//! Scripted responder: answer a message instead of only watching it.
//!
//! A rule is a trigger filter plus a reply template, so the console can stand in for
//! a device that is not on the bench — or for a whole fleet of them. Everything the
//! reply needs already exists elsewhere in this app (`scheduler::render_template`
//! for `${...}` tokens, `topic` for filter matching, the publisher for the wire);
//! what this module owns is the *decision*: which rules a delivery claims, what the
//! rendered reply looks like, and how much of it is allowed.
//!
//! Two limits are deliberate:
//!
//! - **A rule whose reply matches its own trigger is refused at add time.** That is a
//!   feedback loop, and the only thing it produces is traffic.
//! - **Cross-rule loops cannot be detected cheaply** (A answers B, B answers A), so
//!   each rule carries a per-second ceiling and the engine has a global one. A
//!   throttled reply is counted, never silently dropped.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::scheduler::render_template;
use crate::topic::wildcard_match;

pub const MAX_RULES: usize = 32;
/// Replies per second across every rule. Two rules ping-ponging would otherwise
/// saturate the link they are both sitting on.
pub const GLOBAL_REPLIES_PER_SEC: u32 = 200;
/// A reply that echoes a whole payload should not be unbounded.
const MAX_ECHOED_PAYLOAD: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponderRule {
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// Inbound filter that starts this reply.
    pub trigger: String,
    /// Topic template; `${topic}`, `${payload}` and the scheduler's tokens apply.
    pub reply_topic: String,
    pub reply_payload: String,
    #[serde(default)]
    pub qos: u8,
    #[serde(default)]
    pub retain: bool,
    /// Wait this long before answering, so a device can look slow on purpose.
    #[serde(default)]
    pub delay_ms: u64,
    /// 0 means "only the global ceiling applies".
    #[serde(default)]
    pub max_per_sec: u32,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// One reply the engine decided to make. Publishing it is the caller's job: only the
/// connection owner can put bytes on the wire.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingReply {
    pub rule_id: String,
    pub topic: String,
    pub payload: String,
    pub qos: u8,
    pub retain: bool,
    pub delay_ms: u64,
}

