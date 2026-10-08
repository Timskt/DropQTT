# DropQTT 接手手册（2026-10）

给**另一台电脑**（或另一个人 / 另一个编码代理）看的：从空目录到"所有门禁全绿、能继续开发"。
不重复 `AGENTS.md` 里的纪律条款，只讲**怎么做**和**为什么这台机器上会失败**。

写作时点：`main` = `8bfceb4`，v0.10.1 已发布。所有数字都是当时代码实测，不是估算。

---

## 1. 接手检查表（按顺序跑，全绿即接手成功）

```bash
git clone https://github.com/Timskt/DropQTT.git && cd DropQTT

# 1) 依赖
npx pnpm install --frozen-lockfile

# 2) 前端三件套
npx tsc --noEmit                              # 期望：无输出
npx eslint . --max-warnings=10                # 期望：0 error / 10 warning（不是 9，不是 11）
npm test                                      # 期望：149 passed（18 个文件）

# 3) Rust
cd src-tauri
cargo check --all-targets
cargo clippy --all-targets -- -D warnings     # 期望：Finished，0 告警
cargo test                                    # 期望：全绿；Windows 上见 §5 的 harness 说明
cd ..

# 4) UI（要先把 vite 起在 1420）
node node_modules/vite/bin/vite.js --host 127.0.0.1 &   # 另开终端
npx playwright test                           # 期望：221 passed

# 5) 无头 CLI 门禁（需要一个一次性 broker，见 §4 的端口表）
cd src-tauri && cargo build --bin dropqtt-cli && cd ..
bash scripts/cli-gate.sh ./src-tauri/target/debug/dropqtt-cli 127.0.0.1 <port>       # 36 项
bash scripts/scenario-gate.sh ./src-tauri/target/debug/dropqtt-cli 127.0.0.1 <port>   # 18 项

# 6) i18n
python scripts/check-i18n-parity.py           # 期望：962 × 4，parity OK
```

任何一步红，**先怀疑环境再怀疑代码**：CI 在干净机器上跑同一批门禁，CI 绿说明代码没问题。

---

## 2. 环境搭建

| 组件 | 要求 | 备注 |
| --- | --- | --- |
| Node | CI 用 22；本机 v24.14.1 也正常 | 前端工具全部走 `npx` |
| 包管理 | **pnpm**（仓库里只有 `pnpm-lock.yaml`，没有 `package-lock.json`） | `packageManager: pnpm@11.1.2`；本机该版本的切换 shim 损坏，`pnpm` 直接跑会 `ENOENT` → 用 `npx pnpm install --frozen-lockfile` |
| Rust | stable + `cargo`/`clippy` | 见 §5：Windows 上必须显式指定工具链 |
| 系统库（Linux） | `libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` | Tauri v2 常规要求 |
| 系统库（Linux，新增） | **`libdbus-1-dev` + `pkg-config`** | broker 密码进 Secret Service 之后需要；CI 两个 apt 块都已加，本地漏了会在 `keyring` 依赖上报链接错 |
| 浏览器 | Windows/macOS 有 WebView2 / WKWebView；Linux 需要 webkit2gtk | UI 测试用的是 Chromium（`npx playwright install --with-deps chromium`） |
| mosquitto | 跑 CLI 门禁需要（`allow_anonymous` 或带 ACL 的一次性实例） | 别用属主的 1883 |

`.npmrc` 只有一行 `ignore-scripts=false`（放开 postinstall，Playwright/tauri 需要）。

---

## 3. CI 是什么，怎么读

`.github/workflows/ci.yml`（push 即跑，四个作业）：

| 作业 | 内容 | 权威点 |
| --- | --- | --- |
| `frontend` | `tsc` → `eslint --max-warnings=10` → `vitest` → `vite build` | ESLint 预算由它守 |
| `ui` | Playwright + mock 掉的 Tauri IPC | 真 DOM 行为 |
| `backend` | `cargo check --all-targets` → `cargo clippy --all-targets -- -D warnings` → `cargo test` | **只有它跑 `mqtt_manager.rs` / `bridge.rs` 的测试**（本机 harness 覆盖不到，见 §5） |
| `cli` | 起一个带 ACL 的 mosquitto，跑 `cli-gate.sh`（36 项）+ `scenario-gate.sh`（18 项） | 退出码契约 |

`.github/workflows/release.yml`：`v*.*.*` tag 或手动触发，三平台四目标矩阵。

