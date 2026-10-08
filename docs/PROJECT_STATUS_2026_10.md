# DropQTT 项目现状总结（2026-10-05）

> 本文所有数字均为当场实测，不是回忆。测量命令随文标注，便于下次复核。

## 1. 一句话现状

**DropQTT 已经不是一个文件传输工具，而是一台 MQTT 工作台**：五个常驻工作区
（文件传输 / MQTT 控制台 / 数据桥接 / 消息历史 / 运维诊断），外加设备仿真与验收场景、
会话录制回放、Prometheus 指标导出。贯穿全部功能的一条主张是**失败不许看起来像成功**。

当前版本 **0.11.2**，`main` 与 `origin/main` 同步，工作区干净
（仅 `PROJECT_ANALYSIS_v0.9.md`、`docs/REVIEW_2026_10_03.md` 两份按你决定不入库的文档）。

## 2. 规模与门禁

| 指标 | 实测值 |
| --- | --- |
| Rust 源码 | 23,282 行 / 27 个模块（含 `bin/dropqtt-cli.rs` 与 `tls_report.rs`） |
| TS + TSX 源码 | 25,173 行 / 98 个文件 |
| Tauri 命令 | 79 个 `#[tauri::command]` |
| i18n 键 | 1032 × 4 语言（`scripts/check-i18n-parity.py` 三方核对：四份文件 + `Translations` 接口） |
| 依赖 | npm 31（运行时 14 + 开发 17）/ cargo 22 个直接依赖（本轮新增 `x509-parser`，11 个传递依赖） |
| 测试文件 | 22 个 unit + 37 个 Playwright spec + 1 个 Rust 集成测试 |

**门禁全绿（2026-10-08 本轮末次运行）**：

- Rust **383 lib + 1 集成通过**（macOS 本机 `cargo test`）
- 前端单测 **231 通过**（`npm test` = `vitest run tests/unit`）
- 真 DOM UI **254 通过**（`npx playwright test`）
- 真机 CLI 门禁 **cli-gate 37 项 + scenario-gate 26 项**（一次性 mosquitto `18831`，未碰本机 `1883`；scenario-gate 新增 7 项为 CLI 自驱 bench，§4.76；cli-gate 多出的那一项是 broker 身份自检，§4.78）
- `tsc --noEmit` 干净；`cargo clippy --all-targets -- -D warnings` **通过**
- ESLint **0 error / 10 warning**（预算锁在 10，本轮未涨）

## 3. 能力清单（按工作区）

**文件传输**：分块与重组（绕开 broker 包上限）、SHA-256 端到端校验、
PAUSE/RESUME/CANCEL 控制传播到对端、NACK 驱动的缺块重传、接收审批模式、
对端未确认的独立终态（不是绿勾）。

**MQTT 控制台**：MQTTX 风格收发 + 九种 payload 视图（`auto` 判定 + text / json / senml / cbor /
base64 / hex / markdown / html，含无依赖 CBOR 与 RFC 8428 SenML 读取）、
沙箱 QuickJS 用户变换、MQTT5 订阅选项与遗嘱属性、共享订阅、
**请求/响应一等公民**（超时重试次数、一问多答收集、correlation 按字节精确配对）、
SUBACK/PUBACK reason code 全量上抛、CONNACK 能力表（broker 说"只收 QoS1"就不会假装发了 QoS2）、
订阅标识符、报文级 trace、CLI 命令复制、会话录制 `.dqrec` 与按节拍回放。

**数据桥接**：broker→broker 与 broker→HTTP，多行源过滤器、排除子树、五种主题改写、
限速、**磁盘 outbox（1s→300s 退避 + 死信）**、多 sink fan-out、转发日志、规则导入导出（脱敏）。

**消息历史**：SQLite（WAL + JSON1）追加式迁移、按主题聚合、按天/按条保留策略、
**两条报文对比**（JSON 逐字段 / 文本逐行 / 二进制整体，附传输字段差异与截断感知，§4.80）、
**字段级取值历史**（按 `temp.c` 这类路径追一个字段的历史，静默画断点不插值，§4.81a）、
**投递审计**（按序号字段判缺口/重复/乱序/时延分位，并拒绝把它说成 broker 丢包，§4.81b）、
活动时间轴视图（按 correlation 跨主题配对 RPC）、捕获文件导出。

**运维诊断**：12 项主动健康检查、自身耗时仪表（flush / 滞后 / 历史写）、
**TLS 材料取证**（证书有效期判定 / 主体与颁发者 / SAN / CA 与叶子槽位错配 / 只有 CN 对得上这个 rustls 会忽略的陷阱，§4.82）、
静默看门狗（带恢复感知，设备复报会清自己的计时器）、故障注入（丢/延/重/篡改/错关联，
且明确声明"缺消息可能是我们干的"）、脚本化应答器、断言规则、
**Prometheus 指标端点**。

