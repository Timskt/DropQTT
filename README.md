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
- 📡 **MQTTX-style Pub/Sub Console**: Live message feed with Auto/JSON/Text/Markdown/HTML/CBOR/Base64/Hex payload views (dependency-free RFC 8949 codec; DOMPurify-sanitized Markdown & fully-sandboxed HTML previews), a live-preview split editor with byte counters and draft persistence, feed pause/buffer, per-filter subscription hit statistics, JSON/CSV message export, one-click message replay (verbatim topic/payload/QoS/retain/v5 properties) and click-to-subscribe topic badges, a retained-message clearer, plus a subscription registry that is automatically re-applied on every reconnect.
- 🔁 **Resilient Transfers**: NACK-driven missing-chunk retransmission, zombie-task watchdogs, and graceful CONNACK-driven subscription recovery.
- 🔀 **Broker-to-Broker Data Bridge**: Run two independent bridge connections and forward messages between any two brokers by topic rules. Multi-line source filters subscribe many topics with one rule; exclusions carve out sub-trees; topic rewrites support keep / prefix / fixed-aggregate / regex-capture / per-topic mapping tables; payloads pass verbatim or through prefix-suffix tags, JSON envelopes, and a sandboxed **embedded-JavaScript transform** (`function transform(topic, payload, qos, retain)` with 100 ms / 4 MB limits, null-to-drop semantics and an in-form dry-run tester). Per-rule rate limiting, forwarded/dropped counters, a live forward log, rules export/import as JSON, and auto-reconnect that restores remembered endpoints on startup.
- ✅ **Receive Approval Mode**: Toggle auto-accept off to gate incoming files behind an explicit Approve/Reject review after SHA-256 verification.
- 🎨 **Themeable UI**: Four design-token driven themes (Cyberpunk, OLED Obsidian, Nord, Solaris light) with CSS custom properties, plus 4-language i18n (简中/English/繁中/日本語).
- 🚪 **Room / Channel Isolation**: Share files simply by agreeing on a channel code (e.g. `#my-secure-room`).
- 🔥 **Live Topic Traffic & Bench Lab**: Per-actual-topic traffic ranking (msgs/sec, byte volume, peak rate, last-active) with second-accurate counters that stay exact under load, a hot-topic flame highlight, and a built-in publish stress lab (up to 20k msg/sec) that loops back through your own subscriptions to verify stat accuracy and UI responsiveness.
- 🚦 **Overload-Proof Console Feed**: The backend batches the message feed at ~10 Hz (200 msgs/emit) with counted overflow drops — thousands of msgs/sec never flood the webview, and the UI shows a red notice when display rows were dropped while stats remain precise.
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
- macOS (Xcode Command Line Tools), Linux (WebKitGTK dev packages), or Windows (C++ Build Tools)

### Run in Development
```bash
# Install dependencies
pnpm install

# Start Tauri development mode
pnpm tauri dev
```

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
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

GitHub Actions will automatically build the artifacts and attach them to a new GitHub Release.