**从某些机器上看不到 CI 结果**（没有 `gh`、仓库私有、且约定不去读属主的 git 凭据）。这种情况就把
"推送 + 本地门禁全绿"作为交付边界，别猜 CI 的状态。

---

## 4. 真机验证：broker 纪律与端口表

**铁律**：属主自己的 mosquitto 服务在 `127.0.0.1:1883`，**永远不要向它发测试流量**。
所有验证都在回环，不出网。

| 端口 | 用途 | 怎么起 |
| --- | --- | --- |
| 1883 | 属主的常驻服务 | **不要动、不要发** |
| 18830 | 一次性 aedes（Node） | `node` + aedes 脚本 |
| 18831 | 一次性 mosquitto：`lab2.conf` 匿名 / `acl-lab.conf` 需密码 + ACL | 二者都只监听 127.0.0.1 |
| 18832 / 18833 | 可编程 probe broker（MQTT5，按主题前缀决定 SUBACK/PUBACK 理由码）/ 它的报文日志 HTTP | 需要"broker 真的拒绝了"这类判定时用 |

要复现"broker 拒绝"这类判定，用 ACL 或密码，而不是模拟：
`allow_anonymous false` + `password_file` + `acl_file`（只授 `pattern cli-gate/#`）就能造出真实的 0x87。
CI 的 `cli` 作业用的就是这套（`.github/ci/mosquitto.conf` + `.github/ci/mosquitto.acl`，都在仓库里）。

**用完关掉**，并确认没把属主的实例误杀：`netstat -ano | grep 1883` 看清 PID 归属再 `taskkill //PID <pid> //F`。

### 驱动真实桌面窗口（UI 改动的最终验收）

1. 构建：`cd src-tauri && RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu cargo build`
   —— **不要接管道**（管道会吞掉真实退出码）；看日志末尾的 `Finished` 和 exe 的 mtime 确认真的产物更新了。
2. 启动时给一个**隔离的** WebView2 目录 + 调试端口，避免污染属主的 localStorage：
   ```bash
   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9224" \
   WEBVIEW2_USER_DATA_FOLDER="C:\Users\<you>\dq-wv2-<purpose>" \
   ./target/debug/dropqtt.exe
   ```
3. 通过 CDP 驱动：`http://127.0.0.1:9224/json/list` 找 page → WebSocket →
   `Runtime.evaluate`（读写 localStorage、点按钮、取文本）、`Page.captureScreenshot`（截图自己看）。
   - 受控输入框要用原生 setter 再派发 `input` 事件，React 才认。
   - **不要导航离开 devUrl 的 origin**（`http://localhost:1420`），离开之后 invoke 会被 ACL 拒。
4. 关闭用 `WM_CLOSE`（别 `taskkill /F`，SQLite 的 WAL 收尾会被打断）。
5. 收尾：删掉自己建的凭据/临时目录；如果动过属主的 profile，逐项还原。

### 验证"东西真的存到了该存的地方"

写存储类改动，必须去**存储那一侧**取证，不能只信调用返回成功：

```bash
MSYS_NO_PATHCONV=1 cmdkey /list | iconv -f GBK -t UTF-8 | grep -i dropqtt
```
Git Bash 会把 `/list` 改写成路径（于是 cmdkey 打印自己的 usage），且本机控制台输出是 GBK——
两个条件都满足才算真读过凭据管理器。钥匙串条目长这样：
`LegacyGeneric:target=broker:<ref>.DropQTT`。

---

## 5. 不在仓库里的机器本地资产（新机器需要重建或跳过）

这两样**故意**没入库（一次性、含绝对路径、只服务于"这台机器工具链坏了"）。

### 5.1 `~/dropqtt-rustcheck` —— Rust 逻辑门禁的本地替身

本机 `cargo test --lib`（在 `src-tauri` 下）能编译但测试进程 `STATUS_ENTRYPOINT_NOT_FOUND`
（gnu 链接下加载 tauri/WebView2 依赖失败）。于是把纯逻辑模块用绝对路径 `#[path]` 引进一个独立 crate 跑。

重建：