**跨工作区**：验收场景文件 `.dqscn`（装置 + 判据 + JUnit/JSON 结论）、命令面板 Ctrl+K、
空状态给控件而非一句话、四主题四语言、自动更新。

## 4. 第十七轮（本轮）新增

1. **`/metrics` Prometheus 端点**（评审 §3.4）：默认关闭、**只绑 `127.0.0.1` 且不提供 host 参数**、
   输出与面板同一份已脱敏快照；指标名与标签里没有报文、主题名、clientId、路径、凭据、健康检查文案。
   面板有开关、端口（下限由后端给出）、URL、抓取配置与指标说明复制。
2. **生命周期消息计数器**：`messages_received_total` / `messages_sent_total`，任何"重置统计"都不清零。
3. **uptime 序列**：因为上一条引入了"重启 vs 断流"的新歧义。
4. **窗口标题改名并跟随语言**：`DropQTT - MQTT Workbench` / `工作台` / `工作臺` / `ワークベンチ`。

## 5. 证据分级（哪些是跑出来的，哪些只是代码依据）

**真机跑出来的**（一次性 mosquitto `127.0.0.1:18831`，全程未触碰你本机的 `1883` 服务）：

- 指标端点：`netstat` 显示 `127.0.0.1:9464 LISTENING` 属主为 `dropqtt.exe`；
  `dropqtt_mqtt_connected{endpoint="127.0.0.1:18831"} 1`；发 5 条后
  `topics_tracked 0→1`、`history_rows 48713→48718`；`GET /` → 404、
  `POST /metrics` → 405 且**不回显路径**；158 行输出里 clientId / 主题名 / 路径 / token **零命中**；
  关闭开关后 `LISTENING` 消失。
- 计数器语义修正前后对比：修正前连上就 6、反复 reload 后 466；修正后连上 0、发 1 条 +1、发 5 条 Δ=5、
  控制台发布 `sent=1`。
- 标题栏：从进程外读 `MainWindowTitle`，zh-CN 得 `DropQTT - MQTT 工作台`，切 en 得 `MQTT Workbench`。
- release 产物本身也跑过：`target/release/dropqtt.exe` 启动后抓到 `dropqtt_uptime_seconds 474`。

**只有代码/单测依据、没做真机取证的**：

- "重启后端口自动关闭"——`MetricsHub::default()` 即关、且无任何持久化路径，但没做"重启再 curl"。
- **OTLP 推送没做**：它需要一个外发目标，"默认关 + 仅 loopback"的前提在 push 模型下不成立，
  宁可少做也不留一个默认往外发的开关。
- HEAD 请求的 `Content-Length` 与实际字节数一致性：纯函数测试覆盖，未走真 socket。

## 6. 已知限制与未做

| 项 | 状态 |
| --- | --- |
| §3.5 多连接工作区 | **未做**。实测改造面：73 个命令全部隐含"只有一个连接"、`App.tsx` 单 `broker.isConnected` 就 23 处、事件名要按连接分道、32 个 spec 的 mock 随之全改；且需先定"现有 4.8 万行历史如何归属"。属架构决策，不适合顺手做。 |
| §3.2 无头 CLI 进 CI | **已完成**（2026-10-07）。`ci.yml` 新增 `cli` 作业：一次性 mosquitto + ACL，跑 `scripts/cli-gate.sh` 的 37 项退出码断言。2026-10-08 起 `verify --scenario --bench-rate N` 能自己打负载、判性能条，带条的验收文件在 CLI 里也能拿到 0（§4.76）。**四个作业在 2026-10-08 首次同时转绿**——此前 `cli` 作业自引入起连红六次，真实原因是门禁对着别人的 broker 跑（§4.78）。 |
| §3.3 broker 凭据入 keyring | **已完成**（2026-10-07，见 §4.72）。密码进 OS 凭据库，本地设置只留随机引用；启动前迁移旧明文；引用悬空时连接明确报错而不是匿名重试。webhook header 里的敏感值 2026-10-08 也已入库（`webhook:` 前缀，见 §4.75）。 |
| §1.6 桥接每消息克隆 rules/conns 表 | **未做**。评审称是最大可优化项，但按本项目规矩要先 A/B 量出收益；此前两次"看起来该优化"的地方量下来都不是瓶颈。 |
| §1.7 `BEGIN IMMEDIATE` 失败少报计数 | **已完成**（本轮复核发现评审该条已过期，代码里已是"计入 lost_rows 并跳过本批"）。 |
| §8.4 双栏对比 | 依赖多连接的半边未做；"改动前 vs 改动后报文对比"半边**已有**（`utils/diff.ts` + 详情面板）。 |
| 历史全文检索 FTS5 | **主动不做**（写入放大在万级/s 场景是净损失，未验证前不加）。 |
| 前端虚拟化 | **主动不做**：实测比现状慢。 |

