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

### 3.3 界面与主题
- 浅色主题（Solaris）主体背景与选中态跟随 CSS 变量；`--text-muted` 对比度 `#a8a29e → #78716c`。
- 顶部栏可换行、右侧组 `ml-auto`；窄窗口无横向溢出。
- 历史行整行可点、带展开指示箭头；悬停态统一。
- 桥接面板在展开表单时隐藏重复的 "Add Rule" 按钮（此前同一视图存在两个同名按钮，语义不同）。

### 3.4 第二轮：MQTTX 对标补齐（2026-10-01 追加）

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

## 4. 验证矩阵（哪些真跑过）

| 项目 | 命令 | 结果 | 说明 |
| --- | --- | --- | --- |
| 前端类型检查 | `npx tsc --noEmit` | ✅ 通过 | |
| 前端单元测试 | `npx vitest run tests/unit` | ✅ 4/4 | 截断判定、导出保真、二进制 Hex、空桶填充 |
| 浏览器 UI 测试 | `npx playwright test` | ✅ 4/4 | 见下方"验证边界" |
| 界面目视核对 | Playwright 截图（Cyberpunk 1280 / Solaris 1020 / 850 窄窗） | ✅ 已逐张查看 | 浅色主题底色、模板卡片栅格、历史展开区均正常 |
| **Rust 单元测试** | `cargo clippy/test`（gnu harness，见 §4.1） | ✅ **25/25 通过** | protocol 5 + history 4 + transform 7 + webhook 6 + 原有若干 |
| **Rust clippy** | `cargo clippy --all-targets` | ✅ 零告警 | CI 用 `-D warnings`，此处已提前把关 |
| `bridge.rs` / `mqtt_manager.rs` / `lib.rs` | — | ⚠️ **gnu harness 覆盖不到**（依赖 `tauri::AppHandle`），但已通过下面的真机端到端验证 | 见 §4.3 |
| **真机端到端：MQTT → 桥接 → Webhook** | 本地 aedes broker + 本地 HTTP sink + 真实 Tauri 应用 | ✅ **通过** | 见 §4.3，截图 `test-results/app-cdp.png` |

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

Playwright 用例通过 `window.__TAURI_INTERNALS__` 桩替换了 IPC，它证明的是"React 组件在给定数据下的渲染与交互正确"，**不是**后端行为——后端行为由 §4.2（单元测试）与 §4.3（真机）负责。

---

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

## 6. 下一轮候选

> 原列第 1、2 项（过载漏记、历史错误可见）**已在第二轮完成并真机验证**，见 §3.4 与 §4.5。
> MQTTX 对标的完整差距分析与排序见 `docs/ROADMAP_vs_MQTTX.md`。

按性价比排序：

1. **C2 后端定时发布**：把调度从前端 `setInterval`（漂移、不持久、卸载即停、只能一条）挪进 Rust。
2. **D1 压测台补齐**：QoS/retain 可选、停止按钮、多主题、P50/P95/P99 与发送/确认差值。
3. **B2 协议字段补全**：Payload Format Indicator / Topic Alias / Session-Expiry / v5 Will properties。
4. **RPC 一等公民**：带 `responseTopic` 自动临时订阅应答主题、按 `correlationData` 配对、显示往返延迟与超时。
5. **多连接**：单 client 槽 → `HashMap<connId, Connection>`。建议单独一轮，需先定"历史与流量榜按连接归属"的语义。
6. **Webhook 可选可靠性**：失败落盘重投（N 次 / M 秒退避），明确它是本地文件队列而非消息中间件。
7. **系统代理开关**：按需启用 `reqwest/system-proxy`。
8. **把 gnu 路线固化成本地开发方式**：加 `pnpm tauri:dev:gnu`（设 `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu`），让没有 Windows SDK 的机器也能一键联调。
9. **补 `bridge.rs` 的自动化测试**：它只被真机端到端覆盖过一次，没有可重复回归。可把 `resync_subs` 的期望集合计算抽成不依赖 Tauri 的纯函数。
10. **给 `ErrorBoundary` 补用例**：目前只有代码路径审查，没有 Playwright 覆盖。

---

## 附：本轮改动文件清单

**新增**：`src-tauri/src/webhook.rs`、`src/utils/history.ts`、`tests/unit/history.test.ts`、`tests/ui/workspaces.spec.ts`、`playwright.config.ts`、`docs/ITERATION_2026_09.md`（本文件）

**第二轮新增**：`src/utils/codec.ts`、`src/hooks/useCodec.ts`、`src/components/ErrorBoundary.tsx`、`tests/ui/subscribe-options.spec.ts`、`tests/ui/codec.spec.ts`、`docs/ROADMAP_vs_MQTTX.md`
**第二轮修改**：`src-tauri/src/{transport,mqtt_manager,diagnostics,protocol,bridge,lib}.rs`、`src/components/mqttx/{MessageStream,SubscriptionsBar}.tsx`、`src/hooks/{useBroker,useMqttMessages}.ts`、`src/App.tsx`、`src/types.ts`、`src/i18n/index.ts`

**修改**：`src-tauri/src/{bridge,history,lib,mqtt_manager,transform}.rs`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src/{App,types,main,index.css,i18n}`、`src/components/BrokerStatusBar.tsx`、`src/components/Sidebar.tsx`、`src/components/bridge/BridgePanel.tsx`、`src/components/history/HistoryPanel.tsx`、`src/hooks/useBridge.ts`、`src/utils/exportMessages.ts`、`index.html`、`package.json`、`pnpm-lock.yaml`、`.gitignore`、`.github/workflows/ci.yml`、`README.md`
