//! Silence watchdog — the field-ops question MQTT clients generally cannot
//! answer: "has this device stopped talking?".
//!
//! A rule watches a topic filter and raises an alert once the filter has seen
//! no traffic for `timeoutSec`, then repeats at most every `cooldownSec`.
//! Alerts go out through the same bounded HTTP sink as bridge webhooks.
//!
//! Deliberately synchronous and lock-light: `observe` runs on the inbound
//! publish path, so it must never await while holding a lock. Callers evaluate
//! on a timer and deliver the returned alerts outside this module.
//!
//! Every method that can advance or reset a timer takes `now_sec` from the
//! caller: a module that read the wall clock internally while the rest of the
//! API took an injected time could not be tested deterministically.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::topic::wildcard_match;
use crate::webhook::WebhookConfig;

/// Last-seen timestamps have one-second resolution, so a shorter threshold
/// would fire spuriously.
pub const MIN_TIMEOUT_SEC: u64 = 5;

fn default_timeout() -> u64 {
    60
}
fn default_cooldown() -> u64 {
    300
}
fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceRule {
    pub id: String,
    pub name: String,
    /// Topic filter; `+` / `#` wildcards allowed, `$` topics need an explicit
    /// leading `$` (RFC 3.1.1 §4.7).
    pub topic_filter: String,
    /// Raise an alert after this many seconds without a matching publish.
    #[serde(default = "default_timeout")]
    pub timeout_sec: u64,
    /// Minimum gap between two alerts for the same ongoing outage.
    #[serde(default = "default_cooldown")]
    pub cooldown_sec: u64,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Where to POST the alert.
    #[serde(default)]
    pub webhook: WebhookConfig,
}

/// A rule that has gone silent and is not in cooldown.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceAlert {
    pub rule_id: String,
    pub rule_name: String,
    pub topic_filter: String,
    pub timeout_sec: u64,
    /// 0 when nothing matched since the watchdog was armed.
    pub last_seen_sec: i64,
    pub silent_for_sec: i64,
    pub webhook: WebhookConfig,
}

#[derive(Default)]
pub struct SilenceWatchdog {
    rules: Mutex<HashMap<String, SilenceRule>>,
    /// Last observation **per rule**, not per topic: the topic-stats table is
    /// LRU-evicted and would delete precisely the silent topics we care about.
    last_seen: Mutex<HashMap<String, i64>>,
    fired_at: Mutex<HashMap<String, i64>>,
    /// Only armed while a broker connection is live, so a reconnect gap is not
    /// mistaken for a device outage.
    armed: Mutex<bool>,
}

impl SilenceWatchdog {
    /// Validate and replace the whole rule set (same lifecycle as bridge rules:
    /// the frontend owns persistence, the backend only ever sees a full set).
    pub fn sync_rules(&self, rules: Vec<SilenceRule>, now_sec: i64) -> Result<(), String> {
        let mut map = HashMap::new();
        for rule in rules {
            if rule.name.trim().is_empty() {
                return Err("Silence rule needs a name".into());
            }
            if rule.topic_filter.trim().is_empty() {
                return Err(format!("Rule '{}' has an empty topic filter", rule.name));
            }
            if rule.timeout_sec < MIN_TIMEOUT_SEC {
                return Err(format!(
                    "Rule '{}' timeout must be at least {} seconds",
                    rule.name, MIN_TIMEOUT_SEC
                ));
            }
            if rule.cooldown_sec < MIN_TIMEOUT_SEC {
                return Err(format!(
                    "Rule '{}' cooldown must be at least {} seconds",
                    rule.name, MIN_TIMEOUT_SEC
                ));
            }
            // Only enforced while enabled, so a saved-but-disabled rule can keep
            // a redacted webhook after import.
            if rule.enabled {
                rule.webhook.validate()?;
            }
            map.insert(rule.id.clone(), rule);
        }

        {
            let mut last = self.last_seen.lock().map_err(|_| "watchdog state poisoned")?;
            let mut fired = self.fired_at.lock().map_err(|_| "watchdog state poisoned")?;
            last.retain(|id, _| map.contains_key(id));
            fired.retain(|id, _| map.contains_key(id));
            // A rule added to an already-armed watchdog starts its clock now;
            // otherwise it would alert on the very next tick for a device that
            // never had a chance to speak.
            for id in map.keys() {
                last.entry(id.clone()).or_insert(now_sec);
            }
        }
        *self.rules.lock().map_err(|_| "watchdog state poisoned")? = map;
        Ok(())
    }

