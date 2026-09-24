# DropQTT v0.7.1 全面分析报告

> **分析日期**：2026-09-23
> **分析范围**：`src/`（42 个文件）、`src-tauri/src/`（8 个模块）、根级配置、CI/CD、测试
> **代码规模**：13,782 行（前端 + Rust）
> **分析方式**：只读全量审计 + 逐行证据核验
> **本报告未修改、创建或删除任何源码文件**（本文档本身为唯一新增产物）

---

## 目录

- [0. 项目概览](#0-项目概览)
- [1. 界面层面](#1-界面层面)
- [2. 功能层面](#2-功能层面)
- [3. 代码结构层面](#3-代码结构层面)
- [4. 用户体验层面](#4-用户体验层面)
- [5. 可扩展性层面](#5-可扩展性层面)
- [6. 安全专项](#6-安全专项)
- [7. 生态功能扩展](#7-生态功能扩展)
- [8. 健康记分卡](#8-健康记分卡)
- [9. 改进清单（P0/P1/P2）](#9-改进清单p0p1p2)
- [10. 路线图与下一步](#10-路线图与下一步)
- [附录 A. 证据索引](#附录-a-证据索引)

---

## 0. 项目概览

| 项 | 事实 |
|---|---|
| 定位 | Tauri 2 桌面端：MQTT 文件传输 + MQTTX 风格控制台 + Broker 桥接 + 历史归档 |
| 技术栈 | React 18 + TS 5.7（strict）+ Tailwind 3 + CSS 变量主题<br>Rust 2021 + rumqttc 0.24 + tokio + rusqlite + rquickjs |
| 代码量 | 13,782 行 |
| 最大文件 | `mqtt_manager.rs` 2022 · `i18n/index.ts` 1630 · `bridge.rs` 907 · `BridgePanel.tsx` 897 · `MessagePublisher.tsx` 630 · `MessageStream.tsx` 553 |
| 测试 | Rust **35** 个（bridge 15 / transform 7 / mqtt_manager 7 / protocol 5 / history 1）；前端 **0** 个 |
| CI | `.github/workflows/ci.yml:31-35,65-75` — tsc + vite build + cargo check/clippy/test<br>**无 lint、无前端测试** |
| IPC 表面 | **37** 个 `#[tauri::command]`（`lib.rs`，全部注册于 `:368-406`） |
| 工作区状态 | 13 个已修改 + 5 个新增未提交（`history.rs`、`components/history/`、`BrokerSysPanel.tsx`、`useBrokerSys.ts`、`utils/template.ts`） |

### 组件层级

```
App (src/App.tsx:34)
├── Sidebar (:169)                      固定 w-60，4 模式导航 + 语言/主题选择
├── 主列 (:190)
│   ├── BrokerStatusBar (:191)          h-11，模式标签 + Broker 下拉 + 延迟 + 连接开关
│   ├── 连接错误横幅 (:206-221)
│   └── main (:223) ── 四模式嵌套三元 (:224-345)
│       ├── HistoryPanel
│       ├── BridgePanel → BridgeConnCard ×2
│       ├── transfer: BatchSender + ReceiverConfig + TransferQueue → TransferRow
│       └── mqttx:    SubscriptionsBar + BrokerSysPanel + TopicTrafficPanel
│                     + MessageStream → MessageRow → {JsonTree, MarkdownView, HtmlPreview}
│                     + MessagePublisher
└── SettingsModal (:350)                全局挂载
```

---

## 1. 界面层面

### 1.1 视觉风格：设计令牌体系（本项目最大资产）

`ThemeTokens` 定义 40 个语义变量（`src/themes/index.ts:3-52`），4 套主题（`:107-206`）。语义状态色采用 **text / soft / border 三元组**，因此 chip 在明暗主题下都不需要 `!important` 覆写：

```css
/* src/index.css:174-182 */
.chip-info { color: var(--info); background: var(--info-soft); border-color: var(--info-border); }
```

Solaris 亮色主题专门重排了整个状态色板（`src/themes/index.ts:175-200`），并刻意保留深色代码面（`:163` `'--bg-code': '#292e36'`，注释 `:8` 说明 "kept dark in light themes, editor-style"）——这是经过思考的决策，不是遗漏。

### 1.2 可优化的 UI/UX 细节（按严重度）

#### ① 默认窗口下双栏布局永不生效（确认）

`tauri.conf.json:17-20` 默认 `width: 1020`、`minWidth: 850`；`tailwind.config.js` 无自定义 `screens` → `lg` = 1024px。而：

```tsx
// src/App.tsx:233
<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
```

1020px < 1024px，侧栏再吃掉 240px（`Sidebar.tsx:86` `w-60`），内容区实际仅 780px。**默认窗口尺寸下传输页永远是单栏堆叠**，`max-w-6xl`（1152px）也永远够不到。

同类断点还出现在 `MessagePublisher.tsx:569`（分屏预览）、`BatchSender.tsx:102,188`、`BrokerSysPanel.tsx:89`、`ReceiverConfig.tsx:83`。

#### ② 令牌双源（确认）

`src/index.css:7-51` 的 `:root` 回退值与 `src/themes/index.ts:60-105` 的 `darkBase` 是同一套 cyberpunk 值的**两份手抄**。改主题必须同步两处，否则首帧与运行时不一致。

#### ③ 硬编码颜色绕过令牌（确认）

同一"代码面文字"角色存在两个不同值：

| 位置 | 值 |
|---|---|
| `MessageStream.tsx:219`、`MessagePublisher.tsx:587`、`HistoryPanel.tsx:224`、`JsonTree.tsx:124` | `#d3dae6` |
| `index.css:263`（`.rich-md code`） | `#e2e8f0` |

其它：`rgba(148,163,184,…)` 边框重复 5 处（`MessageStream.tsx:202,206,219`、`HistoryPanel.tsx:224`、`JsonTree.tsx:103`）；`JsonTree.tsx:10-17` 整套 COLORS；`SubscriptionsBar.tsx:17` COLOR_PALETTE；`BridgePanel.tsx:802,806` 的 `#9cdcfe` / `#ce9177`（VSCode 色，背景用了令牌、前景没有，属半迁移状态）。

#### ④ 亮色主题下的白色残留（确认）

- `SubscriptionsBar.tsx:102` 色板选中态 `outline: '2px solid white'`
- `RichText.tsx:136` HTML 预览 iframe `bg-white`
- `ReceiverConfig.tsx:115`、`SettingsModal.tsx:52` 开关滑块 `bg-white`

在 Solaris 象牙白背景上选中态几乎不可见。

#### ⑤ 交互可达性缺陷（确认）

| 问题 | 位置 |
|---|---|
| Broker 配置下拉是**纯 hover 菜单，且触发按钮没有 onClick** → 键盘/触屏完全无法打开 | `BrokerStatusBar.tsx:56-65`（无行为）、`:68` `hidden group-hover:block` |
| **"拖拽"提示是假的**：`div onClick`，无 `onDrop`/`onDragOver`；无 `role`/`tabIndex` | `BatchSender.tsx:132-142` |
| 模态框无 Escape、无焦点陷阱、无背景点击关闭、无 `role="dialog"`/`aria-modal` | `SettingsModal.tsx:137` |
| 点击 `<pre>` 展开 payload，唯一提示是内嵌英文文字 | `MessageStream.tsx:211-215,223` |
| 展开历史行是 `div onClick` 而非 button | `HistoryPanel.tsx:203-205` |

#### ⑥ 主题/语言管道的死代码与静态谎言（确认）

```js
// tailwind.config.js:7    darkMode: 'class'  → 全仓 0 处 dark: 变体
// index.html:2            <html lang="zh-CN" class="dark">  → 切语言/切亮色主题都不更新
// index.html:2,9          #090b10 背景硬编码 3 处 → 选亮色主题时首帧深色闪屏
```

零引用项：`tailwind.config.js:10-23` 的 `brand`/`electric` 色板、`:43-45` 的 `pulse-slow`、`themes/index.ts:219` 的 `themeBodyBg`。

#### ⑦ 内联样式压倒组件化（确认）

全仓 **337 处 `style={{}}`**、512 处 `var(--…)`，但**没有 Button/Chip/Field/PanelHeader 任何共享原语**。四个面板头各自手抄同一套结构：`HistoryPanel.tsx:109-123`、`TransferQueue.tsx:249-260`、`BrokerSysPanel.tsx:62-79`、`TopicTrafficPanel.tsx:156-196`。

---

## 2. 功能层面

### 2.1 核心功能

| 功能 | 证据 |
|---|---|
| MQTT 3.1.1 / 5.0 双协议（客户端与事件循环双枚举归一化） | `transport.rs:79-96,98-129,132-185,187-263,265-308` |
| TLS / 自定义 CA / mTLS 双向认证 | `transport.rs:16-48`（`:41` `tls(ca, client_auth, None)`） |
| 用户名密码、LWT 遗嘱、keepAlive、10MB 包上限、100 槽请求通道 | `transport.rs:139-152,165-177,135,137,157` |
| 分块文件传输（64KB–2MB 可选） | `mqtt_manager.rs:1360-1618`；UI `BatchSender.tsx:22-28` |
| SHA-256 端到端校验 + 原子改名交付 | `mqtt_manager.rs:1019-1110`、`:1134` `fs::rename` |
| NACK 驱动缺块重传 + 看门狗（8 轮上限） | `mqtt_manager.rs:1807-1893,1333-1351,1895-1925` |
| 暂停 / 恢复 / 取消 | `mqtt_manager.rs:1620-1640`；UI `TransferQueue.tsx:179-193` |
| 接收审批模式（自动 / 人工 Approve-Reject） | `mqtt_manager.rs:1083-1109,1187-1220` |
| 断线自动重连 + CONNACK 后全量重订阅（含 `$SYS/#`） | `mqtt_manager.rs:274-314,285-293` |
| 订阅注册表（持久化 + 重连自动重放） | `useMqttMessages.ts:19-22,84-112`；`useBroker.ts:103-108` |
| 多格式发布（Text/JSON/MD/HTML/CBOR/Base64/Hex） | `utils/payload.ts:10-18,23-57` |
| 消息流 8 种视图 + auto 内容嗅探 | `MessageStream.tsx:36-48,51-90` |

### 2.2 辅助功能

| 功能 | 证据 |
|---|---|
| 逐 topic 实时流量排名 | `mqtt_manager.rs:509-594`；`TopicTrafficPanel.tsx:71-79` |
| 热点阈值告警 + 快照差分（NEW 标记） | `TopicTrafficPanel.tsx:82-101,199-213,285-287` |
| 内置压测实验台（≤20k msg/s） | `mqtt_manager.rs:599-669`；`TopicTrafficPanel.tsx:139-152` |
| 抗过载批量 feed（100ms/200条/512KB，溢出计数） | `mqtt_manager.rs:21-30,454-493`；UI `MessageStream.tsx:518-523` |
| feed 暂停 + 缓冲（上限 500） | `useMqttMessages.ts:24-30,46-52,63-78` |
| Broker `$SYS` 健康面板 + 厂商识别 | `BrokerSysPanel.tsx:27-52`；`mqtt_manager.rs:384-400,738-743` |
| SQLite 持久历史 + 手写 SVG 趋势图 | `history.rs:69-85`；`HistoryPanel.tsx:24-51` |
| Broker↔Broker 桥接（24 字段，5 种 topic 改写模式） | `bridge.rs:38-102,200-250`；`types.ts:176-212` |
| 沙箱 JS 载荷变换（100ms / 4MB / 16KB 三重上限） | `transform.rs:22-24,55-65` |
| 逐规则限速 + 转发/丢弃计数 + 实时日志 | `bridge.rs:170-183,543-552`；`useBridge.ts:59-65` |
| 规则导入/导出 JSON + 启动自动重连 | `useBridge.ts:135-143,168-183` |
| JSON/CSV 导出（原生对话框 + 浏览器回退） | `utils/exportMessages.ts:58-90` |
| Retained 消息一键清除 | `MessageStream.tsx:258-300,439-485` |
| 消息重放 / 点击 topic 快速订阅 | `MessageStream.tsx:142-150,168-176`；`App.tsx:308-322` |
| 模板变量（timestamp/iso/uuid/random/counter） | `utils/template.ts:6-42` |
| 定时循环发布 | `MessagePublisher.tsx:188-218` |
| Markdown（DOMPurify）/ HTML（sandbox iframe）富文本渲染 | `RichText.tsx:71-74,88-139` |
| 可折叠语法着色 JSON 树 | `JsonTree.tsx:43-134` |
| 4 主题 + 4 语言（322 键 × 4 = 1288 条） | `themes/index.ts:107-206`；`i18n/index.ts:1,329` |
| 草稿持久化 + 最近 topic 自动补全 | `MessagePublisher.tsx:75-82,118-131,316-320` |
| 剪贴板 WKWebView 降级兼容 | `utils/clipboard.ts:10-38` |
| 自动更新（minisign 签名） | `App.tsx:145-162`；`tauri.conf.json:30-35` |

### 2.3 边界情况：处理得当的部分（确认）

- **过载降级是设计过的**：`mqtt_manager.rs:21-30` 注释明确说明"thousands of msgs/sec 下逐条 IPC 会冲垮 webview"，三重上限 + 溢出计数（`:460`），前端如实告知（`MessageStream.tsx:521`）且**流量统计保持精确**。
- **截断载荷禁止重放**：`MessageStream.tsx:170` `disabled={!connected || msg.truncated}`，配专属提示 `t.replayTruncated`。
- **元数据校验**：`mqtt_manager.rs:811-822` 校验 `chunk_size` ∈ (0, 8MB)、`sha256.len()==64`、`expected_chunks == total_chunks`；`:906` 严格校验每块长度；`:825-828` 重复/重放 meta 直接忽略。
- **校验失败有完整收尾**：发 ERROR ctrl、删临时文件、置 failed（`:1049-1081`）。
- **旧版存档兼容**：`types.ts:214-238` `bridgeRuleDefaults` + `useBridge.ts:178` 展开合并。
- **浏览器开发态降级**：所有 hook 的 `invoke` 都包 `catch {}`（`useTopicStats.ts:31-33`、`useBrokerSys.ts:17-19`、`useBridge.ts:70-72`）。
- **0 字节文件**：`total_chunks=1`（`mqtt_manager.rs:1385-1389`），期望长度 0（`:1674-1681`）。

### 2.4 边界情况：确认的功能缺陷

#### F-1 批量发送的文件大小永远是 0（P1，用户可见）

```tsx
// src/components/file-transfer/BatchSender.tsx:68
const newItems = paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() || 'file', size: 0 }));
```

`useBatchSender.ts:25` 原样透传 `size: f.size`，全仓无任何 `stat`/后端回填（已 grep 确认 `setBatchFiles` 无外部调用者）。因此 `:76` `totalSize` 恒为 0，`:212` 永远渲染"总容量: 0 B"。

#### F-2 历史面板的时间窗/方向/条数控件全部失效（P1）

```tsx
// src/components/history/HistoryPanel.tsx:84-89
}, [search, direction, limit, windowId]);
useEffect(() => { load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

`load` 依赖四个状态，但 effect 依赖为空 → 点击 5m/15m/1h/24h（`:167-180` 仅 `setWindowId`）不会重新查询，趋势图与 `sinceMs`（`:69-70`）永远停留在首次加载；方向 segmented（`:138-152`）与 limit 下拉（`:153-155`）同样惰性，必须再点一次"查询"（`:156`）。

#### F-3 批量发送失败也会放彩带（P2）

```ts
// src/hooks/useBatchSender.ts:102-104
if (!cancelRef.current) { confetti({ particleCount: 80, spread: 80, origin: { y: 0.7 } }); }
```

只判断"未取消"，不判断逐项 `status === 'failed'`（`:87,96` 会写入 failed）→ 部分/全部失败仍庆祝。

#### F-4 5 分钟后传输控制静默失效（P1，后端）

`mqtt_manager.rs:1497-1501` 的 300 秒清理任务**无条件**移除 outgoing 条目 → 此后 `pause/resume/cancel`（`:1620-1640`）与 NACK 重传（`:1348`）对长传输变成空操作，UI 无任何反馈。

#### F-5 磁盘写满的错误信息误导（P2）

`mqtt_manager.rs:951-954` 写块失败仅 `eprintln!`，该块不记入 `received_chunks` → 看门狗 NACK 7 轮后报 `"Timed out: N of M chunks never arrived"`（`:1861-1869`）。用户看到"网络超时"，真因是磁盘。

#### F-6 断开连接时的 finalize 竞态（P2）

`mqtt_manager.rs:354` `disconnect` 清空 `incoming_transfers`，而 `:1008-1014` spawn 的 `finalize_incoming` 可能仍在计算哈希（`:1041`）→ 随后 `rename`（`:1134`）失败并报 "failed"。

#### F-7 未连接时也在轮询（P2）

`App.tsx:84` `useTopicStats(activeMode === 'mqttx')` 未带 `broker.isConnected`，而 `:81` 和 `:87` 都带了。全应用共 **4 个独立定时器**：1000ms（`useTopicStats.ts:36`）、1500ms（`useSubscriptionStats.ts:29`）、1500ms（`useBridge.ts:103`）、2000ms（`useBrokerSys.ts:28`）。

#### F-8 其它

- 启动时无孤儿 `.dropqtt_*.tmp` 清扫。
- `sys_metrics` 无上限（`mqtt_manager.rs:741`，仅 `:357,399` 清空），订阅 `$SYS/#`（`:293`）后对端可无限撑大。
- `transfer_id` 未做字符集校验即拼入临时路径（`:835`）。
- `bridge.rs:342` 订阅失败被 `let _ =` 吞掉，`:347-352` 却把 `subs` 覆写为 `desired` → 状态声称已订阅，实际没有，直到重连才恢复。
- `bridge.rs:47-48` `source_qos` 字段声明后，`:342` 订阅硬编码 `1` → 字段实际无效。
- `bridge.rs:605-608` 目标连接缺失时 `None => continue`，不计数、不发事件 → 静默丢消息。

---

## 3. 代码结构层面

### 3.1 目录组织（评价：良好）

```
src/
  components/{file-transfer,mqttx,bridge,history}/   ← 按工作模式分组
  hooks/         8 个 use*，一个领域一个
  utils/         cbor / payload / template / clipboard / exportMessages（纯函数）
  themes/        令牌定义 + applyTheme
  i18n/          单文件字典
  types.ts       与 protocol.rs 手工镜像的契约
src-tauri/src/   扁平 8 文件
```

### 3.2 职责过载（确认）

| 单元 | 规模 | 问题 |
|---|---|---|
| `MqttManager` | **21 字段**（`mqtt_manager.rs:136-161`）、**42 方法**（`:170-1666`） | ≥12 项职责：连接生命周期、订阅注册表、`$SYS` 抓取、history 代理、feed 批处理与 IPC、流量统计、压测发生器、控制台发布、接收状态机、发送状态机、控制协议、文件 IO + UI emit。**是 god object** |
| `send_file` | `:1360-1618`，**259 行** | 单函数最长。其余：`handle_chunk` `:892-1016`(125)、`handle_meta` `:797-890`(94)、`finalize_incoming` `:1019-1110`(92)、`run_watchdog` `:1807-1893`(87) |
| `bridge.rs route` | `:572-694`，123 行 | 排除过滤 + 限速 + topic 改写 + transform + 属性转发 + 事件发射全在一处 |
| `BridgePanel` | 897 行；主组件 `:266-897` = **632 行**，单个 `return` 的 JSX 占 `:420-896` = **477 行** | 约 **10 项职责**；10 个 `useState` + 1 `useRef`（`:272-284`）；4 个 textarea（`:567,613,676,719`）；只抽出 1 个子组件（`BridgeConnCard` `:99-264`） |
| `lib.rs` | 409 行 | 模块声明 + `AppState`(`:16-19`) + **37 个命令** + 插件初始化 + DB 引导 + `invoke_handler`(`:368-406`)；`run()` 77 行(`:333-409`) |
| `i18n/index.ts` | 1630 行 | 322 键 × 4 语言单文件常量，全量进主 chunk |

**关注点混杂的具体位置**：`mqtt_manager.rs:984` 的 `emit_progress` 嵌在 `:916` `incoming_transfers.lock().await` 持锁作用域内，同一作用域还做磁盘写（`:946-954`）——协议解析、文件 IO、UI 事件三者共用一把全局锁。

### 3.3 复用率与冗余（确认）

**`formatBytes` 被实现 5 次，3 种不同实现：**

```
src/components/bridge/BridgePanel.tsx:59          （MB/GB 分支式）
src/components/file-transfer/BatchSender.tsx:55   （log/pow 式，组件内定义）
src/components/file-transfer/TransferQueue.tsx:21 （log/pow 式，与上重复）
src/components/mqttx/MessagePublisher.tsx:66      （只到 KB，一行式）
src/components/mqttx/TopicTrafficPanel.tsx:40     （MB/GB 分支式，与 BridgePanel 重复）
```

**其它冗余：**

- `bridge.rs:646-664` 与 `:678-692` 两段近乎相同的 `BridgeEvent` 发射块。
- transform 脚本校验在 `lib.rs:299-305` 与 `bridge.rs:504-513` 重复。
- `history.rs:191-195` 重复的 SQL 字符串对。
- 主题令牌双源（`index.css:7-51` vs `themes/index.ts:60-105`）。
- 面板头 JSX 四处手抄（见 1.2⑦）。
- `BridgePanel.tsx:438-459` 与 `:460-481` 两个 `BridgeConnCard` 调用点，`onConnect` 函数体除 `'src'`/`'dst'` 字面量外**逐字相同**。
- `BridgePanel.tsx:823-825,827-829,832-838` 三个近乎相同的统计徽章；`:840-847`/`:848-855` 两个除图标外相同的图标按钮；`:161` 与 `:212` 重复的 `{p.name} · {host}:{port}`；`:577`/`:579` 相邻两行各算一次同一个 `split('\n').filter().length`。
- 事件日志上限魔数**三处重复**：`BridgePanel.tsx:869-873` 硬编码 `'150'`/`'80'`、`:882` `events.slice(-80)`、`useBridge.ts:14` `EVENT_LOG_CAP = 150`。
- `BridgePanel.tsx:95-96` 自实现 base64，而 `utils/cbor.ts` 的 `uint8ToBase64` 已存在且 `MessagePublisher.tsx:160` 正在用。

**死代码：**

| 项 | 位置 |
|---|---|
| `source_qos` 字段声明后无效 | `bridge.rs:47-48` vs `:342` |
| `disconnect_all` 零调用者（无 `on_window_event`）→ 无优雅关闭 | `bridge.rs:477` |
| `themeBodyBg` 零引用 | `themes/index.ts:219` |
| 第二次冗余 base64 解码走 `unwrap_or_default()` 死分支 | `mqtt_manager.rs:705-707` |
| tailwind `brand`/`electric`/`pulse-slow` 零引用 | `tailwind.config.js:10-23,43-45` |
| `darkMode:'class'` + `<html class="dark">` 但无 `dark:` 变体 | `tailwind.config.js:7`、`index.html:2` |
| 死别名 `const targetDescription = topicRewriteDescription` | `BridgePanel.tsx:418` |
| `opener:default` 权限：前端零 `plugin-opener` 引用 | `capabilities/default.json:10` |
| `scripts/generate_logo.swift` 无任何 workflow/文档引用 | `scripts/` |

### 3.4 命名规范（评价：良好）

TS 侧 camelCase / 组件 PascalCase / 常量 SCREAMING_SNAKE 一致；Rust 侧 snake_case 一致；hook 命名统一 `use<Domain>` 且每个都有解释"为什么"的 JSDoc（`useBroker.ts:25-28`、`useMqttMessages.ts:14-17`、`useTransfers.ts:7-10`、`useBridge.ts:29-33`）——质量高于平均。

**跨语言边界依赖 Tauri 的隐式大小写转换**：Rust `transfer_id` ← JS `transferId`（`useTransfers.ts:57`），`file_path` ← `filePath`（`useBatchSender.ts:73`）。这是隐式契约，**没有任何地方声明**，改错不会报错只会静默 undefined。

### 3.5 耦合过重的部分（确认）

#### ① IPC 契约完全手工维护

约 **40 处 `invoke('字面量')`** 分散在 8 个文件，无类型化封装层。新增一个命令需同时改 `lib.rs`（函数 + `:368-406` 注册）、`protocol.rs`、`types.ts`、调用方 hook 四处，全靠人肉同步。

#### ② 协议层没有类型安全的枚举

```rust
// src-tauri/src/protocol.rs:100,119-120,177
pub msg_type: String,   // "NACK" | "COMPLETED" | "ERROR"  ← 仅注释约定
```

TS 侧 `types.ts:39-48` 有 `TransferStatus` 联合类型，但 Rust 侧无对应 enum，两端漂移不会被编译器发现。

#### ③ 错误全部字符串化

37 个命令一律 `Result<_, String>`；`Cargo.toml:33` 声明了 `thiserror = "1.0"` 但 `src-tauri/src` 中**零使用**。文案风格混杂：`"script is empty"`（`lib.rs:301`）、`format!("Rule '{}' has an invalid regex: {}", …)`（`bridge.rs:502`）、`format!("open history db: {e}")`（`history.rs:64`）。前端只能 `String(err)` 展示，无法按类型分流。

#### ④ 渲染期副作用

```tsx
// src/App.tsx:59,71
const getConsoleTopicsRef = useRef<() => ...>(() => []);
getConsoleTopicsRef.current = mqtt.getTopicsToRegister;   // 在 render body 中赋值
```

注释（`:57-58`）说明是为打破 broker↔messages 循环依赖，意图可理解，但渲染期写 ref 是 React 反模式。

#### ⑤ 持久化"脑裂"

UI 偏好在 localStorage（`usePersistentState.ts:4-24`，无版本号无迁移）、桥接规则在 localStorage 再推给后端（`useBridge.ts:36,82-87`，**前端是权威源**）、历史在 SQLite、下载目录在 Rust 侧（`App.tsx:113,136`）。唯一迁移机制是手写的 `bridgeRuleDefaults`（`types.ts:214-238`）。`useTransfers.ts:16-18,52` 甚至绕开 `usePersistentState` 直接读写 `localStorage`——同一项目内两种持久化写法。

#### ⑥ 无 ESLint，却有 6 处 eslint-disable

`SettingsModal.tsx:93`、`HistoryPanel.tsx:88`、`useTopicStats.ts:41`、`useBridge.ts:142`、`useTransfers.ts:23`、`MessagePublisher.tsx:172` 全部抑制 `react-hooks/exhaustive-deps`，但 `package.json:28-39` devDependencies 无 eslint、`:6-11` 无 lint 脚本 → **抑制是空转的，底层隐患无人看守**。其中 `HistoryPanel.tsx:88` 已确认对应 F-2 缺陷；`useTopicStats.ts:30`、`useBridge.ts:139` 捕获了过期闭包。

#### ⑦ TS 严格度

`tsconfig.json:18-21` 开了 `strict` + `noUnusedLocals` + `noUnusedParameters` + `noFallthroughCasesInSwitch`（好）。缺 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`；`:7` `skipLibCheck: true`；`:23` `"include": ["src"]` → `scripts/` 不受检查；`tsconfig.node.json:1-10` **完全没开 `strict`**，这正是 `vite.config.ts:4` 需要 `@ts-expect-error` 的原因。

---

## 4. 用户体验层面

### 4.1 操作路径（评价：主干顺畅）

**首次传输**：启动 → 默认已配置公共 broker（`types.ts:289-299`）→ 顶栏 Connect（`BrokerStatusBar.tsx:124`）→ 选文件（`BatchSender.tsx:133`）→ Send Batch（`:229`）。**约 3 步，无需进设置**——很好的默认值设计。

**接收审批**：关闭 auto-accept（`ReceiverConfig.tsx:106-118`）→ 校验完进入 `awaiting_approval` → 侧栏脉冲徽章（`Sidebar.tsx:143-150`）→ 行内 Approve/Reject（`TransferQueue.tsx:156-177`）+ 行背景高亮（`:138`）。双重提示，路径清楚。

**控制台调试**：默认预置两条订阅（`useMqttMessages.ts:9-12`）→ 自动嗅探格式（`MessageStream.tsx:55-65`）→ 点 topic 快速订阅（`:142-150`）→ 重放（`:168-176`）。符合 MQTTX 用户心智。

### 4.2 反馈机制（评价：不统一，缺全局层）

**做得好的：**

- 连接错误有全局横幅 + 一键重连（`App.tsx:206-221`）。
- 空状态区分语义：`MessageStream.tsx:529` 区分 `t.noMessages` / `t.noMessagesFiltered`；`BrokerSysPanel.tsx:83` 区分 `t.sysEmptyWaiting`（已连接等待）/ `t.sysEmptyOffline`（未连接）。
- 复制/重放有瞬时视觉确认（`MessageStream.tsx:175,182` + 自动复位 `:309,316`）。
- 发布器实时字节数与非法载荷告警（`MessagePublisher.tsx:134-140,483-493`）。

**问题：**

- **没有统一 toast/notification 层**。瞬时反馈被实现了 **6 次**：`copiedId`+`replayedId`+`exportNote`（`MessageStream.tsx:249-252`）、`successToast`+`errorText`（`MessagePublisher.tsx:94-95`）、`updateStatusText`（`App.tsx:110`）、`testResult`（`SettingsModal.tsx:86`）、`copiedId`（`HistoryPanel.tsx:63`）。样式、时长（1400/1500/2000/2500/3500/4000ms）、位置各不相同。
- **错误反馈大量只进 console**：发布失败 `MessageStream.tsx:318`；订阅失败 `useMqttMessages.ts:95,107`；历史加载失败 `HistoryPanel.tsx:80`；下载目录初始化失败 `App.tsx:115`。UI 毫无反应。
- **传输控制操作完全没有 catch**：`useTransfers.ts:56-78` 六个函数都是裸 `await invoke(...)` → 后端 Err 时产生未处理 rejection，UI 静默。
- **静默吞错**：`HistoryPanel.tsx:100` `clear_history` `.catch(() => {})`；`useBroker.ts:107` 重订阅 `.catch(() => {})`。
- **富文本渲染失败被静默降级**：`RichText.tsx:96-98` `catch { return null; }` → 渲染成 `<pre>`（`:118`）但不告知"Markdown 解析失败"。
- **原生阻塞对话框 ×2**：`App.tsx:151` 更新确认、`HistoryPanel.tsx:99` 清空历史。
- **删除桥接规则无确认、无撤销**：`BridgePanel.tsx:848-855` 立即删除。
- **桥接页 4 个互不相关的错误面**：`BridgePanel.tsx:484-488`、`:256-260`、`:769-771`、`:703-714`。

### 4.3 加载状态（评价：三个模式覆盖较全，桥接模式为零）

已有：`isConnecting`（`BrokerStatusBar.tsx:126,134`）、`isTesting`（`:102,108`）、`testing`（`SettingsModal.tsx:345-347`）、`isPublishing`（`MessagePublisher.tsx:620,623`）、`exporting`（`MessageStream.tsx:418,423`）、`loading`（`HistoryPanel.tsx:61,117`）、`clearingRetain`（`MessageStream.tsx:475,480`）、`isSendingBatch`（`BatchSender.tsx:230,233`）。

**例外：**

- **桥接模式完全没有 loading 态**：`busy` 只用于禁用按钮（`BridgePanel.tsx:200,248`），无 spinner/骨架屏；`runScriptTest`（`:286-305`）不设 pending 标志、不禁用按钮（`:693-701`）→ 试运行可被连续点击，产生并发后端调用。
- `ReceiverConfig.tsx:30-37` 用 `setTimeout(..., 400)` 制造**假加载动画**；`:73` 禁用时未区分"未连接"与"处理中"。

### 4.4 无障碍（评价：几乎为零 — 本项目最薄弱维度）

全仓 42 个 tsx 文件中，ARIA 属性只有 **2 处**：

```tsx
// src/components/file-transfer/ReceiverConfig.tsx:108-109
role="switch"
aria-checked={autoReceive}
```

`BridgePanel.tsx`（897 行）中 `aria-`/`role=`/`tabIndex`/`onKeyDown`/`htmlFor` 匹配数为 **0**。

| 缺口 | 证据 |
|---|---|
| 无 `aria-label`：所有图标按钮仅靠 `title` | `MessageStream.tsx:489`、`TransferQueue.tsx:160,169`、`BrokerStatusBar.tsx:103`、`Sidebar.tsx:106`、`BridgePanel.tsx:544,840,848` |
| 无 `aria-live`：连接状态、传输进度、发布成功均为纯视觉更新 | `Sidebar.tsx:209-211`、`TransferQueue.tsx:211`、`MessagePublisher.tsx:296-301` |
| 无焦点可见样式：`index.css` 全文无 `:focus-visible`；多处显式 `focus:outline-none` | `index.css:109-111`；`Sidebar.tsx:229,245`、`SettingsModal.tsx:52`、`TopicTrafficPanel.tsx:260` |
| `tabIndex` 零处；`onKeyDown` 仅 2 处 | `HistoryPanel.tsx:132`（Enter 查询）、`MessagePublisher.tsx:576`（Cmd+Enter） |
| 非按钮的可点击元素，键盘无法触达 | `BatchSender.tsx:133`、`HistoryPanel.tsx:203-205`、`MessageStream.tsx:211` |
| `<select>` 无关联 label | `Sidebar.tsx:226,242`、`TopicTrafficPanel.tsx:165,260`、`HistoryPanel.tsx:153`、`MessagePublisher.tsx:344` |
| 桥接规则表单不是 `<form>`，Enter 不提交、无原生校验 | `BridgePanel.tsx:774` 裸 `<button onClick={submitDraft}>` |
| 桥接页所有输入框只有 placeholder、无可访问名称 | `BridgePanel.tsx:549,567,599-609,613,686,728,734,753` |
| **全局禁用文本选择**，topic/文件名/SHA/错误信息均不可复制 | `index.css:57` `user-select: none` + `App.tsx:167`；仅 `.select-text` 局部恢复（`MessageStream.tsx:216`、`HistoryPanel.tsx:224`）。`TransferQueue.tsx:205` 的错误消息用 `break-all` 展示却不能复制 |
| 动效无降级：`animate-pulse/spin/bounce` + confetti 遍布，无 `prefers-reduced-motion` | `useTransfers.ts:38`、`useBatchSender.ts:103` |
| `index.html:2` `lang="zh-CN"` 永不更新 → 屏幕阅读器用错语音引擎 | `App.tsx:40-46` 只换字典 |
| 对比度风险：`--text-muted` `#64748b` 用于 10px 文本（*推断，未实测*） | `themes/index.ts:70`；`Sidebar.tsx:54`、`MessageStream.tsx:156` |

### 4.5 国际化完整度

**字典完整性做对了（确认）**：`Record<Language, Translations>`（`i18n/index.ts:329`）+ 322 键全必填 interface（`:3-327`）→ 任一语言缺键都是编译错误，CI 的 `tsc --noEmit`（`ci.yml:32`）强制守卫。四语言块（`zh-CN` 330-654、`en` 655-979、`zh-TW` 980-1304、`ja` 1305-1629）逐键比对**零缺失、零多余、零重复**。`App.tsx:46` 还有字典级兜底。

**问题在旁路与打包：**

- **全量字典进主 chunk**：`App.tsx:22` 静态导入，`vite.config.ts:17-19` 只拆了 richtext → 4 种语言全部打进 `dist/assets/index-*.js`（401 KB），每个用户下载约 3 份用不到的字典。
- **插值手工且无校验**：17 处手写 `.replace('{x}', …)`，漏填会原样渲染 `{count}`。
- **硬编码英文约 24 处**：

| 位置 | 文案 |
|---|---|
| `BrokerStatusBar.tsx:46,111,119,135` | `MODE:`、`PING`、`...`、`ID:` |
| `Sidebar.tsx:118,125,137,157` | `Workspace Mode`、`Chunked Transfer`、`Pub/Sub Console`、`Broker ↔ Broker`（同处 `title` 用了 `t.modeFileTransfer`，**同一组件内中英混排**） |
| `MessagePublisher.tsx:523,534,624` | `Template`、`Prettify`、`Publishing...` |
| `MessageStream.tsx:162,223` | `Payload truncated in feed`、`⋯ click to expand` |
| `RichText.tsx:60` | 代码块 `Copy` 按钮（高频可见） |
| `SettingsModal.tsx:232,390` | `IP / Domain`、`v0.7.0`（**版本号也错了**） |
| `BatchSender.tsx:23-27` | 5 个 chunk 选项标签 |
| `HistoryPanel.tsx:225` | `(binary)` |
| `utils/payload.ts:44,55` | 载荷错误串（经 `MessagePublisher.tsx:168` 直接显示给用户） |
| `JsonTree.tsx:98` | `items` / `keys` |
| `BridgePanel.tsx:721`、`:81-92` | placeholder、`SAMPLE_SCRIPT` 注释 |
| `index.html:7` | `<title>` 窗口标题 |

（`QoS 0/1/2`、`JSON`、`CSV`、`RETAIN`、主题名属语言中立，不算缺陷。）

**版本号三处不一致**：`SettingsModal.tsx:390` 显示 `v0.7.0`（错）、`Sidebar.tsx:100` 显示 `v0.7.1-core`（多余后缀）。配置文件之间数值是对齐的（`package.json:4`、`tauri.conf.json:4`、`Cargo.toml:3`、`Cargo.lock:919` 全为 `0.7.1`），漂移只在 UI 硬编码字符串。

---

## 5. 可扩展性层面

### 5.1 便于迭代的部分（确认）

- **主题扩展成本极低**：`themes/index.ts:107-206` 是纯数据表，新增主题 = 加一个 `ThemeDefinition` + `Theme` 联合类型加字面量（`:1`）+ 两处下拉选项（`Sidebar.tsx:248-251`、`SettingsModal.tsx:160-163`）。
- **hook 按领域切分是干净接缝**：8 个 hook 各自封装一类后端交互并返回自洽 API（`useBroker.ts:169-188` 返回 17 个成员、`useBridge.ts:199-220` 返回 20 个），组件只消费不感知 IPC。
- **高吞吐架构方向正确**：后端批量 + 溢出计数（`mqtt_manager.rs:21-30`）而非前端节流，统计与展示解耦。
- **桥接规则数据驱动**：24 字段全量 serde 化（`bridge.rs:38-102`），有 camelCase 往返测试（`:900`）。
- **纯函数已良好隔离**：`sanitize_file_name`/`get_unique_path`/`expected_chunk_len`/`wildcard_match`（`mqtt_manager.rs:1674-1751`）、`map_topic`/`build_payload`/`gate_allow`（`bridge.rs`）——35 个测试全部落在这一层，说明可测性边界真实存在。

### 5.2 阻碍迭代的部分

| # | 问题 | 证据 |
|---|---|---|
| E-1 | **新增工作模式需改 5 个文件**（无注册表）。`App.tsx:38` 的字符串白名单尤其危险——新模式忘了加会静默回退到 transfer | `Sidebar.tsx:7,120-171`、`App.tsx:37-38,224-345`、`BrokerStatusBar.tsx:21-22,48`、i18n ×4 |
| E-2 | **无类型化 IPC 层**（见 3.5①②③）——扩展性最大单点阻力 | 40 处 `invoke` 字面量 |
| E-3 | **后端无组合根，新能力只能往 god object 上堆**。`HistoryStore` 的接入方式暴露了这点 | `mqtt_manager.rs:403-407` `attach_history` 用 `try_write`，争用时**静默丢弃**；字段是 `RwLock<Option<Arc<..>>>`（`:180`），读取处全要 `unwrap_or_default()`（`:415-421`）→ "history 不可用"与"history 为空"在 UI 上无法区分 |
| E-4 | **SQLite 无迁移机制**：无 `PRAGMA user_version`、无版本表。将来加列时 `IF NOT EXISTS` 会静默跳过 → 运行时 SQL 错误。另 `query` 按 `direction` 过滤（`:148-152`）但该列无索引 | `history.rs:69-85` |
| E-5 | **留存策略只有行数上限且惰性**：两次裁剪之间无界增长，无字节上限，无 `VACUUM`，`payload` 与 `payload_b64` **双份存储** → 磁盘占用约消息体积 2.3 倍 | `history.rs:17-19,128-140,103-117` |
| E-6 | **阻塞式 SQLite 跑在 async 运行时上**：无 `spawn_blocking`，每 50 批跑一次 `DELETE … NOT IN (SELECT …)`。同类问题：JS 执行（`transform.rs:48-117`）在 `bridge.rs:631` 的 async 任务内同步调用，跑满 100ms 会占住一个 tokio worker | `mqtt_manager.rs:485-487` + `history.rs:54,93,136` |
| E-7 | **全局 deadline 竞态限制并发扩展**：进程级静态量，每次调用覆写 → 两个桥接连接 + 一次试运行并发时互相篡改超时预算 | `transform.rs:28` `static DEADLINE_MS: AtomicU64`、`:62` |
| E-8 | **凭证明文存 localStorage，堵死后续能力**：未加密、未走钥匙串 → "配置导出/分享/云同步"一旦做就是凭证泄露 | `useBroker.ts:30-31`、`useBridge.ts:43`；`protocol.rs:15` `pub password: Option<String>`；`:7-15` 派生 `Debug, Serialize` |
| E-9 | **前端零测试 + CI 无 lint → 重构无安全网** | `package.json:6-11,28-39`；`ci.yml:31-35` |

### 5.3 新功能接入点（已验证的最低成本路径）

| 想加什么 | 接缝 | 成本 |
|---|---|---|
| **新载荷格式**（Protobuf/MessagePack/FlatBuffers） | `utils/payload.ts:8` `PayloadFormat` 联合 + `:10-18` `PAYLOAD_FORMATS` 表 + `:23-57` `payloadToBytes` switch + `MessageStream.tsx:36-48` `VIEW_MODES` + `:51-90` `resolveView` 嗅探分支 | **最低**，已表驱动 |
| **新桥接 topic 模式** | `bridge.rs:38-102` 加字段 → `:200-250 map_topic` 加分支 → `types.ts:166,176-212` → `BridgePanel` 表单，照 `bridge.rs:734-900` 的 15 个样例补测试 | 低 |
| **新主题** | `themes/index.ts:107-206` 加条目 | **最低** |
| **新工作模式** | 先做 E-1 的注册表改造，否则要改 5 个文件 | 中 |
| **新后端命令** | 先做 E-2 的 `src/ipc/` 收敛，否则手改 4 处 | 中 |
| **告警/通知** | 复用 `mqtt_manager.rs:454-493` 的批量 emit 模式，新建独立 manager，在 `lib.rs:16-19` `AppState` 加字段（当前唯一组合根） | 中高 |

---

## 6. 安全专项

### P0 — 远程可触发的任意文件写入（路径穿越）

> 已亲自逐行验证，非推断。项目记忆中亦记录此为已知待修 Bug。

`sanitize_file_name` 只在**一处**被调用，而落盘用的是**未净化的原始对端文件名**：

```rust
// src-tauri/src/mqtt_manager.rs:834-836  ← 唯一一次净化，结果存入 entry.final_path
let safe_name = sanitize_file_name(&meta.file_name);
let temp_path = download_dir.join(format!(".dropqtt_{}.tmp", meta.transfer_id));
let final_path = get_unique_path(&download_dir, &safe_name);
```

但 `IncomingTransfer.meta` 保留原始 `TransferMeta`（`:42`），审批路径直接取原始名：

```rust
// :1194  →  :1209
let file_name = e.meta.file_name.clone();
let final_path = get_unique_path(&dir, &file_name);   // ← 未经净化
```

而 `get_unique_path` 只做 `join`，无规范化：

```rust
// :1728
let target = dir.join(file_name);
```

Rust `Path::join` 遇绝对路径会**整体替换** base，`..` 段也不做归一化。因此对端把 `file_name` 设为 `/Users/x/.zshrc` 或 `../../.ssh/authorized_keys`，即可写到下载目录之外。`:1131` `if final_path.exists() { fresh } else { final_path.to_path_buf() }` 不会二次净化。

**三条触发路径：**

1. **审批路径（无条件）**：`:1194` → `:1209` → `:1131` 走 `else` 分支（fresh unique path 必不存在）→ 使用原始名派生路径。
2. **自动接收路径（条件触发）**：`:1085` 传入已净化的 `entry.final_path`（`:966`），正常安全；但 `:1130-1131` 存在回退——**当净化后的目标文件已存在时**（例如同名文件连发两次）改用原始名 → 同样穿越。
3. **临时文件路径**：`:835` 拼接了未经字符集校验的对端 `transfer_id`（`:811-822` 的 meta 校验不含 `transfer_id`）。

**可利用性**：默认 `auto_receive = true`（`:184`）；默认订阅公共 broker 的公开频道（`types.ts:283-290` `broker.emqx.io`、`App.tsx:54` `dropqtt/public-lobby/#`）；SHA-256 由攻击者自算必然通过；`README.md:29` 把频道码当作隔离手段（"agreeing on a channel code"）——即依赖隐蔽性而非认证。**任何知道/猜到频道 topic 的互联网用户都能触发。**

### 其它安全问题

| 级别 | 问题 | 证据 |
|---|---|---|
| **P0** | **release 构建启用 devtools**，无 feature 门控、无 profile 区分 → 生产包里 WebView 开发者工具可用 | `src-tauri/Cargo.toml:18` `features = ["devtools"]` |
| **P0** | **CSP 完全关闭** | `tauri.conf.json:25-27` `"csp": null` |
| P1 | **webview 可读任意本地文件并经 MQTT 外发**：`start_send_file(file_path)` 无白名单、无对话框强制；`set_download_dir(path)` 接受任意路径；`reveal_file` 用 OS shell 打开任意路径父目录且 `let _ =` 吞掉失败后仍返回 `Ok(())` | `lib.rs:63,28,321,325,327` |
| P1 | **凭证明文持久化** | `useBroker.ts:30-31`、`useBridge.ts:43`；`protocol.rs:15` |
| P2 | **TLS 静默降级**：CA 读取失败 → 回落系统根证书，仅 `eprintln!`；mTLS 材料不可读 → 直接不带客户端证书连接。用户以为在用 mTLS。（证书校验本身未被削弱，无 `danger_accept_invalid_certs`） | `transport.rs:43-46,33-37`；正向证据 `:22,41,45` |
| P2 | **对端可触发重传放大**：任何在 `/ctrl/<id>` 发布的对端都能触发重传（8 轮上限），按对端提供的 `missing` 逐项分配缓冲 | `mqtt_manager.rs:1333-1350,1339,1914` |
| P2 | **topic 注入未过滤**：自定义发布 topic 仅 trim + 去后缀，不拒绝 `#`/`+`/控制字符 | `mqtt_manager.rs:1394-1403` |
| P2 | `opener:default` 是多余的 webview 权限（前端零引用，仅 Rust 侧 `lib.rs:322` 用）；`capabilities/default.json:6-12` 五个权限全是裸默认值，无 `allow`/`deny` scope | `capabilities/default.json` |
| P2 | **发布无草稿审核**：打 tag 即立即对外发布 | `release.yml:97` `releaseDraft: false` |

**⚠ 三项串联构成完整攻击链**：`csp: null` + release devtools + `start_send_file` 任意路径 → 在生产包里打开控制台，直接调用 IPC 读取任意本地文件并经已配置的 broker 外发。单独看每项是中危，串起来是高危。

### 正向确认（做得好的部分）

| 项 | 证据 |
|---|---|
| **JS 沙箱可信**：每条消息新建 `Runtime`、4MB 内存上限、100ms wall-clock 中断、16KB 脚本上限、**只注入 4 个原始值**（`__topic/__payload/__qos/__retain`），未注册 `Resolver`/`Loader`，无 fs/network/module 能力 | `transform.rs:59,60,62-65,55,72-75` |
| **SQL 全参数化**：插入/查询/序列/裁剪均无字符串拼接。唯一小瑕：LIKE 元字符未转义 | `history.rs:103-117,159-164,204-206,137`；`:146` |
| **富文本防 XSS 到位**：DOMPurify `USE_PROFILES` + 强制链接 `target=_blank` + `rel=noopener noreferrer nofollow`；HTML 预览用 `sandbox=""`（零权限、opaque origin）；代码块用事件委托而非内联 `onclick` | `RichText.tsx:71-74,80-86,132-135,52-67` |
| **更新签名密钥管理正确**：私钥来自 CI secrets，本地密码文件已 gitignore 且确认未被追踪 | `release.yml:91-92`；`.gitignore:33` |
| **Rust 侧零 `.unwrap()`/`.expect()`**（`mqtt_manager.rs` + `transport.rs`，唯一例外是 `lib.rs:408` 启动失败） | grep 确认 |

---

## 7. 生态功能扩展

> 本章为新增分析。所有"现状缺口"均已核验代码；所有"建议"明确标注为建议。

### 7.1 当前生态位

项目自我定位（`README.md:13`）是"在 HTTP/P2P/SCP/云存储被封、但 MQTT 1883/8883 可达的隔离网络中做可验证文件传输"。这个定位**独特且有价值**——MQTTX 类工具不做文件传输，文件传输工具不依赖 MQTT broker。

但同时 `README.md:24` 明确对标 MQTTX（"MQTTX-style Pub/Sub Console"），项目记忆亦记录"对标 MQTTX 补齐缺失功能"为既定标准。因此生态扩展有两条并行的线：

- **纵深线**：巩固"MQTT 文件传输"这一独占生态位（竞品几乎为零）。
- **对标线**：补齐 MQTTX 的通用客户端能力，让控制台本身可作为日常工具使用。

### 7.2 协议生态缺口（已核验）

#### ① WebSocket 传输：README 宣称支持，代码中不存在

```rust
// src-tauri/src/transport.rs:16-19  ← 唯一的传输构建函数
fn build_transport(config: &BrokerConfig) -> Option<RumqttcTransport> {
    if !config.use_tls { return None; }        // None = 纯 TCP
```

全文件只有 `tls_with_default_config()`（`:22,45`）与 `tls(ca, client_auth, None)`（`:41`）两个分支，**零 `ws://`/`wss://`/websocket 引用**。而：

```
README.md:13  "…but standard MQTT broker connectivity (port 1883, 8883 TLS, or WebSocket) is permitted"
```

**这是文档与代码的直接矛盾**，且 WebSocket 恰恰是该产品定位（"只有 MQTT 端口可达的隔离网络"）最需要的传输方式——企业出网代理通常只放行 80/443，`wss://` 是唯一能穿过的形态。

> **建议（高价值）**：`rumqttc` 支持 `Transport::Ws`/`Wss`（需 `websocket` feature）。在 `BrokerConfig` 加 `transport: 'tcp' | 'ws'` 字段，`build_transport` 增分支，`SettingsModal` 加协议选择器（可复用 `:248-251` 的下拉模式）。同时修正 README 或标注为 roadmap。

#### ② MQTT 5 特性覆盖率：约 3/10

发布属性只实现了 3 个，其余全部 `..Default::default()` 丢弃：

```rust
// src-tauri/src/transport.rs:202-207
let v5_props = props.map(|p| rumqttc::v5::mqttbytes::v5::PublishProperties {
    content_type: p.content_type.clone(),
    user_properties: p.user_properties.clone(),
    message_expiry_interval: p.message_expiry,
    ..Default::default()          // ← response_topic / correlation_data / topic_alias 全丢
});
```

契约层同样只有 3 个字段（`protocol.rs:138-145`），因此这不只是 UI 缺失，而是**协议层就没建模**。

| MQTT 5 特性 | 现状 | 生态价值 |
|---|---|---|
| Content-Type / User Properties / Message Expiry | ✅ 已实现（收发双向） | — |
| **Shared Subscription `$share/{group}/{filter}`** | ❌ 全仓零 `$share` 引用。用户手打该字符串能"意外生效"（rumqttc 会照发），但无 UI 支持、无负载均衡语义、`TopicTrafficPanel` 会把它当普通 topic 统计 | **高**——消费组是多实例调试的刚需 |
| **Subscription Identifier** | ❌ `subscribe()` 走无属性版本（`transport.rs:228-240`），无法设置 | 中——多订阅合并场景 |
| **Reason Code 上报** | ❌ 全仓零 `reason_code` 引用。订阅被 broker 拒绝（0x8F 未授权等）时前端只看到 `.catch(() => {})`（`useBroker.ts:107`）静默失败 | **高**——当前"订阅了但收不到消息"完全无法诊断 |
| **Topic Alias** | ❌ | 中——高频小消息省带宽，与本项目压测/遥测场景契合 |
| **Request/Response（Response Topic + Correlation Data）** | ❌ | **高**——RPC 调试是 MQTTX 用户高频需求 |
| **No Local / Retain As Published** | ❌（需 SubscribeProperties） | 中——`MessageStream` 的 IN/OUT 过滤（`:352-371`）目前靠后端 echo 实现，No Local 会更干净 |
| **Will Delay Interval** | ❌（`BrokerConfig` 有 will 四字段 `types.ts:16-19`，但无 delay） | 低中 |
| **Flow Control（Receive Maximum）** | ❌ 未暴露，用 rumqttc 默认 | 低 |
| **Server Keep Alive / Assigned Client ID 回显** | ❌ CONNACK 属性未上报前端 | 低中 |

#### ③ 行业协议生态：完全空白

- **Sparkplug B**（工业 IoT 事实标准，`spBv1.0/#` + Protobuf NBIRTH/DBIRTH/DDATA）：零支持。项目已有自实现 CBOR 编解码器（`utils/cbor.ts`，411 行 RFC 8949），**扩展到 Protobuf 的技术路径是现成的**，而 Sparkplug 是 MQTT 工具在工业场景最有价值的差异化。
- **MQTT-SN**（UDP、无线传感网）：零支持，`rumqttc` 亦不覆盖，成本高、优先级低。

### 7.3 云平台生态接入（建议）

当前认证只有"用户名 + 密码 + mTLS"三件套（`types.ts:1-24`）。主流云 IoT 平台的认证方式都无法直接配置：

| 平台 | 缺失能力 | 接入成本 |
|---|---|---|
| **AWS IoT Core** | SigV4 签名（用户名 = 派生 token，密码 = HMAC 签名，需定时刷新） | 中——纯前端/Rust 计算，无需新传输层 |
| **Azure IoT Hub** | SAS Token 生成（`SharedAccessSignature sr=…&sig=…&se=…`）、Device ID 作为 clientId 的约束 | 低中 |
| **阿里云 / 腾讯云 IoT** | 各自的一次性密码/签名算法 | 低中 |
| **EMQX / HiveMQ Cloud** | 基础认证已可用，但缺 **增强认证（MQTT 5 AUTH 报文 / SCRAM）** | 高（需 rumqttc 支持） |

> **建议**：在 `BrokerConfig` 增 `authMode: 'none' | 'password' | 'aws-sigv4' | 'azure-sas' | 'aliyun'`，把签名计算放在 Rust 侧（`transport.rs:139-152` 已有凭据装配点），前端只收集 AK/SK。**这也是把明文凭证问题（E-8）一并解决的契机**——云平台的 AK/SK 比 broker 密码更敏感，必须走系统钥匙串。

### 7.4 数据出口生态（建议 — 现有架构的最佳延伸点）

项目已有完整的"入站消息 → 规则处理"链路（`bridge.rs:572-694`），但**动作只有"转发到另一个 broker"一种**（`bridge.rs:668-670`）。这是生态扩展性价比最高的方向：把 `BridgeRule` 的 target 从"另一个 MQTT 连接"泛化为"任意 sink"。

| Sink | 价值 | 复用现有代码 |
|---|---|---|
| **HTTP / Webhook** | 极高——调试时把消息推给自己的服务 | `bridge.rs:600-670` 的 route 主干 + `transform.rs` 的 JS 变换可原样复用，只换最后的发送 |
| **文件（JSONL / CSV 追加）** | 高——长时间抓包归档 | `utils/exportMessages.ts:37-55` 已有 CSV 序列化；`history.rs` 已有落盘经验 |
| **SQLite / PostgreSQL** | 中高——已有 `history.rs` 的 rusqlite 基础 | 直接扩展 `history.rs:69-85` 的 schema |
| **Kafka / Redis** | 中——需要新依赖，体积敏感（`README.md:19` 强调 <15MB） | 建议做成可选 feature |
| **Prometheus /pushgateway** | 中高——`TopicTrafficPanel` 已在算 msgs/sec、bytes/sec、peak（`mqtt_manager.rs:509-594`），**这些指标直接就是 Prometheus 格式** | 纯文本协议，零依赖 |
| **Grafana / InfluxDB line protocol** | 中 | 同上，纯文本 |
| **OpenTelemetry** | 中——分布式追踪场景 | 依赖较重 |

> **建议实现顺序**：Webhook → JSONL 文件 → Prometheus。三者都不需要重量级依赖，且能把"桥接"从 broker-to-broker 升级为通用的**规则引擎 + 数据管道**，这是相对 MQTTX 的真正差异化（MQTTX 的脚本功能也只做转换，不做多 sink 分发）。

### 7.5 自动化与脚本生态（建议）

| 能力 | 现状 | 建议 |
|---|---|---|
| **CLI / headless 模式** | ❌ 单窗口 GUI 应用（`tauri.conf.json:13-24`），无 `main.rs` 参数解析（`main.rs` 仅 5 行） | 已有 37 个 Tauri 命令构成完整能力面（`lib.rs:368-406`），抽一个 `clap` CLI 复用 `AppState` 即可支持 `dropqtt send ./file --topic x --broker y`，让文件传输能进 CI/脚本 |
| **场景录制/回放** | 部分——有单条消息重放（`MessageStream.tsx:168-176`）与循环发布（`MessagePublisher.tsx:188-218`），但无法录制一段真实流量并重放 | 已有 SQLite 历史（`history.rs`）+ CSV/JSON 导出（`exportMessages.ts`），补一个"从历史/导出文件按时序回放"即可 |
| **插件系统** | ❌ 无 | **`transform.rs` 的 rquickjs 集成是现成的插件运行时**：已有内存上限、超时中断、脚本大小限制（`:22-24`），且已验证无宿主绑定（`:72-75`）。把它从"桥接规则的一个字段"提升为"通用扩展点"（消息过滤器 / 载荷解码器 / sink），是最低风险的插件化路径 |
| **脚本化 payload 解码器** | 部分——8 种内置格式（`utils/payload.ts:10-18`）+ auto 嗅探（`MessageStream.tsx:55-65`），但私有二进制协议无法自定义 | 允许用户注册 JS 解码器：`(bytes) => string`，接入点就是 `resolveView`（`MessageStream.tsx:51-90`）的 switch |
| **多连接/多会话管理** | 部分——主连接 1 个 + 桥接 2 个（`useBridge.ts:138`），但主连接与桥接连接互不相通，桥接面板要手动重填 broker 信息（`BridgePanel.tsx:112-115`） | 统一为"连接池"：`broker.profiles`（`useBroker.ts:31`）与 `bridge.remember`（`useBridge.ts:43`）合并为单一连接注册表，桥接规则从池中选源/目标 |

### 7.6 协作生态（建议 — 独占生态位的自然延伸）

`README.md:29` 的"Room / Channel Isolation"目前是纯手工约定 topic 字符串。这是**该产品最独特的场景**（跨隔离网传文件），值得做成一等公民：

- **短码/二维码配对**：把 `{broker, port, tls, channel, sha256-pin}` 编码成 6-8 位短码或 QR，接收方一扫即加入房间。技术上 `utils/template.ts` 已有 uuid 生成，`utils/cbor.ts` 可做紧凑编码。
- **房间成员发现**：用 MQTT retained 消息 + LWT（`BrokerConfig` 已有 will 四字段 `types.ts:16-19`）实现 presence——成员上线发 retained、离线由 broker 代发 LWT，天然适配。
- **传输链接分享**：`transferId` + `sha256` 已存在（`types.ts:50-64`），可生成"取件链接"让接收方校验来源。
- **⚠ 前置条件**：以上全部依赖 P0-1 的路径穿越修复与频道认证。当前"知道 topic 就能写你磁盘"的状态下，任何提升可发现性的功能都会**放大**攻击面。

### 7.7 开发者生态（建议）

| 能力 | 价值 |
|---|---|
| **协议一致性测试套件** | 项目已有内置压测台（`mqtt_manager.rs:599-669`，≤20k msg/s）与精确的秒级统计（`:509-594`）。把它扩展为"对任意 broker 跑 MQTT 合规性检查"（QoS 2 流程、retain 语义、wildcard 边界、`$SYS` 可用性）是独特能力——目前市面上的 MQTT 一致性工具都是 CLI |
| **内置 mock broker** | 让用户无需外部 broker 即可演示/测试。当前默认连公共 broker（`types.ts:283-290`），存在隐私与可用性风险 |
| **协议文档化** | `README.md:37-49` 已有 topic 拓扑说明，但 `protocol.rs` 的 meta/ctrl JSON schema 未文档化，第三方无法实现兼容客户端 |

### 7.8 生态扩展的架构前提

上述任何一项都会撞上 5.2 节的同一批阻碍。**建议的先后关系**：

```
P0 安全修复
   ↓
E-2 类型化 IPC 层（src/ipc/）+ protocol.rs 真枚举
   ↓                    ↓
E-3 后端组合根拆分      7.4 多 sink（BridgeRule.target 泛化）
   ↓                    ↓
7.5 插件系统（提升 transform.rs 为通用扩展点）
   ↓
7.2 MQTT5 补全 / 7.3 云平台认证 / 7.6 协作生态
```

理由：多 sink、插件、云认证都需要新增后端命令与协议字段；若先做 E-2，每项新功能的接入成本从"手改 4 处"降为"改 1 处 + 生成类型"。反之，在手工 IPC 契约上叠加 10 个新 sink 会让 `lib.rs`（已 409 行 / 37 命令）彻底失控。

### 7.9 生态功能优先级矩阵

| 功能 | 用户价值 | 实现成本 | 依赖 | 建议优先级 |
|---|---|---|---|---|
| **WebSocket / WSS 传输** | 极高（产品定位刚需，且 README 已宣称） | 低（rumqttc 原生支持） | 无 | **生态 P0** |
| **Reason Code 上报 + 订阅失败可见** | 极高（当前静默失败无法诊断） | 低 | E-2 | **生态 P0** |
| **Webhook / HTTP sink** | 高 | 中 | E-2、E-3 | 生态 P1 |
| **Shared Subscription `$share`** | 高 | 低中 | E-2 | 生态 P1 |
| **Request/Response 调试** | 高 | 中 | 7.2 属性补全 | 生态 P1 |
| **CLI / headless** | 高（进 CI） | 中 | E-3 | 生态 P1 |
| **Prometheus 指标导出** | 中高 | 低（已有数据） | 无 | 生态 P1 |
| **云平台认证（AWS/Azure）** | 中高 | 中 | E-8 凭证安全 | 生态 P2 |
| **JSONL/CSV 自动归档 sink** | 中高 | 低 | 已有导出代码 | 生态 P2 |
| **JS 插件系统** | 中（长期高） | 高 | E-3、transform.rs 去全局态（E-7） | 生态 P2 |
| **Sparkplug B** | 中（工业场景高） | 高 | 载荷格式扩展链 | 生态 P2 |
| **短码/QR 房间配对** | 中（独占场景） | 中 | **必须先修 P0-1** | 生态 P2 |
| **内置 mock broker** | 中 | 中高 | 无 | 生态 P3 |
| **MQTT-SN** | 低 | 高 | rumqttc 不支持 | 不建议 |

---

## 8. 健康记分卡

| 维度 | 评分 | 主要依据 |
|---|---|---|
| 界面 | **6.5/10** | 令牌体系与主题架构优秀；扣分于默认窗口断点失效、令牌双源、白色残留、无共享原语 |
| 功能 | **7.5/10** | 覆盖面广且深（NACK 重传、溢出计数、CBOR、`$SYS`、JS 变换）；扣分于 3 个确认的功能缺陷与若干静默失效 |
| 代码结构 | **5.5/10** | 前端分层清晰、注释质量高；扣分于 god object、632 行单组件、IPC 契约手工维护、5 份 `formatBytes`、大量死代码 |
| 用户体验 | **5/10** | 主干路径顺、空/加载态覆盖好（桥接模式除外）；扣分于无障碍近乎为零、无统一 toast、错误大量只进 console、i18n 旁路 |
| 可扩展性 | **5.5/10** | 主题/载荷格式/桥接模式三条链已表驱动；扣分于无类型化 IPC、无 DB 迁移、前端零测试、凭证明文堵死同步类功能 |
| 安全 | **3/10** | 富文本与 JS 沙箱做得很好，但存在一个远程可利用的任意文件写入 + CSP 关闭 + release devtools + 凭证明文，且四项可串联 |
| 生态完整度 | **4.5/10** | 独占的"MQTT 文件传输"生态位有价值；但 WebSocket 缺失（README 却宣称支持）、MQTT5 覆盖 3/10、无云平台认证、sink 只有 broker→broker |

**综合：5.4/10** — 功能完成度与工程品味明显高于同规模项目，但有一个必须先修的 P0 安全漏洞，以及"无前端测试 + 无 lint"导致的重构风险。

---

## 9. 改进清单（P0/P1/P2）

### P0 — 立即（安全，阻塞发布）

| # | 项 | 位置 | 建议 |
|---|---|---|---|
| **P0-1** | **修复路径穿越**：所有落盘路径必须经 `sanitize_file_name` | `mqtt_manager.rs:968,1130,1194,1209`；`:835` 的 `transfer_id` | 在 `deliver_incoming`/`approve_transfer` 入口统一净化；`get_unique_path`（`:1727-1751`）内加断言：规范化后必须仍以 `dir` 为前缀，否则返回 Err；`transfer_id` 加字符集校验（仅 `[A-Za-z0-9_-]`）。补 3 个纯函数测试（绝对路径、`..`、Windows `..\`）——`sanitize_file_name`/`get_unique_path` 当前**零测试覆盖** |
| **P0-2** | 收敛 webview 的文件系统能力 | `lib.rs:28,63,321`；`capabilities/default.json:9-10` | `set_download_dir`/`start_send_file`/`reveal_file` 加路径校验（限定在用户已授权目录内）；`fs:default` 收窄为显式 scope；删掉多余的 `opener:default` |
| **P0-3** | 开启 CSP | `tauri.conf.json:26` | 从 `"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'"` 起步（`unsafe-inline` 因 337 处内联 style 暂必需） |
| **P0-4** | **release 构建去掉 devtools** | `Cargo.toml:18` | 改为 `[features]` 门控或仅 dev profile 启用。与 P0-3 合并处理——二者共同构成"生产包里开控制台调 IPC"的完整链路 |

### P1 — 本迭代（正确性 + 高风险体验）

| # | 项 | 位置 | 建议 |
|---|---|---|---|
| P1-1 | 历史面板时间窗/方向/条数控件失效（F-2） | `HistoryPanel.tsx:84-89,138-155,167-180` | effect 依赖改为 `[load]` 并对 `search` 防抖，或在各控件 `onChange` 中显式触发 `load()` |
| P1-2 | 批量发送文件大小恒为 0（F-1） | `BatchSender.tsx:68,76,212` | 新增后端 `stat_file` 命令（或用 `plugin-fs` 的 `stat`）回填 `size`；在此之前先隐藏"总容量"文案 |
| P1-3 | 传输控制操作无错误处理 | `useTransfers.ts:56-78` | 六个函数统一加 try/catch 并上抛到 UI |
| P1-4 | 5 分钟后 pause/resume/cancel 静默失效（F-4） | `mqtt_manager.rs:1497-1501` | 清理前判断传输是否仍活跃；或改为按最后活动时间滑动过期 |
| P1-5 | 无障碍最小可用集 | 全仓（见 4.4 表） | ①所有图标按钮加 `aria-label`；②连接状态/传输进度加 `aria-live="polite"`；③`index.css` 加全局 `:focus-visible` 环；④`SettingsModal.tsx:137` 加 `role="dialog"` `aria-modal` + Escape + 焦点陷阱；⑤`BrokerStatusBar.tsx:56-68` 改为点击切换的 `aria-haspopup="menu"`；⑥`BatchSender.tsx:133`、`HistoryPanel.tsx:203`、`MessageStream.tsx:211` 改为 `<button>` 或加 `role`+`tabIndex`+键盘处理；⑦`BridgePanel.tsx:774` 包进 `<form>` |
| P1-6 | 统一反馈层 | 6 处各自实现（见 4.2） | 抽 `useToast()` + `<ToastHost/>`，替换 `copiedId`/`successToast`/`exportNote`/`updateStatusText`/`testResult`；同时替掉 `App.tsx:151`、`HistoryPanel.tsx:99` 的原生 `confirm()` |
| P1-7 | 版本号单一来源 | `SettingsModal.tsx:390`、`Sidebar.tsx:100` | 构建期注入（`vite.config.ts` `define` 读 `package.json`，或 `@tauri-apps/api/app` 的 `getVersion()`）。配置文件本身已对齐，无需改动 |
| P1-8 | 引入 ESLint | `package.json:6-11,28-39`；6 处空转 disable | 装 `eslint` + `eslint-plugin-react-hooks`，CI（`ci.yml:31-35` 之后）加 `pnpm lint`；逐个复核 6 处 `exhaustive-deps` 抑制——其中 `HistoryPanel.tsx:88`、`useBridge.ts:142`、`useTopicStats.ts:41` 已确认对应真实缺陷 |
| P1-9 | 磁盘/IO 错误如实上报（F-5） | `mqtt_manager.rs:951-954,1036-1037`；`history.rs:100,102,120` | 写块失败应立刻置 `failed` 并带真实原因，而非让看门狗报"超时"；`flush`/`sync_all` 与 SQLite 事务的 `let _ =` 必须检查 |
| P1-10 | 断线时的 finalize 竞态（F-6） | `mqtt_manager.rs:354` vs `:1008-1014,1041` | `disconnect` 前等待或标记进行中的 finalize；追踪 `JoinHandle` 而非裸 spawn |
| P1-11 | 删除规则无确认无撤销 | `BridgePanel.tsx:848-855` | 加确认（用 P1-6 的对话框，非 `confirm()`）或改为软删除 + Undo |
| P1-12 | 桥接页零 loading 态、试运行可连点 | `BridgePanel.tsx:200,248,286-305,693-701` | `runScriptTest` 加 `testing` 标志并禁用按钮；连接/断开加 spinner |
| P1-13 | 事件日志上限魔数三处重复 | `BridgePanel.tsx:869-873,882` vs `useBridge.ts:14` | 常量单一来源，文案插值改为传入实际值 |
| P1-14 | `btoa(String.fromCharCode(...))` 大载荷抛 `RangeError` | `BridgePanel.tsx:95-96` | 复用 `utils/cbor.ts` 的 `uint8ToBase64` |
| P1-15 | 发布流程无草稿审核 + 文档不完整 | `release.yml:97`；`README.md:13,84,86` | `releaseDraft: true`；README 补 `Cargo.toml`、更新 tag 示例、加 ci.yml 徽章、**修正 WebSocket 表述**（见 7.2①） |
| **P1-16** | **WebSocket 传输 + Reason Code 上报**（生态 P0） | `transport.rs:16-48,228-240`；`useBroker.ts:107` | 见 7.2①②。这是唯一建议进 P1 的生态项——因为它同时修复"README 宣称但不存在"和"订阅静默失败无法诊断"两个问题 |

### P2 — 后续（结构 + 打磨 + 生态）

| # | 项 | 位置 | 建议 |
|---|---|---|---|
| P2-1 | 拆分 `MqttManager` | `mqtt_manager.rs:136-161`（21 字段 / 42 方法） | 按职责切出 `FeedBroadcaster`（`:454-493`）、`TopicStats`（`:509-594`）、`SysMonitor`（`:384-400`）、`TransferReceiver`/`TransferSender`；`AppState`（`lib.rs:16-19`）作为组合根注入；`HistoryStore` 改为构造期必填，去掉 `attach_history` 的 `try_write` 静默失败（`:403-407`） |
| P2-2 | 类型化 IPC 层 | 40 处 `invoke('字面量')` / 8 文件 | 新建 `src/ipc/`，按域导出具名函数；`protocol.rs` 的 `msg_type`/`status`/`direction` 改真 enum（`:100,119-120,177`）；错误改 `thiserror`（`Cargo.toml:33` 已声明未使用）带 code |
| P2-3 | 拆分 `BridgePanel` | `:266-897` | 按已确认的 10 项职责切：`ConnPair`（合并 `:438-459`/`:460-481`）、`RuleForm`（`submitDraft` `:364-402` 拆为 validate/parse/mint）、`TransformEditor`（`:663-715`）、`RuleList`（`:782-860`）、`EventLog`（`:863-894`）；`:272-284` 的 10 `useState`+1 `useRef` 收敛为 `useReducer`；删死别名 `:418` |
| P2-4 | i18n 补全 + 懒加载 | 4.5 所列约 24 处硬编码；`i18n/index.ts` 1630 行；`App.tsx:22` | 硬编码全部入字典；按语言拆文件 + 动态 `import()`（主 chunk 401 KB 可显著下降）；17 处手写 `.replace()` 收敛为带占位符校验的 `t(key, params)` |
| P2-5 | 抽共享 UI 原语 | 337 处内联 style | `Button`/`Chip`/`PanelHeader`/`Field`/`SegmentedControl`（后者在 `MessageStream.tsx:351-372,393-412`、`HistoryPanel.tsx:137-152,166-181` 重复 4 次）+ `StatBadge`（`BridgePanel.tsx:823-838`）+ `IconButton`（`:840-855`）；统一 5 份 `formatBytes` 到 `src/utils/format.ts` |
| P2-6 | 消除令牌双源与硬编码色 | `index.css:7-51` vs `themes/index.ts:60-105`；`#d3dae6`×4 vs `#e2e8f0`；`BridgePanel.tsx:802,806`；`SubscriptionsBar.tsx:102` | `:root` 回退值由构建期从 `themes.cyberpunk` 生成，或用 `[data-theme]` 选择器切换；新增 `--code-text`/`--code-border`/`--code-key`/`--code-string` 令牌族 |
| P2-7 | 响应式校准 | `tauri.conf.json:17-20` vs 6 处 `lg:` | 二选一：默认 `width` 提到 ≥1280，或把这些断点降为 `md:`（768px）/自定义 `screens`；让 `index.html:2` 的 `lang` 与 `class` 随设置同步 |
| P2-8 | 消息流虚拟化 | `MessageStream.tsx:532`（`.map` 渲染至多 500 行）、`:129`（每行 base64 解码 + JSON parse） | 引入虚拟列表；`resolveView` 结果按 `msg.id + viewMode` 缓存，避免切视图时 500 行全量重算 |
| P2-9 | 统一持久化 + SQLite 迁移 | 3.5⑤；`history.rs:69-85` | 加 `PRAGMA user_version` 与迁移函数；localStorage 键加版本前缀；凭证改走系统钥匙串（`tauri-plugin-stronghold` 或平台 keychain）——**这是 7.3 云认证的前置条件** |
| P2-10 | 收敛轮询与后台任务 | 4 个定时器（F-7）；`mqtt_manager.rs:321-330,629-667,887-889,1008-1014,1348-1350,1497-1501` 六处未追踪 spawn | 前端合并为单一 tick 分发；后端保存 `JoinHandle` 并在 disconnect 时 abort（`:339-347` 当前先 abort poller 再 `disconnect()`，导致 DISCONNECT 包只入队未发出）。压测任务未存 handle（`:629-667`）→ 可并发跑两个 bench，与其文档注释（`:598`）矛盾 |
| P2-11 | 前端测试从零起步 | `package.json` 无任何测试工具 | 先覆盖纯函数：`utils/cbor.ts`（411 行手写 RFC 8949 编解码器，**零测试**）、`utils/payload.ts:23-57`、`utils/template.ts:23-42`、`utils/exportMessages.ts:12-13,20-55`（CSV 转义）、`BridgePanel.tsx:66-79` `parseTopicMap`/`formatTopicMap`；再加 hook 测试 |
| P2-12 | 补 `transport.rs` 与 `lib.rs` 测试 | 两文件共 717 行、**0 测试** | 优先 `transport.rs:98-129` QoS 映射、`:132-185` v3/v5 选项装配、`:265-308` 包归一化（纯逻辑易测）；`lib.rs` 至少给带参数校验的命令加测试（尤其 P0-2 修完后的路径校验） |
| P2-13 | 动效降级 + 文本选择 | confetti（`useTransfers.ts:38`、`useBatchSender.ts:103`）；`index.css:57` | 尊重 `prefers-reduced-motion`；彩带改为可关闭且仅在全部成功时触发（F-3）；让 topic/文件名/SHA/错误信息可选中新 |
| P2-14 | 清理死代码 | 3.3 末段表格 | 全部删除或接通（`bridge.rs:47-48` `source_qos`、`:477` `disconnect_all`） |
| P2-15 | 文档补齐 | `README.md:13,17-33,84,86` | 功能列表未包含历史归档与 `$SYS` 面板（均为本轮新增）；修正 WebSocket 表述；补 `protocol.rs` 的 meta/ctrl JSON schema 文档（第三方互操作的前提） |
| **P2-16** | **多 sink 桥接**（生态 P1） | `bridge.rs:668-670` | 见 7.4。顺序：Webhook → JSONL 文件 → Prometheus |
| **P2-17** | **MQTT 5 特性补全**（生态 P1） | `transport.rs:202-207,228-240`；`protocol.rs:138-145` | 见 7.2②。顺序：`$share` 共享订阅 → Request/Response → Topic Alias |
| **P2-18** | **CLI / headless 模式**（生态 P1） | `main.rs`（5 行）；`lib.rs:368-406` | 见 7.5。抽 `clap` CLI 复用 `AppState`，让文件传输能进 CI |
| **P2-19** | **云平台认证**（生态 P2） | `transport.rs:139-152`；`types.ts:1-24` | 见 7.3。**前置依赖 P2-9 凭证安全** |
| **P2-20** | **JS 插件系统**（生态 P2，长期） | `transform.rs:22-24,55-65,72-75` | 见 7.5。前置依赖 P2-1（组合根）与 E-7（去 `static DEADLINE_MS`） |

---

## 10. 路线图与下一步

### 第一步（本周，安全优先）

只做 **P0-1 / P0-2 / P0-3 / P0-4**。

P0-1 的修复面很小（净化点从 1 处扩到 3 处 + `get_unique_path` 加前缀断言 + `transfer_id` 校验），且 `sanitize_file_name`/`get_unique_path` 是自由函数，可立刻补 3-5 个纯 Rust 单元测试进 CI（`ci.yml:73-75` 已有 `cargo test`）。

**在修好之前不建议对外发布新版本**，因为默认配置就指向公共 broker 且默认自动接收。P0-4（devtools）改动只有一行，应与 P0-1 同批。

### 第二步（下个迭代，止血 + 建网）

- **P1-1 / P1-2**：用户一眼能看到的错误数据（历史控件失效、容量恒为 0），优先于任何新功能。
- **P1-8**（ESLint 进 CI）：后续所有重构的前置条件，且能立刻暴露 `useBridge.ts:142`、`useTopicStats.ts:41` 这类已存在的过期闭包。
- **P1-16**（WebSocket + Reason Code）：唯一一个建议提到 P1 的生态项——它同时修复"README 宣称但代码不存在"和"订阅静默失败无法诊断"两个问题，且 `rumqttc` 原生支持，成本低、价值高。
- P1-5 / P1-6 可并行，两者会顺带清理约 20 处重复代码。

### 第三步（结构性投资，需先有测试网）

**P2-11 / P2-12（补测试）→ P2-1 / P2-2（拆 `MqttManager` + 类型化 IPC）→ P2-3（拆 `BridgePanel`）**。

顺序不能颠倒：当前前端零测试、后端 35 个测试全在纯函数层，直接动 2022 行的 `mqtt_manager.rs` 或 632 行的 `BridgePanel` 主组件风险过高。

### 第四步（生态扩张）

P2-2 完成后，7.8 节的依赖链解锁：多 sink（P2-16）→ MQTT5 补全（P2-17）→ CLI（P2-18）→ 云认证（P2-19）→ 插件系统（P2-20）。

**关于新功能选型**：载荷格式链（`utils/payload.ts` + `MessageStream` 的 `VIEW_MODES`/`resolveView`）和桥接 topic 模式链（`bridge.rs:200-250`）已经是表驱动 + 有测试样例的，接入成本最低，适合作为下一个功能点。反过来，任何需要新增工作模式或新增后端命令的功能，最好**先**做 P2-2 与 E-1 的注册表改造，否则每次都要手改 5 个文件。

### 总体判断

`mqtt_manager.rs:21-30` 的批量 feed + 溢出计数、`transport.rs` 的 v3/v5 归一化双枚举、`RichText.tsx` 的 DOMPurify + `sandbox=""` 双层防护、`transform.rs` 的 per-message Runtime + 三重上限、`i18n` 的 1288 条零偏差字典 + 编译期守卫——这几处的设计取舍都是对的，注释也准确记录了"为什么"。

这个项目的核心问题不是设计能力，而是：

1. **验证能力**——无前端测试、无 lint、安全边界（路径处理、传输层、命令层）零测试覆盖。
2. **一致性**——同一件事被实现了 5-6 次（`formatBytes`、toast、面板头、segmented control、base64），且三处魔数各自漂移。
3. **纵深与广度的失衡**——文件传输这条纵深线做得很深（NACK、看门狗、审批、SHA-256），但它最需要的 WebSocket 传输反而缺失，且 README 已经宣称支持。

修好第 1 点，第 2、3 点的改造才有安全网。

---

## 附录 A. 证据索引

### 已核验的关键数字

| 指标 | 值 | 核验方式 |
|---|---|---|
| 总代码行数 | 13,782 | `find src src-tauri/src -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.rs' -o -name '*.css' \) \| xargs wc -l` |
| Tauri 命令数 | **37** | `grep -c "#\[tauri::command\]" src-tauri/src/lib.rs` |
| Rust 测试数 | **35** | 逐文件 `#[test]` + `#[tokio::test]` 计数 |
| 前端测试数 | **0** | `find` 全仓 `*test*`/`*spec*` 无输出 |
| i18n 键数 | 322 × 4 = **1288** | 四语言块逐键比对 |
| 内联 style | **337** 处 | `grep -ro "style={{" src --include="*.tsx" \| wc -l` |
| `var(--…)` 引用 | **512** 处 | 同上 |
| ARIA 属性 | **2** 处 | `grep -rn "aria-\|role="` 全仓 |
| `formatBytes` 实现 | **5** 份 | `grep -rn "formatBytes ="` |
| `eslint-disable` | **6** 处（ESLint 未安装） | `grep -rn "eslint-disable"` |
| `confirm()` | **2** 处 | `App.tsx:151`、`HistoryPanel.tsx:99` |
| `dangerouslySetInnerHTML` | **1** 处（有 DOMPurify） | `RichText.tsx:125` |

### 版本一致性核验

| 文件 | 版本 | 状态 |
|---|---|---|
| `package.json:4` | 0.7.1 | ✅ |
| `src-tauri/tauri.conf.json:4` | 0.7.1 | ✅ |
| `src-tauri/Cargo.toml:3` | 0.7.1 | ✅ |
| `src-tauri/Cargo.lock:919` | 0.7.1 | ✅ |
| `src/components/Sidebar.tsx:100` | `v0.7.1-core` | ⚠ 硬编码 + 多余后缀 |
| `src/components/SettingsModal.tsx:390` | `v0.7.0` | ❌ **错误** |

### Rust 测试分布

| 文件 | 行数 | 测试数 | 位置 |
|---|---|---|---|
| `bridge.rs` | 907 | **15** | `:700` mod；734,740,749,757,774,784,796,805,819,834,841,850,866,880,900 |
| `transform.rs` | 187 | **7** | `:119` mod；128,138,149,157,170,176,182 |
| `mqtt_manager.rs` | 2022 | **7** | `:1928` mod；1933,1951,1974（tokio）,1992,1999,2007,2016 |
| `protocol.rs` | 268 | **5** | `:188` mod；194,216,235,246,255 |
| `history.rs` | 301 | **1** | `:237` mod；260 |
| `transport.rs` | 308 | **0** | — |
| `lib.rs` | 409 | **0** | — |

### 事实 / 推断 / 建议的区分

- **事实**：所有带 `file:line` 的陈述均已直接读取源码核验。
- **推断**（文中已标注）：`--text-muted` 在 10px 下的对比度风险（未实测）；WebSocket 缺失对产品定位的影响评估；`transport.rs` 无测试与 `README.md:25` 宣称的关联。
- **建议**：第 7 章全部、第 9 章"建议"列、第 10 章全部。

---

*报告生成于 2026-09-23。分析过程全程只读，除本文档外未修改、创建或删除任何文件。*
