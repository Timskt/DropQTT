# DropQTT 需求调研与迭代记录（2026-09）

> **迭代基线**：`main` @ `a2a8565`（v0.9.0）
> **工作分支**：`feat/history-and-workspace-polish`（未提交、未推送）
> **调研方式**：公开资料检索 + 全量源码审计推导痛点。**没有做用户访谈或工单/评论分析**，因此下文的"痛点"是有依据的假设，不是实测结论。

---

## 目录

- [1. 调研证据](#1-调研证据)
- [2. 痛点假设与优先级](#2-痛点假设与优先级)
- [3. 本轮已落地范围](#3-本轮已落地范围)
- [4. 验证矩阵（哪些真跑过）](#4-验证矩阵哪些真跑过)
- [5. 已知限制（必须如实告知）](#5-已知限制必须如实告知)
- [6. 下一轮候选](#6-下一轮候选)

---

## 1. 调研证据

| 来源 | 取到的事实 | 对 DropQTT 的含义 |
| --- | --- | --- |
| [MQTTX README](https://github.com/emqx/MQTTX) | 定位为连接管理 + 报文测试 + 编解码 + 模拟 + 压测的一体化调试客户端 | DropQTT 的差异化在"文件传输 + 桥接"，调试面（历史、导出、回放）需要补齐到可比水平 |
| [EMQX Webhook 数据集成文档](https://docs.emqx.com/en/emqx/latest/data-integration/data-bridge-webhook.html) | 官方把 HTTP 集成用于设备上下线通知、告警、业务系统投递，支持模板与鉴权 | MQTT → HTTP 是高频真实需求，且 DropQTT 已有主题过滤 + JS 转换，可直接复用 |
| [Node-RED MQTT cookbook](https://cookbook.nodered.org/mqtt/connect-to-broker) | 典型链路是"设备/本地 broker → 自动化流"，主题如 `sensors/livingroom/temp` | 本轮三个内置模板（遥测接入、温度告警、边缘汇聚）按这个形状设计 |

结论：**MQTT → Webhook** 是覆盖面最广的扩展点，比"只能两个 Broker 互转"的桥接适用面更大，因此本轮落地它。

---

## 2. 痛点假设与优先级

按"源码证据强度 × 影响面"排序：

| # | 痛点 | 证据 | 处置 |
| --- | --- | --- | --- |
| P1 | 历史列表与趋势图筛选条件不一致，看到的曲线和列表对不上 | `history.rs` 旧 `series()` 只按 topic 过滤、忽略 direction 和 until | **已修**：两者共用同一套谓词 |
| P1 | 被截断的历史消息仍可"重发"，等于把残缺载荷原样发回设备 | 旧 `HistoryPanel` 只判 `payloadBase64` 非空 | **已修**：标志位 + 解码长度双重校验，旧库记录也能识别 |
| P1 | 重发丢失 MQTT5 响应主题/关联数据，RPC 类消息回放后链路断 | 旧代码写死 `userProperties: []` | **已修**：`HistoryRow` 落库 `properties` 列并原样回传 |
| P1 | 桥接重连后不恢复订阅；QoS 改了也不重新订阅 | 旧 `subs` 是 `HashSet<String>`，CONNACK 不触发同步 | **已修**：`filter→qos` 映射 + CONNACK 后重同步 |
| P2 | 脚本超时用全局 `AtomicU64` 截止时间，并发转换互相续命 | `transform.rs` 旧实现 | **已修**：每个 Runtime 持有自己的 `Instant` 截止点 |
| P2 | 无法把 MQTT 数据送到业务系统/API/告警通道 | 桥接目标只有 Broker | **已加**：HTTP/Webhook 目标 + 3 个模板 |
| P2 | 浅色主题下页面主体仍是硬编码深色底，`index.html` 内联样式覆盖主题 | 旧 `index.html` | **已修**：主题在 React 挂载前应用，内联底色移除 |
| P3 | 顶部悬停式 Broker 下拉不可键盘操作、窄窗口被裁切 | 旧 `BrokerStatusBar` 用 `group-hover` | **已修**：换成原生 `<select>` + 可换行的 header |
| — | 过载时被显示缓冲丢弃的消息**同时也不会进历史** | `mqtt_manager.rs:525` `push_feed` 先丢再入批，历史在 `flush_feed` 才写 | **未修**，见 §5 与 §6 |

---

## 3. 本轮已落地范围

### 3.1 历史工作区
- 时间窗新增 **全部时间**（默认），保留 5m/15m/1h/24h。
- 列表与趋势图共用同一 `search / direction / since / until`，SQL `LIKE` 中的 `%` `_` `\` 已转义，避免把搜索词当通配符。
- 排序稳定化：`ts DESC, rowid DESC`。
- 导出当前筛选结果为 JSON / CSV（走原生保存对话框，浏览器环境降级为下载）。
- 载荷查看器：Text / JSON / Hex / Base64 / CBOR 五视图，解析失败就地显示错误。
- 重放保护：不完整载荷禁用按钮并给出原因；空载荷（清除保留消息）允许重放。
- **实时控制台的重放同样补齐** `responseTopic` / `correlationData`（`src/App.tsx`）——此前只有历史面板带属性，从实时流里重放 RPC 请求会丢掉应答地址。Rust 侧 `publish_console` 本来就转发这两个字段，缺的只是前端。
- SQLite 采用**追加式迁移**（`PRAGMA table_info` 检查后 `ALTER TABLE ADD COLUMN`），旧库不丢记录、重复打开幂等。

### 3.2 桥接 / Webhook
- 规则新增 `targetKind: mqtt | http`；HTTP 规则复用全部主题改写、过滤、限速与 JS 转换能力。
- 请求体两种格式：JSON 信封（`topic/qos/retain/timestamp/payload`，二进制走 `payloadBase64`）或原始字节。
- 校验：仅 http/https、必须有 host、禁止 URL 内嵌账号密码与 fragment；禁止手写 `Host/Content-Length/Connection/Transfer-Encoding`。
- 日志与错误信息只输出 `POST <origin>`，路径与 query 中的 token 不落盘、不回显。
- 客户端：连接超时 3s、总超时 10s、**不跟随重定向**、只有 2xx 记成功。
- 并发上限 4（`Semaphore::try_acquire_owned`），超限即计入 dropped，**绝不阻塞 MQTT 轮询任务**。
- 三个可编辑模板：遥测接入业务 API、温度阈值告警、边缘站点汇聚。
- 导出规则时 HTTP 规则**抹掉 URL 与请求头并置为 disabled**（`version: 2`），导入后需重新填写——避免把凭据带进导出文件。
- **修掉一个重连回归**：`resync_subs` 改成用 `?` 直接上抛第一次 `SUBSCRIBE` 失败，会让后面所有连接的订阅恢复被整体中断、且丢失已同步部分。现在逐条尝试、只把**确认成功**的 filter 写回缓存（失败的下一轮自动重试），最后汇总上报第一个错误。

### 3.3 MQTTX 对标补齐（第二轮，2026-10-01）

调研与差距分析见 `docs/ROADMAP_vs_MQTTX.md`；本节只记录已落地部分。

**A 组 · 正确性与安全**
- **A1 mTLS 不再静默降级**：`transport.rs` 原先在 CA/证书/私钥读不到时 `eprintln!` 后继续用系统根证书连接——用户以为在用私有 CA，实际校验走公网信任库。现在一律硬失败，并且**只配了一半的 mTLS（有证书无私钥或反之）也报错**，不再当成"未启用"。
- **A2 过载不再漏史**：`push_feed` 原先在显示缓冲满时直接丢弃最旧行，而历史只在 `flush_feed` 成批写入，**因此高吞吐下被丢的恰好是最该排查的突发段**。现在被淘汰的行进入同样有界的 `feed_archive_only` 队列，由下一次 flush 补写进 SQLite（不进 UI 批次）。队列也饱和时才计入新增的 `feed_lost` 计数。
- **A3 历史故障不再伪装成"无数据"**：`query`/`series` 改为返回 `Result`，并去掉了原先 `filter_map(|x| x.ok())` 对损坏行的静默吞掉。存储不可用与"没有匹配结果"现在在 UI 上可区分。

**B 组 · 协议完整度**
- **B1 MQTT5 订阅选项**：新增 `SubOptions { qos, noLocal, retainAsPublished, retainHandling }`，经 `Filter` + `subscribe_many` 落到线上（rumqttc 0.24 的 `subscribe_with_properties` 不带这三个字段，必须走 Filter 路径）。订阅表由 `HashMap<String, u8>` 改为 `HashMap<String, SubOptions>`，**因此重连后的重订阅会原样恢复选项**。控制台仅在 v5 连接下显示该控件（v3.1.1 无线上等价物，显示出来等于骗人）。

**C 组 · 差异化**
- **C1 控制台载荷编解码**：复用桥接已有的 QuickJS 沙箱与 `bridge_test_transform` 命令，**零新增后端**。关键设计是**仅影响显示**——原始字节始终是权威，历史、导出、重发拿到的都是 broker 投递的原样报文；脚本报错的行保留原文并标红，而不是把内容弄丢。带 LRU 缓存（200 条）避免滚动列表反复调用沙箱。

**顺带修掉的健壮性问题**
- 新增 `ErrorBoundary` 包住工作区：此前任何一处渲染异常都会**白屏整个应用且无任何提示**（实测由一个 null 载荷触发）。现在只显示失败的区域 + 错误信息 + 重试，且切换工作区自动恢复。
- 侧栏桥接副标题从 `Broker ↔ Broker` 更正为 `Broker ↔ Broker / HTTP`。

- 浅色主题（Solaris）主体背景与选中态跟随 CSS 变量；`--text-muted` 对比度 `#a8a29e → #78716c`。
- 顶部栏可换行、右侧组 `ml-auto`；窄窗口无横向溢出。
- 历史行整行可点、带展开指示箭头；悬停态统一。
- 桥接面板在展开表单时隐藏重复的 "Add Rule" 按钮（此前同一视图存在两个同名按钮，语义不同）。

---

### 3.4 IoT 领域能力（第三轮，2026-10-01）

**SenML 读数（RFC 8428）** —— `src/utils/senml.ts`
- 同时支持 JSON 字符串标签与 CBOR 整数标签（`bver=-1, bn=-2, bt=-3, bu=-4, bv=-5, bs=-6, n=0, u=1, v=2, vs=3, vb=4, s=5, t=6, ut=7, vd=8`）；我们的 CBOR 解码器已把整数键字符串化，因此一张表覆盖两种编码
- 基础字段 `bn/bt/bu/bv/bs` 按规范向后继承
- 时间解析遵守 2^28 规则：≥ 该值为绝对 POSIX 秒，< 该值为相对 now 的偏移；记录 `t` 叠加在基时间上
- 校验按规范：拒绝高于支持版本的 `bver`、同包内 `bver` 不一致、以 `_` 结尾的未知标签（关键扩展位）；普通未知标签忽略并告警；仅有基础字段的记录合法；除 `s` 外必须有主值
- 控制台与历史都新增 SenML 视图，`application/senml+json|cbor` 的媒体类型检测排在通用 json/cbor **之前**，无 Content-Type 时退化为结构检测
- **单位只在数值读数上显示**：`bu` 会继承给后续每条记录，否则布尔值旁边会印出 `Cel` 误导读者（实机发现并修正）

**静默看门狗** —— `src-tauri/src/silence.rs`
- 回答 MQTT 客户端普遍答不出的问题：**"这台设备是不是停止上报了？"**
- 规则 = 主题过滤器 + 静默阈值 + 冷却时间 + Webhook 目标；告警走 `webhook::deliver` 同一条有界通道
- **最后上报按"规则"而非"主题"记账**：`topic_stats` 是 LRU 淘汰的，被删掉的恰好是最静默的主题，用它做看门狗会漏报
- **断线即解除武装**：`set_connected(false)` 清空计时基准，避免把"我们自己掉线"报成"设备掉线"；CONNACK 时重新武装并以上报时刻为基准
- **恢复上报即清除冷却**：否则一台抖动快于冷却周期的设备只会告警一次，永远不再告
- 阈值下限 5 秒，因为最后上报只有 1 秒精度
- 评估在独立任务里每秒一次，告警投递 `tokio::spawn` 出去，**绝不阻塞 MQTT 轮询**
- 命名避让：`mqtt_manager` 已有传输超时的 `run_watchdog`，本模块叫 `silence` 以免混淆
- 顺带把 `wildcard_match` 从 `mqtt_manager.rs` 抽到新的 `topic.rs`，这样看门狗不必拖进 Tauri 依赖就能进 harness 测试

### 3.5 界面与主题
- 浅色主题（Solaris）主体背景与选中态跟随 CSS 变量；`--text-muted` 对比度 `#a8a29e → #78716c`。
- 顶部栏可换行、右侧组 `ml-auto`；窄窗口无横向溢出。
- 历史行整行可点、带展开指示箭头；悬停态统一。
- 桥接面板在展开表单时隐藏重复的 "Add Rule" 按钮（此前同一视图存在两个同名按钮，语义不同）。

### 3.6 定时发布后端化（第四轮，2026-10-01）

**问题**：原来的"自动发布"是 `MessagePublisher.tsx` 里的一个 `setInterval`。它有四道硬伤：切工作区/关面板即死、每次回调都要等一轮 IPC 才重新起表、同时只能跑一条、断线后语义不明。对"拿它做长稳测试/模拟设备心跳"这个用途，第一条就足以否决。

**新的分工**（`src-tauri/src/scheduler.rs` + `mqtt_manager.rs::run_schedule`）：
- **纯状态机进 `scheduler.rs`，可脱离 Tauri 单测**：`ScheduleSpec` 校验、`${...}` 模板渲染、载荷编码、注册表（运行/完成/失败/停止四态、计数、错误连击、快照排序）。发布循环留在 `mqtt_manager`，因为它要拿 client 和 feed。
- **复用 `publish_console` 整条链路**，不另开一条发送路径：所以定时消息一样进控制台、一样落 SQLite、一样带 v5 properties。
- **绝对截止时刻网格**：`sleep_until(next)` + `next += period`，落后超过一个周期才重锚（避免睡眠后被补发一串）。
- **断连语义**：`disconnect()` 里 `stop_all()`，而 `connect()` 开头就调 `disconnect()`，所以换 broker 必然清空上一会话的任务；内部自动重连**不**影响任务（rumqttc 会把发布缓存在通道里）。
- **失败语义**：连续 5 次发布失败才判 `failed`（单次抖动不算），编码类确定性错误直接 `failed` 并带上原因；错误串在面板上逐行显示。
- **进度靠轮询，终态靠事件**：`schedule-event` 只在完成/失败/停止时发，高频任务不会把 IPC 打满。
- **上限**：并发 32 条、周期 50 ms ~ 24 h，发布主题禁止通配符。
- **CBOR 明确不支持定时**（后端没有 CBOR 编码器），界面直接禁用"开始"并说明原因，而不是静默发出错误字节。
- 顺带修掉一个真 bug：编辑器对模板载荷的实时校验拿**未渲染**的文本去 `JSON.parse`，于是 `{"seq":${counter}}` 永远显示"⚠ invalid"，而两条发送路径其实都是先渲染再编码。现在按渲染后的探针结果判定。

**边界（不夸大）**：任务本身是**会话级**的——重启应用不会恢复任务，重启窗口（`reload`）会。持久化的是节奏与次数默认值。"保存一组定时任务并在启动时自动恢复"另列为 C2b。

### 3.7 压测台补齐（第四轮，2026-10-01）

原来只有一个"开始压测"：QoS 写死 0、不能停、单主题、只报发送数——`mqttx bench` 有的观测维度它基本都没有。

**新的分工**（`src-tauri/src/bench.rs` + `mqtt_manager.rs::run_bench`）：
- **多主题轮询**：`rate` 是**总量**（跨主题），每条消息按 `1e6/rate` µs 的绝对网格发出，与定时发布同一套防漂移写法。
- **QoS 0/1/2 + retain 可选**；`durationSec = 0` 表示一直跑到手动停止。
- **可停止**：`BenchManager` 注册表保存每个运行的取消位与 `JoinHandle`，`bench_stop(id)` 立即生效；上限 4 个并发运行。
- **回环延迟分位数**：载荷头部带 `magic + seq + 发送时刻`，broker 回环到自己订阅时即可算出 publish→回来的耗时；`p50/p95/p99/max/mean` 由**最近 10000 个样本**给出，被挤掉的样本数单独报为 `dropped`，不让"窗口分位数"冒充全量分位数。
- **发送 vs 确认**：`transport.rs` 新增 `NetEvent::PublishAcked`（QoS1 的 PUBACK、QoS2 最终半程的 PUBCOMP），面板据此显示 `sent / acked` 差值——这是看客户端 inflight 是否堵住的直接指标。桥接那侧不需要就明确写了空分支。
- **载荷小于 15 字节时不强塞头部**：保持用户要求的字节数，代价是这一轮没有延迟样本，界面显示 `timed 0` 而不是显示 0 ms 骗人。
- **进度是 500 ms 一次的事件 + 面板 1 s 轮询**，20k msg/s 也不会产生每条一个 IPC。

### 3.8 MQTT5 协议字段补全（第四轮，2026-10-01）

- **发布侧新增**：Payload Format Indicator（0=字节流 / 1=UTF-8 / 不设置=属性完全不上线）、Topic Alias。二者与原有 content-type / message-expiry / response-topic / correlation-data / user properties 一起进 v5 属性面板。
- **连接侧新增**：`Session-Expiry-Interval`（走 CONNECT properties，rumqttc 没有专用 setter，因此对 `connect_properties()` 读-改-写，避免覆盖已设的 max-packet-size）、`Will Delay Interval`、遗嘱 `Content-Type`。
- **入站可见性**：`NormalizedPublish` 与 `MqttGenericMessage` 带上 `payload_format`，控制台用 `UTF-8`/`BYTES` 徽标显示**发布方声明**的格式（与"我们从字节猜出来的"区分开），并随历史 properties 一起入库，重放时保持同一声明。
- **主题别名受 broker 通告上限约束**（本轮最重要的发现，见 §4.9）：CONNACK 的 `topic-alias-maximum` 为 0 时硬发别名，rumqttc 会当协议错误**把整条连接拆掉**。现在在 `publish_console` 前置校验，返回可读错误而连接不受牵连。
- **桥接的转发策略**：`content-type`/`user-properties`/`response-topic`/`correlation-data`/`payload-format` 跨跳转发；**主题别名故意不转发** —— 别名只在单条连接内有意义，链到另一条连接上就是错的。
- 遗嘱属性、Session-Expiry 在 v3.1.1 连接上不渲染（界面按 `protocolVersion === 5` 收敛）。

### 3.9 审计复核与"不再撒谎"的三条控制路径（第五轮，2026-10-02）

拿一份独立只读审计（工作区里的 `PROJECT_ANALYSIS_v0.9.md`，**未**纳入版本库，留给我自己判断）逐条**先复核再动手**，因为审计报告本身也有不准的条目：

- **P0-1 桥接静默丢包**：规则的目标连接不在时，代码 `continue` —— 既不计数也不告诉界面。现在这条路会 `bump(rule.id, false)` 并发一条带原因（`target connection 'x' is not connected`）的 `bridge-event`，规则行的失败计数与浮层都能看到。**丢包必须留下账，哪怕没人来看。**
- **P0-2 历史写失败被当成"查无此记录"**：`history.rs` 新增 `lost_rows` 累计器 —— 拿不到锁 = 整批、COMMIT 失败 = 整批、单行失败 = 逐条；进 `MqttDiagnostics`，`history_store` 健康检查在丢失 > 0 时转 `warn`。
- **P0-3 控制命令对未知 id 撒谎**：`pause_transfer` / `resume_transfer` / `cancel_transfer` 原来返回 `()`，找不到目标时什么都发生不了、界面还显示"已操作"。现在统一 `Result<(), String>`，错误串直接指出是哪一个方向、哪一个 id 找不到。
  - 审计这条**部分不准**：它说 `approve/reject` 也一样撒谎，实际上那两个早已返回 `Result`。
  - 审计**漏了一条更重的**：`cancel_transfer` 只对发送方向有效，接收中的传输点"取消"是彻底空操作 —— 现在接收方向走 `reject_transfer`，会删临时文件并回一条 ERROR 控制消息。
- **验证过程中我自己发现的新缺陷（审计没有，正向用例也没有覆盖到）**：接收端的 finalize 任务与"取消"抢跑 —— 取消已经把条目摘掉、临时文件删掉，finalize 仍在跑 SHA 校验，跑完**无条件**广播 `awaiting_approval`（或自动接收的 `completed`），于是队列里冒出一行指向已不存在文件的"待确认接收"，点它只会得到一个"No such file"。修法是把**"取消即失去所有权"做成不变量**：三条终态分支（校验失败 / 自动接收 / 待确认）各自在锁内 claim 条目，claim 失败就彻底闭嘴 —— 不广播，也不给发送端发伪造的"SHA 校验失败"。

### 3.10 MQTT5 请求/响应成为一等公民（第六轮，2026-10-02）

之前 `responseTopic` / `correlationData` 只是"能发出去"的协议字段（§3.8），发完就没人管了。这一轮把它变成**真正的请求-响应**：

- **入口**：发布面板 v5 属性区新增 `等待应答` 勾选与 `超时 (ms)`（默认 5000，后端钳制 100 ms–120 s）。勾选后同一个"发布"按钮改走 `rpc_request`，未勾选时行为与过去完全一致（`tests/ui/rpc.spec.ts` 第 6 条专门钉住这点）。
- **应答主题留空即自动生成** `<base_topic>/rpc/<id 前 8 位>`（取自连接配置里的 base topic，不是写死的 `dropqtt`），关联数据留空则用本次调用的 uuid。生成的主题会在行内显示出来，用户因此知道"对方该往哪儿回"。
- **配对规则（顺序即优先级）**：① 入站主题的 `correlationData` 与请求相等 → 精确配对；② 应答**没带** correlationData → 与该应答主题上**最早**的未决请求按先后配对，并把这一"更弱的结论"永久标在行上（`pairedByPosition`），不伪装成精确匹配；③ 应答带了**别人的** correlationData → 与我们无关，请求继续等（真机验证过，见 §4.16）。
- **临时订阅是引用计数的**（`rpc.rs::ResponseWatch`）：解析/超时/清除/断链都会 release；最后一个引用释放时才 `unsubscribe`。若这个应答主题**用户本来就自己订阅过**，我们只借用、绝不替他退订。
- **断链即终态**：`disconnect()` 把所有未决调用一次转成超时（`expire_all`），不留"永远待应答"的幽灵行，也不会把这个临时订阅重放到下一个 broker 上。
- **往返延迟的定义**：`发出那一刻 → 收到应答那一刻`，不是 ack 时间；因此它包含对端的处理耗时，界面标签写的是"往返"而不是"网络延迟"。
- 运维诊断新增 `待应答请求 / 无应答请求` 两个计数与健康检查 `rpc_activity`（有超时时转 warn，文案直接问"是否有人订阅了应答主题"）。
- 与定时发布一样是**会话级**的：调用活在 Rust，面板卸载/`reload` 不丢，重启应用不恢复。

### 3.11 审计报告第二批：静默失败、协议合法性与六个重复实现（第七轮，2026-10-02）

`PROJECT_ANALYSIS_v0.9.md` 的 P0 三条已在 §3.9 处理。这一轮把它剩下的条目**逐条对着当前代码复核**（报告写于 v0.9.0 基线，本轮之前的改动已经让它的一部分过期），成立的十项全部修掉：

**先说复核掉的那条**：报告 P1-1"300 秒无条件清理 outgoing，长传输中途 pause/cancel 会静默失效"—— §4.11 的确认窗口（`confirm_grace_secs`，30 s + 1 s/MiB，上限 900 s，且只在最后一片发出后才起算）已经把它替换掉了；现在的清理**只对未确认的已完成发送**发生，进行中的传输不会被摘走条目，再叠加 P0-3 让未知 id 直接报错，这条已经不成立。**审计报告里我核掉的就是这一条。**

成立并修掉的：

- **N-P0-1 → 主题合法性前置校验**（`topic.rs::publish_topic_error` / `filter_topic_error`）。发布主题含 `+`/`#`（任意位置）、空层级、NUL、超 65535 字节一律拒绝；订阅过滤器另加规则：`#` 只能独占最后一级、`+` 只能独占一级。**接入点**：控制台发布、订阅、RPC 请求、文件传输的自定义频道主题。设计上的两个刻意选择：① `$SYS/...` 这类发布**我们不拦**（拦了就没法观察 broker 自己的拒绝行为，这是调试工具的分内事）；② 调度器/压测台上一轮已有同类检查，本轮**没有重复实现**，只是把控制台/订阅/传输这三条漏网路径补齐。
- **P1-13 → CSV 公式注入**。主题与报文是**外部可控**的：任何人都能往 broker 发一个名叫 `=cmd|'/c calc'!A1` 的主题，导出 CSV 后用 Excel 打开就触发求值。光加引号没用（带引号的 `=` 单元格照样求值），所以新增 `src/utils/csv.ts`：首字符属于 `= + - @ \t \r` 的**字符串**单元格前置单引号（数字/布尔不动，否则速率列会坏），并统一了原先三处各写各的转义（`TopicTrafficPanel` / `exportMessages` / 历史的 `fmtBytes` 邻域）。
- **P2-22 → 关窗现在是干净断开**。以前窗口一关进程就撕 socket，对端看到的是异常断连。现在 `CloseRequested` 先 `prevent_close()`，在 **1.2 s 上限**内 `mqtt.disconnect()` + `bridge.disconnect_all()`，然后 `window.destroy()` —— 超时会照样销毁，**不会把用户关在打不开的窗口里**。
- **P2-10 → 桥接 clientId 的唯一性后缀不再被截断**。原来是 `format!("{id}_b{suffix}").take(23)`：长 id 会把 `_bsuffix` 截掉，两个长 id 的会话反而**互相踢下线**。现在截的是基名、后缀必留，且 v5 根本不截（23 是 MQTT 3.1 的历史限制）。
- **P2-13 → keepAlive 单一来源**：后端 `clamp_keep_alive`（5–600）成为权威，UI 同界。手改配置文件里的 100000 秒不再能把会话拖进未定义行为。
- **P2-23 → 订阅注册失败不再被吞**：`useBroker` 连接后的订阅循环原来是 `.catch(() => {})`。ACL 拒绝或畸形过滤器**不是瞬时错误**，重试也一样失败，所以汇总成一条 toast（`{count}` + 第一条原因）。
- **P1-3 → 批次不再"失败也放彩带"**：只有**全部** `delivered` 才庆祝 + 成功 toast；否则红色汇总 toast 说清 `{delivered} 送达 / {other} 未确认或失败`。取消分支保持不庆祝。
- **P1-9 → 六个 `formatBytes` 合成一个**（`src/utils/format.ts`）。规则：字节取整、KB 一位小数、MB 及以上两位小数。其中发布器那份**根本没有 MB 分支**，30 MB 会显示成 `30720.00 KB`。
- **P2-2 → 硬编码英文界面文案**：侧边栏（工作区模式与四个副标题）、`模板`/`格式化`/`发送中…`、报文截断提示与"点击展开"、Markdown 代码块的复制/已复制、broker 用户名占位符、五个分块尺寸说明，全部进 i18n（4 语言齐）。非组件环境（hooks、`marked` 渲染器）需要文案时走新增的 `currentTranslations()`，读同一个 `dropqtt_lang`，保证 toast 不会串语言。
- **P2-20 → `auto_receive` 不再直读 localStorage**：改走 `usePersistentState<boolean>`；JSON 布尔序列化后恰好是 `true`/`false`，与旧值**字节兼容，无需迁移**。
- **P2-4/5/7 → 死配置与死依赖清理**：`tailwind.config.js` 的 `pulse-slow`（零引用）、`themes/index.ts` 的 `themeBodyBg`（注释自称"legacy props"，实际零引用）、`Cargo.toml` 里从未使用的 `thiserror`。

### 3.12 共享订阅：消费端的水平扩展（第九轮，2026-10-02）

审计把"共享订阅"列在协议补齐的第一条（§7.1），它也是 IoT 里真实会撞到的一组需求：**上游是百万设备、下游是少量消费者**，一个消费者吃不下，就要多个实例共摊同一个主题族。MQTT5 的机制是 `$share/<ShareName>/<TopicFilter>`（[EMQX 的说明](https://www.emqx.com/en/blog/introduction-to-mqtt5-protocol-shared-subscription)：组内**轮流派发**，参与者必须用**同一组名 + 同一过滤器**才会进同一个池；同组内 QoS 要一致，否则投递质量不可预测；会话过期时间要小心，过长的 session-expiry 会把消息投给已离线的成员）。[HiveMQ 的 MQTT5 系列](https://www.hivemq.com/blog/mqtt5-essentials-part7-shared-subscriptions/) 也把它列为规范内的标准能力。这轮把它做成一等公民：

- **订阅侧**：v5 连接上多出一个"共享订阅"开关与组名输入（v3.1.1 不显示——协议里没有这个机制）。打开后过滤器组合成 `$share/<组>/<主题>`；**组名为空时不允许提交**，否则会拼出半截的非法过滤器。列表里每条共享订阅带一个"共享组 X"的徽标。
- **校验（后端权威）**：组名不能含 `/`、`+`、`#`（含 `/` 会移动组与过滤器的边界），不能以 `$` 开头（`$` 前缀是 broker 保留的），不能嵌套 `$share`。**并且先跑共享规则再跑通用过滤器规则** —— `$share/a+b/x` 的正确诊断是"组名不能含 +"，而不是"通配符必须独占一级"，后者会让用户去改一个他根本没写错的 topic filter。
- **共享订阅 + No Local 直接拒绝**，理由有出处：[Mosquitto 2.1.0 变更记录](https://github.com/eclipse-mosquitto/mosquitto/blob/master/ChangeLog.txt)写明"客户端订阅共享主题又设置 no-local 时返回协议错误"。我们提前给出可读拒绝，而不是让用户去线上等一个 SUBACK 意外。No Local 在普通订阅上照旧可用。
- **命中计数修的是隐蔽正确性问题**：broker 派发给组成员时**送的是原始主题名**（`$share/` 前缀被剥掉），而 `wildcard_match` 原本按字面比较，所以共享订阅**明明在收消息，命中数却永远是 0**，顺带让按主题过滤的规则/看门狗也匹配不上。现在 `wildcard_match` 先剥 `$share/<组>/` 再比对内层过滤器，`$` 开头主题仍走原有系统主题规则。

**市场对标（这次不是凭感觉）**：MQTTX 的差异化在"多连接 GUI + 场景化数据模拟"——[1.9.3 起有 IoT scenario 数据仿真](https://www.emqx.com/en/blog/mqttx-v-1-9-3-release-notes)。我们在**协议深度**这一路继续拉开差距：共享订阅这类生产端扩展机制，MQTTX 的订阅表单并不暴露；而我们的部署场景（咖啡馆网关、边缘汇聚）恰好是"一个入口、多个下游 worker"。所以这个功能对我们的用户比"再画一个设备模拟器"更有价值，也符合 §6 既定的"按报文深度而不是客户端广度取胜"的路线。

## 4. 验证矩阵（哪些真跑过）

| 项目 | 命令 | 结果 | 说明 |
| --- | --- | --- | --- |
| 前端类型检查 | `npx tsc --noEmit` | ✅ 通过 | |
| 前端单元测试 | `npm test`（= `vitest run tests/unit`） | ✅ **20/20** | SenML 16 + 历史 4；注意裸跑 `npx vitest run` 会把 Playwright 用例也收进来而报"文件加载失败"，脚本已限定 `tests/unit` |
| 浏览器 UI 测试 | `npx playwright test` | ✅ **18/18** | 5 个 spec 文件：workspaces 4 + scheduler 5 + codec 5 + silence 2 + subscribe-options 2；见下方"验证边界" |
| 界面目视核对 | 真机截图（Cyberpunk 中文界面，定时发布进行中） | ✅ 已逐张查看 | `test-results/live-scheduler.png`：运行中/已完成/已停止三种状态、并行任务、模板渲染后的报文流 |
| **Rust 单元测试** | `cargo clippy/test`（gnu harness，见 §4.1） | ✅ **60/60 通过** | 含本轮新增 `scheduler` 14 条 |
| **Rust clippy** | `cargo clippy --all-targets` | ✅ 零告警 | CI 用 `-D warnings`，此处已提前把关 |
| `bridge.rs` / `mqtt_manager.rs` / `lib.rs` | — | ⚠️ **gnu harness 覆盖不到**（依赖 `tauri::AppHandle`），但已通过下面的真机端到端验证 | 见 §4.3、§4.7 |
| **真机端到端：MQTT → 桥接 → Webhook** | 本地 aedes broker + 本地 HTTP sink + 真实 Tauri 应用 | ✅ **通过** | 见 §4.3，截图 `test-results/app-cdp.png` |
| **真机端到端：后端定时发布精度** | 第二个 mosquitto 实例 + 真实窗口 + SQLite 时间戳 | ✅ **通过** | 见 §4.7，含一次"实测推翻自己注释"的修正 |

### 4.1 Rust 是怎么跑起来的

本机 MSVC 链接不可用（原因见 §5.1），因此装了一套**独立的 gnu 工具链**并搭了一个仓库外的验证壳：

```bash
rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal --component clippy
# harness 在 ~/dropqtt-rustcheck，用绝对路径 #[path] 直接引用仓库里的真实源文件
cd ~/dropqtt-rustcheck && cargo +stable-x86_64-pc-windows-gnu test
```

要点：harness **不复制代码**，而是 `#[path = "D:/code/ai/DropQTT/src-tauri/src/history.rs"] mod history;`，跑的就是仓库里那份文件；它只纳入不依赖 Tauri 的 4 个模块（`protocol` / `history` / `webhook` / `transform`）。这套壳在仓库外、不提交，但值得留着——以后改 Rust 不必等 CI 才发现低级错误。

### 4.2 已被执行验证的关键行为

- `legacy_database_is_migrated_without_losing_rows`：手工造一张 v0.9 的旧表（无 `properties`/`truncated` 列）→ 打开迁移 → 再打开一次，确认**幂等**且旧记录可读、新列默认值正确。
- `filters_match_chart_and_treat_sql_wildcards_literally`：搜索词 `load_50%` 不被当作 SQL 通配符，且列表与趋势图计数一致。
- `history_preserves_properties_and_detects_incomplete_payloads`：MQTT5 响应主题/关联数据往返保真；解码长度与 `payload_len` 不符的旧记录被判定为截断。
- `posts_json_envelope_with_headers_to_a_local_endpoint`：真实 TCP 回环服务器收到 `POST /hook?token=... HTTP/1.1`、`content-type: application/json`、`authorization: Bearer local-only` 与完整信封。
- `non_2xx_and_redirects_are_errors_without_leaking_the_url`：500 与 302 都记为失败（**不跟随重定向**），错误串里不含路径与 token。
- `runaway_loop_dies_even_while_other_scripts_keep_starting`：另起线程每 5ms 触发一次正常转换，`while(true)` 脚本仍必须在数秒内被杀——这正是旧的共享 `DEADLINE_MS` 静态量做不到的。

### 4.3 真机端到端（本轮最有价值的验证）

Tauri 应用**可以用 gnu 工具链完整构建并运行**（`cargo build` 32 分钟，产出 `src-tauri/target/debug/dropqtt.exe`，`webview2-com` / `embed-resource` / `rusqlite` / `rquickjs` / `reqwest` 全部通过）。启动方式：先起 Vite（`devUrl` 指向 `localhost:1420`），再直接跑该 exe。

链路全部留在 127.0.0.1，**没有向任何外部系统发消息**（你本机的 mosquitto 占着 1883，所以 lab broker 特意用 18830，未触碰）：

```
aedes broker (127.0.0.1:18830)
   └─ DropQTT 桥接 src 连接 · 订阅 sensors/+/telemetry
        └─ rule: targetKind=http → QuickJS transform → webhook.rs POST
             └─ HTTP sink (127.0.0.1:8081)
```

实测结果：

| 用例 | 结果 |
| --- | --- |
| JSON 信封投递 | `POST /events` · `content-type: application/json` · body `{"payload":"{\"temperature\":51.4,...}","qos":1,"retain":false,"timestamp":...,"topic":"sensors/room1/telemetry"}` ✅ |
| raw + JS 转换 | `POST /alert` · `content-type: application/octet-stream` · body `{"alert":"HIGH TEMP 44.4","device":"edge-9","from":"sensors/room2/telemetry"}` ✅ |
| `transform` 返回 `null` | 21℃ 那条**没有产生任何 POST**，计入 `dropped` ✅ |
| 规则统计 | `bridge_stats` → `{"forwarded":3,"errors":0,"dropped":1}` ✅ |
| 启动自动重连 | 应用冷启动后 `bridge_status` 即 `connected:true · 127.0.0.1:18830` ✅ |
| 界面 | 集成场景模板三张卡片、"启动时自动重连"、转发源"已连接"、侧栏 `Broker ↔ Broker / HTTP` 全部中文正常渲染 ✅ |

这一并覆盖了 gnu harness 碰不到的 `bridge.rs` 路由、`transport.rs` 连接、以及 `webhook.rs` 在真实进程里的投递。

**仍未覆盖**：MQTT 文件传输工作区的分块收发、TLS/mTLS 连接、`$SYS` 监控、SQLite 历史在真实高吞吐下的表现。


### 4.4 验证边界（务必区分）

Playwright 用例通过 `window.__TAURI_INTERNALS__` 桩替换了 IPC，它证明的是"React 组件在给定数据下的渲染与交互正确"，**不是**后端行为——后端行为由 §4.2（单元测试）、§4.3 与 §4.5（真机）负责。

### 4.5 第二轮（A/B/C1）实测结果

**测试规模**：`tsc` ✅ · `vitest` 4/4 ✅ · `playwright` **9/9** ✅（第一轮 4 条）· `vite build` ✅ · Rust **32/32** ✅ · clippy 零告警 ✅

**真机验证环境**：重新构建 `dropqtt.exe`（增量 2 分 8 秒），并用 WebView2 的 `--remote-debugging-port` 直接驱动真实窗口。

> **重要环境发现**：`aedes` 1.2 的 `lib/handlers/connect.js:65` 判定 `protocolVersion < 3 || > 4`，**根本不接受 MQTT5**（独立 mqtt.js 客户端同样被拒 "Unacceptable protocol version"）。所以凡涉及 v5 线上语义，不能用 aedes 验证。本轮改用**第二个 mosquitto 实例（127.0.0.1:18831，临时配置、无持久化）**，并且**全程未触碰用户自己跑在 1883 的 mosquitto 服务**。

| 项 | 验证方式 | 实测结果 |
| --- | --- | --- |
| A1 mTLS 硬失败 | 真机 `connect_broker` + 不存在的 CA 路径 | `REJECTED: TLS CA file 'C:/definitely/missing-ca.pem' is unreadable: …(os error 3)` |
| A1 半配置 mTLS | 只给证书不给私钥 | `REJECTED: mTLS client certificate set without a private key` |
| A2 过载不漏史 | 订阅后灌 **30000** 条 | `feedDropped: 19200`、**`feedLost: 0`**、**`historyRows: 30000`** —— 显示缓冲溢出但历史全量入库（修复前这 19200 条会静默消失） |
| B1 v5 连接 | mosquitto 18831 + `protocolVersion: 5` | `connected: true`；`$SYS` 面板正确指纹出 `mosquitto version 2.0.15`、连接数 1 |
| B1 **noLocal 上线** | 行为学证明：自发自收 | 同时订阅 `lab/nl`(noLocal) 与 `lab/allow`，各由本客户端发一条 → 主题统计只有 `lab/allow: 1`，`lab/nl` 为 0 |
| C1 编解码 | Playwright 3 条 | 显示被改写为 `TEMP=21.5`；脚本报错时原文仍在并标红 `Codec failed`；**重发出去的仍是原始字节** |

**B1 为什么用行为学而不是抓包**：我一开始写了个 TCP 代理去解 SUBSCRIBE 的选项位，但 CONNECT 的协议级别偏移算错（`4+n` 写成了 `6+n`），继续修一个自制解码器只会带来假信心。改为"开 noLocal 后自己发布的消息不该回到自己"——由真实 broker 执行、结果可判定，证据强度更高。

**仍未验证**：A3 的错误分支在真机上未主动触发（逻辑由 `storage_failure_is_not_reported_as_empty_results` 单测覆盖）；`ErrorBoundary` 的回退界面只有代码路径审查，没有 Playwright 用例。

### 4.6 静默看门狗真机时序验证

用第二个 mosquitto 实例（127.0.0.1:18831）+ 本地 HTTP sink，规则 `devices/+/hb`，阈值 8 秒：

| 观察 | 证据 |
| --- | --- |
| 阈值精确性 | 最后一次心跳 `lastSeen=02:42:24`，首条告警 `generatedAt=02:42:32`、`silentForSec: 8` |
| 持续离线按冷却复告 | 冷却 15 秒时 `silentForSec` 依次 8 → 23 → 38 → 53 → 68 → 83（严格 +15） |
| **恢复清除抑制** | 冷却设为 60 秒：恢复前告警约在 `02:45:22`，设备在 `02:45:26` 重新上报后，下一次告警约在 `02:45:34` —— **间隔仅 12 秒，远小于 60 秒冷却**，证明恢复会清零计时与抑制 |
| 告警文档机器可读 | `{"type":"dropqtt.silence","ruleId","topicFilter","timeoutSec","silentForSec","lastSeen"(RFC3339),"generatedAt"}`，`content-type: application/json`（即使规则存为 raw） |
| 不阻塞 MQTT | 告警期间心跳与流量统计持续正常更新 |



---

### 4.7 定时发布真机精度验证

环境：第二个 mosquitto 实例（127.0.0.1:18831，临时配置，用完即关；**全程未触碰用户自己跑在 1883 的服务**），真实 `dropqtt.exe` 窗口经 WebView2 CDP 驱动。
**度量口径**：任务发布 → 经真实 broker → 由本客户端订阅回环 → 落 SQLite 的**入站**行；间隔用行上的 `timestamp_ms` 算，**不采信调度器自己的计数**。

| 观察 | 证据 |
| --- | --- |
| **生命周期（本功能的立身之本）** | 用真实 UI 点击"开始"起两条任务，随后 `page.reload()` 把整棵 React 树（连同任何前端计时器）销毁：两条任务的 `sent` 仍从 56 → 100、7 → 19 → 20 继续跑到 `completed`，任务 `id` 不变 |
| 绝对网格精度 | 100 × 50 ms → 首末跨 **4949 ms**（理想 4950）；20 × 250 ms → 跨 **4758 ms**（理想 4750） |
| 并行互不干扰 | 两条同时运行，各自 p50 = **47 ms / 250 ms**；单条到达间隔有抖动（fast min 1 / p95 66 / max 104 ms），但总跨度锁死在理想值，说明抖动来自回环接收路径而非发送调度 |
| 模板渲染 | 入站报文 `seq` 为 **1..100 / 1..20 严格递增**；`${iso}` 渲染出真实 RFC3339；截图里可见 14:04:27.149 → .293 → .396 → .503（≈120 ms） |
| 双份留痕 | 每条定时发布都留下 `out` 行（100/100、20/20），回环 `in` 行同样齐全 |
| 断连语义 | 无限任务在 `disconnect_broker` 后 `running → stopped`；已完成任务保持 `completed` 不被改写 |
| **老实现对照** | 同样 100 × 50 ms，用前端 `setInterval` + `await invoke` 跑：跨 **6191.8 ms**（理想 4950，**+25%、多花 1.24 秒**） |

**这一条是量出来的，不是推出来的**：第一版我用 `tokio::time::interval` + `MissedTickBehavior::Delay`，实测 60 × 100 ms 跨了 **6549 ms**（p50 110 ms）——Delay 从"这一 tick 被观察到的时刻"重新起表，于是每次发布的耗时都被加进周期，正是我自己在注释里断言"不会累加"的那件事。改成显式绝对截止时刻后才拿到上表的数字。教训：**速率类断言必须实测，注释里的推理不算证据。**

**未覆盖**：睡眠/唤醒后的重锚行为（需要真等挂起，未做）；32 条并发上限只由单测与 `preflight` 保证，真机最多同时跑过 3 条。

### 4.8 压测台真机验证

环境同 §4.7（127.0.0.1:18831 的第二个 mosquitto 实例，用完即关；未触碰用户 1883 服务）。订阅 `bench/#` 后由 broker 回环，因此"broker 侧看到了多少条"是可独立核对的。

| 观察 | 证据 |
| --- | --- |
| 多主题轮询 | 3 主题、请求 2000/s：流量榜显示 `bench/a` 526 / `bench/b` 525 / `bench/c` 525（差 1 条，正是轮询形状） |
| QoS1 确认计数 | `sent=1576 · acked=1555`，且运行结束后 `acked` 不再变化 |
| QoS0 没有确认 | `sent=260 · acked=0` —— 线上本来就没有 PUBACK，所以界面只在 QoS>0 时显示这一列 |
| 回环延迟分位数 | QoS1：`p50 1 · p95 129 · p99 223 · max 330 ms`；QoS0：`p50 1 · p95 2 · p99 6 · max 11 ms`（同机 QoS0 明显更紧，符合预期） |
| 载荷太小不造假 | `size=8` 时 `timed=0`、分位数全 0，界面显示 `timed 0` 而不是拿 0 ms 冒充样本 |
| **停止是真停了** | 两个采样点**都取在 `bench_stop` 返回之后**：计数 358 → 358，broker 侧 2 秒窗口新增 **0** 条；定时发布同样为 0 |
| 校验在后端 | `bench/+/wild` 被拒：`'bench/+/wild' is a subscription filter, not a publish topic` |

**两条被真机纠正的记录**：
1. 第一版 `elapsedMs` 对已结束的运行仍在增长，看起来像"跑不完"。改为进入终态时记下 `finished_ms`，并补了"停止后 elapsed 与 sent 都不再变化"的单测。
2. 我一度判定"停止后还在发布"是漏杀任务。但那次比较的两个数跨过了 stop 的 CDP 往返（一次 `get_topic_stats` 就要几百毫秒），增长发生在 stop **之前**。改成"只在 stop 返回之后取两个样本"重测，增量为 0。**结论：是测量口径错了，不是代码错了** —— 而只有把 broker 侧计数拉进来做交叉验证，才分得清这两件事。

### 4.9 v5 属性的线上取证

`mosquitto_sub -d` 只打印包络行，**不打印 v5 属性**，所以它当不了这轮的证人。改用一个只说最小 MQTT5 的本地 TCP sink（127.0.0.1:18832），把属性字节段解出来。

**先证明证人可信**：用 `mosquitto_pub` 作参考编码器 —— `-D publish payload-format-indicator 1 -D publish topic-alias 7 -D publish content-type text/plain -D publish message-expiry-interval 60` 后，sink 输出 `payload-format-indicator=1 topic-alias=7 content-type=text/plain message-expiry-interval=60`；`mosquitto_sub -x 120` 的 CONNECT 解出 `receive-maximum=20`（mosquitto 默认值，说明属性块边界算对了）。第一轮我还写错过：把固定头里的 dup/qos/retain 当成变量头首字节、v5 CONNACK/SUBACK 少写属性长度字节 —— 都是参考客户端当场逼出来的。

应用自己的字节：

| 字段 | sink 解出 |
| --- | --- |
| CONNECT · Session-Expiry | `session-expiry-interval=120` |
| CONNECT · 遗嘱 | `topic=lab/will/exit payload=gone-dark qos=1 retain=0` |
| CONNECT · 遗嘱属性 | `will-delay-interval=5 content-type=text/plain` |
| PUBLISH · 声明 UTF-8 | `payload-format-indicator=1 message-expiry-interval=45` |
| PUBLISH · 声明字节流 | `payload-format-indicator=0`（0 与"不设置"是两件事） |
| PUBLISH · 什么都不设 | `publish properties: (none)` |

**主题别名：一次真实的静默故障。** 对着通告"不支持别名"的 sink 发 `topicAlias: 7`，`publish_console` **返回成功但连接直接掉线**（rumqttc 把它当协议错误拆链）。现在 `publish_console` 先按 CONNACK 的 `topic-alias-maximum` 判定：
`rejected(broker announced no topic-alias support; cannot send alias 7 (clear it to publish))`，且 `connected: true` —— 错误可读、连接无恙。

**取证边界（不夸大）**：sink 的属性表对我暂时不关心的后续属性仍会错位（它把一个 user property 印成了 `reason-string=trace`），所以本表只列参考客户端已验证正确的字段。**入站别名解析未做线上验证**：依据是 `rumqttc-0.24.0/src/v5/state.rs:315-331` 在把包交给我们先就把 `publish.topic` 补全了，因此我们的控制台天然看到真实主题 —— 这是读源码得到的结论，不是跑出来的。

### 4.10 文件传输工作区真机双端验证（此前从未覆盖）

两个 `dropqtt.exe` 实例 + 第二个 mosquitto 实例（18831），一个当发送方一个当接收方，走真实界面操作（订阅、开关"自动接收"、点"接收保存/拒绝"、暂停·继续）。

| 项 | 证据 |
| --- | --- |
| 分片流式传输 | 8 MB / **128 片**、20 MB / **320 片**、60 MB / **960 片** 全部 `分片进度: n/n` 收齐 |
| 端到端完整性 | 60 MB 源文件与落盘文件 sha256 **完全一致**（`e4d9d5fedd038f55…fa2b99`）；8 MB 同样一致；接收端界面显示的 SHA 与源文件前缀一致 |
| 接收审批交互 | 关掉"自动接收文件"后进入 `待确认接收`；点"接收保存"→ 落盘；点"拒绝"→ 行变 `已取消` 且 `.dropqtt_*.tmp` 被清掉 |
| 暂停 / 继续 | 60 MB 传输中点暂停：`已暂停 · 16.06 MB / 60 MB · 分片进度: 257/960`，随后"继续"控件出现并可恢复，最终 960/960 校验通过 |
| 保存目录设置 | 接收目录经 `set_download_dir` 指到临时目录，文件确实落在那里（不污染用户下载夹） |
| 发送端断网韧性 | 传输中杀掉 broker 再拉起：发送端仍把 **640/640** 全部推完（rumqttc 缓冲重发），未丢未报错 |

**修掉一个真实缺陷**：发送端从不订阅自己的 `<prefix>/ctrl/<id>`，于是接收端的 **NACK 重传请求永远收不到**，`COMPLETED` 回执也收不到 —— 接收端明明"校验通过"，发送端却永远停在"已发送·待对端确认"。现在 `send_file` 自动登记该订阅（进注册表，所以断线重连会重放），传输结束 300 秒后随 `unsubscribe_topic` 一并撤销。修后实测：发送端订阅表出现 `resilient/files/ctrl/<uuid>`，行状态变成 **校验通过** ✓

**仍未解决 / 需要决策**：
- ~~断网实验中发送端永远停在"待对端确认"~~ → **本轮已实现确认超时**，见 §4.11。
- 真正的 NACK 重传分支（缺哪片补哪片）在修好订阅后**仍未被线上触发过**：需要精确丢包，本地回环做不到。
- 原生文件选择对话框无法脚本化，所以"选文件"这一步是人工/间接路径；发送本身走的是应用自己的 `start_send_file` 命令。

### 4.11 对端确认超时（决策 + 实现 + 实测）

**决策**：加超时，**不自动重发**。理由：字节已经全部离开本机，重发是拿用户带宽赌一个未知状态；而"发完了但没人回执"本身就是该被看见的独立终态，把它伪装成失败或成功都是撒谎。

- 窗口随文件大小伸缩：`30s + 1s/MiB`，上限 900 s（`protocol.rs::confirm_grace_secs`，含 u64 溢出边界单测）。因为对端要先哈希校验整份文件才能回执，固定秒数对小文件太宽、对大文件太狠。
- 定时器不引入新状态字段：**COMPLETED/ERROR 本来就会把该传输从 `outgoing_transfers` 摘掉**，所以"到点时还在"就是没确认，一次 `remove` 同时完成判定与清理。
- 新终态 `confirm_timeout` 在界面上是独立一行（琥珀色 + "已发送·对端未确认" + `peer never confirmed the transfer`），进度条仍显示 100%，因为字节确实发完了。

**实测**（两个真实实例，一笔发给有人订阅的 `live/files`，一笔发给没人应答的 `deaf/files`，均 1 MB → 窗口 31 s）：

| 时刻 | 无人应答的那笔 | 有人应答的那笔 |
| --- | --- | --- |
| t=5 s | 已发送·待对端确认 | 已发送·待对端确认 |
| t=25 s | 已发送·待对端确认 | **校验通过** |
| t=40 s | **已发送·对端未确认** | 校验通过（未被误判） |

接收端只收到 `live-1mb.bin` 一笔 ✓。界面侧另有 2 条 Playwright 用例锁住"两种终态不互相污染"。

### 4.12 重新发送入口与"批次不再撒谎"（第五轮，2026-10-02）

超时终态落地后暴露出三处连带的诚实性问题，一并修掉：

1. **批次把"没人回执"当成功**：`useBatchSender` 的判定是 `ok = status === 'delivered' || status === 'sent'`，所以对端完全离线时批量列表打绿勾。现在只有 `delivered` 算成功，`confirm_timeout`/`sent` 归入新的 `unconfirmed` 态（琥珀色，不是绿也不是红）。
2. **前端自己另有一套 60 秒猜测**：`waitForSendComplete` 里对 `sent` 状态硬编码了 60 s 宽限，与后端的"随大小伸缩"窗口并存 —— 两套真相必然打架。删掉前端那份，后端成为唯一裁决者；30 分钟的兜底保留（防止状态事件本身丢失时永久卡批次）。
3. **失败原因算出来了却从不显示**：批次项的 `error` 字段没有任何渲染位置，且 `statusLabel` 漏了 `failed` 分支，导致失败的行标签显示成"待处理"。两处都修了，原因进 chip 的 title。

另外 `clearFinished` / `finishedCount` 都没把 `confirm_timeout` 当终态，超时行既清不掉也不显示"清除已结束" ✓ 一并补齐。

**重新发送的语义（决策）**：作为**一笔全新传输**重发，不复用旧 transferId。因为接收端对进行中的同 id 会去重忽略（`handle_meta` 早退），而对已完成的同 id 会另存成 `file(1)` —— 复用 id 在两种情况下都不是用户想要的"再发一次"。新 id 的最坏结果只是一份可见的重复文件。

**真机验证**（两个实例，1 MB，窗口 = 30s + 1s/MiB = 31 s）：

| 步骤 | 结果 |
| --- | --- |
| 发给无人订阅的 `deaf/files` | **t=31 s** 转 `已发送·对端未确认`，接收目录为空 ✓ |
| 让接收端补上 `deaf/#` 订阅，点"重新发送" | 队列出现**两行同一文件**（旧超时行 + 新传输行）✓ 新语义生效 |
| 落盘 | `report-1mb.bin` 1048576 B，sha256 与源 **MATCH** ✓ |
| 运维诊断 | `confirmTimeouts = 1`，`transfer_activity` 检查转 `warn`，文案直接指出"对端是否在线并订阅了 `<prefix>/ctrl/#`" ✓ |

界面侧新增 2 条 Playwright 用例（重发按钮 → `start_send_file` 参数正确；超时行可清除），全套 32/32。

### 4.13 审计修复的真机取证（第五轮，2026-10-02）

两个实例 + 一次性 lab broker（`127.0.0.1:18831`），CDP 分别用独立 WebView2 profile 与 9223/9224 端口 —— 共享 profile 时第二个窗口不一定挂到同一个调试端口上，这点已经踩过两次。

| 场景 | 实测 |
| --- | --- |
| 桥接规则指向不存在的连接，外部 `mosquitto_pub` 打一条 `audit/x` | `bridge_stats` → `{errors: 1}` ✓ 不再静默丢弃 |
| `cancel_transfer('no-such-id')` | 拒绝：`no active transfer 'no-such-id' to cancel` ✓ |
| `pause_transfer('no-such-id')` | 拒绝：`no outgoing transfer 'no-such-id' to pause` ✓ |
| 30 MB 传输**流式接收中**取消（自动接收开） | 返回 Ok，接收目录 `[]`（临时文件已删），行停在 `已取消` ✓ |
| 同上，自动接收关 | 返回 Ok，目录 `[]`，行停在 `已取消` ✓ **不再复活成"待确认接收"** |
| 发送端视角 | 行变 `传输失败 · Receiver rejected the transfer`（0 B / 30 MB）✓ 对端真的收到了终止原因 |
| 正向回归：自动接收 20 MB | 行 `校验通过`，落盘 `big5.bin`，sha256 与源 **MATCH** ✓ |
| 正向回归：人工批准 | 出现 `待确认接收` → 点"接收保存" → 行 `校验通过`，落盘 `big5_1.bin`，hash **MATCH** ✓ |
| 运维面板 | `定时发布运行中 0 / 压测运行中 0 / 对端未确认的发送 0 / 未能写入历史 0 / FEED 丢失（含历史）0` 全部渲染 ✓ |

**这轮最该记下来的是我自己的回归**：所有权判据第一版写成 `finalize_state == Streaming`，但状态在最后一个分片时就已翻到 `Verifying`；同时 `approve_transfer` 会**先把条目摘掉**再调 `deliver_incoming`，我却把"remove 返回 None"当成失活信号塞进了那个函数。结果真机跑出来：自动接收永久停在"计算哈希校验"、临时文件不再改名、**批准按钮彻底失效**。取消专项测试全绿（因为所有 finalize 都提前返回了），是正向用例把它抓出来的。教训写进方法论：**改"所有权/失活判定"时，取消路径和完成路径必须同批验证，只测取消会掩盖破坏。**

门：`cargo clippy --all-targets` 干净、`cargo build` 通过、Rust harness **77/77**、`npx tsc --noEmit` 通过、`npm test` **20/20**、`npx playwright test` **32/32**。

P0-2 的计数**只有单元测试证明**（`storage_failure_is_not_reported_as_empty_results` 断言 `lost_rows == 2`）；真机上只验证了面板把"未能写入历史"渲染出来且读数为 0 —— 制造一次真实 DB 写失败需要锁库或换只读目录，这轮没做。

### 4.15 一个只有测试能抓到的 UI 缺陷（我自己引入的）

新加的 `超时 (ms)` 数字框我当时写了 `min=100 step=500`。浏览器于是把它变成**表单校验错误**：填 2500（2500-100 不是 500 的整数倍）会让 `type=submit` 的"发布"按钮**静默失效** —— 不报错、不提示、什么都不发生。真机 UI 用例的表现是"点击发布后 30 s 超时，`rpc_request` 一次都没发生"。

去掉 `step` 后 6/6 通过。**教训**：任何放进 `<form>` 的 number 输入都只能有宽松的 `step`（默认 1），否则它会以"校验失败"的名义吞掉整个提交；而这类缺陷在类型检查、单元测试和肉眼review里都不存在。

同期还有一次反向教训：`rpc_list` 命令上线后，3 个既有 spec 的 mock 走到默认分支返回 `null`，`useRpc` 把它塞进 state，`RpcPanel` 立刻在 `calls.filter` 上崩掉整个控制台 —— 9 条用例集体超时。**我选择把 mock 改诚实（补 `if (cmd === 'rpc_list') return []`），而不是给前端加 `Array.isArray` 兜底**：真实后端永远不会返回 null，为不存在的失败写防御代码只会掩盖下一个真 bug。

### 4.16 请求/响应真机取证（第六轮，两个实例 + lab broker 18831）

**先更正一条我自己的错误结论**：我第一次跑这组验证时写下"本机没有可用的第三方 v5 客户端"（因为 mosquitto 2.0.15 的 `--property` 只支持 user property，仓库里也没有 mqtt.js）。这是**没找完就下的结论** —— `~/mqtt-lab/node_modules` 里就装着 **mqtt.js 5.16**（v5 properties 完整支持）。下面这组结果是**重新跑**的，应答方是独立的 mqtt.js 客户端，而不是 DropQTT 自己。

对端脚本：`~/mqtt-lab/rpc-peer.mjs`，四种模式 `echo | bare | wrong | deaf`，它 `subscribe('lab/rpc/#')`，把收到的请求的 `properties.responseTopic` 当作回信地址，并打印它从线上读到的 correlationData。

| 场景（应答方 = mqtt.js 5.16） | 实测 |
| --- | --- |
| `echo`（原样带回 correlationData） | 对端日志 `peer saw request lab/rpc/req-echo corr=corr-echo resp=lab/rpc/rep-echo` ✓ **独立客户端确认我们把关联数据/应答主题写上了线**；本端 `resolved`，**往返 12 ms**，`pairedByPosition=false`，应答体解出 `{"answeredBy":"mqtt.js-5",...}` ✓ |
| `wrong`（回信带别人的 correlationData） | 3 s 时仍是 `pending` ✓ 不按主题乱配对；到 6 s 期限转 `timeout` ✓ 不吞下错答 |
| `bare`（回信**不带** correlationData） | `resolved` 且 `pairedByPosition=true` ✓ 弱配对被如实标注 |
| `deaf`（听见但不回） | `timeout`；`rpcTimeouts=1 / rpcPending=0`；应答主题已从订阅表里消失（引用释放）✓ |

> 第一次跑 `wrong` 时报过 `FAIL :: resolved` —— 不是应用的错，是**我的编排错了**：上一轮的 `bare` 对端进程（22 s 生命周期）还活着，它对这个新请求做了按顺序配对。隔离进程后重跑即通过。教训：**多进程共存的真机验证里，"上一条还在世"就是一种污染**，串行化或等它退出再测。

同一批结果里，DropQTT↔DropQTT 的那轮（应答方为第二个实例，`mosquitto_sub -V mqttv5` 作旁观）同样全部通过：自动订阅出现 `lab/rpc/reply`、错误 correlationData 不配对、正确配对 `往返 1866 ms`（含我自己脚本的 900 ms 间隔，不是网络慢）、留空自动生成 `dropqtt/rpc/afcad1dd`、裸回信标 `按先后配对`、旁观端抓到 `lab/rpc/witness|visible-request` 与 `lab/rpc/wreply|visible-reply`。

界面实拍：`test-results/demo-rpc-panel.png`（该目录被 .gitignore 忽略，只在本机看）。

门：Rust harness **90/90**（新增 13 条 RPC 状态机用例）、`cargo clippy --all-targets` 干净、`cargo build` 通过、`npx tsc --noEmit` 通过、`npm test` **20/20**、`npx playwright test` **38/38**（新增 6 条）。

### 4.17 第二批修复的真机取证（第七轮）

单测层面新增：`topic.rs` 5 条（通配符/空层级/NUL/超长/`$` 放行，以及过滤器 `#`、`+` 的合法形状）harness **95/95**；`tests/unit/csv.test.ts` 5 条；`tests/unit/format.test.ts` 4 条 → vitest **29/29**（原 20 + CSV 5 + format 4）。

真机（一次性 lab broker `127.0.0.1:18831`，`log_type all` 落盘，应用实例经 CDP 驱动）：

| 场景 | 实测 |
| --- | --- |
| 发布 `lab/bad/+x` / `lab/bad/#` | 均被拒：`A publish topic may not contain wildcards ('+' or '#')` ✓ |
| 发布 `lab//b` | 被拒：`Topic contains an empty level …` ✓ |
| 连发四条非法主题之后 | 合法发布仍成功、`subscribe_topic('lab/+/ok')` 成功 ✓ **会话没被 rumqttc 拆掉**（这正是我们要防的代价） |
| 发布 `$SYS/broker/uptime` | 我们放行，由 broker 决定 ✓ 设计如此 |
| 订阅 `lab/#/x` / `lab/a+b` | 分别被拒：`'#' is only valid as the last level on its own` / `'+' must occupy a whole level` ✓ |
| RPC 请求主题含 `+` | 请求被拒**且没有留下临时订阅**（`get_subscription_stats` 只剩 `lab/+/ok`）✓ 与 §4.16 的引用释放语义一致 |
| 传输频道 `room/+x` | 发送前即拒，不落一条进行中的传输 ✓ |
| `keepAliveSecs: 100000` 的 profile | 连接成功且 `connected=true` ✓ 钳制生效（旧行为：无上限直发） |
| 桥接长 clientId（51 字符）v3 / v5 | v3 → `very-long-bridg_b6bafa5`（23 字符，**后缀保住**）；v5 → 全长 + `_bfed004` 不截断 ✓ 两条会话同时 `connected`，没互踢 |
| 用 `WM_CLOSE` 关窗（等价于用户点 ×） | broker 依次记录 `Received DISCONNECT`：主会话 `val_keepalive`、桥接 `val_bridge_b367ad2`、上面两条长 id 会话 ✓ 进程正常退出 |

> 顺手记录一个**取证工具的坑**：`invoke('plugin:window\|close')` 会被能力清单拒绝（`window.close not allowed. Permissions … do not include …`）。这本身是 P1-4 想收窄的方向 —— 说明 webview 现在没有自助关窗权限。要用 OS 层 `WM_CLOSE`（`SendMessageTimeout`）才能触发真实的 `CloseRequested`，`taskkill` 则完全绕过它。

门：clippy 干净、`cargo build` 通过、harness **95/95**、`npx tsc --noEmit` 通过、`npm test` **29/29**、`npx playwright test` **38/38**、`npx vite build` 通过。

### 4.18 审计第三批（不需要你拍板的小项）与验证边界

- **P2-15**：后端只有**一处**中文字面量（`写入失败 (chunk N)`），改成语言中性的 `write failed (chunk N)` —— OS 错误是数据，不是界面文案。全仓库扫描确认仅此一处。
- **N-P2-1**：流量表原本写死只画 80 行，"另有 N 条"无法展开。现在 `MAX_VISIBLE_ROWS` 成常量，超限时才出现**主题名过滤框**（sticky 在表头上方）。第一版我把"被过滤掉"和"被上限截断"混在一起算，`{n} more` 会把 90 条全说成被截断 —— 用例 `a long traffic table can be filtered…` 钉住了正确语义：只对匹配集计截断。CSV 导出跟随过滤（导出所见）。
- **P2-14**：删除桥接规则从一次点击改为**两段式确认**（4 秒内再点一次才删），armed 状态按规则 id 存，所以滞后的第二次点击不会删掉另一条规则；试运行加 `testing` 互斥，异步期间按钮禁用并显示"试运行中…"。

**验证边界（如实说明）**：这批由新增 `tests/ui/ux-guards.spec.ts`（4 条）与全量门覆盖 —— UI **42/42**、单测 **29/29**、harness **95/95**、clippy 干净、`cargo build` 与 `npx vite build` 通过。**流量过滤没有做真机 92 主题取证**：我的冒烟脚本在 `connect_broker` 传了缺 `useTls` 的配置被后端直接拒绝（顺带说明后端参数校验是严格的），脚本在启动阶段就退了，所以这一项目前只有 mock 证据。

### 4.19 ESLint 门禁落地（第八轮，2026-10-02）

审计的 P1-6 是对的：`tsc` 看不见 hook 依赖数组与 render 期副作用，而这两类恰好是这个项目最容易"界面看起来对、实际拿到旧值"的错误来源。

**装的是**：`eslint@10` + `@eslint/js` + `typescript-eslint@8` + `eslint-plugin-react-hooks@7` + `globals`。**必须用 pnpm**：CI 跑 `pnpm install --frozen-lockfile`，用 npm 装会只更新 `package-lock.json`，把 CI 直接打挂。本机 `pnpm` 的 shim 是坏的（`Failed to switch pnpm to v11.1.2`），可用的是 **`corepack pnpm`**（版本由 `packageManager` 字段决定，正好 11.1.2）。

**规则分级（这一轮的判断）**：
- `react-hooks/rules-of-hooks`、`react-hooks/exhaustive-deps`、`react-hooks/refs` = **error**。
- `react-hooks/set-state-in-effect`、`react-hooks/purity` = **warn**。前者会在十几个"轮询钩子里 await 后 setState"的惯用写法上报警，后者盯的是 `Date.now()` 参与渲染；把它们设成 error 会换来十处无收益改写，换不到安全性。
- `@typescript-eslint/no-explicit-any` 关掉：Tauri 事件负载与测试替身本来就是动态形状，强行加类型只是仪式。

**首次运行 24 条 → 现在 0 error / 10 warn**，且**没有加一条 `eslint-disable`**：
- 9 处 render 期写 ref（审计 P2-17 点名的就是这类）全部改成 `useRef(value)` + 就地 `useEffect` 写入。我先抽了个 `useLatestRef()` helper，结果 `exhaustive-deps` 立刻反过来要求把 helper 返回的 ref 列进依赖数组——规则**看不出自定义 hook 返回的是稳定 ref**，于是凭空多出 8 条误报。改回内联写法后误报归零。**结论：可读性 helper 会让静态规则瞎掉，这种抽象在这条边界上不值。**
- 4 条真错：两处正则里的多余转义（`\/`、`\#`）、一处 `let` 应为 `const`、一处测试里未使用的常量。
- 1 条**已经过期的 `eslint-disable-next-line`**（`SettingsModal` 的依赖数组早已补齐，注释还在替一条不存在的问题说话）——删掉。这正是禁用注释的长期风险：代码修好了，注释留下并继续遮蔽后来者。

**真机验证**（lab broker + 单实例 CDP，覆盖被改写的三条运行时路径）：
- 连接时订阅注册（`topicsRef`）：先订阅后连接 → `lint/ref/feed` 的报文进了控制台 ✓
- 重连（换 clientId 重连）后原订阅仍生效（`subscriptionsRef`/`connectedRef`）：`lint/ref/again` 进feed ✓
- 暂停/继续（`pausedRef`）：暂停期间的报文**不入屏**，点继续后**补出** ✓
- 设置弹窗 Esc 关闭（`onCloseRef`）✓；历史面板载入 ✓

顺带被真机逼出一个**可访问性缺陷**：暂停按钮在 paused 状态下把可及名换成了待读条数（`+3`），"继续接收"只活在 `title` 里，于是我的自动化定位不到它、屏幕阅读器也读不出它是干什么的。补了 `aria-label={paused ? t.resumeFeed : t.pauseFeed}`，徽标继续做视觉信息。

**CI**：`frontend` job 在 typecheck 之后新增 `pnpm run lint --max-warnings=10`，阈值就是今天的告警数——**收紧要有人改代码，放宽要有人签字**。门：`eslint` 0 error / 10 warn、`tsc` 通过、vitest **29/29**、Playwright **42/42**、`vite build` 通过。

### 4.20 共享订阅真机取证（第九轮，两个实例 + mosquitto 2.0.15）

用本机 mosquitto 起一次性 lab broker（`127.0.0.1:18831`，`persistence false`）。它的 `$share` 至少自 2.0.12 可用（该版变更记录："Fix $share subscriptions not being recovered for durable clients that reconnect"），所以这条机制能在本机端到端证明，不需要外部系统。

两个实例都订阅 `$share/g1/lab/shared/#`（QoS 1），A 另订阅 `lab/plain/#` 作为对照；外部 `mosquitto_pub -q 1` 打 24 条到 `lab/shared/telemetry`：

```
A hits: {"lab/plain/#":1,"$share/g1/lab/shared/#":12}
B hits: {"$share/g1/lab/shared/#":12}
```

| 断言 | 结果 |
| --- | --- |
| 组内两个成员各收到一部分 | **12 / 12** ✓ 轮流派发真的发生了 |
| 组内没有重复投递 | `12+12 = 24` 恰好等于发布数 ✓ |
| 共享过滤器的命中数不是 0 | ✓ 这正是本轮修掉的正确性问题 |
| 同客户端的普通订阅不受影响 | `lab/plain/#` = 1（发布 1 条）✓ |
| 控制台只显示自己那一份 | 两侧各 13 行（命中 12，DOM 侧多算一个主题文本节点），**没有谁显示 24** ✓ |
| `$share/a+b/x` 被拒 | `a share name may not contain '/', '+' or '#'` ✓ 由共享规则先给出（不是通用的通配符报错） |
| `$share/g/$share/inner/x` 被拒 | `a shared subscription cannot wrap another shared subscription` ✓ |
| 共享 + No Local 被拒 | `a shared subscription cannot also set No Local` ✓ |
| No Local 在普通订阅仍可用 | 成功注册 `lab/ok/#` ✓ |

**顺带排掉一个我自己的测量假象**：第二次跑这份脚本时数字变成"每个成员各收 24"，看着像派发失败或消息重复。真因是我把脚本跑在**上一轮已经连接并订阅过的活进程**上，前后两次的注册叠加了。为排除"同进程二次 `connect_broker` 是否留下两条事件循环、从而重复处理每条入站报文"这个真问题，我单独做了探针：先连一次打 5 条（命中 5），再对同一 clientId 打一次 connect 并打 5 条 → **命中 10（增量恰为 5），控制台新增 5 行**。二次连接没有双跑循环，应用是干净的；错的始终是取证脚本的进程卫生。**教训：多实例真机验证里，"上一轮的进程/订阅还在世"必须当作污染源排除，先看进程数与 clientId，再解读数字。**

门：Rust harness **99/99**（新增 4 条共享订阅用例）、clippy 干净、`cargo build` 通过、`tsc` 通过、`eslint` **0 error / 10 warn**、vitest **29/29**、Playwright **46/46**（新增 4 条共享订阅 UI 用例）、`vite build` 通过。

### 4.21 压测台真正的天花板是定时器粒度，不是归档（第九轮，2026-10-02）

共享订阅做完后我继续吃审计剩下的条目，第一件是 P2-16（"rusqlite 与 QuickJS 都在 tokio worker 上同步阻塞"）。我没有直接照做，而是先量：

| 条件（QoS 0，128 B，请求 1000/s，6 s） | 实测 |
| --- | --- |
| 只发不收（完全没有入站、没有归档） | **92 /s** |
| 自收 + 全量归档 | 170–206 /s |

**只发不收就只有 92/s** —— 这条直接否证了"归档/阻塞写库是瓶颈"。真正的原因是 Windows 的定时器唤醒粒度约 10–16 ms，而压测台原本是"每条消息睡一次"：rate=1000 意味着 1 ms 周期，循环一辈子卡在等一个不可能那么快到点的唤醒上。§5.5 当年记下的 ~315 msg/s 天花板，其实是同一个东西在不同负载下的表现。

**改法**：按窗口节拍 —— 每 20 ms 醒来一次，补发到"按已用时间本该发完"的数量（追赶量封顶 4 个窗口，避免被饿很久后瞬间倾泻）。这也是专用压测工具的常规做法。

| 修复后（同一台机器、同一 lab broker） | 请求 1000/s | 请求 5000/s |
| --- | --- | --- |
| 只发不收 | **989 /s** | 2609 /s |
| 自收 + 全量归档 | **980 /s**（5947 条全部观测、全部入库，`lostRows=0`） | 3053 /s（12417 行入库，`lostRows=0`） |

约 **10 倍**（1000 档）与 **~10 倍**（5000 档相对旧实现的上限）。新的实际上限大约在 3000 msg/s 量级，仍受自发自收 + 全量入库影响 —— §5.5 的"要不要给压测加不镜像开关"因此仍然是有意义的候选，但它不再是那个把 1000 压成 92 的元凶。

**P2-16 我按证据拆成两半处理**：
- QuickJS 那半**保留并落地**：`bridge.rs` 的规则转换与 `lib.rs` 的试运行都改到 `spawn_blocking`。理由与吞吐无关 —— 脚本只在自己的 deadline 到点时才会被杀，内联执行会让那个 worker 上的**所有**其他任务（入站事件循环、RPC 计时器、传输）一起停住。
- rusqlite 那半**试过又回退**：改成 offload 后我为了保持"先入库再上屏"额外拷了一份批次，实测反而更慢；而 A/B 已证明写库不是瓶颈。为一个无法用数字证明收益、还会削弱一条顺序保证的改动留在树上，就是我自己一直反对的那种"看起来很努力"的回退。代码注释里写明了这个决定和它的测量依据，`HistoryStore::record_lost` 这个只服务于被回退方案的辅助函数也一并删掉（不留死代码）。

**同源的欠账已在本轮还掉**：`run_schedule`（定时发布）曾经也是每条睡一次，见 §4.22 —— 下限也从 50 ms 放到 10 ms，100/s 实测误差 0.4%。

### 4.22 定时发布也是窗口节拍（第九轮）

§4.21 那堵墙在 `run_schedule` 里还立着：一条消息一次唤醒。当时我只把它记成欠账，这轮补上，顺带发现它比压测台更受限 —— 下限是 50 ms，也就是说**这个功能在此之前最多只能做到 20/s**，谁也别想用"定时发布"模拟高频设备。

改动与压测台同源（每 20 ms 醒来一次，补发到"按已用时间本该发完"的数量；追赶封顶 4 个窗口，所以合盖睡眠后不会倾泻积压），并保留原有语义：第一条立刻发（不等一个周期）、每次唤醒都检查取消、`record_fire` 的次数上限与终态事件不变。下限从 50 ms 降到 10 ms；再低就确实是压测台的领域，注释里写清楚了边界。

**真机（lab broker，外部 `mosquitto_sub` 计数）**：

| 请求间隔 | 应发 | broker 实收 | 跨度 |
| --- | --- | --- | --- |
| 100 ms | ≈51 | 49 | 4.79 s ✓ 与 §4.7 的历史精度一致 |
| 20 ms | ≈301 | 298 | 5.94 s ✓ |
| 10 ms | ≈601 | **599** | 5.97 s ✓ **100/s，误差 0.4%**（改动前这个速率无法配置） |

**顺手抓到的第二个同类 bug（用户可感知）**：间隔输入框原本写着 `step={50}`，而它和"发布"按钮在同一个 `<form>` 里。填 **75 ms** 这种非 50 倍数的值会让表单校验失败，于是**点"发布"什么都不发生** —— 与 §4.15 我亲手制造又修掉的那个缺陷一模一样。这次直接不重复这个坑：去掉 `step`，`max` 用后端同一个上限（24 h）。

**还有一处测试卫生问题**：`scheduler.rs` 的下限测试把 `10` 硬写进了断言（"低于下限"）。改成 10 ms 后它自己变成了合法值而失败 —— 我把它改成 `MIN_INTERVAL_MS - 1`，让断言跟着常量走而不是再钉一个魔数（否则下一次调下限还会以同样方式炸）。门：harness **99/99**、clippy 干净、scheduler + publisher UI **10/10** 通过。

### 4.23 批次不再靠轮询等待（P2-19），以及两条我复核后拒绝的审计项

**P2-19 已做**：`waitForSendComplete` 原本用 `setInterval(250)` 反复读一个 ref。它不是"能跑就行"的问题 —— 批次里**每个文件都会因此多等最多 250 ms 才被发现已终结**，且整个传输期间挂着一个定时器。现在等待者登记在一张 map 里，由**已提交的 transfers 状态**在 effect 中结算；后端依旧独占"对端从未确认"的判定（那套随文件大小伸缩的窗口），这里只负责被叫醒。30 分钟的兜底留着，但它现在只覆盖"事件本身丢了"这一种情况，不再是常规出口。

诚实说明验证边界：这次**没有新增测试**。它是一次保持行为的改动，风险面是"漏掉某个终态导致批次卡住"，而这个风险被既有的 4 条 transfer/batch UI 用例与那张终态集合常量收敛在同一处（`SEND_TERMINAL`，模块级，注释写明了为什么不含只用于入站的 `completed`）。批次文件选择走原生对话框，本机不可脚本化（§4.10 已记），所以我无法给这条路径补真机证据 —— 这一点不装作已经证明。

**复核后拒绝的两条**：
- **P2-21**（"`diagnostics_snapshot` 先把 `downloadDirWritable` 写死 false，再由 `build_snapshot` 回填，迂回")：回填不是条件分支，`build_snapshot` 里那次探测是**无条件**的，成功/失败两条路都会写值与错误串。把探测搬进构造函数等于在两个地方各写一份探测逻辑 —— 那不是消除迂回，是制造第二个真相源。保持原样。
- **P2-8**（`tsconfig.node.json` 不开 strict）：它保护的是 `vite.config.ts` 这类构建期文件，而那一处 `@ts-expect-error` 是插件类型版本差异导致的；开 strict 会连带要求把 vite 配置类型补齐，收益与风险不成比例，且这次没有可验证的用户可见后果。留在队列里，等有真实需要时做。

门：`tsc` 通过、`eslint` 0 error / 10 warn、`transfer-confirm` + batch 相关 UI 4/4、既有全量 **46/46**、vitest 29/29、harness 99/99。

### 4.24 P2-18：面板引用的上限不再是一个副本数字

`useBridge` 用 `EVENT_LOG_CAP = 150` 裁事件环形缓冲，而 `BridgePanel` 的"只显示最近 {cap} 条"文案里**另外写死了一个 150**。改上限不会报错，只会让界面开始报一个假数 —— 这类"两个真相源"正是本轮一直在删的东西，所以 hook 导出常量、面板引用它。**没有为它加测试**：这条改动的正确性是"两处读同一个符号"，一个断言 `150` 出现在文案里的测试只能证明它自己。门：`tsc`、`eslint` 0 error、Playwright **46/46** 复跑通过。

### 4.25 订阅被拒不是"看不见"，而是"整个会话在反复掉线"（第十轮，2026-10-03，实测推翻审阅稿 §1.1）

`docs/REVIEW_2026_10_03.md` 说 SUBACK 被归进 `NetEvent::Other` 丢弃，于是界面在 ACL 拒绝时仍显示"已订阅"。
按这条去实现时，真机不给这个结果：接上可编程的探针 broker 后，应用**根本没有画出红标**，而是横幅里反复出现
`MqttState(SubFail { reason: NotAuthorized })`，状态在 Connected/Disconnected 之间跳。查 rumqttc 0.24 源码确认：

```rust
// rumqttc-0.24.0/src/v5/state.rs
fn handle_incoming_suback(&mut self, suback: &mut SubAck) -> Result<(), StateError> {
    for reason in suback.return_codes.iter() {
        match reason {
            SubscribeReasonCode::Success(qos) => { ... }
            _ => return Err(StateError::SubFail { reason: *reason }),   // 致命
        }
    }
```

也就是说**被拒的 SUBACK 永远到不了我们手里**：`poll()` 返回 `Err(ConnectionError::MqttState(SubFail))`，
连接被拆，1 秒后 CONNACK 重放又带上同一个过滤器 → 再被拒 → 无限掉线循环。PUBACK/PUBREC/PUBCOMP/UNSUBACK
各有对应的 `*Fail`，同一形状。审阅稿把后果说轻了一个数量级，把修法也指错了方向。

改成的样子：

- `transport::v5_error_event()` 把 rumqttc 那一条错误通道**拆开**：ack 类拒绝映射成
  `NetEvent::AckRejected{stage, code, text}`（code 是规范字节），其余才继续当 `ConnectionError`。
  字节表写在 `transport.rs`，并由 `suback_reason_bytes_match_the_spec` 等测试逐个变体钉住。
- 授予类 SUBACK 仍作为包到达，所以 `NetEvent::SubAck` 这条路负责**QoS 降级**：broker 回 0x01 而我们请求 0x02
  时，订阅条上出现 `granted QoS 1`，并 emit `subscription-downgraded`。
- `acks::AckTracker` 是这轮新增的纯逻辑模块（10 个 harness 测试）：一次 SUBSCRIBE 只带一个过滤器，
  所以 FIFO 能精确归因；**多出来的 reason 字节记成 `unattributed` 而不是猜给某个过滤器**——把"无辜订阅画成红标"
  比"少画一个红标"糟得多。
- 关键止血：被拒过滤器进入 **quarantine**，CONNACK 重放时跳过它。用户重新订阅（`expect_sub`）或移除
  （`forget`）才解除。一次拒绝 = 一条可见结论，而不是每秒一次的会话拆除。
- 前端 `useSubscriptionStats` 把**事件监听挂在挂载期而不是"已连接"期间**——这条是实测逼出来的：
  拒绝事件本身就是让连接掉下去的原因，监听器若被 `isConnected` 挡住，就会在需要它的那一刻恰好不在场
  （第一轮真机跑出来就是"红标靠 1.5 s 轮询补上、toast 永远不出现"）。
- 诊断新增 `ack_verdicts` 健康检查与 4 个计数（被拒订阅 / 被拒取消订阅 / 被拒发布 / 无法对应的应答码），
  运维面板同数显示；压测台不再把失败回执算成 acked，`0x10 无订阅者` 单独一列。

真机取证（探针 broker `~/mqtt-lab/probe-broker.mjs`，127.0.0.1:18832，每个 verdict 都由服务端脚本指定）：
点击 Connect 后 500 ms 内出现两条 toast —— `Broker refused secret/telemetry: not authorized (ACL)` 与
`Broker capped public/# at QoS 1`，两个徽标随后常驻；**状态连续 6 秒保持 Connected**；
服务端侧最后一轮连接只订阅了 `public/#` 与 `$SYS/#`，`secret/telemetry` 不再被重放 —— 循环确实被切断了。

顺带两条独立取证：
- reason code 字节表**不能凭记忆写**。我先写的表把 SUBACK 的"topic filter invalid"记成 0x8E，
  用 mqtt.js 的 `mqtt-packet/constants.js`（另一份独立实现）核对后才知道是 **0x8F**，
  而 0x90 属于 PUBLISH 族。测试里把这条陷阱单独钉住（`describe_sub(0x8e)` 必须是"未识别"）。
- mosquitto 2.0.15 **不在 SUBSCRIBE 上强制 ACL**：给它一个只允许 `public/#` 的 acl_file，
  订阅 `secret/#` 仍被授予（broker 日志 `Sending SUBACK` 可查），但**发布**被拒并回
  `PUBACK rc135`（同一日志可查）。所以 SUBACK 拒绝只能靠可编程探针复现，PUBACK 拒绝有真实 broker 证据。

门：Rust harness **121/121**、vitest **35/35**、Playwright **52/52**（新增 `tests/ui/suback-verdicts.spec.ts` 6 项、
`tests/unit/ackReason.test.ts` 6 项）、`tsc` 干净、`cargo clippy --all-targets` 干净、ESLint 0 error（warn 仍是 10 的预算）。

### 4.26 关联数据按字节处理，并且不再谎报文本（A2）

`transport.rs` 之前用 `String::from_utf8_lossy` 解 correlationData。规范里它是不透明字节串，
设备常用 4 字节 UUID 或 protobuf tag。改成 `Vec<u8>` 后：RPC 配对是**字节相等**；显示走两条诚实的分支
（`protocol::correlation_forms`）——字节是合法 UTF-8 才给文本，同时永远给一份 hex。
副作用是行为变严：过去入站值会被 `trim()` 再比，所以 `"abc "` 能配上 `"abc"`；现在必须逐字节一致，
配不上就超时，而 hex 会显示在 RPC 行的 tooltip 里，用户看得见差在哪。
桥接转发也补了无损通道：`PubProperties.correlation_hex` 优先于文本字段，非 UTF-8 的关联数据跳一跳不失真。
harness 里 `a_binary_reply_cannot_pair_through_a_lossy_text_decoding` 用 0xFF 0x00 钉住了这个回归方向
（它 lossy 解码后正好等于 `"\u{FFFD}\u{0}"`，旧代码会把它配给一个从未见过的请求）。

## 5. 已知限制（必须如实告知）

### 5.1 环境：本机 MSVC 不可用，但 gnu 可以完整跑起应用

`cargo +1.98.1 test`（MSVC）在链接第一个 build script 时失败：

```
error: linking with `link.exe` failed
  = note: link: extra operand '...rcgu.o'
```

这不是本仓库代码问题。诊断结果：
- `PATH` 上的 `link.exe` 是 Git/MSYS 的 coreutils `link`（建硬链接用的），不是 MSVC 链接器；
- VS 2022 Professional 装了 C++ 工具集**二进制**，但 `VC/Tools/MSVC/14.44.35207/include` 与 `lib/x64` 为空；
- `Windows Kits\10\Lib`、`Include` 目录不存在，全盘找不到 `kernel32.lib` / `ucrt.lib`；
- `vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` 返回空，所以 rustc 检测不到工具集，退化成裸 `link.exe`。

**修正之前的判断**：这**不**等于"本机跑不了 DropQTT"。改用 `stable-x86_64-pc-windows-gnu` 后，整个 Tauri 应用（含 `webview2-com`、`embed-resource`+`windres`、`rusqlite`、`rquickjs`、`reqwest/rustls`）编译、链接、运行全部正常，见 §4.3。MSYS2 的 mingw64 已自带 gcc/windres/dlltool，所以 gnu 路线零额外成本。

**仍然建议修 MSVC** 的理由：发布产物、`cargo test --locked` 的官方目标三元组、以及和 CI/其它开发者的一致性，都走 msvc。做法是在 VS Installer 勾选"使用 C++ 的桌面开发"（含 Windows 11 SDK）。

### 5.2 Webhook 是"尽力投递"，不是可靠通道
明确不做、也明确写在 UI 提示里的：
- 并发 4、单请求 10s、请求体 2MB 上限，超出即计 dropped；
- **无重试、无排队、无落盘 outbox**——应用退出或未运行时消息直接丢失；
- 慢接口只会占用自己的信号量，不会拖住 MQTT，但会丢新消息；
- 直连，未启用系统代理（`reqwest` 的 `system-proxy` 特性被 `default-features = false` 关掉了）。对以本地/内网端点为主的调试场景这是更可预测的行为，但如果你的网络必须走代理，需要显式加回该特性。

### 5.3 历史过载漏记 —— **已于第二轮修复**（原限制留档）
原问题：`push_feed`（`src-tauri/src/mqtt_manager.rs`）在显示缓冲满（`FEED_BUFFER_MAX = 2000`）时直接丢弃最旧行，而历史只在 `flush_feed` 成批落库，**因此高吞吐下被丢弃的消息既看不到也查不到**——恰恰是排障最需要的部分。

现状：被淘汰的行转入同样有界的 `feed_archive_only` 队列，由下一次 flush 补写进 SQLite（不进 UI 批次）；只有该队列也饱和时才计入新增的 `feed_lost`。真机 30000 条压测：`feedDropped 19200 / feedLost 0 / historyRows 30000`（见 §4.5）。

遗留：流量计数一直走独立路径；`feed_lost` 目前只在运维诊断里可见，消息流横幅仍只报显示丢弃。

### 5.4 其他
- ~~`history.rs` 的 DB 错误被吞掉~~ → **已于第二轮修复**：`query`/`series` 返回 `Result`，并去掉了 `filter_map(|x| x.ok())` 对损坏行的静默丢弃。`append` 仍保持宽容（写入路径不能因存储故障阻断消息流）。
- CSV 导出未做公式注入（`=`, `+`, `@`）转义。调试自采数据风险低，未扩大改动。
- `PROJECT_ANALYSIS.md` 停留在 v0.7.1，本文只覆盖增量。

---

### 5.5 压测台吞吐上限（**第九轮修正了归因**）

当年记录：请求 2000 msg/s 实测约 **315 msg/s**，并归因为"自发自收 + 全量入库，同一任务既发又收"。第九轮实测证明这个归因是**错的**：在旧实现下，连"完全不订阅、完全不入库"的纯发送也只能跑到 **92/s**（请求 1000/s）。真实瓶颈是 Windows 定时器唤醒粒度（~10–16 ms）遇上一句"每条消息睡一次"的节拍，见 §4.21。

改成窗口节拍后：请求 1000/s → 实测 989/s（只发）/ 980/s（自收 + 全量入库，`lostRows=0`）；请求 5000/s → 约 2600–3050/s。所以现在的实际上限大约在数千 msg/s 量级，**其中确实还含"自发自收 + 全量入库"的成本，但它不再是数量级的那一刀**。

面板显示的仍是**实际 /s**（`sent / elapsed`），差距必须可见。"给压测加一个不镜像到 feed/历史的开关"仍然值得做，只是预期要按新数据校准：它换来的是从 ~3000 往上，而不是从 92 往上。

### 5.6 定时发布是会话级的

任务活在 Rust 进程里，能扛过面板卸载和 `reload`，但**重启应用不会恢复**；持久化的只有节奏与次数默认值。跨重启自动恢复需要"保存的任务定义"（候选 C2b）。

### 5.7 文件传输：对端确认超时是"未知"，不是"失败"

发送端现在会在 `30s + 1s/MiB`（上限 900 s）内等不到回执就转入 `已发送·对端未确认`（§4.11）。但要注意这个状态的语义：**它只说明没收到回执**，不代表对端没拿到文件（对端可能拿到了却没订阅 ctrl 主题，也可能压根离线）。我们**故意不自动重发**，所以恢复手段目前只有人工重发。

另外：NACK 的"缺哪片补哪片"分支在本地回环下无法真实触发，目前只有代码路径与 §4.1 的单元测试级保证。

### 5.8 请求/响应的三条边界（第六轮）

1. **一问只一答**：第一条匹配上的应答就终结这次调用，后续重复应答被忽略（`the_first_reply_wins_a_double_answer` 钉住了行为）。想要"多方响应/广播式收集"的语义需要另一种设计，现在没有做，也不会假装支持。
2. **RETAINED 应答是已知风险**：如果应答主题上留有 retained 消息，自动订阅会在订阅那一刻收到**上一次遗留的应答**；按顺序配对（应答不带 correlationData 时）就可能把它错配给一个新请求。带正确 correlationData 的请求不受影响。绕开方式是别让应答主题用 retain —— 我没有在界面里替你禁止，因为这不是普遍错误；知道这条边界再决定。
3. **未决请求没有"取消"按钮**：只能等它自己超时。有界（最长 120 s）且必然终结，所以我不为它再造一套状态机。

另外与定时发布一样：**调用表是会话级的**，重启应用不恢复（§5.6 同理）。

### 5.9 审计报告里我**这轮没有做**的条目（以及为什么）

复核成立不等于该由我替你决定。以下几条要么改动你的发布/信任模型，要么是需要你先定方向的重构，我选择**留成明确问题**而不是顺手改掉：

| 条目 | 为什么没动 |
| --- | --- |
| **P1-2 凭证明文存 localStorage** | 成立，且是报告里最重的安全项。但引入 `tauri-plugin-stronghold` 或 OS keyring 会改变你的**密钥生命周期模型**（首次启动迁移已有明文、keyring 不可用时是硬失败还是回落明文、打包新增依赖），这是产品决定不是清理。至少要配套 `usePersistentState` 的 schema 版本与迁移，那是独立一轮。 |
| **P1-5 `releaseDraft: false`** | 成立。但它改的是**你的发布流程**：改成草稿后 updater 何时可见需要一个人工/CI 确认步骤。我不替你决定发布节奏。 |
| **P1-4 capabilities `fs:default` 过宽** | 报告的前提**是错的**：它说"当前代码没有从前端直接调用 fs 读写"，实际 `src/utils/exportMessages.ts:61` 就在 `import('@tauri-apps/plugin-fs')` 里用 `writeTextFile` 落盘导出（CSV/JSON/规则导出都走这条路）。所以直接删 `fs:default` 会**静默砍掉导出功能**。真要收窄，得先把导出改成一条后端命令（`write_text_file`）再删权限，或用 `fs:scope` 精确列出允许落盘的目录 —— 而 scope 写错的表现正是"点了没反应"，需要**逐个目标目录人工验证**（下载/文档/桌面），本机无法脚本化原生对话框。我没有用一半的验证去做这个改动。 |
| **P1-14 历史 payload 双列存储** | 成立（约 2.3× 体积），但 `payload` 列是**文本检索**的字段；只留 base64 就要在 SQLite 侧做解码检索，等于换搜索模型。这不是删一列能了事的。 |
| **P1-6 CI 加 ESLint** | ~~留给后续~~ **第八轮已落地**（见 §4.19）。 |
| **P1-10 / P1-11 IPC 类型化（`ts-rs` / `tauri-specta`）** | 成立。这属于 §6.1"拆 `MqttManager`"同级别的结构性工程，需要一次贯穿全仓库的改动。 |
| **P2-6 侧边栏 `v0.9.0-core` 后缀** | 显示与 `package.json` 的 `0.9.0` 不一致是事实，但后缀可能有意区分的构建线；这是品牌/发布决定，我不动。 |
| **§6.1 / §6.2 大文件拆分、§7.1 Shared Subscription、§6.3 统一错误类型** | 报告自己的分级也把它们放在"重构/扩展"，与本轮"静默失败 + 合法性 + 一致性"的主题不同轴，留作后续。 |

报告里剩下的 P2（`MessageStream` 虚拟化、`{n}` 手工插值统一、`BridgePanel` 防连点、`spawn_blocking`、`useTransfers` 去轮询、bridge 事件上限常量、诊断构造迂回、`$SYS` 关键词识别）**仍然成立**，已并入 §6 的候选池。

### 4.27 CONNACK 不再只读一个字段（A3，§1.4）

以前只从 CONNACK 里取 `topic-alias-maximum`，其余通告全部丢弃。现在 `transport::ConnCapabilities`
按 MQTT5 §3.2.2.3.0 的**缺省语义**收下全部通告（"没发这个属性"与"发了 0"是两件事，
`retain-available` 缺省是"支持"，`topic-alias-max` 缺省才是 0），并把它变成三处行为：

- **发布前置门**（`publish_console`）：QoS 高于 `maximum-qos`、retain 撞上 `retain-available = 0`、
  估算报文超过 `maximum-packet-size`，都在本地拒绝并给出可读原因。理由与别名门一样：
  rumqttc 不会替我们协商降级，它照发，broker 决定多不客气。
- **订阅前置门**（`subscribe_topic`）：broker 通告不支持通配符/共享订阅时本地直接拒。
  这跟 §4.25 是一对 —— 那种 SUBACK 拒绝会把会话拆掉，最好的处理是**根本不发出这个请求**。
- **表单跟随通告**：QoS 下拉里超限项 `disabled` 并带 ✕，retain 复选框禁用，共享订阅开关禁用；
  而"为什么点不动"必须可见，所以超限的**已存草稿**会在发布区显式给一行红字警告
  （`broker accepts up to QoS 1 · this broker has retain unavailable`）。
  未通告（v3 或尚未连接）时一律不加限制 —— 猜出来的能力比没有更糟。
- 运维面板新增"broker 通告的能力"表。

真机（探针 broker 通告 maxQos 1 / retain 0 / shared 0 / alias 10 / receive 5 / packet 1 MB /
keep-alive 45 / session-expiry 120 / assigned-client-id）：QoS 选项渲染为
`QoS 2 ✕(disabled)`，retain 与共享开关 `disabled`，开关 title 给出原因，
草稿警告行两句话都在；运维表 12 行全部如实显示。门：harness **123/123**、vitest 35、
Playwright **58/58**（新增 `tests/ui/broker-caps.spec.ts` 6 项）、`tsc`/`clippy` 干净、
ESLint 0 error / warn 预算仍是 10（新 hook 用**派生**而不是在 effect 里清空状态，避免再加一条告警）。

一个顺带发现，**没有在本轮修**：broker 指派 `assigned-client-identifier` 时我们显示了它，
但重连仍用回自己的 clientId —— MQTT5 要求此后用服务端指派的那个。它改的是重连语义，单独排期。

### 5.10 本轮（A1/A2）没有做到的三件事

1. **PUBACK 拒绝没能在桌面应用里跑通**。代码路径有 harness 测试、有真实 mosquitto 的 `PUBACK rc135` 证据、
   有 Playwright 的合并 toast 测试，但我用 CDP 驱动发布表单时 QoS1 的 PUBLISH 始终没到线上
   （填进去的 topic 没能进 React 状态）。这是**我的驱动不精确**，不是已证明的产品缺陷，也没有被证明不存在。
2. **桥接链路上的拒绝仍然会重放**。`bridge.rs` 只把 `AckRejected` 转成链路错误文案（不再是 debug 串）+ 1.5 s 退避，
   没有 quarantine —— 桥接的订阅集来自规则，规则不改就一直失败。要做的是"规则级失败标记 + 面板红点"，
   那是另一件事，没塞进这轮。
3. **归因依赖 broker 按序回 SUBACK**。我们一次 SUBSCRIBE 只带一个过滤器，FIFO 在 TCP + 合规 broker 下是精确的；
   但 `SubFail` 错误里**没有 packet id**，所以"哪个过滤器被拒"是按在飞顺序推的。数不对时我记 `unattributed`
   并显示"无法对应的应答码"，而不是猜。

## 6. 下一轮候选

> 原列第 1、2 项（过载漏记、历史错误可见）**已在第二轮完成并真机验证**，见 §3.3 与 §4.5。
> 上一轮的第 1、2 项（C2 后端定时发布、D1 压测台补齐）**已在第四轮完成并真机验证**，见 §3.6、§3.7 与 §4.7、§4.8。
> 本轮第 3 项（B2 协议字段补全）同样已完成并做了线上取证，见 §3.8 与 §4.9。
> MQTTX 对标的完整差距分析与排序见 `docs/ROADMAP_vs_MQTTX.md`。

按性价比排序：

> **已完成的插入项**：文件传输"对端确认"超时与独立终态（§4.11）；重新发送入口与批次诚实化（§4.12）；审计报告 P0-1/P0-2/P0-3 的复核修复 + 取消/finalize 竞态（§3.9、§4.13）；**列表第 1 项 RPC 已在第六轮完成并真机取证**（§3.10、§4.16）；**审计第二批（静默失败 / 主题合法性 / 一致性）已在第七轮完成**（§3.11、§4.17），其中我不做的部分与原因集中在 §5.9。剩下的同类问题是**断点续传**（重发是复用同一 transferId 还是新开一笔已定为新开），以及**给所有权判定补可回归的纯函数测试**。

1. ~~**RPC 一等公民**~~ ✅ **第六轮完成**（§3.10 / §4.16）。它的同类收尾项：**一问多答的收集模式**、**应答主题带 retain 时的错配处理**（§5.8 第 2 条），以及把 `rpc_request` 接进脚本钩子/桥接，让转发的消息也能挂上请求。
2. **压测吞吐开关**：允许压测运行不镜像到 feed/历史，把 §5.5 的实测 ~315 msg/s 提到通道上限；同时才有资格谈"高压下"的 P50/P95/P99。
3. **多连接**：单 client 槽 → `HashMap<connId, Connection>`。建议单独一轮，需先定"历史与流量榜按连接归属"的语义。
4. **B2 的收尾**：入站主题别名的线上验证（目前只有源码依据，见 §4.9）；桥接对 user-property 转发的字节级复核。
5. **C2b 保存的定时任务**：把任务定义（不只是节奏默认值）持久化，支持"启动时自动恢复"。
6. **C2c 定时任务的 CBOR 编码**：需要一个 Rust CBOR 编码器；在那之前界面明确拒绝，不做静默降级。
7. **Webhook 可选可靠性**：失败落盘重投（N 次 / M 秒退避），明确它是本地文件队列而非消息中间件。
8. **系统代理开关**：按需启用 `reqwest/system-proxy`。
9. **把 gnu 路线固化成本地开发方式**：加 `pnpm tauri:dev:gnu`（设 `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu`），让没有 Windows SDK 的机器也能一键联调。顺带记录：`cargo test --lib` 在本机 gnu 下能编译但测试进程加载 Tauri/WebView2 依赖会 `STATUS_ENTRYPOINT_NOT_FOUND`，所以 Rust 门只能走 §4.1 的 harness。
10. **补 `bridge.rs` 的自动化测试**：它只被真机端到端覆盖过一次，没有可重复回归。可把 `resync_subs` 的期望集合计算抽成不依赖 Tauri 的纯函数。
11. **给 `ErrorBoundary` 补用例**：目前只有代码路径审查，没有 Playwright 覆盖。
12. **把接收端"所有权判定"抽成纯函数并加 harness 回归**：§4.13 那类竞态（取消 vs finalize）现在只有真机双实例证明，本机 `cargo test --lib` 起不来（§5.1、§4.1），所以自动化门抓不住它。把"条目能否被这次 finalize 广播"做成不依赖 `AppHandle` 的谓词，就能进 77 项 harness。
13. **断点续传**：`confirm_timeout` 后只有"整笔重发"。协议要加"从第 N 片继续"的语义（以及接收端如何证明自己还留着半截临时文件），没定协议之前不做半成品实现。

---

## 附：本轮改动文件清单

**新增**：`src-tauri/src/webhook.rs`、`src/utils/history.ts`、`tests/unit/history.test.ts`、`tests/ui/workspaces.spec.ts`、`playwright.config.ts`、`docs/ITERATION_2026_09.md`（本文件）

**第二轮新增**：`src/utils/codec.ts`、`src/hooks/useCodec.ts`、`src/components/ErrorBoundary.tsx`、`tests/ui/subscribe-options.spec.ts`、`tests/ui/codec.spec.ts`、`docs/ROADMAP_vs_MQTTX.md`
**第二轮修改**：`src-tauri/src/{transport,mqtt_manager,diagnostics,protocol,bridge,lib}.rs`、`src/components/mqttx/{MessageStream,SubscriptionsBar}.tsx`、`src/hooks/{useBroker,useMqttMessages}.ts`、`src/App.tsx`、`src/types.ts`、`src/i18n/index.ts`

**修改**：`src-tauri/src/{bridge,history,lib,mqtt_manager,transform}.rs`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src/{App,types,main,index.css,i18n}`、`src/components/BrokerStatusBar.tsx`、`src/components/Sidebar.tsx`、`src/components/bridge/BridgePanel.tsx`、`src/components/history/HistoryPanel.tsx`、`src/hooks/useBridge.ts`、`src/utils/exportMessages.ts`、`index.html`、`package.json`、`pnpm-lock.yaml`、`.gitignore`、`.github/workflows/ci.yml`、`README.md`

**第三轮新增**：`src-tauri/src/{topic,sysmonitor}.rs`、`src/components/ops/OpsPanel.tsx`（看门狗 / `$SYS` / 诊断）
**第四轮新增**：`src-tauri/src/{scheduler,bench}.rs`、`src/hooks/{useSchedules,useBench}.ts`、`tests/ui/{scheduler,bench,v5-properties,transfer-confirm}.spec.ts`
**第五轮修改**：`src-tauri/src/{bridge,history,diagnostics,mqtt_manager,lib}.rs`（P0-1/P0-2/P0-3 + 取消/finalize 所有权）、`src/components/ops/OpsPanel.tsx`、`src/types.ts`、`src/i18n/index.ts`

**第六轮新增**：`src-tauri/src/rpc.rs`（请求/响应状态机，13 条单元测试）、`src/hooks/useRpc.ts`、`src/components/mqttx/RpcPanel.tsx`、`tests/ui/rpc.spec.ts`
**第六轮修改**：`src-tauri/src/{mqtt_manager,lib,diagnostics}.rs`、`src/{App.tsx,types.ts,i18n/index.ts}`、`src/components/mqttx/MessagePublisher.tsx`、`src/components/ops/OpsPanel.tsx`、`tests/ui/{bench,v5-properties,subscribe-options}.spec.ts`（mock 补 `rpc_list`）
**第七轮新增**：`src/utils/csv.ts`、`src/utils/format.ts`、`tests/unit/csv.test.ts`、`tests/unit/format.test.ts`
**第七轮修改**：`src-tauri/src/{topic,transport,bridge,mqtt_manager,lib}.rs`、`src-tauri/Cargo.toml`（去掉未用的 thiserror）、`tailwind.config.js`、`src/themes/index.ts`、`src/hooks/{useBroker,useTransfers,useBatchSender}.ts`、`src/components/{Sidebar,SettingsModal}.tsx`、`src/components/{bridge/BridgePanel,file-transfer/BatchSender,file-transfer/TransferQueue,history/HistoryPanel,mqttx/MessagePublisher,mqttx/MessageStream,mqttx/RpcPanel,mqttx/TopicTrafficPanel,mqttx/RichText}.tsx`、`src/utils/exportMessages.ts`、`src/i18n/index.ts`
