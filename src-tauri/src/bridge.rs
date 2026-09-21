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

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::mqtt_manager::wildcard_match;
use crate::protocol::{BrokerConfig, PubProperties};
use crate::transport::{build_connection, MqttClient, NetEvent, NormalizedPublish};

/// One forwarding rule: source topic filter -> target connection + topic map
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRule {
    pub id: String,
    pub name: String,
    /// Logical connection id acting as the source ("src" | "dst")
    pub source_conn: String,
    /// Source topic filter; '+' / '#' wildcards allowed
    pub source_filter: String,
    /// Subscription QoS applied on the source connection
    #[serde(default = "default_qos1")]
    pub source_qos: u8,
    /// Logical connection id receiving the forwarded publish
    pub target_conn: String,
    /// "same" (keep original topic) | "prefix" (replace prefix)
    #[serde(default = "default_topic_mode")]
    pub topic_mode: String,
    #[serde(default)]
    pub prefix_from: String,
    #[serde(default)]
    pub prefix_to: String,
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

/// Eventloop task handle + cooperative shutdown flag
pub type LoopControl = (JoinHandle<()>, Arc<AtomicBool>);

#[derive(Default)]
pub struct BridgeManager {
    conns: Mutex<HashMap<String, BridgeConn>>,
    tasks: Mutex<HashMap<String, LoopControl>>,
    rules: Mutex<HashMap<String, BridgeRule>>,
    stats: Mutex<HashMap<String, BridgeRuleStats>>,
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
        _ => topic.to_string(),
    }
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

    fn desired_filters(rules: &HashMap<String, BridgeRule>, conn_id: &str) -> HashSet<String> {
        rules
            .values()
            .filter(|r| r.enabled && r.source_conn == conn_id && !r.source_filter.trim().is_empty())
            .map(|r| r.source_filter.trim().to_string())
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
            if r.source_filter.trim().is_empty() {
                return Err(format!("Rule '{}' has an empty source filter", r.name));
            }
            if r.source_conn == r.target_conn {
                return Err(format!("Rule '{}' must use two different connections", r.name));
            }
        }
        let map: HashMap<String, BridgeRule> = rules.into_iter().map(|r| (r.id.clone(), r)).collect();

        // Purge stats of removed rules
        {
            let mut stats = self.stats.lock().await;
            stats.retain(|id, _| map.contains_key(id));
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
            if !wildcard_match(&rule.source_filter, &publish.topic) {
                continue;
            }
            let target_topic = map_topic(rule, &publish.topic);
            // Loop guard: never bounce a message back onto the same topic it
            // arrived on (would ping-pong through the same connection).
            if rule.target_conn == src_id && target_topic == publish.topic {
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

            let payload_len = publish.payload.len();
            let result = target
                .publish(&target_topic, qos, retain, publish.payload.clone(), props.as_ref())
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
