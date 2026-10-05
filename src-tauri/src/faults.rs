//! Fault injection: the only way to regression-test "failures must be visible".
//!
//! Three rounds of this project were spent making dropped messages, refused acks
//! and silent timeouts observable. Nothing in the repo could *produce* those
//! conditions on demand, so every claim about them was proven by hand once and then
//! trusted. This module is the generator: percentages of loss, added latency,
//! duplicates, damaged payloads and wrong correlation data, applied at the two ends
//! of the client.
//!
//! Two choices are deliberate:
//!
//! - **Percentages are a stride, not a coin flip.** `drop 25%` damages exactly every
//!   fourth message. A reproducible rate is what makes a test of the loss path
//!   possible; a random one only shows that loss is *possible*.
//! - **Injection sits ahead of everything else on the inbound path** — before the
//!   traffic meter, history, the feed, RPC pairing and assertions alike. A dropped
//!   message has to be missing from all of them, or the fault is a decoration rather
//!   than a test of those code paths.
//!
//! What is *not* here: broker-side refusals (ACL, quota, unsupported QoS). Those are
//! the broker's decision and cannot be injected from a client; `~/mqtt-lab/probe-broker.mjs`
//! serves them on demand for the live checks. Neither is a session flap: reconnecting
//! is driven from the UI today, so a backend-initiated flap needs a reconnect
//! primitive that does not exist yet.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::topic::wildcard_match;
use crate::transport::NormalizedPublish;
use bytes::Bytes;

