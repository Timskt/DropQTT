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

### 5.5 压测台实测吞吐受"自发自收 + 全量入库"限制

请求 2000 msg/s（QoS1、64 B、三主题、同时订阅着 `bench/#`）实测约 **315 msg/s**；QoS0 请求 500 实测约 130。原因是这些消息要同时走完 `route_message` → 流量统计 → 控制台 feed → SQLite 批量入库，同一个事件循环任务既发又收。

因此面板显示的是**实际 /s**（由 `sent / elapsed` 算出）而不是只报请求值 —— 差距必须可见。要真正突破这个上限，需要给压测加"不镜像到 feed/历史"的开关（未做，已列入候选）。

### 5.6 定时发布是会话级的

任务活在 Rust 进程里，能扛过面板卸载和 `reload`，但**重启应用不会恢复**；持久化的只有节奏与次数默认值。跨重启自动恢复需要"保存的任务定义"（候选 C2b）。

### 5.7 文件传输：对端确认超时是"未知"，不是"失败"

发送端现在会在 `30s + 1s/MiB`（上限 900 s）内等不到回执就转入 `已发送·对端未确认`（§4.11）。但要注意这个状态的语义：**它只说明没收到回执**，不代表对端没拿到文件（对端可能拿到了却没订阅 ctrl 主题，也可能压根离线）。我们**故意不自动重发**，所以恢复手段目前只有人工重发。

另外：NACK 的"缺哪片补哪片"分支在本地回环下无法真实触发，目前只有代码路径与 §4.1 的单元测试级保证。

## 6. 下一轮候选

> 原列第 1、2 项（过载漏记、历史错误可见）**已在第二轮完成并真机验证**，见 §3.3 与 §4.5。
> 上一轮的第 1、2 项（C2 后端定时发布、D1 压测台补齐）**已在第四轮完成并真机验证**，见 §3.6、§3.7 与 §4.7、§4.8。
> 本轮第 3 项（B2 协议字段补全）同样已完成并做了线上取证，见 §3.8 与 §4.9。
> MQTTX 对标的完整差距分析与排序见 `docs/ROADMAP_vs_MQTTX.md`。

按性价比排序：

> **已完成的插入项**：文件传输"对端确认"超时与独立终态（§4.11）；重新发送入口与批次诚实化（§4.12）；审计报告 P0-1/P0-2/P0-3 的复核修复 + 取消/finalize 竞态（§3.9、§4.13）。剩下的同类问题是**断点续传**（重发是复用同一 transferId 还是新开一笔已定为新开），以及**给所有权判定补可回归的纯函数测试**。

1. **RPC 一等公民**：带 `responseTopic` 自动临时订阅应答主题、按 `correlationData` 配对、显示往返延迟与超时。
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