```toml
# ~/dropqtt-rustcheck/Cargo.toml
[package] name = "dropqtt_rustcheck" version = "0.0.0" edition = "2021"
[lib] path = "src/lib.rs"
[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
base64 = "0.22"
rusqlite = { version = "0.31", features = ["bundled"] }
bytes = "1.7"
reqwest = { version = "0.13", default-features = false, features = ["rustls"] }
chrono = "0.4"
rquickjs = "0.8"
tokio = { version = "1.38", features = ["full"] }
uuid = { version = "1.10", features = ["v4", "fast-rng"] }
sha2 = "0.10"
hex = "0.4"
rumqttc = { version = "0.24", features = ["websocket"] }
keyring = { version = "3.6", default-features = false, features = ["windows-native", "crypto-rust"] }
```

`src/lib.rs` 用 `#[path = "D:/code/ai/DropQTT/src-tauri/src/<mod>.rs"] pub mod <mod>;` 引入这些模块：
`protocol diagnostics history webhook transport silence topic transform scheduler bench rpc acks
assertions faults responder outbox metrics secrets verdict scenario cli`，
再给 `mqtt_manager` / `bridge` 写**只到签名层**的 shim（metrics 的测试只需要类型对得上）。
新增模块时**必须同步这里**，否则新代码在本地永远没有门。

当前覆盖 **21 个模块 / 325 项测试**。`mqtt_manager.rs`（3 项）和 `bridge.rs`（16 项）要 tauri，
只有 CI 的 `cargo test` 会跑。

### 5.2 `~/mqtt-lab` —— 一次性 broker、CDP 探针、截图与关窗脚本

里面是：`lab2.conf` / `acl-lab.conf` / `acl-lab.acl` / `acl-lab.pass`（一次性口令，非属主真实凭据）、
`probe-broker.mjs`（MQTT5 可编程裁决）、`start-lab2.ps1`、`close-app.ps1`、`cdp-probe*.mjs`、
`keyring-live.mjs`（钥匙串改动的分步驱动：seed / reload / state / type / save / wipe / shot）、
以及验收截图 `demo-*.png`。

这些不需要入库（含本机路径、一次性口令、截图），但**新机器上要么重建，要么改用 CI 那套**：
仓库里的 `.github/ci/mosquitto.conf` + `mosquitto.acl` 就是可复用的最小配置，
两个 gate 脚本只吃 `<cli> <host> <port>` 三个参数，不依赖 `~/mqtt-lab`。

### 5.3 属主的运行数据（不要覆盖）

- 历史库 SQLite（WAL）：动它之前先整目录备份，并用**内容**而不是 md5 判断有没有变——
  干净关窗会触发 checkpoint，md5 变了但内容一样。
- localStorage 在 WebView2 的用户数据目录里；要试迁移/破坏性流程，用 §4 的隔离目录，别拿属主 profile 练手。

---

## 6. 发版

1. 版本号有**四处**，一起改（漏一处就会打出"版本对不上"的包）：
   `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 里的 `dropqtt` 条目。
2. 提交 → 打 tag `v<semver>` → 推 tag：`release.yml` 由 `v*.*.*` 触发。
3. 签名：updater 用 minisign，私钥与口令在 GitHub Secrets
   （`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）。
   公钥与 endpoint 写死在 `src-tauri/tauri.conf.json`（`releases/latest/download/latest.json`）。
   **本地没有私钥，产不出可升级签名包**——这是设计如此，不是漏配。`.gitignore` 已排除 `*.key`、
   `*.key.pub`、`src-tauri/.updater-key-password`。
4. 产物：macOS（aarch64 + x86_64）、Linux（deb/AppImage）、Windows（msi/NSIS）+ `latest.json`。
5. **绝不移动已发布的 tag**。要修已发布版本，就发 patch 版本（0.10.0 之后是 0.10.1，而不是回退）。
6. 推送后一定要用 `git ls-remote` 按 SHA 核对——本机曾经出现过"push 显示成功、远端啥也没有"
   （TLS 中断），此后每次推都核对。

本机 `pnpm tauri build` 打 NSIS 包目前**跑不通**：下载 GitHub release 资源时连接被截断（重试 6 次）。
这是环境问题（同 §3 的网络观察），CI 的 Windows 作业能正常构建。

---

## 7. 工程习惯（决定"怎么写"的那些）