## 7. 发布与产物状态

- 已推 tag：`v0.10.0`（→ `3f99499`）、`v0.10.1`（→ `b6c442b`，**含标题修复**）、
  `v0.11.0`（已删除，见下）→ `v0.11.1`（报文对比 / 字段取值取证 / 投递审计 / TLS 材料取证 /
  CLI 自驱 bench / webhook header 入钥匙串 / CI 门禁修复）→ `v0.11.2`
  （修 `$SYS/#` 被拒后每秒一条 toast 的循环，§4.85）。
  **`v0.11.0` 发布失败、`v0.11.1` 成功**，原因与教训见下两条。
- **`v0.11.0` 四目标全挂在 tauri-action 一步**：`Unterminated inline array at row 56`。
  `src-tauri/Cargo.toml` 里 Linux target 的 `keyring` 写成了**跨行内联表**——TOML 1.0 不允许，
  而 `tauri-action` 用严格解析器读这个文件；cargo 自己宽容，所以 `cargo check` / `cargo test` /
  四个 CI 作业全绿，**只有真去发版才会暴露**。它是 keyring 那批改动带进来的，v0.10.1 之后
  没发过版，于是一直躺着。修法就是收成单行（§4.83）。
- 失败的 `v0.11.0` tag **已由属主指示删除**（2026-10-08，远端 + 本地）。当时先补
  `v0.11.1` 往前发是延续 `v0.10.0 → v0.10.1` 的先例；tag 留不留属决定事项，这次有了明确指示。
  可恢复信息：tag 对象 `defac9c` → 提交 `d34bd17`（仍在 main 上）。
  **Actions 里那次失败运行（`#37762168882`）不随 tag 删除而消失**，历史列表和该提交上的
  检查标记仍显示为红；要清掉它只能删运行记录，那是另一件事。
- **CI 可读，且本轮已在读**。这台机器上有已授权的 `gh`，`ci.yml` 四个作业的结果全部核实过
  （§4.77 连红五次就是靠读 CI 日志定位的）。读作业日志需要 `gh api --allow-escape-sequences`，
  否则它会拒绝输出，很容易被误当成"日志是空的"。
  版本一致性校验本地按 workflow 同一段 shell 复现通过（package = tauri = cargo = lock）。
  签名步骤**这次是查证过的，不再是推断**：`v0.11.1` 产出 17 个产物，
  rpm / deb / AppImage / msi / setup.exe / 两个 app.tar.gz 都带 `.sig`，
  `latest.json` 线上可读且 `version` 为 `0.11.1`。
- **本轮新增权限 `core:window:allow-set-title`** 会随 0.10.1 进入正式产物。
  范围窄（capabilities 限定 `windows: ["main"]`，只能改自己窗口的标题；远程 URL 关闭、
  CSP `default-src 'self'`）。不认可的话删这一行即退回静态英文标题。
- 本地产物：`src-tauri/target/release/bundle/msi/DropQTT_0.10.0_x64_en-US.msi`（14.4 MB，
  Windows Installer API 核对过 35 张表与负载在位）。**它是未签名的，不能当 release 发**——
  本机没有 minisign 私钥（`~/.tauri` 与 `.updater-key-password` 均不存在，签名密钥在仓库 secrets）。
  NSIS 的 `.exe` 本机做不出来：工具包每次都要从 GitHub 重下，累计 6 次在同一处被 TLS 截断，
  与代码无关。

## 8. 测量过程中值得留下的教训

1. **计数器必须活着测**：把自增放在 `route_message` 开头，理由写得很顺，实测却读出 466 而流量表说 5。
   原因是每次 CONNACK 重订阅 `$SYS/#`，mosquitto 就把整棵 retained `$SYS` 树重发一遍。
   修法不是"加个过滤"，而是**对齐已有的那把尺**——放到 `record_topic` 旁边，让总数恒等于流量表。
2. **`JoinHandle::abort()` 只请求取消**，socket 属于那个 future，运行时没轮到就仍占着端口；
   快速关-开会报 "port already in use"。要 `await` 那个 handle 才是可证明的释放。
3. **Tauri v2 不把 `document.title` 镜像到 OS 标题栏**（本机实测），改名要显式 `setTitle`。
4. **别把文件字节当成数据**：应用一次正常开合就会让 SQLite 把 WAL 合并回主库，三个文件 md5 全变而内容一字未动。
   判断"有没有动到数据"要看行数/时间戳/payload 合计，不是 md5。
5. **push 的回显不可信**：`v0.10.0` 那次打印了 `[new tag]` 而远端根本没有。此后一律用
   `git ls-remote` 取远端实际值核对。
6. **实验要有区分力**：第一次验标题时静态兜底值和英文译文用了同一字符串，"显示英文"根本分不清
   是没同步还是同步对了；让默认语言出中文并从进程外读数才有结论。
