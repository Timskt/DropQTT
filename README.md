# DropQTT 🚀
> **Fast, Resilient Cross-Platform File Transfer Over MQTT**

[![Release Tauri App](https://github.com/Timskt/DropQTT/actions/workflows/release.yml/badge.svg)](https://github.com/Timskt/DropQTT/actions/workflows/release.yml)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-2021-orange?logo=rust)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

<p align="center">
  <img src="./app-icon.png" width="160" height="160" alt="DropQTT App Icon" />
</p>

**DropQTT** is a lightweight (~10–15 MB) desktop application built with **Tauri v2**, **Rust (`rumqttc`)**, and **React + Tailwind CSS**. It enables direct, secure, and verifiable file transfer across isolated network environments where standard HTTP uploads, P2P, SCP, or cloud storage are blocked, but standard MQTT broker connectivity (port `1883`, `8883` TLS, or WebSocket) is permitted.

---

## 🌟 Key Features

- ⚡ **Lightweight Footprint**: Packaged with Tauri v2 instead of Electron, yielding an installation size under 15MB and low memory consumption.
- 🧩 **Dynamic Chunking & Reassembly**: Conquers broker packet limits by breaking files into customizable chunks (64 KB to 2 MB) with streaming flow control.
- 🛡️ **Bit-Perfect SHA-256 Verification**: End-to-end cryptographic hashing ensures files are received without corrupted or missing packets.
- 🌐 **Ubiquitous Broker Support**: Works out of the box with public brokers (EMQX, HiveMQ, Mosquitto) or any private self-hosted MQTT v3.1.1/5.0 broker with optional TLS encryption and authentication.
- 🤝 **MQTT 5.0 Full Support**: Per-connection protocol selection, clean start semantics, and v5 publish properties (Message Expiry, Content-Type, User Properties) on console publishing.
- 📡 **MQTTX-style Pub/Sub Console**: Live message feed with Auto/JSON/SenML/Text/Markdown/HTML/CBOR/Base64/Hex payload views (dependency-free RFC 8949 codec; **RFC 8428 SenML reader for both the JSON and CBOR encodings**, resolving base names, inherited units and the 2^28 absolute-vs-relative time rule into an aligned reading table; collapsible syntax-colored JSON tree; DOMPurify-sanitized Markdown & fully-sandboxed HTML previews), a **user payload codec** (`function transform(topic, payload, qos, retain)` running in the same sandboxed QuickJS engine as the bridge, display-only so history/export/replay keep the exact bytes), a live-preview split editor with byte counters and draft persistence, feed pause/buffer, per-filter subscription hit statistics, JSON/CSV message export, one-click message replay (verbatim topic/payload/QoS/retain/v5 properties) and click-to-subscribe topic badges, a retained-message clearer, MQTT5 subscription options (No Local / Retain As Published / Retain Handling) that survive reconnects, plus a subscription registry that is automatically re-applied on every reconnect.
- 🔁 **Resilient Transfers**: NACK-driven missing-chunk retransmission, zombie-task watchdogs, and graceful CONNACK-driven subscription recovery.
- 🧭 **Transfer Lifecycle Controls**: Sender-originated PAUSE / RESUME / CANCEL controls now propagate to the receiver, suspend watchdog timeouts while paused, and produce an immediate terminal state.
- 🛑 **Silence Watchdog**: alert rules that POST to a webhook when a topic filter stops carrying traffic — the "has this device gone quiet?" question a normal MQTT client cannot answer. Per-rule silence threshold and cooldown, wildcard filters, and recovery-aware suppression (a device that reports again clears its own timer, so a flapping node keeps alerting instead of being swallowed by an open cooldown). Timers are tracked per rule, never in the LRU-evicted topic table, and are disarmed while the link is down so your own reconnect is never blamed on the device.
- 🔀 **Data Bridge (Broker → Broker and Broker → HTTP)**: Run two independent bridge connections and forward messages by topic rules. Multi-line source filters subscribe many topics with one rule; exclusions carve out sub-trees; topic rewrites support keep / prefix / fixed-aggregate / regex-capture / per-topic mapping tables; payloads pass verbatim or through prefix-suffix tags, JSON envelopes, and a sandboxed **embedded-JavaScript transform** (`function transform(topic, payload, qos, retain)` with 100 ms / 4 MB limits, null-to-drop semantics and an in-form dry-run tester). A rule can target an **HTTP/Webhook endpoint** instead of a broker — JSON envelope or raw body, custom headers, and three starter recipes (telemetry → business API, threshold alert, edge-site aggregation). Per-rule rate limiting, forwarded/dropped counters, a live forward log, rules export/import as JSON, and auto-reconnect that restores remembered endpoints and re-applies changed QoS on CONNACK.
- ✅ **Receive Approval Mode**: Toggle auto-accept off to gate incoming files behind an explicit Approve/Reject review after SHA-256 verification.
- 🎨 **Themeable UI**: Four design-token driven themes (Cyberpunk, OLED Obsidian, Nord, Solaris light) with CSS custom properties, plus 4-language i18n (简中/English/繁中/日本語).
- 🚪 **Room / Channel Isolation**: Share files simply by agreeing on a channel code (e.g. `#my-secure-room`).
- 🔥 **Live Topic Traffic & Bench Lab**: Per-actual-topic traffic ranking (msgs/sec, byte volume, peak rate, last-active) with second-accurate counters that stay exact under load, a hot-topic flame highlight, and a built-in publish stress lab (up to 20k msg/sec) that loops back through your own subscriptions to verify stat accuracy and UI responsiveness.
- 🚦 **Overload-Proof Console Feed**: The backend batches the message feed at ~10 Hz (200 msgs/emit) with counted overflow drops — thousands of msgs/sec never flood the webview, and the UI shows a red notice when display rows were dropped while stats remain precise.
- 🗂️ **Searchable Message History**: Every console-feed row is mirrored to SQLite (bounded at 100k rows) so traffic stays inspectable after the live feed scrolls away. Free-text search over topic *and* payload, direction filter, 5m/15m/1h/24h/**All time** windows, and a trend chart whose buckets use exactly the same predicates as the result list. Filtered results export to JSON/CSV, payloads inspect as Text/JSON/Hex/Base64/CBOR, and MQTT5 properties (response topic, correlation data, user properties) survive the round-trip to replay. Rows whose stored bytes are incomplete — including captures written by older versions — are detected and blocked from replay rather than silently re-published truncated.
- 🩺 **Operations Diagnostics Center**: A dedicated Ops workspace reports runtime/platform metadata, broker connection state, transfer activity, feed pressure, SQLite history status and bridge health. Active checks cover download-directory writability, history availability, TLS posture, subscriptions and overload indicators; the sanitized report can be copied or exported without passwords, usernames or certificate paths.
- ♿ **Keyboard & Responsive Polish**: Fluid container-driven layouts work at the default window size, dialogs trap and restore focus, key interactive surfaces are keyboard reachable, document language follows the selected locale, decorative motion respects `prefers-reduced-motion`, and code surfaces use theme tokens.
- 🎨 **Pristine Modern UI & Brand Identity**: Designed with the `app-logo-design-engine` skill, featuring an origami vector mark rendered via native Swift + CoreGraphics producing true 32-bit RGBA (`ColorType 6`) icons without white squircle borders.
- 📦 **Cross-Platform Matrix**: Builds native installers for macOS (`.dmg`), Linux (`.deb`, `.AppImage`), and Windows (`.msi`, NSIS `.exe`).

---

## 📐 MQTT Transfer Protocol Specification

```
dropqtt/
  └── {channel}/
        ├── meta                          <- File metadata & SHA-256 (QoS 1)
        ├── chunk/{transferId}/{seq}      <- Binary raw chunk payloads
        └── ctrl/{transferId}             <- Transfer control: ACK, PAUSE, RESUME, CANCEL, COMPLETED
```

1. **Handshake (`meta`)**: The sender computes the full-file SHA-256 and broadcasts file metadata (`transferId`, `fileName`, `fileSize`, `chunkSize`, `totalChunks`, `sha256`).
2. **Chunk Streaming (`chunk`)**: The sender streams binary chunks to sequence-addressed topics with paced flow control. The receiver writes directly to temporary storage.
3. **Verification & Delivery (`ctrl`)**: Upon receiving the final chunk, the receiver re-calculates the complete SHA-256 hash. If verified, the file is atomically moved to the destination folder and a `COMPLETED` receipt is emitted.

---

## 🛠️ Development & Building

### Prerequisites
- Node.js >= 20, `pnpm`
- Rust toolchain (stable)
- macOS (Xcode Command Line Tools), Linux (WebKitGTK dev packages), or Windows (C++ Build Tools **including the Windows 10/11 SDK** — `link.exe` alone is not enough; without the SDK's `ucrt.lib`/`kernel32.lib` no Rust binary can be linked)

### Run in Development
```bash
# Install dependencies
pnpm install

# Start Tauri development mode
pnpm tauri dev
```

### Tests
```bash
pnpm test          # Vitest unit tests (history decode/replay/export/chart filling)
pnpm test:ui       # Playwright browser tests (mocked Tauri IPC, real React UI)
(cd src-tauri && cargo test)   # Rust: SQLite history, bridge rules, webhook, QuickJS sandbox
```
`pnpm test:ui` starts the Vite dev server on `127.0.0.1:1420` and drives the real components with a stubbed IPC layer, so it validates rendering and interaction — not live MQTT or HTTP networking.

### Build Locally
```bash
# Build production bundle for current platform
pnpm tauri build
```

---

## 🚀 Automated Cross-Platform Release (GitHub Actions)

DropQTT packages installers for **macOS (Apple Silicon & Intel)**, **Ubuntu Linux**, and **Windows** via GitHub Actions.

Releases are triggered strictly by pushing semantic version tags:

```bash
# 1. Update version in package.json & src-tauri/tauri.conf.json
# 2. Commit and tag:
git tag -a v0.9.0 -m "Release v0.9.0"
git push origin v0.9.0
```

GitHub Actions will automatically build the artifacts and attach them to a new GitHub Release.