    /// Record traffic on `topic`. Called on every inbound publish.
    ///
    /// A matching publish also clears the rule's fire time: that is the device
    /// recovering. Cooldown must only suppress repeat alerts during one
    /// continuous outage — measuring it from the last alert instead would let a
    /// device that flaps faster than the cooldown alert only once, forever.
    pub fn observe(&self, topic: &str, now_sec: i64) {
        let Ok(rules) = self.rules.lock() else { return };
        if rules.is_empty() {
            return;
        }
        let Ok(mut last) = self.last_seen.lock() else { return };
        let Ok(mut fired) = self.fired_at.lock() else { return };
        for rule in rules.values() {
            if rule.enabled && wildcard_match(rule.topic_filter.trim(), topic) {
                last.insert(rule.id.clone(), now_sec);
                fired.remove(&rule.id);
            }
        }
    }

    /// Arm on connect / disarm on disconnect, resetting all timers.
    pub fn set_connected(&self, connected: bool, now_sec: i64) {
        if let Ok(mut armed) = self.armed.lock() {
            *armed = connected;
        }
        let Ok(mut last) = self.last_seen.lock() else { return };
        let Ok(mut fired) = self.fired_at.lock() else { return };
        if connected {
            if let Ok(rules) = self.rules.lock() {
                for id in rules.keys() {
                    last.insert(id.clone(), now_sec);
                }
            }
        } else {
            last.clear();
            fired.clear();
        }
    }

    /// Return the rules that are currently silent and not in cooldown, marking
    /// them fired so a continuing outage does not spam the endpoint.
    pub fn evaluate(&self, now_sec: i64) -> Vec<SilenceAlert> {
        if !self.armed.lock().map(|a| *a).unwrap_or(false) {
            return Vec::new();
        }
        let Ok(rules) = self.rules.lock() else { return Vec::new() };
        if rules.is_empty() {
            return Vec::new();
        }
        let Ok(mut last) = self.last_seen.lock() else { return Vec::new() };
        let Ok(mut fired) = self.fired_at.lock() else { return Vec::new() };

        let mut alerts = Vec::new();
        for rule in rules.values() {
            if !rule.enabled {
                continue;
            }
            // An unobserved rule is silent for as long as it has been armed;
            // sync_rules/set_connected seed the baseline so this is bounded.
            let seen = *last.get(&rule.id).unwrap_or(&now_sec);
            let silent_for = now_sec - seen;
            if silent_for < rule.timeout_sec as i64 {
                continue;
            }
            if let Some(previous) = fired.get(&rule.id) {
                if now_sec - *previous < rule.cooldown_sec as i64 {
                    continue;
                }
            }
            fired.insert(rule.id.clone(), now_sec);
            alerts.push(SilenceAlert {
                rule_id: rule.id.clone(),
                rule_name: rule.name.clone(),
                topic_filter: rule.topic_filter.clone(),
                timeout_sec: rule.timeout_sec,
                last_seen_sec: seen,
                silent_for_sec: silent_for,
                webhook: rule.webhook.clone(),
            });
        }
        // A rule that has since recovered must not carry a stale fire time.
        fired.retain(|id, _| rules.contains_key(id));
        last.retain(|id, _| rules.contains_key(id));
        alerts
    }

    pub fn rule_count(&self) -> usize {
        self.rules.lock().map(|r| r.len()).unwrap_or(0)
    }
}