/// A reply that echoes a whole payload must not be unbounded, and the cut has to
/// land on a character boundary or the JSON it is pasted into stops being valid.
fn echo_window(payload: &str) -> &str {
    if payload.len() <= MAX_ECHOED_PAYLOAD {
        return payload;
    }
    let mut cut = MAX_ECHOED_PAYLOAD;
    while cut > 0 && !payload.is_char_boundary(cut) {
        cut -= 1;
    }
    &payload[..cut]
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponderStats {
    pub id: String,
    pub name: String,
    pub trigger: String,
    pub enabled: bool,
    pub matched: u64,
    pub replied: u64,
    pub throttled: u64,
    /// Deliveries skipped because this engine sent them itself a moment ago
    pub suppressed: u64,
    pub failed: u64,
    #[serde(default)]
    pub last_error: Option<String>,
}

/// Why a rule was refused. Errors here are shown where they are typed, so a rule
/// that could never answer — or would answer itself forever — cannot be saved.
pub fn rule_error(rule: &ResponderRule) -> Option<String> {
    let trigger = rule.trigger.trim();
    if trigger.is_empty() {
        return Some("a responder needs a trigger filter".to_string());
    }
    if let Some(err) = crate::topic::filter_topic_error(trigger) {
        return Some(err);
    }
    let reply = rule.reply_topic.trim();
    if reply.is_empty() {
        return Some("a responder needs a reply topic".to_string());
    }
    // A templated topic is judged on a concrete stand-in: `${topic}/ack` is a fine
    // reply address, and an empty or malformed one is not, but neither can be seen
    // in the template text itself.
    let sample = render_sample(reply);
    if let Some(err) = crate::topic::publish_topic_error(&sample) {
        return Some(err);
    }
    if wildcard_match(trigger, &sample) {
        return Some("the reply topic matches this rule's own trigger — that is a loop".to_string());
    }
    if rule.qos > 2 {
        return Some("QoS above 2 does not exist".to_string());
    }
    if rule.max_per_sec > 10_000 {
        return Some("that rate ceiling is not a device, it is an attack".to_string());
    }
    if rule.delay_ms > 60_000 {
        return Some("a reply delayed by more than a minute belongs in a schedule".to_string());
    }
    None
}

/// A concrete stand-in used to judge a templated reply topic.
fn render_sample(text: &str) -> String {
    text.replace("${topic}", "device/sample")
        .replace("${payload}", "sample")
        .replace("${uuid}", "0")
        .replace("${counter}", "0")
        .replace("${seq}", "0")
        .replace("${random}", "0")
        .replace("${device}", "1")
        .replace("${ts}", "0")
        .replace("${timestamp}", "0")
        .replace("${iso}", "1970-01-01T00:00:00.000Z")
}

/// How many recent replies the engine remembers so it can refuse to answer its own
/// output. The memory is engine-wide rather than per rule on purpose: a rule that
/// answers its own reply is a cycle of one, but two rules answering each other is the
/// same failure with an extra step, and only a shared "we sent that" stops both.
const SUPPRESSED_REPLIES: usize = 128;

#[derive(Debug)]
struct Entry {
    rule: ResponderRule,
    counter: u64,
    window_sec: i64,
    window_sent: u32,
    stats: ResponderStats,
}

#[derive(Debug, Default)]
pub struct ResponderEngine {
    entries: Mutex<Vec<Entry>>,
    active: AtomicBool,
    /// Second the global reply budget is measured against, and what it has spent.
    budget: Mutex<(i64, u32)>,
    /// Topics this engine answered from, newest last.
    answered: Mutex<VecDeque<String>>,
}

impl ResponderEngine {
    pub fn sync_rules(&self, rules: Vec<ResponderRule>) -> Result<(), String> {
        if rules.len() > MAX_RULES {
            return Err(format!("at most {MAX_RULES} responder rules are supported"));
        }
        let mut ids = std::collections::HashSet::new();
        let mut entries = Vec::with_capacity(rules.len());
        for rule in rules {
            if let Some(err) = rule_error(&rule) {
                return Err(match rule.name.trim().is_empty() {
                    true => err,
                    false => format!("{}: {err}", rule.name.trim()),
                });
            }
            if !ids.insert(rule.id.clone()) {
                return Err(format!("two responder rules share the id {}", rule.id));
            }
            let stats = ResponderStats {
                id: rule.id.clone(),
                name: rule.name.clone(),
                trigger: rule.trigger.clone(),
                enabled: rule.enabled,
                matched: 0,
                replied: 0,
                throttled: 0,
                suppressed: 0,
                failed: 0,
                last_error: None,
            };
            entries.push(Entry {
                rule,
                counter: 0,
                window_sec: 0,
                window_sent: 0,
                stats,
            });
        }
        let active = entries.iter().any(|e| e.rule.enabled);
        *self.entries.lock().map_err(|_| "responder state poisoned")? = entries;
        self.active.store(active, Ordering::Relaxed);
        Ok(())
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }

    pub fn rule_count(&self) -> usize {
        self.entries.lock().map(|e| e.len()).unwrap_or(0)
    }

    /// Decide every reply a delivery claims. Called on the router path, so the whole
    /// function takes one lock and does no I/O.
    pub fn plan(&self, topic: &str, payload: &str, now_ms: i64) -> Vec<PendingReply> {
        if !self.is_active() {
            return Vec::new();
        }
        let Ok(mut entries) = self.entries.lock() else { return Vec::new() };
        if entries.is_empty() {
            return Vec::new();
        }
        let now_sec = now_ms / 1000;
        let Ok(mut budget) = self.budget.lock() else { return Vec::new() };
        if budget.0 != now_sec {
            *budget = (now_sec, 0);
        }
        let Ok(mut answered_guard) = self.answered.lock() else { return Vec::new() };
        let mut answered = std::mem::take(&mut *answered_guard);
        let mut sent: Vec<String> = Vec::new();
        let mut out = Vec::new();
        for entry in entries.iter_mut() {
            if !entry.rule.enabled || !wildcard_match(entry.rule.trigger.trim(), topic) {
                continue;
            }
            if answered.iter().any(|seen| seen == topic) {
                // This delivery is a reply this engine sent a moment ago. Answering it
                // is how a responder turns a bench into a traffic storm, so it is
                // counted separately instead of being mistaken for input.
                entry.stats.suppressed += 1;
                continue;
            }
            entry.stats.matched += 1;
            if budget.1 >= GLOBAL_REPLIES_PER_SEC {
                entry.stats.throttled += 1;
                continue;
            }
            if entry.window_sec != now_sec {
                entry.window_sec = now_sec;
                entry.window_sent = 0;
            }
            if entry.rule.max_per_sec > 0 && entry.window_sent >= entry.rule.max_per_sec {
                entry.stats.throttled += 1;
                continue;
            }
            entry.counter = entry.counter.wrapping_add(1);
            let counter = entry.counter;
            let echoed = echo_window(payload);
            let render = |text: &str| {
                render_template(text, counter, now_ms, 0, 0)
                    .replace("${topic}", topic)
                    .replace("${payload}", echoed)
            };
            let reply_topic = render(entry.rule.reply_topic.trim());
            let body = render(&entry.rule.reply_payload);
            entry.window_sent += 1;
            budget.1 += 1;
            entry.stats.replied += 1;
            sent.push(reply_topic.clone());
            out.push(PendingReply {
                rule_id: entry.rule.id.clone(),
                topic: reply_topic,
                payload: body,
                qos: entry.rule.qos,
                retain: entry.rule.retain,
                delay_ms: entry.rule.delay_ms,
            });
        }
        for topic in sent {
            answered.push_back(topic);
        }
        while answered.len() > SUPPRESSED_REPLIES {
            answered.pop_front();
        }
        *answered_guard = answered;
        out
    }

    /// A reply could not be published. Counted per rule so the panel can say which
    /// one is failing rather than showing a silent zero.
    pub fn record_failure(&self, rule_id: &str, error: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            if let Some(entry) = entries.iter_mut().find(|e| e.rule.id == rule_id) {
                entry.stats.failed += 1;
                entry.stats.last_error = Some(error.to_string());
            }
        }
    }

    pub fn stats(&self) -> Vec<ResponderStats> {
        self.entries
            .lock()
            .map(|entries| {
                entries
                    .iter()
                    .map(|e| ResponderStats {
                        enabled: e.rule.enabled,
                        ..e.stats.clone()
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn reset(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            for entry in entries.iter_mut() {
                entry.counter = 0;
                entry.window_sec = 0;
                entry.window_sent = 0;
                entry.stats.matched = 0;
                entry.stats.replied = 0;
                entry.stats.throttled = 0;
                entry.stats.suppressed = 0;
                entry.stats.failed = 0;
                entry.stats.last_error = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(over: PartialRule) -> ResponderRule {
        ResponderRule {
            id: over.id.unwrap_or_else(|| "rp1".to_string()),
            name: over.name.unwrap_or_else(|| "echo".to_string()),
            trigger: over.trigger,
            reply_topic: over.reply_topic,
            reply_payload: over.reply_payload,
            qos: over.qos.unwrap_or(1),
            retain: over.retain.unwrap_or(false),
            delay_ms: over.delay_ms.unwrap_or(0),
            max_per_sec: over.max_per_sec.unwrap_or(0),
            enabled: over.enabled.unwrap_or(true),
        }
    }

    /// Field-optional builder: naming every knob in each test hides which one matters.
    struct PartialRule {
        id: Option<String>,
        name: Option<String>,
        trigger: String,
        reply_topic: String,
        reply_payload: String,
        qos: Option<u8>,
        retain: Option<bool>,
        delay_ms: Option<u64>,
        max_per_sec: Option<u32>,
        enabled: Option<bool>,
    }

    impl Default for PartialRule {
        fn default() -> Self {
            Self {
                id: None,
                name: None,
                trigger: "devices/+/cmd".to_string(),
                reply_topic: "devices/gw1/ack".to_string(),
                reply_payload: "{\"ok\":true}".to_string(),
                qos: None,
                retain: None,
                delay_ms: None,
                max_per_sec: None,
                enabled: None,
            }
        }
    }

    fn armed(rules: Vec<ResponderRule>) -> ResponderEngine {
        let engine = ResponderEngine::default();
        engine.sync_rules(rules).expect("sync");
        engine
    }

    #[test]
    fn a_matching_delivery_produces_exactly_one_rendered_reply() {
        let e = armed(vec![rule(PartialRule {
            reply_payload: "{\"echo\":\"${payload}\",\"on\":\"${topic}\"}".to_string(),
            ..Default::default()
        })]);
        let replies = e.plan("devices/gw1/cmd", "reboot", 1_700_000_000_000);
        assert_eq!(replies.len(), 1);
        let reply = &replies[0];
        assert_eq!(reply.topic, "devices/gw1/ack");
        assert_eq!(reply.payload, "{\"echo\":\"reboot\",\"on\":\"devices/gw1/cmd\"}");
        assert_eq!(reply.qos, 1);
        let stats = &e.stats()[0];
        assert_eq!((stats.matched, stats.replied), (1, 1));
    }

    #[test]
    fn a_delivery_no_rule_claims_changes_nothing() {
        let e = armed(vec![rule(PartialRule::default())]);
        assert!(e.plan("other/topic", "x", 1).is_empty());
        assert_eq!(e.stats()[0].matched, 0);
    }

    #[test]
    fn the_counter_token_counts_replies_not_deliveries() {
        let e = armed(vec![rule(PartialRule {
            reply_payload: "seq ${counter}".to_string(),
            ..Default::default()
        })]);
        let first = e.plan("devices/gw1/cmd", "a", 1_000).remove(0);
        let second = e.plan("devices/gw2/cmd", "b", 2_000).remove(0);
        assert_eq!(first.payload, "seq 1");
        assert_eq!(second.payload, "seq 2");
    }

    #[test]
    fn a_rule_that_answers_its_own_trigger_is_refused_before_it_can_loop() {
        // The trigger is a filter, the reply a concrete topic: this pair would make
        // the responder talk to itself forever.
        let looped = rule(PartialRule {
            trigger: "devices/#".to_string(),
            reply_topic: "devices/gw1/ack".to_string(),
            ..Default::default()
        });
        let err = rule_error(&looped).expect("refused");
        assert!(err.contains("loop"), "{err}");
        let e = ResponderEngine::default();
        assert!(e.sync_rules(vec![looped]).is_err());
        assert!(!e.is_active());
    }

    #[test]
    fn a_templated_reply_topic_is_still_checked_for_the_self_loop() {
        let looped = rule(PartialRule {
            trigger: "devices/gw1/#".to_string(),
            reply_topic: "devices/gw1/ack-${counter}".to_string(),
            ..Default::default()
        });
        assert!(rule_error(&looped).is_some());
    }

    #[test]
    fn the_per_rule_ceiling_throttles_and_says_so() {
        let e = armed(vec![rule(PartialRule {
            max_per_sec: Some(2),
            ..Default::default()
        })]);
        // Same second for all five calls.
        let now = 1_700_000_000_000;
        for i in 0..5 {
            assert_eq!(e.plan("devices/gw1/cmd", "x", now + i).len(), if i < 2 { 1 } else { 0 });
        }
        let stats = &e.stats()[0];
        assert_eq!((stats.matched, stats.replied, stats.throttled), (5, 2, 3));
    }

    #[test]
    fn the_global_ceiling_bounds_two_hot_rules() {
        // Distinct input and output topics: the reply-suppression list must not be
        // what caps this, or the test would prove the wrong thing.
        let a = rule(PartialRule {
            id: Some("a".into()),
            trigger: "a/in".into(),
            reply_topic: "a/out".into(),
            max_per_sec: Some(500),
            ..Default::default()
        });
        let b = rule(PartialRule {
            id: Some("b".into()),
            trigger: "b/in".into(),
            reply_topic: "b/out".into(),
            max_per_sec: Some(500),
            ..Default::default()
        });
        let e = armed(vec![a, b]);
        let now = 1_700_000_000_000;
        let mut total = 0;
        for i in 0..(GLOBAL_REPLIES_PER_SEC + 40) {
            total += e.plan(if i % 2 == 0 { "a/in" } else { "b/in" }, "", now).len();
        }
        assert_eq!(total as u32, GLOBAL_REPLIES_PER_SEC, "the ceiling held");
        let throttled: u64 = e.stats().iter().map(|s| s.throttled).sum();
        assert!(throttled >= 40, "and the refusals were counted: {throttled}");
    }

    #[test]
    fn an_echoed_payload_is_cut_on_a_char_boundary() {
        let e = armed(vec![rule(PartialRule {
            reply_payload: "${payload}".to_string(),
            ..Default::default()
        })]);
        let big = "é".repeat(MAX_ECHOED_PAYLOAD); // two bytes each, so the byte cap lands mid-char
        let reply = e.plan("devices/gw1/cmd", &big, 1_000).remove(0);
        assert!(reply.payload.len() <= MAX_ECHOED_PAYLOAD);
        assert!(reply.payload.is_char_boundary(reply.payload.len()));
    }

    #[test]
    fn a_reply_that_could_not_be_published_is_attributed_to_its_rule() {
        let e = armed(vec![rule(PartialRule::default())]);
        e.record_failure("rp1", "not connected");
        let stats = &e.stats()[0];
        assert_eq!(stats.failed, 1);
        assert_eq!(stats.last_error.as_deref(), Some("not connected"));
    }

    #[test]
    fn a_disabled_rule_matches_nothing_at_all() {
        let e = armed(vec![rule(PartialRule {
            enabled: Some(false),
            ..Default::default()
        })]);
        assert!(e.plan("devices/gw1/cmd", "x", 1).is_empty());
        assert!(!e.is_active());
        assert_eq!(e.stats()[0].matched, 0);
    }

    #[test]
    fn a_rule_never_answers_its_own_reply_even_when_the_filter_covers_it() {
        // `${topic}/ack` under a `#` trigger is the loop the static check cannot see.
        let e = armed(vec![rule(PartialRule {
            trigger: "devices/#".into(),
            reply_topic: "${topic}/ack".into(),
            ..Default::default()
        })]);
        let first = e.plan("devices/gw1/cmd", "reboot", 1_000);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].topic, "devices/gw1/cmd/ack");
        // The broker hands that reply straight back on the same filter.
        assert!(e.plan("devices/gw1/cmd/ack", "{\"ok\":true}", 1_500).is_empty());
        let stats = &e.stats()[0];
        assert_eq!((stats.matched, stats.replied, stats.suppressed), (1, 1, 1), "an echo is not input");
        // A different device is still answered.
        assert_eq!(e.plan("devices/gw2/cmd", "reboot", 2_000).len(), 1);
    }

    #[test]
    fn two_rules_answering_each_other_stop_after_one_hop() {
        // A answers on b/x; B must recognise b/x as A's output rather than input.
        let a = rule(PartialRule {
            id: Some("a".into()),
            trigger: "a/#".into(),
            reply_topic: "b/x".into(),
            ..Default::default()
        });
        let b = rule(PartialRule {
            id: Some("b".into()),
            trigger: "b/#".into(),
            reply_topic: "a/x".into(),
            ..Default::default()
        });
        let e = armed(vec![a, b]);
        assert_eq!(e.plan("a/ping", "x", 1_000).len(), 1, "A answered");
        assert!(e.plan("b/x", "y", 1_500).is_empty(), "B must not answer A's reply");
        let stats = e.stats();
        assert_eq!(stats[0].replied, 1);
        assert_eq!((stats[1].matched, stats[1].suppressed), (0, 1));
    }

    #[test]
    fn nonsense_rules_are_refused_where_they_are_written() {
        let cases = vec![
            PartialRule { trigger: "  ".into(), ..Default::default() },
            PartialRule { reply_topic: "  ".into(), ..Default::default() },
            PartialRule { qos: Some(5), ..Default::default() },
            PartialRule { delay_ms: Some(120_000), ..Default::default() },
            PartialRule { max_per_sec: Some(999_999), ..Default::default() },
        ];
        for case in cases {
            assert!(rule_error(&rule(case)).is_some(), "should be refused");
        }
    }

    #[test]
    fn reset_clears_the_counts_and_the_counter_but_keeps_the_rule() {
        let e = armed(vec![rule(PartialRule::default())]);
        e.plan("devices/gw1/cmd", "x", 1_000);
        e.reset();
        let stats = &e.stats()[0];
        assert_eq!((stats.matched, stats.replied, stats.failed), (0, 0, 0));
        assert!(e.is_active());
        assert_eq!(e.rule_count(), 1);
        let reply = e.plan("devices/gw1/cmd", "x", 2_000).remove(0);
        assert_eq!(reply.topic, "devices/gw1/ack");
    }
}
