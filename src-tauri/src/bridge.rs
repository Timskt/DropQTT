//! Broker-to-broker message forwarding (MQTT bridge).
//!
//! Completely independent from the main console session: the bridge owns its
//! own set of named connections (typically "src" and "dst") and a list of
//! forwarding rules. Any inbound publish on a source connection that matches
//! an enabled rule's topic filter is republished verbatim (payload bytes
//! untouched) onto the target connection, with optional topic remapping and
//! QoS/retain policies.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use base64::Engine;
use bytes::Bytes;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinHandle;

use crate::diagnostics::BridgeDiagnostics;
use crate::topic::wildcard_match;
use crate::protocol::{BrokerConfig, PubProperties, SubOptions};
use crate::transform::{apply_transform, TransformOutcome, SCRIPT_SIZE_LIMIT};
use crate::transport::{build_connection, MqttClient, NetEvent, NormalizedPublish};
use crate::webhook::{self, WebhookConfig};

/// One exact/wildcard topic mapping entry for "map" mode
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicMapEntry {
    pub from: String,
    pub to: String,
}

/// One forwarding rule: source topic filter -> target connection + topic map
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRule {
    pub id: String,
    pub name: String,
    /// Logical connection id acting as the source ("src" | "dst")
    pub source_conn: String,
    /// Source topic filter; '+' / '#' wildcards allowed. May contain multiple
    /// newline-separated filters (one broad subscription rule for many topics).
    pub source_filter: String,
    /// Subscription QoS applied on the source connection
    #[serde(default = "default_qos1")]
    pub source_qos: u8,
    /// Logical connection id receiving the forwarded publish
    pub target_conn: String,
    #[serde(default = "default_target_kind")]
    pub target_kind: String,
    #[serde(default)]
    pub webhook: WebhookConfig,
    /// Extra sinks this rule fans the same message out to, after its primary
    /// `webhook`. One device stream usually has to reach the business API, an
    /// archive and an alert hook at once; each sink is delivered and retried on
    /// its own, because one endpoint being down is not the others' excuse.
    /// Index 0 in the outbox is the primary, 1.. these in order.
    #[serde(default)]
    pub targets: Vec<WebhookConfig>,
    /// "same" (keep original topic) | "prefix" (replace prefix)
    /// | "fixed" (single aggregate topic) | "regex" (capture-group rewrite)
    /// | "map" (per-topic mapping table, exact then wildcard)
    #[serde(default = "default_topic_mode")]
    pub topic_mode: String,
    #[serde(default)]
    pub prefix_from: String,
    #[serde(default)]
    pub prefix_to: String,
    /// Target topic when topic_mode == "fixed"
    #[serde(default)]
    pub fixed_topic: String,
    /// Regex pattern / replacement ($1 groups) when topic_mode == "regex"
    #[serde(default)]
    pub regex_pattern: String,
    #[serde(default)]
    pub regex_replacement: String,
    /// Per-topic mapping rows when topic_mode == "map"
    #[serde(default)]
    pub topic_map: Vec<TopicMapEntry>,
    /// Optional JS `function transform(topic, payload, qos, retain)` applied
    /// to the payload before forwarding; returning null drops the message
    #[serde(default)]
    pub transform_script: String,
    /// Wildcard filters whose matching topics are NOT forwarded by this rule
    #[serde(default)]
    pub exclude_filters: Vec<String>,
    /// Literal text prepended / appended to the payload (byte-safe for text)
    #[serde(default)]
    pub payload_prefix: String,
    #[serde(default)]
    pub payload_suffix: String,
    /// Wrap the payload into a JSON envelope {topic, ts, payload|payload_b64}
    #[serde(default)]
    pub wrap_json: bool,
    /// Max messages forwarded per second by this rule (0 = unlimited)
    #[serde(default)]
    pub rate_limit: u32,
    /// "source" (follow incoming) | "fixed"
    #[serde(default = "default_qos_mode")]
    pub qos_mode: String,
    #[serde(default)]
    pub fixed_qos: u8,
    /// "source" (follow incoming) | "on" | "off"
    #[serde(default = "default_retain_mode")]
    pub retain_mode: String,
    /// Forward MQTT5 content-type / user properties when the target speaks v5
    #[serde(default)]
    pub forward_props: bool,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_qos1() -> u8 {
    1
}
fn default_target_kind() -> String { "mqtt".into() }
fn default_topic_mode() -> String {
    "same".to_string()
}
fn default_qos_mode() -> String {
    "source".to_string()
}
fn default_retain_mode() -> String {
    "source".to_string()
}
fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRuleStats {
    pub forwarded: u64,
    pub errors: u64,
    /// Messages skipped by exclusion or rate limiting
    pub dropped: u64,
    pub last_topic: String,
    /// Webhook bodies waiting in the outbox, and dead letters that stopped being retried
    pub queued: u64,
    pub dead: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConnInfo {
    pub id: String,
    pub connected: bool,
    pub broker_host: String,
    pub broker_port: u16,
    pub client_id: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeEvent {
    pub rule_id: String,
    pub rule_name: String,
    pub from_topic: String,
    pub to_topic: String,
    pub bytes: usize,
    pub qos: u8,
    pub retain: bool,
    pub ok: bool,
    pub error: Option<String>,
    pub timestamp: String,
}

#[derive(Clone)]
struct BridgeConn {
    client: MqttClient,
    connected: Arc<AtomicBool>,
    info: BridgeConnInfo,
}

/// Per-rule one-second rate-limit window
#[derive(Default)]
struct RateWindow {
    window_sec: u64,
    count: u32,
}

fn gate_allow(window: &mut RateWindow, now_sec: u64, limit: u32) -> bool {
    if limit == 0 {
        return true;
    }
    if window.window_sec != now_sec {
        window.window_sec = now_sec;
        window.count = 0;
    }
    if window.count >= limit {
        return false;
    }
    window.count += 1;
    true
}

/// Eventloop task handle + cooperative shutdown flag
pub type LoopControl = (JoinHandle<()>, Arc<AtomicBool>);

pub struct BridgeManager {
    conns: Mutex<HashMap<String, BridgeConn>>,
    tasks: Mutex<HashMap<String, LoopControl>>,
    rules: Mutex<HashMap<String, BridgeRule>>,
    stats: Mutex<HashMap<String, BridgeRuleStats>>,
    gates: Mutex<HashMap<String, RateWindow>>,
    /// Currently registered subscription filters per connection
    subs: Mutex<HashMap<String, HashMap<String, u8>>>,
    subscription_sync: Mutex<()>,
    webhook_client: std::sync::OnceLock<Result<reqwest::Client, String>>,
    webhook_slots: Arc<Semaphore>,
    /// Attached during setup. An `Err` here means the queue could not be opened, and
    /// `outbox_error` says why — "retries are off" must never be the silent default.
    outbox: std::sync::OnceLock<Result<Arc<crate::outbox::Outbox>, String>>,
}

impl Default for BridgeManager {
    fn default() -> Self {
        Self {
            conns: Mutex::new(HashMap::new()), tasks: Mutex::new(HashMap::new()),
            rules: Mutex::new(HashMap::new()), stats: Mutex::new(HashMap::new()),
            gates: Mutex::new(HashMap::new()), subs: Mutex::new(HashMap::new()),
            subscription_sync: Mutex::new(()), webhook_client: std::sync::OnceLock::new(),
            webhook_slots: Arc::new(Semaphore::new(4)),
            outbox: std::sync::OnceLock::new(),
        }
    }
}

/// Map the incoming topic through the rule's topic policy
pub fn map_topic(rule: &BridgeRule, topic: &str) -> String {
    match rule.topic_mode.as_str() {
        "prefix" => {
            if !rule.prefix_from.is_empty() && topic.starts_with(&rule.prefix_from) {
                let mut out = rule.prefix_to.clone();
                let mut rest = topic[rule.prefix_from.len()..].to_string();
                // Normalise the join so "x/" + "/b" never becomes "x//b"
                while out.ends_with('/') {
                    out.pop();
                }
                while rest.starts_with('/') {
                    rest.remove(0);
                }
                if !out.is_empty() && !rest.is_empty() {
                    out.push('/');
                }
                out.push_str(&rest);
                out
            } else {
                // Prefix doesn't apply — keep the original topic
                topic.to_string()
            }
        }
        "fixed" => {
            if rule.fixed_topic.trim().is_empty() {
                topic.to_string()
            } else {
                rule.fixed_topic.trim().to_string()
            }
        }
        "regex" => Regex::new(&rule.regex_pattern)
            .ok()
            .and_then(|re| re.replace(topic, rule.regex_replacement.as_str()).into_owned().into())
            .unwrap_or_else(|| topic.to_string()),
        "map" => {
            // Exact rows win, then the first matching wildcard row
            if let Some(e) = rule.topic_map.iter().find(|e| e.from == topic && !e.to.is_empty()) {
                return e.to.clone();
            }
            if let Some(e) = rule
                .topic_map
                .iter()
                .find(|e| !e.to.is_empty() && wildcard_match(&e.from, topic))
            {
                return e.to.clone();
            }
            topic.to_string()
        }
        _ => topic.to_string(),
    }
}

/// True when the topic matches any of the rule's exclusion filters
pub fn is_excluded(rule: &BridgeRule, topic: &str) -> bool {
    rule.exclude_filters
        .iter()
        .any(|f| !f.trim().is_empty() && wildcard_match(f.trim(), topic))
}

/// Apply the rule's payload edits: optional JSON envelope + prefix/suffix.
/// Returns the original bytes untouched when no edits are configured.
pub fn build_payload(rule: &BridgeRule, topic: &str, payload: &Bytes) -> Bytes {
    if rule.payload_prefix.is_empty() && rule.payload_suffix.is_empty() && !rule.wrap_json {
        return payload.clone();
    }
    let body: Vec<u8> = if rule.wrap_json {
        let envelope = match std::str::from_utf8(payload) {
            Ok(text) => serde_json::json!({
                "topic": topic,
                "ts": chrono::Utc::now().timestamp_millis(),
                "payload": text,
            }),
            Err(_) => serde_json::json!({
                "topic": topic,
                "ts": chrono::Utc::now().timestamp_millis(),
                "payload_b64": base64::engine::general_purpose::STANDARD.encode(payload),
            }),
        };
        envelope.to_string().into_bytes()
    } else {
        payload.to_vec()
    };
    let mut out =
        Vec::with_capacity(rule.payload_prefix.len() + body.len() + rule.payload_suffix.len());
    out.extend_from_slice(rule.payload_prefix.as_bytes());
    out.extend_from_slice(&body);
    out.extend_from_slice(rule.payload_suffix.as_bytes());
    Bytes::from(out)
}

fn resolve_qos(rule: &BridgeRule, incoming: u8) -> u8 {
    match rule.qos_mode.as_str() {
        "fixed" => rule.fixed_qos.min(2),
        _ => incoming,
    }
}

fn resolve_retain(rule: &BridgeRule, incoming: bool) -> bool {
    match rule.retain_mode.as_str() {
        "on" => true,
        "off" => false,
        _ => incoming,
    }
}

impl BridgeManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn attach_outbox(self: &Arc<Self>, opened: Result<Arc<crate::outbox::Outbox>, String>) {
        let _ = self.outbox.set(opened);
    }

    fn outbox(&self) -> Option<&Arc<crate::outbox::Outbox>> {
        self.outbox.get().and_then(|r| r.as_ref().ok())
    }

    pub fn outbox_state(&self) -> crate::outbox::OutboxState {
        use crate::outbox::{OutboxState, MAX_ATTEMPTS};
        match self.outbox() {
            Some(outbox) => OutboxState {
                counts: outbox.counts(),
                error: None,
                preview: outbox.preview(12).unwrap_or_default(),
                max_attempts: MAX_ATTEMPTS,
            },
            None => OutboxState {
                counts: Default::default(),
                error: self.outbox_error().or_else(|| Some("no webhook outbox attached".to_string())),
                preview: Vec::new(),
                max_attempts: MAX_ATTEMPTS,
            },
        }
    }

    pub fn outbox_flush(&self, rule_id: Option<&str>) -> Result<u64, String> {
        self.outbox()
            .ok_or_else(|| "the webhook outbox is unavailable".to_string())?
            .flush_now(rule_id)
    }

    pub fn outbox_drop_dead(&self, rule_id: Option<&str>) -> Result<u64, String> {
        self.outbox()
            .ok_or_else(|| "the webhook outbox is unavailable".to_string())?
            .drop_dead(rule_id)
    }

    pub fn outbox_error(&self) -> Option<String> {
        self.outbox.get().and_then(|r| r.as_ref().err().cloned())
    }

    /// Drain what is due and send it. Runs on its own tick so a recovered endpoint
    /// is retried without any user action, and the pump itself can fail silently
    /// only in the sense that the next tick tries again.
    pub async fn pump_outbox(self: &Arc<Self>, app: &AppHandle) {
        let Some(outbox) = self.outbox().cloned() else { return };
        let due = match outbox.due(chrono::Utc::now().timestamp_millis()) {
            Ok(rows) => rows,
            Err(e) => {
                let _ = app.emit("bridge-event-error", e);
                return;
            }
        };
        for entry in due {
            let rule = self.rules.lock().await.get(&entry.rule_id).cloned();
            let Some(rule) = rule else {
                // The rule is gone, so nobody can say where this goes any more.
                let _ = outbox.record_failure(
                    entry.id,
                    crate::outbox::MAX_ATTEMPTS - 1,
                    "the rule was removed while this was queued",
                    chrono::Utc::now().timestamp_millis(),
                );
                continue;
            };
            if !rule.enabled || rule.target_kind != "http" {
                let _ = outbox.record_failure(
                    entry.id,
                    entry.attempts,
                    "the rule is disabled or no longer an HTTP target",
                    chrono::Utc::now().timestamp_millis(),
                );
                continue;
            }
            // The entry says which sink it owes, and only that sink. If the rule has
            // since lost it, the delivery is failed rather than redirected: posting
            // someone's telemetry to whichever endpoint happens to be left is worse
            // than not posting it.
            let sink = match crate::webhook::sink_at(&rule.webhook, &rule.targets, entry.target_index) {
                Some(sink) => sink,
                None => {
                    let _ = outbox.record_failure(
                        entry.id,
                        crate::outbox::MAX_ATTEMPTS - 1,
                        "that sink is no longer on the rule",
                        chrono::Utc::now().timestamp_millis(),
                    );
                    continue;
                }
            };
            let permit = match self.webhook_slots.clone().try_acquire_owned() {
                Ok(permit) => permit,
                Err(_) => continue, // still due on the next tick; nothing is lost
            };
            let client = self.webhook_client.get_or_init(crate::webhook::client).clone();
            let bytes = entry.body.len();
            let body = bytes::Bytes::from(entry.body.clone());
            let outbox2 = outbox.clone();
            let id = entry.id;
            let attempts = entry.attempts;
            let this = self.clone();
            let rule2 = rule.clone();
            let app2 = app.clone();
            tokio::spawn(async move {
                let _permit = permit;
                let now_ms = chrono::Utc::now().timestamp_millis();
                let result = match client {
                    Ok(client) => crate::webhook::deliver(&client, &sink, body).await,
                    Err(e) => Err(e),
                };
                match result {
                    Ok(()) => {
                        let _ = outbox2.record_success(id);
                        this.bump(&rule2.id, true, &entry.topic).await;
                        let _ = app2.emit("bridge-event", BridgeEvent {
                            rule_id: rule2.id.clone(),
                            rule_name: rule2.name.clone(),
                            from_topic: entry.topic.clone(),
                            to_topic: sink.display_target(),
                            bytes,
                            qos: entry.qos,
                            retain: entry.retain,
                            ok: true,
                            error: None,
                            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                        });
                    }
                    Err(e) => {
                        // A failed retry does not move the rule's error counter: that
                        // one counts payloads whose *first* delivery failed. The
                        // attempt history lives on the queued row, which the panel
                        // shows as retries and as the preview's last error.
                        let _ = outbox2.record_failure(id, attempts, &e, now_ms);
                        let _ = app2.emit("bridge-event", BridgeEvent {
                            rule_id: rule2.id.clone(),
                            rule_name: rule2.name.clone(),
                            from_topic: entry.topic.clone(),
                            to_topic: sink.display_target(),
                            bytes,
                            qos: entry.qos,
                            retain: entry.retain,
                            ok: false,
                            error: Some(e),
                            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                        });
                    }
                }
            });
        }
    }

    /// All newline-separated source filters of a rule
    pub fn rule_filters(rule: &BridgeRule) -> Vec<String> {
        rule.source_filter
            .split('\n')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }

    fn desired_filters(
        rules: &HashMap<String, BridgeRule>,
        conn_id: &str,
    ) -> HashMap<String, u8> {
        let mut desired = HashMap::new();
        for rule in rules
            .values()
            .filter(|r| r.enabled && r.source_conn == conn_id)
        {
            let qos = rule.source_qos.min(2);
            for filter in Self::rule_filters(rule) {
                desired
                    .entry(filter)
                    .and_modify(|current: &mut u8| *current = (*current).max(qos))
                    .or_insert(qos);
            }
        }
        desired
    }

    /// Bring every connection's live subscriptions in line with the rules.
    /// One failing SUBSCRIBE must not strand the other connections, so errors
    /// are collected and the first one is reported after every filter is tried.
    async fn resync_subs(self: &Arc<Self>, reconnect: Option<&str>) -> Result<(), String> {
        let _sync = self.subscription_sync.lock().await;
        if let Some(id) = reconnect {
            self.subs.lock().await.remove(id);
        }
        let rules = self.rules.lock().await.clone();
        let conns = self.conns.lock().await.clone();
        let mut failure = None;
        for (id, conn) in conns {
            if !conn.connected.load(Ordering::SeqCst) {
                continue;
            }
            let desired = Self::desired_filters(&rules, &id);
            let current = {
                let mut subs = self.subs.lock().await;
                subs.entry(id.clone()).or_default().clone()
            };
            let mut applied = HashMap::new();
            for (filter, qos) in &desired {
                if current.get(filter) == Some(qos) {
                    applied.insert(filter.clone(), *qos);
                    continue;
                }
                // Re-subscription is cheap and idempotent on reconnect too.
                match conn.client.subscribe(filter, &SubOptions { qos: *qos, ..Default::default() }).await {
                    Ok(()) => {
                        applied.insert(filter.clone(), *qos);
                    }
                    Err(e) => {
                        if failure.is_none() {
                            failure = Some(format!("{filter}: {e}"));
                        }
                    }
                }
            }
            // A filter whose re-subscribe failed keeps its old live subscription
            // and drops out of the cache, so the next sync retries it.
            for filter in current.keys().filter(|f| !desired.contains_key(*f)) {
                conn.client.unsubscribe(filter).await;
            }
            self.subs.lock().await.insert(id, applied);
        }
        failure.map_or(Ok(()), Err)
    }

    pub async fn bridge_status(self: &Arc<Self>) -> Vec<BridgeConnInfo> {
        let conns = self.conns.lock().await;
        let mut out: Vec<BridgeConnInfo> = conns
            .values()
            .map(|c| BridgeConnInfo {
                connected: c.connected.load(Ordering::SeqCst),
                ..c.info.clone()
            })
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    pub async fn diagnostics_snapshot(&self) -> BridgeDiagnostics {
        let conns = self.conns.lock().await;
        let rules = self.rules.lock().await;
        let stats = self.stats.lock().await;
        BridgeDiagnostics {
            total_connections: conns.len(),
            connected_connections: conns
                .values()
                .filter(|c| c.connected.load(Ordering::SeqCst))
                .count(),
            configured_rules: rules.len(),
            enabled_rules: rules.values().filter(|r| r.enabled).count(),
            forwarded: stats.values().map(|s| s.forwarded).sum(),
            errors: stats.values().map(|s| s.errors).sum(),
            dropped: stats.values().map(|s| s.dropped).sum(),
        }
    }

    async fn set_conn_error(&self, id: &str, error: Option<String>) {
        let mut conns = self.conns.lock().await;
        if let Some(conn) = conns.get_mut(id) {
            conn.info.error = error;
        }
    }

    async fn emit_status(self: &Arc<Self>, app: &AppHandle) {
        let _ = app.emit("bridge-status", self.bridge_status().await);
    }

    pub async fn connect(
        self: &Arc<Self>,
        app: AppHandle,
        id: String,
        config: BrokerConfig,
    ) -> Result<(), String> {
        let id = id.trim().to_lowercase();
        if id.is_empty() || id.len() > 12 {
            return Err("Invalid bridge connection id".to_string());
        }
        self.disconnect(&id).await;

        // Unique suffix: bridging two sessions into the same broker with the
        // console's client id would get the older session kicked.
        let mut config = config;
        let suffix: String = uuid::Uuid::new_v4().simple().to_string()[..6].to_string();
        // The suffix is what keeps two bridged sessions apart, so it must survive
        // any length cap: truncate the base instead of the whole string. MQTT 3.1
        // recommends a 23-character id; v5 has no such limit.
        let tail = format!("_b{}", suffix);
        let budget = if config.is_v5() {
            usize::MAX
        } else {
            23usize.saturating_sub(tail.chars().count())
        };
        let base: String = config.client_id.chars().take(budget).collect();
        let base = if base.trim().is_empty() { "dropqtt".to_string() } else { base };
        config.client_id = format!("{}{}", base, tail);

        let (client, mut eventloop) = build_connection(&config)?;
        let connected = Arc::new(AtomicBool::new(false));

        let info = BridgeConnInfo {
            id: id.clone(),
            connected: false,
            broker_host: config.host.clone(),
            broker_port: config.port,
            client_id: config.client_id.clone(),
            error: None,
        };

        self.conns.lock().await.insert(
            id.clone(),
            BridgeConn {
                client: client.clone(),
                connected: connected.clone(),
                info,
            },
        );

        let this = self.clone();
        let app_handle = app.clone();
        let shutdown = Arc::new(AtomicBool::new(false));
        let flag = shutdown.clone();
        let conn_id = id.clone();

        let handle = tokio::spawn(async move {
            while !flag.load(Ordering::SeqCst) {
                match eventloop.poll().await {
                    NetEvent::Connected(_) => {
                        let first = !connected.swap(true, Ordering::SeqCst);
                        this.set_conn_error(&conn_id, None).await;
                        // Re-apply rule-driven subscriptions after (re)CONNACK
                        // Poll must keep draining the bounded rumqttc request
                        // channel, even with hundreds of restored subscriptions.
                        let sync = this.clone();
                        let sync_id = conn_id.clone();
                        let sync_app = app_handle.clone();
                        tokio::spawn(async move {
                            if let Err(e) = sync.resync_subs(Some(&sync_id)).await {
                                sync.set_conn_error(&sync_id, Some(e)).await;
                                sync.emit_status(&sync_app).await;
                            }
                        });
                        if first {
                            let _ = app_handle.emit("bridge-connected", conn_id.clone());
                        }
                        this.emit_status(&app_handle).await;
                    }
                    NetEvent::ConnectionError(e) => {
                        if connected.swap(false, Ordering::SeqCst) {
                            this.emit_status(&app_handle).await;
                        }
                        this.set_conn_error(&conn_id, Some(e)).await;
                        this.emit_status(&app_handle).await;
                        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    }
                    NetEvent::Publish(publish) => {
                        this.route(&app_handle, &conn_id, publish).await;
                    }
                    // Bridge links forward; nothing here waits on a publish ack.
                    NetEvent::PublishAcked { .. } => {}
                    NetEvent::SubAck { .. } | NetEvent::UnsubAck { .. } => {
                        // Attribution needs the filter each ack answers, which is
                        // the console's registry, not a bridge link's. A refused
                        // bridge subscription surfaces as its own dropped traffic.
                    }
                    NetEvent::AckRejected { stage, code, text } => {
                        // rumqttc drops the link on a refusal, so the bridge status
                        // has to carry the reason or the link just looks unstable.
                        let message = format!(
                            "{stage:?} refused by the broker: {text} (0x{code:02X})"
                        );
                        if connected.swap(false, Ordering::SeqCst) {
                            this.emit_status(&app_handle).await;
                        }
                        this.set_conn_error(&conn_id, Some(message)).await;
                        this.emit_status(&app_handle).await;
                        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    }
                    NetEvent::Other => {}
                }
            }
        });

        self.tasks.lock().await.insert(id, (handle, shutdown));
        self.emit_status(&app).await;
        Ok(())
    }

    pub async fn disconnect(&self, id: &str) {
        let control = self.tasks.lock().await.remove(id);
        let conn = self.conns.lock().await.remove(id);
        let handle = if let Some((handle, flag)) = control {
            flag.store(true, Ordering::SeqCst);
            Some(handle)
        } else {
            None
        };
        if let Some(conn) = conn {
            conn.connected.store(false, Ordering::SeqCst);
            let _ = conn.client.disconnect().await;
        }
        if let Some(mut handle) = handle {
            if tokio::time::timeout(std::time::Duration::from_millis(500), &mut handle).await.is_err() {
                handle.abort();
                let _ = handle.await;
            }
        }
        self.subs.lock().await.remove(id);
    }

    pub async fn disconnect_all(&self) {
        let ids: Vec<String> = self.conns.lock().await.keys().cloned().collect();
        for id in ids {
            self.disconnect(&id).await;
        }
    }

    /// Replace the full rule set (frontend owns persistence)
    pub async fn sync_rules(self: &Arc<Self>, app: AppHandle, rules: Vec<BridgeRule>) -> Result<(), String> {
        for r in &rules {
            let filters = Self::rule_filters(r);
            if filters.is_empty() {
                return Err(format!("Rule '{}' has an empty source filter", r.name));
            }
            if !matches!(r.target_kind.as_str(), "mqtt" | "http") {
                return Err("Unknown bridge target kind".into());
            }
            if r.target_kind == "http" && r.enabled {
                if r.targets.len() > webhook::MAX_EXTRA_TARGETS {
                    return Err(format!(
                        "Rule '{}' fans out to {} extra sinks; the limit is {}",
                        r.name,
                        r.targets.len(),
                        webhook::MAX_EXTRA_TARGETS
                    ));
                }
                // The primary may be left blank when the rule only archives, but then
                // at least one extra sink has to exist — an HTTP rule that delivers
                // nowhere is a rule that silently eats traffic.
                let primary = r.webhook.url.trim();
                if !primary.is_empty() {
                    r.webhook.validate()?;
                } else if r.targets.is_empty() {
                    return Err(format!("Rule '{}' has no webhook target to deliver to", r.name));
                }
                for (i, t) in r.targets.iter().enumerate() {
                    t.validate()
                        .map_err(|e| format!("Rule '{}' extra sink #{}: {}", r.name, i + 1, e))?;
                }
            }
            if r.target_kind == "mqtt" && r.source_conn == r.target_conn {
                return Err(format!("Rule '{}' must use two different connections", r.name));
            }
            if r.topic_mode == "fixed" && r.fixed_topic.trim().is_empty() {
                return Err(format!("Rule '{}' uses fixed-topic mode without a target topic", r.name));
            }
            if r.topic_mode == "map" && r.topic_map.iter().all(|e| e.from.trim().is_empty() || e.to.trim().is_empty()) {
                return Err(format!("Rule '{}' has an empty topic mapping table", r.name));
            }
            if r.topic_mode == "regex" && !r.regex_pattern.is_empty() {
                Regex::new(&r.regex_pattern)
                    .map_err(|e| format!("Rule '{}' has an invalid regex: {}", r.name, e))?;
            }
            let script = r.transform_script.trim();
            if script.len() > SCRIPT_SIZE_LIMIT {
                return Err(format!("Rule '{}' script exceeds {} B", r.name, SCRIPT_SIZE_LIMIT));
            }
            if !script.is_empty() && !script.contains("function transform") {
                return Err(format!(
                    "Rule '{}' script must define function transform(topic, payload, qos, retain)",
                    r.name
                ));
            }
        }
        let map: HashMap<String, BridgeRule> = rules.into_iter().map(|r| (r.id.clone(), r)).collect();

        // Purge stats / rate windows of removed rules
        {
            let mut stats = self.stats.lock().await;
            stats.retain(|id, _| map.contains_key(id));
            let mut gates = self.gates.lock().await;
            gates.retain(|id, _| map.contains_key(id));
        }
        *self.rules.lock().await = map;
        self.resync_subs(None).await?;
        let _ = app.emit("bridge-rules-synced", ());
        Ok(())
    }

    pub async fn stats(self: &Arc<Self>) -> HashMap<String, BridgeRuleStats> {
        let mut stats = self.stats.lock().await.clone();
        // The queue lives in SQLite, so its numbers are merged in on read rather
        // than incremented on every attempt: a restart then still reports the truth.
        if let Some(outbox) = self.outbox() {
            for (id, entry) in stats.iter_mut() {
                let counts = outbox.counts_for(id);
                entry.queued = counts.pending;
                entry.dead = counts.dead;
            }
        }
        stats
    }

    pub async fn reset_stats(self: &Arc<Self>) {
        let rules: Vec<String> = self.rules.lock().await.keys().cloned().collect();
        let mut stats = self.stats.lock().await;
        stats.clear();
        for id in rules {
            stats.insert(id, BridgeRuleStats::default());
        }
    }

    async fn bump(&self, rule_id: &str, ok: bool, topic: &str) {
        let mut stats = self.stats.lock().await;
        let entry = stats.entry(rule_id.to_string()).or_default();
        if ok {
            entry.forwarded += 1;
        } else {
            entry.errors += 1;
        }
        entry.last_topic = topic.to_string();
    }

    async fn bump_dropped(&self, rule_id: &str, topic: &str) {
        let mut stats = self.stats.lock().await;
        let entry = stats.entry(rule_id.to_string()).or_default();
        entry.dropped += 1;
        entry.last_topic = topic.to_string();
    }

    /// True when the rule's per-second budget still has room (0 = unlimited)
    async fn rate_allow(&self, rule_id: &str, limit: u32) -> bool {
        if limit == 0 {
            return true;
        }
        let now = chrono::Utc::now().timestamp().max(0) as u64;
        let mut gates = self.gates.lock().await;
        let window = gates.entry(rule_id.to_string()).or_default();
        gate_allow(window, now, limit)
    }

    async fn route(self: &Arc<Self>, app: &AppHandle, src_id: &str, publish: NormalizedPublish) {
        let rules = self.rules.lock().await.clone();
        if rules.is_empty() {
            return;
        }
        let conns = self.conns.lock().await.clone();

        for rule in rules.values() {
            if !rule.enabled || rule.source_conn != src_id {
                continue;
            }
            // Any of the rule's (possibly multi-line) filters matches -> proceed
            if !Self::rule_filters(rule)
                .iter()
                .any(|f| wildcard_match(f, &publish.topic))
            {
                continue;
            }
            // Exclusion sub-filters carve topics out of a broad wildcard rule
            if is_excluded(rule, &publish.topic) {
                self.bump_dropped(&rule.id, &publish.topic).await;
                continue;
            }
            // Loop guard: never bounce a message back onto the same topic it
            // arrived on (would ping-pong through the same connection).
            let target_topic = map_topic(rule, &publish.topic);
            if rule.target_kind == "mqtt" && rule.target_conn == src_id && target_topic == publish.topic {
                continue;
            }
            if !self.rate_allow(&rule.id, rule.rate_limit).await {
                self.bump_dropped(&rule.id, &publish.topic).await;
                continue;
            }
            let qos = resolve_qos(rule, publish.qos);
            let retain = resolve_retain(rule, publish.retain);
            let props = if rule.forward_props
                && (publish.content_type.is_some()
                    || !publish.user_properties.is_empty()
                    || publish.response_topic.is_some()
                    || publish.correlation_data.is_some()
                    || publish.payload_format.is_some())
            {
                Some(PubProperties {
                    content_type: publish.content_type.clone(),
                    user_properties: publish.user_properties.clone(),
                    message_expiry: None,
                    response_topic: publish.response_topic.clone(),
                    // Bytes in, bytes out: text only when the device's correlation
                    // actually is text, hex when it is not.
                    correlation_data: publish
                        .correlation_data
                        .as_deref()
                        .and_then(|b| std::str::from_utf8(b).ok())
                        .map(str::to_string),
                    correlation_hex: publish
                        .correlation_data
                        .as_deref()
                        .filter(|b| std::str::from_utf8(b).is_err())
                        .map(hex::encode),
                    // The payload-format flag describes the bytes themselves, so it
                    // survives a hop. A topic alias is only meaningful within the
                    // connection that registered it, so it is deliberately not
                    // forwarded: the target link has its own alias space.
                    payload_format: publish.payload_format,
                    topic_alias: None,
                })
            } else {
                None
            };

            // Static edits first (prefix/suffix/envelope), then the JS transform
            // overrides everything when configured.
            let mut payload_out = build_payload(rule, &publish.topic, &publish.payload);
            let mut payload_len = payload_out.len();

            // JS transform wins over static payload edits when configured
            if !rule.transform_script.trim().is_empty() {
                // rquickjs is a synchronous interpreter. Running it inline would
                // hold this tokio worker for the whole script deadline, so a
                // single slow rule could stall every other subscription in the
                // process. Offload it, but keep waiting for the result: the
                // bridge's ordering per message must not change.
                let script = rule.transform_script.trim().to_string();
                let in_topic = publish.topic.clone();
                let in_payload = payload_out.clone();
                let outcome = tokio::task::spawn_blocking(move || {
                    apply_transform(&script, &in_topic, &in_payload, qos, retain)
                })
                .await
                .unwrap_or_else(|_| Err("transform worker panicked".to_string()));
                match outcome {
                    Ok(TransformOutcome::Send(b)) => {
                        payload_len = b.len();
                        payload_out = b;
                    }
                    Ok(TransformOutcome::Drop) => {
                        self.bump_dropped(&rule.id, &publish.topic).await;
                        continue;
                    }
                    Err(e) => {
                        self.bump(&rule.id, false, &publish.topic).await;
                        let _ = app.emit(
                            "bridge-event",
                            BridgeEvent {
                                rule_id: rule.id.clone(),
                                rule_name: rule.name.clone(),
                                from_topic: publish.topic.clone(),
                                to_topic: target_topic.clone(),
                                bytes: 0,
                                qos,
                                retain,
                                ok: false,
                                error: Some(e),
                                timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                            },
                        );
                        continue;
                    }
                }
            }

            if rule.target_kind == "http" {
                // One attempt per sink, each with its own body encoding (a raw POST
                // to the archive and a JSON envelope to the API are the same message
                // with different bytes) and its own queue entry if it fails.
                for (index, sink) in webhook::sinks_with_indexes(&rule.webhook, &rule.targets) {
                    let permit = match self.webhook_slots.clone().try_acquire_owned() {
                        Ok(permit) => permit,
                        Err(_) => { self.bump_dropped(&rule.id, &publish.topic).await; continue; }
                    };
                    let body = webhook::encode_body(&sink, &target_topic, &payload_out, qos, retain);
                    if body.len() > 2 * 1024 * 1024 {
                        self.bump_dropped(&rule.id, &publish.topic).await;
                        continue;
                    }
                    let this = self.clone();
                    let app = app.clone();
                    let rule = rule.clone();
                    let from_topic = publish.topic.clone();
                    let client = self.webhook_client.get_or_init(webhook::client).clone();
                    let queued = this.outbox().map(|_| body.clone());
                    tokio::spawn(async move {
                        let _permit = permit;
                        let bytes = body.len();
                        let result = match client {
                            Ok(client) => webhook::deliver(&client, &sink, body).await,
                            Err(e) => Err(e),
                        };
                        // A failed delivery is queued rather than counted and
                        // forgotten. The error counter still moves, because the
                        // attempt did fail.
                        if let (Err(_), Some(outbox), Some(body)) = (&result, this.outbox().cloned(), queued) {
                            let entry = crate::outbox::OutboxEntry {
                                id: 0,
                                rule_id: rule.id.clone(),
                                topic: from_topic.clone(),
                                body: body.to_vec(),
                                qos,
                                retain,
                                attempts: 0,
                                target_index: index,
                            };
                            let _ = outbox.enqueue(&entry, chrono::Utc::now().timestamp_millis());
                        }
                        this.bump(&rule.id, result.is_ok(), &from_topic).await;
                        let _ = app.emit("bridge-event", BridgeEvent {
                            rule_id: rule.id, rule_name: rule.name, from_topic,
                            to_topic: sink.display_target(), bytes, qos, retain,
                            ok: result.is_ok(), error: result.err(),
                            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                        });
                    });
                }
                continue;
            }

            let target = match conns.get(&rule.target_conn) {
                Some(c) => c.client.clone(),
                None => {
                    // Every other exit in this loop accounts for what it did.
                    // Silently skipping here is the worst failure mode a bridge
                    // can have: the rule reads as enabled with a clean zero-error
                    // stat while the data goes nowhere.
                    self.bump(&rule.id, false, &publish.topic).await;
                    let _ = app.emit(
                        "bridge-event",
                        BridgeEvent {
                            rule_id: rule.id.clone(),
                            rule_name: rule.name.clone(),
                            from_topic: publish.topic.clone(),
                            to_topic: target_topic.clone(),
                            bytes: 0,
                            qos,
                            retain,
                            ok: false,
                            error: Some(format!(
                                "target connection '{}' is not connected",
                                rule.target_conn
                            )),
                            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                        },
                    );
                    continue;
                }
            };
            let result = target
                .publish(&target_topic, qos, retain, payload_out, props.as_ref())
                .await;

            let (ok, error) = match result {
                Ok(_) => (true, None),
                Err(e) => (false, Some(e)),
            };
            self.bump(&rule.id, ok, &publish.topic).await;

            let _ = app.emit(
                "bridge-event",
                BridgeEvent {
                    rule_id: rule.id.clone(),
                    rule_name: rule.name.clone(),
                    from_topic: publish.topic.clone(),
                    to_topic: target_topic,
                    bytes: payload_len,
                    qos,
                    retain,
                    ok,
                    error,
                    timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                },
            );
        }
    }
}

/// Convenience alias for the managed state handle
pub type SharedBridge = Arc<BridgeManager>;

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(mode: &str, from: &str, to: &str) -> BridgeRule {
        BridgeRule {
            id: "r1".into(),
            name: "t".into(),
            source_conn: "src".into(),
            source_filter: "a/#".into(),
            source_qos: 1,
            target_conn: "dst".into(),
            target_kind: "mqtt".into(),
            webhook: WebhookConfig::default(),
            targets: Vec::new(),
            topic_mode: mode.into(),
            prefix_from: from.into(),
            prefix_to: to.into(),
            fixed_topic: String::new(),
            regex_pattern: String::new(),
            regex_replacement: String::new(),
            topic_map: Vec::new(),
            transform_script: String::new(),
            exclude_filters: Vec::new(),
            payload_prefix: String::new(),
            payload_suffix: String::new(),
            wrap_json: false,
            rate_limit: 0,
            qos_mode: "source".into(),
            fixed_qos: 0,
            retain_mode: "source".into(),
            forward_props: false,
            enabled: true,
        }
    }

    #[test]
    fn topic_same_passthrough() {
        let r = rule("same", "", "");
        assert_eq!(map_topic(&r, "sensor/1/data"), "sensor/1/data");
    }

    #[test]
    fn topic_prefix_replacement() {
        let r = rule("prefix", "home/bedroom", "office");
        assert_eq!(map_topic(&r, "home/bedroom/temp"), "office/temp");
        assert_eq!(map_topic(&r, "home/bedroom"), "office");
        // Non-matching prefix keeps the topic untouched
        assert_eq!(map_topic(&r, "kitchen/light"), "kitchen/light");
    }

    #[test]
    fn topic_prefix_slash_join() {
        let r = rule("prefix", "a", "x/y");
        assert_eq!(map_topic(&r, "a/b/c"), "x/y/b/c");
        let r2 = rule("prefix", "a", "x/");
        assert_eq!(map_topic(&r2, "a/b"), "x/b");
    }

    #[test]
    fn qos_and_retain_resolution() {
        let mut r = rule("same", "", "");
        r.qos_mode = "fixed".into();
        r.fixed_qos = 5; // clamped
        assert_eq!(resolve_qos(&r, 0), 2);
        r.qos_mode = "source".into();
        assert_eq!(resolve_qos(&r, 1), 1);

        r.retain_mode = "on".into();
        assert!(resolve_retain(&r, false));
        r.retain_mode = "off".into();
        assert!(!resolve_retain(&r, true));
        r.retain_mode = "source".into();
        assert!(resolve_retain(&r, true));
    }

    #[test]
    fn topic_fixed_aggregation() {
        let mut r = rule("fixed", "", "");
        r.fixed_topic = "all/aggregate".into();
        assert_eq!(map_topic(&r, "sensor/1/data"), "all/aggregate");
        // Empty fixed topic keeps the original (defensive)
        r.fixed_topic = "".into();
        assert_eq!(map_topic(&r, "sensor/1/data"), "sensor/1/data");
    }

    #[test]
    fn topic_regex_capture_groups() {
        let mut r = rule("regex", "", "");
        r.regex_pattern = r"^sensor/(\w+)/data$".into();
        r.regex_replacement = "up.$1".into();
        assert_eq!(map_topic(&r, "sensor/abc/data"), "up.abc");
        // Non-matching topics and invalid patterns keep the original
        assert_eq!(map_topic(&r, "other/topic"), "other/topic");
        r.regex_pattern = "([".into();
        assert_eq!(map_topic(&r, "sensor/abc/data"), "sensor/abc/data");
    }

    #[test]
    fn exclusion_carves_out_wildcard_scope() {
        let mut r = rule("same", "", "");
        r.exclude_filters = vec!["a/private/#".into(), "a/exact".into()];
        assert!(is_excluded(&r, "a/private/secret"));
        assert!(is_excluded(&r, "a/exact"));
        assert!(!is_excluded(&r, "a/public/data"));
    }

    #[test]
    fn multi_line_source_filters_subscribe_every_row() {
        let mut r = rule("same", "", "");
        r.source_filter = "/device/2\n/device/4\n".into();
        assert_eq!(
            BridgeManager::rule_filters(&r),
            vec!["/device/2".to_string(), "/device/4".to_string()]
        );
        let mut rules = HashMap::new();
        rules.insert("r1".into(), r);
        let desired = BridgeManager::desired_filters(&rules, "src");
        assert_eq!(
            desired,
            HashMap::from([
                ("/device/2".to_string(), 1),
                ("/device/4".to_string(), 1),
            ])
        );
    }

    #[test]
    fn source_qos_is_applied_and_duplicate_filters_keep_highest_qos() {
        let mut rules = HashMap::new();
        let mut low = rule("same", "", "");
        low.id = "low".into();
        low.source_filter = "sensor/#".into();
        low.source_qos = 0;
        let mut high = rule("same", "", "");
        high.id = "high".into();
        high.source_filter = "sensor/#".into();
        high.source_qos = 2;
        rules.insert(low.id.clone(), low);
        rules.insert(high.id.clone(), high);

        let desired = BridgeManager::desired_filters(&rules, "src");
        assert_eq!(desired.get("sensor/#"), Some(&2));
    }

    #[test]
    fn topic_map_exact_then_wildcard() {
        let mut r = rule("map", "", "");
        r.topic_map = vec![
            TopicMapEntry { from: "/device/2".into(), to: "/device/20".into() },
            TopicMapEntry { from: "/device/4".into(), to: "/device/40".into() },
            TopicMapEntry { from: "legacy/#".into(), to: "modern/all".into() },
        ];
        assert_eq!(map_topic(&r, "/device/2"), "/device/20");
        assert_eq!(map_topic(&r, "/device/4"), "/device/40");
        assert_eq!(map_topic(&r, "legacy/any/deep"), "modern/all");
        // Unmapped topics pass through unchanged
        assert_eq!(map_topic(&r, "/device/99"), "/device/99");
    }

    #[test]
    fn payload_passthrough_when_no_edits() {
        let r = rule("same", "", "");
        let p = Bytes::from_static(b"hello");
        assert_eq!(build_payload(&r, "t", &p), p);
    }

    #[test]
    fn payload_prefix_and_suffix() {
        let mut r = rule("same", "", "");
        r.payload_prefix = "[brg] ".into();
        r.payload_suffix = "\n".into();
        let p = Bytes::from_static(b"hi");
        assert_eq!(build_payload(&r, "t", &p), Bytes::from_static(b"[brg] hi\n"));
    }

    #[test]
    fn payload_json_envelope_text_and_binary() {
        let mut r = rule("same", "", "");
        r.wrap_json = true;
        let text = build_payload(&r, "s/t", &Bytes::from_static(b"42"));
        let v: serde_json::Value = serde_json::from_slice(&text).unwrap();
        assert_eq!(v["topic"], "s/t");
        assert_eq!(v["payload"], "42");
        assert!(v["ts"].is_i64());

        // Non-UTF-8 bytes ride the envelope as base64
        let bin = build_payload(&r, "s/t", &Bytes::from_static(&[0xFF, 0xFE]));
        let v: serde_json::Value = serde_json::from_slice(&bin).unwrap();
        assert_eq!(v["payload_b64"], "//4=");
    }

    #[test]
    fn rate_window_allows_up_to_limit_per_second() {
        let mut w = RateWindow::default();
        assert!(gate_allow(&mut w, 100, 2));
        assert!(gate_allow(&mut w, 100, 2));
        assert!(!gate_allow(&mut w, 100, 2)); // budget exhausted in window
        assert!(gate_allow(&mut w, 101, 2)); // next second resets
        // limit 0 = unlimited
        let mut w0 = RateWindow::default();
        for _ in 0..1000 {
            assert!(gate_allow(&mut w0, 7, 0));
        }
    }

    #[test]
    fn desired_filters_only_enabled_sources() {
        let mut rules = HashMap::new();
        let mut r1 = rule("same", "", "");
        r1.id = "r1".into();
        r1.source_filter = "s/+/temp".into();
        let mut r2 = rule("same", "", "");
        r2.id = "r2".into();
        r2.source_conn = "dst".into();
        let mut r3 = rule("same", "", "");
        r3.id = "r3".into();
        r3.enabled = false;
        rules.insert("r1".into(), r1);
        rules.insert("r2".into(), r2);
        rules.insert("r3".into(), r3);

        let desired = BridgeManager::desired_filters(&rules, "src");
        assert_eq!(desired, HashMap::from([("s/+/temp".to_string(), 1)]));
    }

    #[test]
    fn rule_serde_camel_case_roundtrip() {
        let json = r#"{"id":"r1","name":"n","sourceConn":"src","sourceFilter":"a/#","sourceQos":1,"targetConn":"dst","topicMode":"prefix","prefixFrom":"a","prefixTo":"b","qosMode":"source","fixedQos":0,"retainMode":"source","forwardProps":true,"enabled":true}"#;
        let r: BridgeRule = serde_json::from_str(json).expect("parse rule");
        assert_eq!(r.source_filter, "a/#");
        assert!(r.forward_props);
        assert_eq!(map_topic(&r, "a/x"), "b/x");
    }
}