/// Alert document sent to the webhook. Fixed shape so a receiving alerting
/// system can key on `type` without parsing prose.
pub fn alert_body(alert: &SilenceAlert) -> Vec<u8> {
    let last_seen_iso = if alert.last_seen_sec > 0 {
        chrono::DateTime::<chrono::Utc>::from_timestamp(alert.last_seen_sec, 0)
            .map(|d| d.to_rfc3339())
            .unwrap_or_default()
    } else {
        String::new()
    };
    serde_json::json!({
        "type": "dropqtt.silence",
        "ruleId": alert.rule_id,
        "ruleName": alert.rule_name,
        "topicFilter": alert.topic_filter,
        "timeoutSec": alert.timeout_sec,
        "silentForSec": alert.silent_for_sec,
        "lastSeen": last_seen_iso,
        "generatedAt": chrono::Utc::now().to_rfc3339(),
    })
    .to_string()
    .into_bytes()
}

/// Emitted after an alert attempt so the UI can show delivery outcome without
/// echoing the webhook URL or headers back to the webview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceAlertEvent {
    pub rule_id: String,
    pub rule_name: String,
    pub topic_filter: String,
    pub silent_for_sec: i64,
    pub ok: bool,
    pub error: Option<String>,
    pub target: String,
    pub timestamp: String,
}

