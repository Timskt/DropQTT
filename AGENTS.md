# DropQTT — 编码代理 / 新机器接手须知

一句话：这是一个 **MQTT 工作台**（文件传输 + 收发控制台 + 数据桥接 + 报文历史 + 运维诊断 + 无头 CLI），
Tauri 2 + Rust + React 18 + TypeScript + Vite。单人项目，改动要**自己证明它真的能跑**。

权威文档（按新鲜度读）：

| 文件 | 作用 |
| --- | --- |
| `docs/PROJECT_STATUS_2026_10.md` | 当下实测规模、门禁数字、能力清单、已知限制 |
| `docs/ITERATION_2026_09.md` | §4.x 逐轮记录**为什么**这么做，以及被推翻了哪些假设 |
| `docs/ROADMAP_vs_MQTTX.md` | 与 MQTTX 的差异定位（流量深度优先，不追客户端广度） |
| `docs/HANDOFF_2026_10.md` | 新机器从克隆到全绿的完整路径、环境陷阱、发版流程 |

> `PROJECT_ANALYSIS_v0.9.md` 与 `docs/REVIEW_2026_10_03.md` 是**故意不入库**的（属主决定），
> 新克隆里没有它们，不要去找。

## 常用命令

```bash
npx pnpm install --frozen-lockfile   # 锁文件是 pnpm 的
npx tsc --noEmit                     # 类型
npx eslint . --max-warnings=10       # lint（预算见下）
npm test                             # 前端单测 = vitest run tests/unit
node node_modules/vite/bin/vite.js --host 127.0.0.1   # UI 测试需要它先在 1420 监听
npx playwright test                  # 真 DOM UI
cd src-tauri && cargo test           # Rust（含 mqtt_manager / bridge）
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo build --bin dropqtt-cli
bash scripts/gate-rig.sh                                   # 起 CI 同构 broker 并跑下面两项
bash scripts/cli-gate.sh ./src-tauri/target/debug/dropqtt-cli <host> <port>
bash scripts/scenario-gate.sh ./src-tauri/target/debug/dropqtt-cli <host> <port>
python scripts/check-i18n-parity.py  # 四语言 + Translations 接口三方核对（会自查解析器本身有没有抽到东西）
python3 scripts/bench-history-lock.py  # 量「图表读会不会拖住写锁」：性能结论先量再改，别猜
python3 scripts/check-ci-shell.py             # 工作流 run 块语法（纯标准库，无需 PyYAML）
python3 scripts/check-release-ready.py        # 只有发版才会暴露的那批问题，本地先跑
python3 scripts/check-macos-signed.py --self-test   # 这道门能不能说"不"（也能验真产物）
python3 scripts/check-release-shipped.py v0.12.4  # 发版**之后**按资产验收：workflow 全绿 ≠ 四个平台都发出去了
```

CI（`.github/workflows/ci.yml`）有四个作业：`frontend` / `ui` / `backend` / `cli`，push 即跑。
**CI 是权威门禁**；本地跑不动的东西（见下）不代表代码有问题。

## 硬性约束（这些是踩过坑换来的）

**安全与隐私**
- 永远不要向属主自己的 broker `127.0.0.1:1883` 发测试流量；用一次性 broker（见 handoff 的端口表），用完关掉。
- 一切测试都在 `127.0.0.1`，不碰外网。
- secret 不落盘、不进日志、不进导出：webhook URL/header、broker 密码（现在在 OS 钥匙串，
  配置里只存 `secretRef`）、场景/抓包/环境包文件里都不许出现 broker 地址或告警端点。
- mTLS 材料缺失必须**响亮地失败**，不许静默降级成非 TLS 或匿名连接。
- 指标端点：默认关闭、只绑回环、无 host 参数；指标名与标签里不得出现报文、主题、clientId、路径、凭据。
- CLI 密码只从 `--password-env VAR` 取，绝不从命令行参数取；解析出的值和变量名都不打印；变量取不到就报错，不改用匿名连接。

**证据纪律**
- "做完了"= 真跑过。类型检查和测试只证明代码正确性，不证明功能正确性；UI 改动要启动窗口看。
- 声称性能收益前先 A/B 量过。本项目已有两次"看起来该优化"量下来不是瓶颈的记录（§1.6、§1.12）。
- 验证工具本身也要验：一个永远通过的断言比没有断言更危险（§4.71、§4.73 各有一次实录）。
- 只断言退出码不够，还要断言**它为什么是这个码**（scenario-gate 因此检查 claim 文本）。

**预算与习惯**
- ESLint 预算是**恰好 10 条 warning**（`--max-warnings=10`，CI 执行）。新增一条就要当场消掉一条，或说明理由。
- i18n 四语言必须等键；新增文案要同时补 4 份 + `src/i18n/types.ts`，跑 parity 脚本。
- 每加一个 Tauri 命令，Playwright 的 invoke 双份要能应答它；或者让前端在 `invoke` 抛错/返回 null 时**退化成"没有后端"**而不是报错——`useMetrics` / `secrets.ts` 是这个套路的样板（省掉 19 个 spec 的补桩税）。
- 注释只写"为什么"和不显然的约束，不写代码在做什么。

## 不要擅自做的事（需要属主点头）

- 移动/删除**已发布的 tag**（上次宁可发 0.10.1 也没回退 v0.10.0）。
- 强制推送、`--no-verify` 跳过钩子、改 CI 流水线的发布行为。
- 读取或代填属主的 git 凭据 / GitHub token。
- 这些项已评估但**留给属主决定**：`releaseDraft`、收窄 `fs:default`、历史双 payload 列、
  typed IPC（ts-rs/tauri-specta）、`-core` 版本后缀、`tsconfig.node` strict、多连接工作区的历史归属语义。
- 那两份未入库文档不要改成入库。

## 已知环境陷阱（细节与解法在 `docs/HANDOFF_2026_10.md`）

- **Windows + MSVC 链接不了**（本机没装 Windows SDK）→ Rust 一律走
  `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu`。
- 本机裸 `cargo` 会解析到 **1.55.0**（一个残留工具链），必须显式指定工具链。
- `packageManager: pnpm@11.1.2` 的版本切换 shim 在本机损坏（`pnpm` 直接跑会 ENOENT）→ 用 `npx pnpm ...`。
- Git Bash 会把 `/list` 这类参数改写成路径、把 PowerShell/Python 内联串里的 `$`/反斜杠吃掉 →
  复杂命令写成 `.ps1` / `.py` 文件再执行；`cmdkey /list` 需要 `MSYS_NO_PATHCONV=1` + GBK 转码。
- `cargo test --lib`（在 src-tauri 里）在本机 gnu 下能编译但测试进程 `STATUS_ENTRYPOINT_NOT_FOUND`
  → 本机用 `~/dropqtt-rustcheck` harness 跑纯逻辑模块（它不在仓库里，重建方法见 handoff §6）。