pub const MAX_RULES: usize = 16;
/// Long enough to time a peer out, short enough that a stuck panel is not mistaken
/// for the app being down.
pub const MAX_DELAY_MS: u64 = 5_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FaultDirection {
    /// Loss on the way in is the fault people actually need, so it is the default.
    #[default]
    Inbound,
    Outbound,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaultRule {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub filter: String,
    #[serde(default)]
    pub direction: FaultDirection,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 0..=100. Every Nth matching message, where N = 100 / pct.
    #[serde(default)]
    pub drop_pct: u8,
    /// Added to every matching message, not sampled.
    #[serde(default)]
    pub delay_ms: u64,
    #[serde(default)]
    pub duplicate_pct: u8,
    #[serde(default)]
    pub corrupt_pct: u8,
    /// Inbound only: flips MQTT5 Correlation Data so a response stops matching the
    /// request it answers. There is no outbound form of this knob because our own
    /// correlation is generated, not observed.
    #[serde(default)]
    pub bad_correlation_pct: u8,
}

fn default_true() -> bool {
    true
}

/// Why a rule was rejected at add time. A rule with no knob set would sit in the
/// list looking armed while doing nothing, which is the failure mode this whole
/// module exists to remove.
pub fn rule_error(rule: &FaultRule) -> Option<String> {
    if rule.filter.trim().is_empty() {
        return Some("a fault needs a topic filter".to_string());
    }
    if let Some(err) = crate::topic::filter_topic_error(rule.filter.trim()) {
        return Some(err);
    }
    let knobs = rule.drop_pct > 0
        || rule.delay_ms > 0
        || rule.duplicate_pct > 0
        || rule.corrupt_pct > 0
        || rule.bad_correlation_pct > 0;
    if !knobs {
        return Some("nothing to inject: set at least one rate or delay".to_string());
    }
    for (label, pct) in [
        ("drop", rule.drop_pct),
        ("duplicate", rule.duplicate_pct),
        ("corrupt", rule.corrupt_pct),
        ("bad correlation", rule.bad_correlation_pct),
    ] {
        if pct > 100 {
            return Some(format!("{label} rate cannot exceed 100%"));
        }
    }
    if rule.delay_ms > MAX_DELAY_MS {
        return Some(format!("delay cannot exceed {MAX_DELAY_MS} ms"));
    }
    if rule.bad_correlation_pct > 0 && matches!(rule.direction, FaultDirection::Outbound) {
        return Some("correlation damage applies to inbound traffic only".to_string());
    }
    None
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaultCounts {
    pub seen: u64,
    pub dropped: u64,
    pub delayed: u64,
    pub duplicated: u64,
    pub corrupted: u64,
    pub mis_correlated: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaultRuleStats {
    pub id: String,
    pub name: String,
    pub filter: String,
    pub enabled: bool,
    pub counts: FaultCounts,
}

/// What the caller has to do about one message. The damage itself (payload,
/// correlation) is applied inside the injector; timing and multiplicity are the
/// caller's, because only it can await or clone the event.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Plan {
    pub drop: bool,
    pub delay_ms: u64,
    pub duplicate: bool,
}

#[derive(Debug, Default, Clone, Copy)]
struct Strides {
    seen: u64,
    drop: u64,
    duplicate: u64,
    corrupt: u64,
    correlation: u64,
}

#[derive(Debug)]
struct Entry {
    rule: FaultRule,
    strides: Strides,
    counts: FaultCounts,
}

#[derive(Debug, Default)]
pub struct FaultInjector {
    entries: Mutex<Vec<Entry>>,
    active: AtomicBool,
}

/// Bresenham-style stride: with `pct` of 25 this fires on the 3rd, 7th, 11th… call,
/// i.e. exactly one in four, with no accumulated drift and no randomness.
fn fires(count: u64, pct: u8) -> bool {
    let pct = pct as u64;
    pct > 0 && (count * pct) % 100 >= 100 - pct
}

impl FaultInjector {
    /// Validate and replace the whole set (frontend owns persistence, as everywhere
    /// else in this app).
    pub fn sync_rules(&self, rules: Vec<FaultRule>) -> Result<(), String> {
        if rules.len() > MAX_RULES {
            return Err(format!("at most {MAX_RULES} fault rules are supported"));
        }
        let mut seen_ids = HashSet::new();
        let mut entries = Vec::with_capacity(rules.len());
        for rule in rules {
            if let Some(err) = rule_error(&rule) {
                return Err(match rule.name.trim().is_empty() {
                    true => err,
                    false => format!("{}: {err}", rule.name.trim()),
                });
            }
            if !seen_ids.insert(rule.id.clone()) {
                return Err(format!("two fault rules share the id {}", rule.id));
            }
            entries.push(Entry {
                rule,
                strides: Strides::default(),
                counts: FaultCounts::default(),
            });
        }
        let active = entries.iter().any(|e| e.rule.enabled);
        *self.entries.lock().map_err(|_| "fault state poisoned")? = entries;
        self.active.store(active, Ordering::Relaxed);
        Ok(())
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }

    pub fn rule_count(&self) -> usize {
        self.entries.lock().map(|e| e.len()).unwrap_or(0)
    }

    fn applies(direction: FaultDirection, to: FaultDirection) -> bool {
        matches!(direction, FaultDirection::Both) || direction == to
    }

    /// Judge and damage one inbound publish. Returns what the caller must still do.
    pub fn apply_inbound(&self, publish: &mut NormalizedPublish) -> Plan {
        if !self.is_active() {
            return Plan::default();
        }
        let Ok(mut entries) = self.entries.lock() else {
            return Plan::default();
        };
        let Some(entry) = entries.iter_mut().find(|e| {
            e.rule.enabled
                && Self::applies(e.rule.direction, FaultDirection::Inbound)
                && wildcard_match(e.rule.filter.trim(), &publish.topic)
        }) else {
            return Plan::default();
        };
        Self::tally(entry, &mut publish.payload, &mut publish.correlation_data, true)
    }

    /// Judge and damage one outbound payload.
    pub fn apply_outbound(&self, topic: &str, payload: &mut Bytes) -> Plan {
        if !self.is_active() {
            return Plan::default();
        }
        let Ok(mut entries) = self.entries.lock() else {
            return Plan::default();
        };
        let Some(entry) = entries.iter_mut().find(|e| {
            e.rule.enabled
                && Self::applies(e.rule.direction, FaultDirection::Outbound)
                && wildcard_match(e.rule.filter.trim(), topic)
        }) else {
            return Plan::default();
        };
        Self::tally(entry, payload, &mut None, false)
    }

    fn tally(
        entry: &mut Entry,
        payload: &mut Bytes,
        correlation: &mut Option<Vec<u8>>,
        inbound: bool,
    ) -> Plan {
        let rule = &entry.rule;
        entry.strides.seen += 1;
        entry.counts.seen += 1;
        let mut plan = Plan::default();

        if rule.delay_ms > 0 {
            plan.delay_ms = rule.delay_ms;
            entry.counts.delayed += 1;
        }
        entry.strides.drop += 1;
        if fires(entry.strides.drop, rule.drop_pct) {
            plan.drop = true;
            entry.counts.dropped += 1;
            // A dropped message is not damaged as well: one fault per message keeps
            // the counters interpretable.
            return plan;
        }
        entry.strides.duplicate += 1;
        if fires(entry.strides.duplicate, rule.duplicate_pct) {
            plan.duplicate = true;
            entry.counts.duplicated += 1;
        }
        entry.strides.corrupt += 1;
        if fires(entry.strides.corrupt, rule.corrupt_pct) {
            flip_payload(payload);
            entry.counts.corrupted += 1;
        }
        if inbound {
            entry.strides.correlation += 1;
            if let Some(bytes) = correlation.as_mut() {
                if fires(entry.strides.correlation, rule.bad_correlation_pct) {
                    flip_bytes(bytes);
                    entry.counts.mis_correlated += 1;
                }
            }
        }
        plan
    }

    pub fn stats(&self) -> Vec<FaultRuleStats> {
        self.entries
            .lock()
            .map(|entries| {
                entries
                    .iter()
                    .map(|e| FaultRuleStats {
                        id: e.rule.id.clone(),
                        name: e.rule.name.clone(),
                        filter: e.rule.filter.clone(),
                        enabled: e.rule.enabled,
                        counts: e.counts,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn reset(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            for entry in entries.iter_mut() {
                entry.strides = Strides::default();
                entry.counts = FaultCounts::default();
            }
        }
    }
}

fn flip_payload(payload: &mut Bytes) {
    if payload.is_empty() {
        return;
    }
    let mut bytes = payload.to_vec();
    flip_bytes(&mut bytes);
    *payload = Bytes::from(bytes);
}

/// Damage that keeps the length: one byte at the midpoint, XORed so the change is
/// reversible in principle but invisible in size.
fn flip_bytes(bytes: &mut [u8]) {
    if bytes.is_empty() {
        return;
    }
    let at = bytes.len() / 2;
    bytes[at] ^= 0xff;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn publish(topic: &str, payload: &[u8], correlation: Option<Vec<u8>>) -> NormalizedPublish {
        NormalizedPublish {
            topic: topic.to_string(),
            payload: Bytes::from(payload.to_vec()),
            qos: 1,
            retain: false,
            content_type: None,
            user_properties: Vec::new(),
            response_topic: None,
            correlation_data: correlation,
            payload_format: None,
            subscription_ids: Vec::new(),
        }
    }

    fn rule(filter: &str, direction: FaultDirection) -> FaultRule {
        FaultRule {
            id: "f1".to_string(),
            name: "lossy".to_string(),
            filter: filter.to_string(),
            direction,
            enabled: true,
            drop_pct: 0,
            delay_ms: 0,
            duplicate_pct: 0,
            corrupt_pct: 0,
            bad_correlation_pct: 0,
        }
    }

    fn armed(rules: Vec<FaultRule>) -> FaultInjector {
        let injector = FaultInjector::default();
        injector.sync_rules(rules).expect("sync");
        injector
    }

    #[test]
    fn a_quarter_drop_damages_exactly_every_fourth_message() {
        let mut r = rule("sensors/#", FaultDirection::Inbound);
        r.drop_pct = 25;
        let e = armed(vec![r]);
        let hits: Vec<bool> = (0..8)
            .map(|_| e.apply_inbound(&mut publish("sensors/a", b"x", None)).drop)
            .collect();
        assert_eq!(hits.iter().filter(|d| **d).count(), 2, "{hits:?}");
        // Bresenham on a counter that starts at 1, so the stride lands on the 3rd
        // call rather than the 4th; the rate is what matters and it is exact.
        assert_eq!(hits, vec![false, false, true, false, false, false, true, false]);
        assert_eq!(e.stats()[0].counts.dropped, 2);
    }

    #[test]
    fn hundred_percent_loss_drops_everything_it_claims() {
        let mut r = rule("sensors/#", FaultDirection::Inbound);
        r.drop_pct = 100;
        let e = armed(vec![r]);
        for _ in 0..5 {
            assert!(e.apply_inbound(&mut publish("sensors/a", b"x", None)).drop);
        }
        assert_eq!(e.stats()[0].counts.seen, 5);
    }

    #[test]
    fn a_dropped_message_is_not_also_counted_as_corrupted() {
        let mut r = rule("sensors/#", FaultDirection::Inbound);
        r.drop_pct = 100;
        r.corrupt_pct = 100;
        let e = armed(vec![r]);
        assert!(e.apply_inbound(&mut publish("sensors/a", b"hello", None)).drop);
        let counts = e.stats()[0].counts;
        assert_eq!((counts.dropped, counts.corrupted), (1, 0));
    }

    #[test]
    fn corruption_keeps_the_length_and_changes_one_byte() {
        let mut r = rule("sensors/#", FaultDirection::Both);
        r.corrupt_pct = 100;
        let e = armed(vec![r]);
        let mut p = publish("sensors/a", b"temp=21.5", None);
        e.apply_inbound(&mut p);
        assert_eq!(p.payload.len(), 9);
        assert_eq!(p.payload[4], 0x3d ^ 0xff, "the midpoint byte is flipped");
        assert_ne!(p.payload[4], b'=');
    }

    #[test]
    fn correlation_damage_only_touches_a_response_that_had_one() {
        let mut r = rule("replies/#", FaultDirection::Inbound);
        r.bad_correlation_pct = 100;
        let e = armed(vec![r]);
        let mut with = publish("replies/a", b"ok", Some(vec![1, 2, 3, 4]));
        e.apply_inbound(&mut with);
        assert_eq!(with.correlation_data, Some(vec![1, 2, 3 ^ 0xff, 4]));
        let mut without = publish("replies/b", b"ok", None);
        e.apply_inbound(&mut without);
        assert_eq!(e.stats()[0].counts.mis_correlated, 1, "nothing to damage on the second");
    }

    #[test]
    fn direction_gates_which_side_of_the_wire_a_rule_touches() {
        let mut in_only = rule("sensors/#", FaultDirection::Inbound);
        in_only.drop_pct = 100;
        let e = armed(vec![in_only]);
        let mut payload = Bytes::from_static(b"x");
        assert!(!e.apply_outbound("sensors/a", &mut payload).drop, "outbound is not its business");
        assert!(e.apply_inbound(&mut publish("sensors/a", b"x", None)).drop);

        let mut out_only = rule("sensors/#", FaultDirection::Outbound);
        out_only.drop_pct = 100;
        let e = armed(vec![out_only]);
        let mut payload = Bytes::from_static(b"x");
        assert!(e.apply_outbound("sensors/a", &mut payload).drop);
        assert!(!e.apply_inbound(&mut publish("sensors/a", b"x", None)).drop);
    }

    #[test]
    fn a_disabled_rule_and_an_unmatched_topic_do_nothing_at_all() {
        let mut r = rule("sensors/#", FaultDirection::Both);
        r.drop_pct = 100;
        r.enabled = false;
        let e = armed(vec![r]);
        let mut payload = Bytes::from_static(b"x");
        assert_eq!(e.apply_outbound("sensors/a", &mut payload), Plan::default());
        assert!(!e.is_active(), "an all-disabled set is not armed");
        assert_eq!(e.stats()[0].counts.seen, 0);

        let mut other = rule("other/#", FaultDirection::Both);
        other.drop_pct = 100;
        let e = armed(vec![other]);
        assert_eq!(e.rule_count(), 1);
        assert!(!e.apply_inbound(&mut publish("sensors/a", b"x", None)).drop);
        assert_eq!(e.stats()[0].counts.seen, 0, "an unmatched topic is not seen");
    }

    #[test]
    fn delay_is_reported_to_the_caller_and_counted() {
        let mut r = rule("sensors/#", FaultDirection::Inbound);
        r.delay_ms = 250;
        let e = armed(vec![r]);
        let plan = e.apply_inbound(&mut publish("sensors/a", b"x", None));
        assert_eq!(plan, Plan { drop: false, delay_ms: 250, duplicate: false });
        assert_eq!(e.stats()[0].counts.delayed, 1);
    }

    #[test]
    fn the_first_rule_whose_filter_matches_decides_alone() {
        let mut a = rule("sensors/#", FaultDirection::Inbound);
        a.id = "a".into();
        a.duplicate_pct = 100;
        let mut b = rule("sensors/+/temp", FaultDirection::Inbound);
        b.id = "b".into();
        b.drop_pct = 100;
        let e = armed(vec![a, b]);
        let plan = e.apply_inbound(&mut publish("sensors/room1/temp", b"x", None));
        assert!(plan.duplicate && !plan.drop, "the earlier rule won");
        let stats = e.stats();
        assert_eq!((stats[0].counts.seen, stats[1].counts.seen), (1, 0));
    }

    #[test]
    fn a_rule_that_injects_nothing_is_refused_before_it_can_look_armed() {
        assert!(rule_error(&rule("sensors/#", FaultDirection::Both)).is_some());
        let mut too_much = rule("sensors/#", FaultDirection::Both);
        too_much.drop_pct = 101;
        assert!(rule_error(&too_much).is_some());
        let mut too_slow = rule("sensors/#", FaultDirection::Both);
        too_slow.delay_ms = MAX_DELAY_MS + 1;
        assert!(rule_error(&too_slow).is_some());
        let mut wrong_filter = rule("sensors/#/+", FaultDirection::Both);
        wrong_filter.filter = "bad/#/filter/x".to_string();
        wrong_filter.drop_pct = 50;
        assert!(rule_error(&wrong_filter).is_some());
        let mut corr_outbound = rule("sensors/#", FaultDirection::Outbound);
        corr_outbound.bad_correlation_pct = 50;
        assert!(rule_error(&corr_outbound).is_some());
    }

    #[test]
    fn a_rejected_set_never_halves_its_way_onto_the_wire() {
        let good = {
            let mut r = rule("sensors/#", FaultDirection::Both);
            r.drop_pct = 50;
            r
        };
        let bad = rule("sensors/#", FaultDirection::Both);
        let e = FaultInjector::default();
        assert!(e.sync_rules(vec![good.clone(), bad]).is_err());
        assert!(!e.is_active());
        assert_eq!(e.rule_count(), 0, "nothing was armed by the failed sync");
    }

    #[test]
    fn duplicate_ids_are_refused_because_only_one_would_ever_be_consulted() {
        let mut a = rule("sensors/#", FaultDirection::Both);
        a.drop_pct = 10;
        let mut b = rule("other/#", FaultDirection::Both);
        b.drop_pct = 10;
        assert!(FaultInjector::default().sync_rules(vec![a, b]).is_err());
    }

    #[test]
    fn reset_zeroes_the_tallies_and_restarts_the_stride() {
        let mut r = rule("sensors/#", FaultDirection::Inbound);
        r.drop_pct = 50;
        let e = armed(vec![r]);
        for _ in 0..4 {
            e.apply_inbound(&mut publish("sensors/a", b"x", None));
        }
        assert_eq!(e.stats()[0].counts.dropped, 2);
        e.reset();
        assert_eq!(e.stats()[0].counts, FaultCounts::default());
        let hits: Vec<bool> = (0..2)
            .map(|_| e.apply_inbound(&mut publish("sensors/a", b"x", None)).drop)
            .collect();
        assert_eq!(hits, vec![true, false], "stride restarted from the top");
        assert!(e.is_active(), "the rule is still armed");
    }
}