- **每轮改动在 `docs/ITERATION_2026_09.md` 加一节 §4.x**，写清"为什么这么做、推翻了哪个假设、
  被自己抓到什么错"。这份文档是本项目最有价值的部分：很多结论只能从"当初为什么"里恢复。
  近几条：§4.70 CLI、§4.71 门禁接 CI、§4.72 密码入钥匙串（含 `keyring` 默认 feature 是**进程内 mock**
  这个坑）、§4.73 场景判定下沉 Rust（含"只查退出码的门放过了根本没收到报文"）、
  §4.74 webhook 走了系统代理、§4.75 header token 入钥匙串、§4.76 CLI 自驱 bench 流量。
- 规模、门禁数字、已知限制记在 `docs/PROJECT_STATUS_2026_10.md`，每轮更新（数字必须是量出来的）。
- 一次只做一件事，但做完要能证明：`tsc` / 单测 / UI / 真机 / 线上取证，逐层往上。
- 判定规则**只允许有一个作者**：能复用引擎就别再实现一遍
  （`verdict::tally`、`BenchSpec::evaluate`、`transport::build_connection` 都是这个用法的落点）。
- 报告/导出这类"给人看的东西"，宁可写 `unknown` 也不给绿：`4 = 没证明` 是本项目和 CI 的契约。

---

## 8. 待办（按建议顺序）

1. ~~**webhook header 里的 Bearer token 也进钥匙串**~~ ✅ 2026-10-08 完成（§4.75）。
   还差一次真 OS 钥匙串上的 GUI 端到端（按 `keyring-live.mjs` 步骤）。
2. ~~**CLI 侧生成 bench 流量**~~ ✅ 2026-10-08 完成（§4.76，`--bench-rate/--bench-size/--bench-qos`）。
   遗留：GUI 收尾不等迟到的 ack，CLI 会等，`maxLost` 在边界上两边可能不一致。
3. 桌面集成：系统托盘、开机自启、全局快捷键（审计列为系统类缺口）。
4. 把 `dropqtt-cli` 二进制挂进 release 产物（现在只有 GUI 安装包）。
5. 主题树浏览器 / 在线设备清单（靠 LWT + `$SYS` + 静默看门狗三块拼图，已有素材）。
6. §1.6 桥接每消息克隆 rules/conns：**先 A/B 量**再动手（本项目已有两次"看着该优化"量下来不是瓶颈）。

### 需要属主拍板，别自作主张

`releaseDraft`、收窄 `fs:default`、历史双 payload 列、typed IPC（ts-rs / tauri-specta）、
`-core` 版本后缀、`tsconfig.node` strict、**多连接工作区的历史归属语义**
（实测改造面：79 个命令都隐含"只有一个连接"、`App.tsx` 里 `broker.isConnected` 23 处、
事件名要按连接分道、32 个 spec 的 mock 随之全改；且要先定现有 4.8 万行历史怎么归属）。

---

## 9. 本机环境陷阱速查（新机器可能根本没有这些，别照抄）

| 症状 | 真因 | 解法 |
| --- | --- | --- |
| `linking with 'link.exe' failed` + `link: extra operand` | 没装 Windows SDK，rustc 找不到工具集，退回到 Git 的 `link`（硬链接工具） | Rust 全走 `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu` |
| `cargo --version` 是 1.55.0 | 一个残留工具链排在 rustup shim 前面 | 永远显式指定工具链，别用裸 `cargo` |
| `pnpm` → `spawnSync ... @pnpm+win-x64\11.1.2\bin\pnpm ENOENT` | `packageManager` 版本切换 shim 损坏 | `npx pnpm ...` |
| Playwright 报 `Process from config.webServer was not able to start` | config 里 webServer 用 `pnpm dev`，而 pnpm 坏 | 先手起 vite（§1 第 4 步），`reuseExistingServer` 会复用 |
| 大量 spec 突然"collection failed"或偶发 flake | 机器被并发构建/CPU 抢占 | 先复跑被点名的那几个文件，别急着改代码 |
| `cmdkey /list` 打印自己的 usage | Git Bash 把 `/list` 改写成路径 | `MSYS_NO_PATHCONV=1 cmdkey /list \| iconv -f GBK -t UTF-8` |
| 内联 PowerShell/Python 里 `$` 或 `\\` 神秘消失 | Git Bash 插值 + 反斜杠折叠 | 写成 `.ps1` / `.py` 文件再执行 |
| 后台链式 `cd a && x; cd b && y` 少跑了一步 | 相对 `cd` 解析到了上一个目录 | 链式命令里一律用绝对路径；空日志 = "没跑"，不是"失败" |
