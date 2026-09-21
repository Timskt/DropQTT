//! Broker-to-broker message forwarding (MQTT bridge).
//!
//! Completely independent from the main console session: the bridge owns its
//! own set of named connections (typically "src" and "dst") and a list of
//! forwarding rules. Any inbound publish on a source connection that matches
//! an enabled rule's topic filter is republished verbatim (payload bytes
//! untouched) onto the target connection, with optional topic remapping and
//! QoS/retain policies.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use base64::Engine;
use bytes::Bytes;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::mqtt_manager::wildcard_match;
use crate::protocol::{BrokerConfig, PubProperties};
use crate::transform::{apply_transform, TransformOutcome, SCRIPT_SIZE_LIMIT};
use crate::transport::{build_connection, MqttClient, NetEvent, NormalizedPublish};

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

#[derive(Default)]
pub struct BridgeManager {
    conns: Mutex<HashMap<String, BridgeConn>>,
    tasks: Mutex<HashMap<String, LoopControl>>,
    rules: Mutex<HashMap<String, BridgeRule>>,
    stats: Mutex<HashMap<String, BridgeRuleStats>>,
    gates: Mutex<HashMap<String, RateWindow>>,
    /// Currently registered subscription filters per connection
    subs: Mutex<HashMap<String, HashSet<String>>>,
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

    /// All newline-separated source filters of a rule
    pub fn rule_filters(rule: &BridgeRule) -> Vec<String> {
        rule.source_filter
            .split('\n')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }

    fn desired_filters(rules: &HashMap<String, BridgeRule>, conn_id: &str) -> HashSet<String> {
        rules
            .values()
            .filter(|r| r.enabled && r.source_conn == conn_id)
            .flat_map(Self::rule_filters)
            .collect()
    }

    /// Bring every connection's live subscriptions in line with the rules
    async fn resync_subs(self: &Arc<Self>) -> Result<(), String> {
        let rules = self.rules.lock().await.clone();
        let conns = self.conns.lock().await.clone();
        for (id, conn) in conns {
            if !conn.connected.load(Ordering::SeqCst) {
                continue;
            }
            let desired = Self::desired_filters(&rules, &id);
            let current = {
                let mut subs = self.subs.lock().await;
                subs.entry(id.clone()).or_default().clone()
            };
            for filter in desired.difference(&current) {
                // Re-subscription is cheap and idempotent on reconnect too.
                let _ = conn.client.subscribe(filter, 1).await;
            }
            for filter in current.difference(&desired) {
                conn.client.unsubscribe(filter).await;
            }
            let mut subs = self.subs.lock().await;
            if let Some(entry) = subs.get_mut(&id) {
                *entry = desired;
            } else {
                subs.insert(id, desired);
            }
        }
        Ok(())
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
        config.client_id = format!("{}_b{}", config.client_id, suffix)
            .chars()
            .take(23)
            .collect();

        let (client, mut eventloop) = build_connection(&config);
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
                    NetEvent::Connected => {
                        let first = !connected.swap(true, Ordering::SeqCst);
                        this.set_conn_error(&conn_id, None).await;
                        // Re-apply rule-driven subscriptions after (re)CONNACK
                        if let Err(e) = this.resync_subs().await {
                            eprintln!("bridge resync failed: {}", e);
                        }
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
                    NetEvent::Other => {}
                }
            }
        });

        self.tasks.lock().await.insert(id, (handle, shutdown));
        self.emit_status(&app).await;
        Ok(())
    }

    pub async fn disconnect(&self, id: &str) {
        if let Some((handle, flag)) = self.tasks.lock().await.remove(id) {
            flag.store(true, Ordering::SeqCst);
            handle.abort();
        }
        if let Some(conn) = self.conns.lock().await.remove(id) {
            conn.connected.store(false, Ordering::SeqCst);
            conn.client.disconnect().await;
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
            if r.source_conn == r.target_conn {
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
        self.resync_subs().await?;
        let _ = app.emit("bridge-rules-synced", ());
        Ok(())
    }

    pub async fn stats(self: &Arc<Self>) -> HashMap<String, BridgeRuleStats> {
        self.stats.lock().await.clone()
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
            if rule.target_conn == src_id && target_topic == publish.topic {
                continue;
            }
            if !self.rate_allow(&rule.id, rule.rate_limit).await {
                self.bump_dropped(&rule.id, &publish.topic).await;
                continue;
            }
            let target = match conns.get(&rule.target_conn) {
                Some(c) => c.client.clone(),
                None => continue,
            };

            let qos = resolve_qos(rule, publish.qos);
            let retain = resolve_retain(rule, publish.retain);
            let props = if rule.forward_props
                && (publish.content_type.is_some() || !publish.user_properties.is_empty())
            {
                Some(PubProperties {
                    content_type: publish.content_type.clone(),
                    user_properties: publish.user_properties.clone(),
                    message_expiry: None,
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
                match apply_transform(
                    rule.transform_script.trim(),
                    &publish.topic,
                    &payload_out,
                    qos,
                    retain,
                ) {
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
        assert_eq!(desired, HashSet::from(["/device/2".to_string(), "/device/4".to_string()]));
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
        assert_eq!(desired, HashSet::from(["s/+/temp".to_string()]));
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