/// Alerts are always JSON regardless of the rule's stored body format.
pub fn alert_webhook(config: &WebhookConfig) -> WebhookConfig {
    WebhookConfig { format: "json".into(), ..config.clone() }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_000_000;

    fn rule(filter: &str, timeout: u64, cooldown: u64) -> SilenceRule {
        SilenceRule {
            id: "r1".into(),
            name: "heartbeat".into(),
            topic_filter: filter.into(),
            timeout_sec: timeout,
            cooldown_sec: cooldown,
            enabled: true,
            webhook: WebhookConfig {
                url: "http://127.0.0.1:8081/alert".into(),
                format: "json".into(),
                headers: vec![],
            },
        }
    }

    fn armed_with(filter: &str) -> SilenceWatchdog {
        let wd = SilenceWatchdog::default();
        wd.sync_rules(vec![rule(filter, 30, 120)], T0).unwrap();
        wd.set_connected(true, T0);
        wd
    }

    #[test]
    fn silent_only_while_disarmed_never_fires() {
        let wd = armed_with("devices/+/hb");
        // Not connected: a reconnect gap must not be reported as device loss.
        wd.set_connected(false, T0);
        assert!(wd.evaluate(1_000_000).is_empty());
    }

    #[test]
    fn arming_does_not_fire_immediately_and_traffic_resets_the_clock() {
        let wd = armed_with("devices/+/hb");
        let t0 = 1_000_000;
        assert!(wd.evaluate(t0).is_empty(), "arming must not alert at once");

        wd.observe("devices/a/hb", t0 + 10);
        assert!(wd.evaluate(t0 + 35).is_empty(), "seen 25s ago is under 30s");

        wd.observe("devices/b/hb", t0 + 40);
        assert!(wd.evaluate(t0 + 60).is_empty(), "a sibling device keeps it alive");
    }

    #[test]
    fn fires_once_the_filter_goes_quiet() {
        let wd = armed_with("devices/+/hb");
        let t0 = 1_000_000;
        wd.observe("devices/a/hb", t0);
        let alerts = wd.evaluate(t0 + 31);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].silent_for_sec, 31);
        assert_eq!(alerts[0].last_seen_sec, t0);
    }

    #[test]
    fn cooldown_suppresses_a_continuing_outage_then_recovers() {
        let wd = armed_with("devices/+/hb");
        let t0 = 1_000_000;
        wd.observe("devices/a/hb", t0);
        assert_eq!(wd.evaluate(t0 + 31).len(), 1, "first alert");
        assert!(wd.evaluate(t0 + 60).is_empty(), "inside the 120s cooldown");
        assert_eq!(wd.evaluate(t0 + 152).len(), 1, "cooldown elapsed");
        assert!(wd.evaluate(t0 + 200).is_empty(), "still cooling down");

        // Traffic resumes: the next silence is a fresh incident.
        wd.observe("devices/a/hb", t0 + 210);
        assert!(wd.evaluate(t0 + 235).is_empty());
        assert_eq!(wd.evaluate(t0 + 245).len(), 1);
    }

    #[test]
    fn only_matching_traffic_resets_a_rule() {
        let wd = armed_with("devices/+/hb");
        let t0 = 1_000_000;
        wd.observe("other/topic", t0 + 20);
        assert_eq!(wd.evaluate(t0 + 40).len(), 1, "non-matching publish must not count");
    }

    #[test]
    fn system_topics_need_an_explicit_dollar_filter() {
        let wd = armed_with("#");
        let t0 = 1_000_000;
        wd.observe("$SYS/broker/load", t0 + 25);
        assert_eq!(wd.evaluate(t0 + 40).len(), 1, "'#' must not match $SYS");

        let wd = armed_with("$SYS/broker/load");
        wd.observe("$SYS/broker/load", t0 + 25);
        assert!(wd.evaluate(t0 + 40).is_empty(), "an explicit $ filter does match");
    }

    #[test]
    fn disabled_rules_never_alert() {
        let wd = SilenceWatchdog::default();
        let mut r = rule("devices/+/hb", 30, 120);
        r.enabled = false;
        wd.sync_rules(vec![r], T0).unwrap();
        wd.set_connected(true, T0);
        assert!(wd.evaluate(1_000_000 + 10_000).is_empty());
    }

    #[test]
    fn a_rule_added_after_arming_gets_a_fresh_baseline() {
        let wd = armed_with("devices/+/hb");
        let t0 = 1_000_000;
        wd.set_connected(true, t0);
        let mut second = rule("gateway/+/status", 30, 120);
        second.id = "r2".into();
        wd.sync_rules(vec![rule("devices/+/hb", 30, 120), second], t0).unwrap();
        // r2 has never been seen; it must be measured from now, not from zero.
        assert!(wd.evaluate(t0 + 10).is_empty(), "new rule must not fire instantly");
        // Keep the pre-existing rule alive so this assertion measures r2 alone.
        wd.observe("devices/a/hb", t0 + 40);
        let alerts = wd.evaluate(t0 + 45);
        assert_eq!(alerts.len(), 1, "only the new rule fires, on its own clock");
        assert_eq!(alerts[0].topic_filter, "gateway/+/status");
    }

    #[test]
    fn validation_rejects_unusable_rules() {
        let wd = SilenceWatchdog::default();
        let mut r = rule("a/#", 30, 120);
        r.topic_filter = "  ".into();
        assert!(wd.sync_rules(vec![r], T0).is_err(), "empty filter");

        let r = rule("a/#", 2, 120);
        assert!(wd.sync_rules(vec![r], T0).is_err(), "timeout below 1s-resolution floor");

        let r = rule("a/#", 30, 1);
        assert!(wd.sync_rules(vec![r], T0).is_err(), "cooldown below floor");

        let mut r = rule("a/#", 30, 120);
        r.name = " ".into();
        assert!(wd.sync_rules(vec![r], T0).is_err(), "blank name");

        let mut r = rule("a/#", 30, 120);
        r.webhook.url = "ftp://host/x".into();
        assert!(wd.sync_rules(vec![r.clone()], T0).is_err(), "enabled rule needs a valid webhook");
        r.enabled = false;
        assert!(wd.sync_rules(vec![r], T0).is_ok(), "disabled rule may keep a redacted URL");
    }

    #[test]
    fn alert_body_is_a_machine_readable_document() {
        let wd = armed_with("devices/+/hb");
        wd.observe("devices/a/hb", 1_000_000);
        let alerts = wd.evaluate(1_000_031);
        let body = alert_body(&alerts[0]);
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["type"], "dropqtt.silence");
        assert_eq!(v["topicFilter"], "devices/+/hb");
        assert_eq!(v["silentForSec"], 31);
        assert_eq!(v["timeoutSec"], 30);
        assert_eq!(v["lastSeen"], "1970-01-12T13:46:40+00:00", "lastSeen is the observed instant in RFC 3339");

        // Alerts always post JSON even when the rule was saved as raw.
        let raw = WebhookConfig { format: "raw".into(), ..Default::default() };
        assert_eq!(alert_webhook(&raw).format, "json");
    }
}
