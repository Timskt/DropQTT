# DropQTT 对标 MQTTX：差距分析与路线图

> **前提**：本文的"目标"不是全面模仿 MQTTX，而是回答一个问题——
> **在"MQTT 报文收发 + 界面体验"这个维度上，DropQTT 哪里该追平、哪里能反超、哪里不该打。**
> 现状盘点基于 `feat/history-and-workspace-polish` 工作区（含未提交改动），逐条带 `file:line` 证据。

---

## 1. 战略判断

MQTTX 是 EMQX 团队产品，有桌面版 + **Web 版** + **CLI** + 云同步 + AI Copilot + 设备模拟。在"通用客户端广度"上与之对耗，是拿单人项目打组织投入，**不该做**。

但两者架构取向不同，这是 DropQTT 的立足点：

| | MQTTX | DropQTT |
| --- | --- | --- |
| 基本单位 | **连接**（一个会话一个上下文） | **流量**（全量入 SQLite，跨会话可查） |
| 强项 | 交互体验、协议覆盖广度、生态工具链 | 事后取证、趋势观测、转发/转换、文件传输 |

所以路线是：**协议与交互追平到不丢分（A/B 组），观测与转换做壁垒（C/D 组），生态工具不碰。**

---

## 2. 现状对照

### 2.1 DropQTT 已有、MQTTX 没有的

1. 分块文件传输 + SHA-256 + NACK 重传 + 暂停/恢复/取消 + 接收审批
2. 桥接转发（Broker↔Broker **与** MQTT→Webhook）+ 每规则 QuickJS 转换 + dry-run
3. SQLite 全量历史（10 万行）+ 趋势图 + 筛选导出 + 截断感知重放
4. 单主题流量榜（速率/字节/峰值/最后活跃/快照差值找热点/CSV）
5. 自动 `$SYS/#` 探测 + 厂商指纹，且不污染消息流与流量统计
6. 零依赖 RFC 8949 CBOR 编解码；不可信载荷走 DOMPurify + `sandbox=""` iframe
7. 10 Hz 批量 IPC + 显式溢出计数；主题统计基数可运行时调
8. 运维诊断快照与脱敏报告导出

### 2.2 曾落后于 MQTTX、本轮已补齐

| 项 | 证据 | 状态 |
| --- | --- | --- |
| mTLS 材料读不到时静默退回系统根证书 | `transport.rs:22-48` | ✅ 改为硬失败，半配置也报错 |
| 过载时被丢弃的消息进不了历史 | `mqtt_manager.rs:532` | ✅ 淘汰行转入有界归档队列 |
| 历史读失败与"无结果"不可区分 | `history.rs:171,224` | ✅ `query`/`series` 返回 `Result` |
| 无 MQTT5 订阅选项 | `transport.rs:267` | ✅ `SubOptions` 上线并随重连恢复 |
| 控制台无用户编解码脚本 | 沙箱仅桥接可用 | ✅ 显示层 codec（复用 `bridge_test_transform`） |
| 一处渲染异常白屏整个应用 | 实测由 null 载荷触发 | ✅ 工作区级 `ErrorBoundary` |
| 定时发布是前端 `setInterval` | 漂移、卸载即停、只能一条 | ✅ **后端调度器**（`scheduler.rs` + `run_schedule`）：绝对网格 100×50 ms 实测跨 4949/4950 ms，前端同参数跨 6191 ms；`reload` 销毁整个 webview 后任务照跑；支持并行与断连停止 |
| 压测台过弱 | QoS0/retain 写死、无停止、单主题、只报发送数 | ✅ **`bench.rs` 重写**：多主题轮询、QoS0/1/2 + retain、可停止、回环 p50/p95/p99、PUBACK/PUBCOMP 与 sent 差值 |

### 2.3 仍然落后的（待办）

| 项 | 证据 | 影响 |
| --- | --- | --- |
| **控制台只能一条连接** | `lib.rs:18-21` 单 client 槽 | 结构差距最大的一项；桥接那套（任意 conn id）可作范本 |
| 缺 Payload Format Indicator / Topic Alias / Session-Expiry / v5 Will | `transport.rs:172,239` | 协议完整度 |
| RPC 无自动关联 | `MessagePublisher.tsx:446-464` | 有 responseTopic 却不自动订阅应答、无配对表、无超时 |
| 保留消息只从当前 500 行流里捞 | `MessageStream.tsx:270-274` | 无法查 broker 保留树 |
| 无系统代理 | 全仓无匹配 | 企业网络 |
| PING 测的是 CONNECT 握手 RTT | `mqtt_manager.rs:279-310` | 不是 keep-alive 延迟，且不周期刷新 |
| 无消息 diff | — | 排障时"这两个时刻/两个主题差在哪"没法直接看 |

---

## 3. 路线图

### 已完成（A/B/C/D 组）
- A1 mTLS 硬失败 · A2 过载归档 · A3 历史错误可见 · B1 v5 订阅选项 · C1 控制台编解码 · **C2 后端定时发布** · **D1 压测台（多主题/QoS/停止/分位数/确认差值）** · ErrorBoundary
- IoT 侧另加：SenML(RFC 8428) 读数、静默看门狗（见 `ITERATION_2026_09.md` §3.4）

### 下一轮（建议顺序）

1. **B2 协议字段补全** — PFI / Topic Alias / Session-Expiry / v5 Will properties。机械但面广。
2. **RPC 一等公民** — 带 `responseTopic` 就自动临时订阅、按 `correlationData` 配对、显示往返延迟与超时。历史层字段已就绪。
3. **多连接** — 单 client 槽 → `HashMap<connId, Connection>`。**建议单独一轮**：它会改所有控制台命令签名，且要先解决"历史与流量榜按连接归属"的语义问题，否则观测层会变糊。
4. **C2 的收尾** — C2b 保存的定时任务（当前任务只在会话内活着，重启不恢复）；C2c 定时任务的 CBOR 编码（缺 Rust 编码器，现在明确拒绝而非静默降级）。

### 明确不做
Web 版、CLI、云同步、AI Copilot、独立设备模拟器 GUI。
设备模拟场景：后端定时器 + `${timestamp|iso|uuid|random|counter|seq}` 模板已经能打（实测 100 条 50 ms 网格零误差、并行多任务、`reload` 不掉），再补"多连接"即可覆盖八成。

---

## 4. 验收口径

每项落地必须同时满足：

- Rust 侧：`cargo test` + `cargo clippy --all-targets -- -D warnings` 通过（本机可用 gnu harness 跑纯逻辑模块，见 `docs/ITERATION_2026_09.md` §4.1）
- 前端：`tsc --noEmit` + `vitest` + `playwright` 全绿
- **真机**：gnu 构建出 `dropqtt.exe`，用本地 broker（**不要碰用户自己的 mosquitto:1883**）跑一遍真实链路
- 线上语义类改动（订阅选项、属性透传）必须有**抓包或回环服务端可观测**的证据，不接受"界面显示了"即算通过
