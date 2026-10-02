//! Attribution of ack reason codes (SUBACK / UNSUBACK / PUBACK family) to the
//! filters and publishes that produced them.
//!
//! A SUBACK carries no topic name — only a packet id and one reason byte per
//! filter, in SUBSCRIBE order. We send exactly one filter per SUBSCRIBE, so a
//! FIFO reproduces the pairing. When the counts disagree, the surplus codes are
//! reported as unattributed instead of being guessed onto a filter they never
//! answered: a wrong "not authorized" badge on an innocent subscription is worse
//! than an honest counter.
//!
//! The byte tables below were checked against the MQTT 5 §3.2.2.2.0 reason-code
//! list as encoded by mqtt.js's `mqtt-packet/constants.js` (2026-10-03), which
//! agrees with rumqttc 0.24's parser. Two values are easy to get wrong from
//! memory: SUBACK "Topic Filter invalid" is 0x8F (not 0x8E) and PUBACK "No
//! matching subscribers" is 0x10, which is *not* an error even though it means
//! nobody received the message.

use std::collections::{HashMap, VecDeque};

use serde::Serialize;

/// MQTT 5 §3.2.2.2.0: everything from 0x80 up is a refusal. v3.1.1 only ever
/// uses 0x00-0x02 and 0x80, so the same test covers both.
pub fn is_error(code: u8) -> bool {
    code >= 0x80
}

/// True only for the plain "accepted" byte. Codes below 0x80 that are not 0x00
/// (granted QoS, "no matching subscribers") are not failures, but they are not
/// an acknowledgement of delivery either.
pub fn is_plain_success(code: u8) -> bool {
    code == 0x00
}

/// English label for a SUBACK code. The UI renders its own text from `code`, so
/// this is the diagnostics/fallback form.
pub fn describe_sub(code: u8) -> &'static str {
    match code {
        0x00 => "granted QoS 0",
        0x01 => "granted QoS 1",
        0x02 => "granted QoS 2",
        0x80 => "unspecified error",
        0x83 => "implementation specific error",
        0x87 => "not authorized (ACL)",
        0x8f => "topic filter invalid",
        0x91 => "packet identifier in use",
        0x97 => "quota exceeded",
        0x9e => "shared subscriptions not supported",
        0xa1 => "subscription identifiers not supported",
        0xa2 => "wildcard subscriptions not supported",
        _ => "unrecognized reason code",
    }
}

/// English label for an UNSUBACK code.
pub fn describe_unsub(code: u8) -> &'static str {
    match code {
        0x00 => "unsubscribed",
        0x11 => "no subscription existed",
        0x80 => "unspecified error",
        0x83 => "implementation specific error",
        0x87 => "not authorized (ACL)",
        0x8f => "topic filter invalid",
        0x91 => "packet identifier in use",
        _ => "unrecognized reason code",
    }
}

/// English label shared by the PUBACK / PUBREC / PUBREL / PUBCOMP family.
pub fn describe_pub(code: u8) -> &'static str {
    match code {
        0x00 => "acknowledged",
        0x10 => "no matching subscribers",
        0x80 => "unspecified error",
        0x83 => "implementation specific error",
        0x87 => "not authorized (ACL)",
        0x90 => "topic name invalid",
        0x91 => "packet identifier in use",
        0x92 => "packet identifier not found",
        0x97 => "quota exceeded",
        0x99 => "payload format invalid",
        _ => "unrecognized reason code",
    }
}

/// A filter or publish the broker refused, with enough context to explain it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rejection {
    pub filter: String,
    /// Raw wire byte, so the UI can name it in the user's language.
    pub code: u8,
    pub meaning: String,
    /// Present only when the broker sent one; never carries credentials.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_string: Option<String>,
    pub at_ms: i64,
}

/// A subscription the broker accepted at a lower QoS than requested.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CappedSub {
    pub filter: String,
    pub granted: u8,
}

/// The ack verdicts the UI shows, gathered for one IPC round trip.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AckState {
    pub rejected: Vec<Rejection>,
    pub refused_unsubscribes: Vec<Rejection>,
    pub capped: Vec<CappedSub>,
    pub unattributed: u64,
}

/// What a single reason byte turned out to mean for us.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Accepted. `granted_qos` is what a SUBACK echoed, which may be lower than
    /// what was asked for.
    Granted {
        filter: String,
        granted_qos: Option<u8>,
    },
    Rejected(Rejection),
    /// More reason bytes than filters waiting: do not blame a real subscription.
    Unattributed { code: u8 },
}

fn sorted(rows: impl Iterator<Item = Rejection>) -> Vec<Rejection> {
    let mut v: Vec<Rejection> = rows.collect();
    v.sort_by(|a, b| a.filter.cmp(&b.filter));
    v
}

/// FIFO attribution plus the current set of refusals.
#[derive(Default)]
pub struct AckTracker {
    pending_sub: VecDeque<String>,
    pending_unsub: VecDeque<String>,
    /// Filters whose SUBSCRIBE the broker refuses, keyed by filter.
    rejected_subs: HashMap<String, Rejection>,
    /// Filters whose UNSUBSCRIBE the broker refuses. Distinct from the above
    /// because the app has already dropped these locally: a red chip on a
    /// subscription that is gone would be its own lie. What belongs here is the
    /// warning that the broker may still be delivering on it.
    rejected_unsubs: HashMap<String, Rejection>,
    /// Filters the broker granted at a lower QoS than requested.
    downgraded: HashMap<String, u8>,
    /// Refused filters we deliberately stop replaying. rumqttc treats a refused
    /// SUBACK as fatal, so replaying one drops the whole session again on every
    /// reconnect; quarantining turns an infinite flap into one visible refusal.
    quarantined: HashMap<String, Rejection>,
    unattributed_sub: u64,
    unattributed_unsub: u64,
}

impl AckTracker {
    /// Record that a SUBSCRIBE for `filter` is in flight.
    pub fn expect_sub(&mut self, filter: &str) {
        // Asking again is the only way to lift a quarantine: the user changed
        // something (ACL, filter, broker) and wants the attempt retried.
        self.quarantined.remove(filter);
        self.pending_sub.push_back(filter.to_string());
    }

    /// Attribute a refusal that arrived as a connection error rather than as a
    /// SUBACK packet: rumqttc aborts the session on the first bad reason code, so
    /// exactly one in-flight filter is implicated, and it is the one we sent first.
    pub fn refuse_oldest_pending_sub(
        &mut self,
        code: u8,
        detail: &str,
        now_ms: i64,
    ) -> Option<Rejection> {
        let filter = self.pending_sub.pop_front()?;
        let rejection = Rejection {
            filter: filter.clone(),
            code,
            meaning: describe_sub(code).to_string(),
            reason_string: Some(detail.to_string()),
            at_ms: now_ms,
        };
        self.rejected_subs.insert(filter.clone(), rejection.clone());
        self.quarantined.insert(filter, rejection.clone());
        Some(rejection)
    }

    /// The unsubscribe equivalent.
    pub fn refuse_oldest_pending_unsub(
        &mut self,
        code: u8,
        detail: &str,
        now_ms: i64,
    ) -> Option<Rejection> {
        let filter = self.pending_unsub.pop_front()?;
        let rejection = Rejection {
            filter: filter.clone(),
            code,
            meaning: describe_unsub(code).to_string(),
            reason_string: Some(detail.to_string()),
            at_ms: now_ms,
        };
        self.rejected_unsubs.insert(filter.clone(), rejection.clone());
        Some(rejection)
    }

    /// Stop replaying a refused filter, keeping the refusal that caused it.
    pub fn quarantine(&mut self, rejection: &Rejection) {
        self.quarantined
            .insert(rejection.filter.clone(), rejection.clone());
    }

    pub fn is_quarantined(&self, filter: &str) -> bool {
        self.quarantined.contains_key(filter)
    }

    pub fn quarantined(&self) -> Vec<Rejection> {
        sorted(self.quarantined.values().cloned())
    }

    pub fn expect_unsub(&mut self, filter: &str) {
        self.pending_unsub.push_back(filter.to_string());
    }

    /// Drop everything about a filter: it is gone from the registry, and a stale
    /// verdict or in-flight slot would only mis-attribute the next answer.
    pub fn forget(&mut self, filter: &str) {
        self.rejected_subs.remove(filter);
        self.rejected_unsubs.remove(filter);
        self.quarantined.remove(filter);
        self.downgraded.remove(filter);
        self.pending_sub.retain(|f| f != filter);
        self.pending_unsub.retain(|f| f != filter);
    }

    pub fn apply_sub(&mut self, codes: &[u8], reason_string: Option<String>, now_ms: i64) -> Vec<Outcome> {
        Self::apply(
            &mut self.pending_sub,
            &mut self.rejected_subs,
            &mut self.unattributed_sub,
            codes,
            reason_string.as_deref(),
            now_ms,
            true,
        )
    }

    /// A refusal to unsubscribe means the broker may still be delivering on a
    /// filter we already dropped locally, so it is reported like any other
    /// refusal — against the filter we named, not guessed.
    pub fn apply_unsub(&mut self, codes: &[u8], reason_string: Option<String>, now_ms: i64) -> Vec<Outcome> {
        Self::apply(
            &mut self.pending_unsub,
            &mut self.rejected_unsubs,
            &mut self.unattributed_unsub,
            codes,
            reason_string.as_deref(),
            now_ms,
            false,
        )
    }

    fn apply(
        pending: &mut VecDeque<String>,
        rejected: &mut HashMap<String, Rejection>,
        unattributed: &mut u64,
        codes: &[u8],
        reason_string: Option<&str>,
        now_ms: i64,
        is_sub: bool,
    ) -> Vec<Outcome> {
        let mut out = Vec::with_capacity(codes.len());
        for &code in codes {
            let Some(filter) = pending.pop_front() else {
                *unattributed += 1;
                out.push(Outcome::Unattributed { code });
                continue;
            };
            if is_error(code) {
                let rejection = Rejection {
                    filter: filter.clone(),
                    code,
                    meaning: (if is_sub { describe_sub } else { describe_unsub })(code).to_string(),
                    reason_string: reason_string.map(str::to_string),
                    at_ms: now_ms,
                };
                rejected.insert(filter.clone(), rejection.clone());
                out.push(Outcome::Rejected(rejection));
            } else {
                rejected.remove(&filter);
                // A granted SUBACK echoes the QoS actually in force, which is how
                // the app learns the broker took QoS 2 down to 1.
                let granted_qos = if is_sub && code <= 0x02 { Some(code) } else { None };
                out.push(Outcome::Granted {
                    filter,
                    granted_qos,
                });
            }
        }
        out
    }

    /// Record the QoS the broker granted. Anything lower than asked is a
    /// downgrade worth showing; an equal grant clears an older verdict, so a
    /// broker that stopped limiting us stops being reported as limiting us.
    pub fn note_granted_qos(&mut self, filter: &str, asked: u8, granted: u8) {
        if granted < asked {
            self.downgraded.insert(filter.to_string(), granted);
        } else {
            self.downgraded.remove(filter);
        }
    }

    pub fn downgrade(&self, filter: &str) -> Option<u8> {
        self.downgraded.get(filter).copied()
    }

    /// Filters the broker capped at a lower QoS than we asked for.
    pub fn capped(&self) -> Vec<CappedSub> {
        let mut v: Vec<CappedSub> = self
            .downgraded
            .iter()
            .map(|(filter, granted)| CappedSub {
                filter: filter.clone(),
                granted: *granted,
            })
            .collect();
        v.sort_by(|a, b| a.filter.cmp(&b.filter));
        v
    }

    /// Everything the console needs about ack verdicts, in one poll.
    pub fn state(&self) -> AckState {
        AckState {
            rejected: self.rejections(),
            // `rejected` already only holds what the broker refused, and a
            // quarantined filter is exactly that, so no extra field is needed.
            refused_unsubscribes: self.unsubscribe_rejections(),
            capped: self.capped(),
            unattributed: self.unattributed_sub + self.unattributed_unsub,
        }
    }

    /// Subscriptions the broker currently refuses — the ones the console draws a
    /// red chip on.
    pub fn rejections(&self) -> Vec<Rejection> {
        sorted(self.rejected_subs.values().cloned())
    }

    /// Unsubscribes the broker refused: the local registry already dropped them,
    /// so this is reported as its own warning rather than as a dead subscription.
    pub fn unsubscribe_rejections(&self) -> Vec<Rejection> {
        sorted(self.rejected_unsubs.values().cloned())
    }

    pub fn is_rejected(&self, filter: &str) -> bool {
        self.rejected_subs.contains_key(filter)
    }

    pub fn rejected_count(&self) -> usize {
        self.rejected_subs.len()
    }

    /// Filters we sent a SUBSCRIBE/UNSUBSCRIBE for with no answer yet.
    pub fn awaiting(&self) -> usize {
        self.pending_sub.len() + self.pending_unsub.len()
    }

    pub fn unattributed(&self) -> (u64, u64) {
        (self.unattributed_sub, self.unattributed_unsub)
    }

    /// The session is gone: those packet ids will never be answered. Verdicts are
    /// kept because every registered filter is re-subscribed on the next CONNACK,
    /// and each re-subscription overwrites or clears its own entry.
    pub fn reset_pending(&mut self) {
        self.pending_sub.clear();
        self.pending_unsub.clear();
    }

    /// Full wipe, used when the connection is replaced.
    pub fn clear(&mut self) {
        self.reset_pending();
        self.rejected_subs.clear();
        self.rejected_unsubs.clear();
        self.quarantined.clear();
        self.downgraded.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_filter_one_reason_pairs_in_order() {
        let mut t = AckTracker::default();
        t.expect_sub("a/b");
        t.expect_sub("c/#");
        let out = t.apply_sub(&[0x00, 0x87], None, 10);
        assert_eq!(out.len(), 2);
        assert!(
            matches!(&out[0], Outcome::Granted { filter, granted_qos: Some(0) } if filter == "a/b"),
            "got {:?}",
            out[0]
        );
        match &out[1] {
            Outcome::Rejected(r) => {
                assert_eq!(r.filter, "c/#");
                assert_eq!(r.code, 0x87);
                assert_eq!(r.meaning, "not authorized (ACL)");
            }
            other => panic!("expected rejection, got {other:?}"),
        }
        assert!(t.is_rejected("c/#"));
        assert!(!t.is_rejected("a/b"));
        assert_eq!(t.awaiting(), 0);
    }

    #[test]
    fn a_later_grant_clears_the_stale_refusal() {
        let mut t = AckTracker::default();
        t.expect_sub("x/y");
        t.apply_sub(&[0x87], None, 1);
        assert!(t.is_rejected("x/y"));
        t.expect_sub("x/y");
        let out = t.apply_sub(&[0x01], None, 2);
        assert!(matches!(out[0], Outcome::Granted { .. }));
        assert!(!t.is_rejected("x/y"));
        assert_eq!(t.rejected_count(), 0);
    }

    #[test]
    fn surplus_reason_bytes_are_reported_not_guessed() {
        let mut t = AckTracker::default();
        t.expect_sub("only/one");
        let out = t.apply_sub(&[0x00, 0x87, 0x97], None, 1);
        assert!(matches!(out[0], Outcome::Granted { .. }));
        assert!(matches!(out[1], Outcome::Unattributed { code: 0x87 }));
        assert!(matches!(out[2], Outcome::Unattributed { code: 0x97 }));
        // An unattributed refusal must not mark a real subscription dead.
        assert_eq!(t.rejected_count(), 0);
        assert_eq!(t.unattributed(), (2, 0));
    }

    #[test]
    fn unsubscribing_clears_both_the_verdict_and_the_queue_slot() {
        let mut t = AckTracker::default();
        t.expect_sub("z/#");
        t.apply_sub(&[0x9e], None, 1);
        assert!(t.is_rejected("z/#"));
        t.forget("z/#");
        assert_eq!(t.rejected_count(), 0);
        assert_eq!(t.awaiting(), 0);
    }

    #[test]
    fn a_refused_unsubscribe_is_attributed_separately() {
        let mut t = AckTracker::default();
        t.expect_sub("live/one");
        t.apply_sub(&[0x00], None, 1);
        t.expect_unsub("gone/two");
        let out = t.apply_unsub(&[0x87], Some("acl".into()), 2);
        match &out[0] {
            Outcome::Rejected(r) => {
                assert_eq!(r.filter, "gone/two");
                assert_eq!(r.reason_string.as_deref(), Some("acl"));
                assert_eq!(r.meaning, describe_unsub(0x87));
            }
            other => panic!("expected rejection, got {other:?}"),
        }
        // "No subscription existed" is a note, not a refusal.
        t.expect_unsub("gone/three");
        let ok = t.apply_unsub(&[0x11], None, 3);
        assert!(matches!(ok[0], Outcome::Granted { .. }));
        assert_eq!(t.unsubscribe_rejections().len(), 1, "only the refused one");
        assert_eq!(t.unsubscribe_rejections()[0].filter, "gone/two");
        // Crucially, a refused unsubscribe does not paint a subscription dead.
        assert_eq!(t.rejected_count(), 0);
    }

    #[test]
    fn disconnect_drops_in_flight_slots_but_keeps_verdicts() {
        let mut t = AckTracker::default();
        t.expect_sub("answered/a");
        t.expect_sub("never_answered/b");
        let out = t.apply_sub(&[0x87], None, 1);
        // The single reason byte belongs to the first SUBSCRIBE we sent.
        match &out[0] {
            Outcome::Rejected(r) => assert_eq!(r.filter, "answered/a"),
            other => panic!("expected rejection, got {other:?}"),
        }
        assert_eq!(t.awaiting(), 1);
        t.reset_pending();
        assert_eq!(t.awaiting(), 0);
        assert_eq!(t.rejected_count(), 1);
        t.clear();
        assert_eq!(t.rejected_count(), 0);
    }

    #[test]
    fn a_restored_qos_clears_the_downgrade_note() {
        let mut t = AckTracker::default();
        t.note_granted_qos("a/b", 2, 1);
        t.note_granted_qos("c/d", 1, 1);
        assert_eq!(t.downgrade("a/b"), Some(1));
        assert_eq!(t.downgrade("c/d"), None);
        t.note_granted_qos("a/b", 2, 2);
        assert_eq!(t.downgrade("a/b"), None);
    }

    #[test]
    fn ack_state_gathers_all_three_verdicts_at_once() {
        let mut t = AckTracker::default();
        t.expect_sub("refused/#");
        t.apply_sub(&[0x87], None, 1);
        t.expect_sub("capped/#");
        t.apply_sub(&[0x00], None, 2);
        t.note_granted_qos("capped/#", 2, 0);
        t.expect_unsub("stuck/#");
        t.apply_unsub(&[0x83], None, 3);
        t.expect_sub("orphan/answer");
        t.apply_sub(&[0x00, 0x80], None, 4);

        let st = t.state();
        assert_eq!(st.rejected.len(), 1);
        assert_eq!(st.rejected[0].filter, "refused/#");
        assert_eq!(st.capped, vec![CappedSub { filter: "capped/#".into(), granted: 0 }]);
        assert_eq!(st.refused_unsubscribes[0].filter, "stuck/#");
        assert_eq!(st.unattributed, 1);
        // The refused unsubscribe must not appear as a dead subscription.
        assert_eq!(st.rejected.len(), 1, "unsub refusals stay in their own list");
    }

    #[test]
    fn an_error_delivered_refusal_is_attributed_to_the_oldest_in_flight_filter() {
        let mut t = AckTracker::default();
        t.expect_sub("first/a");
        t.expect_sub("second/b");
        // The first one was answered (and popped) before the broker killed the
        // session over the second.
        t.apply_sub(&[0x01], None, 1);
        let r = t
            .refuse_oldest_pending_sub(0x87, "SubFail { reason: NotAuthorized }", 2)
            .expect("one filter was in flight");
        assert_eq!(r.filter, "second/b");
        assert!(t.is_quarantined("second/b"), "replaying it would flap again");
        assert!(t.is_rejected("second/b"));
        // Nothing left in flight: the attribution says so rather than guessing.
        assert!(t.refuse_oldest_pending_sub(0x87, "x", 3).is_none());
        let u = t.refuse_oldest_pending_unsub(0x87, "UnsubFail", 4);
        assert!(u.is_none(), "no unsubscribe was in flight");
    }

    #[test]
    fn a_quarantined_filter_stays_out_until_the_user_asks_again() {
        let mut t = AckTracker::default();
        t.expect_sub("acl/denied/#");
        let outcomes = t.apply_sub(&[0x87], None, 1);
        let rejection = match &outcomes[0] {
            Outcome::Rejected(r) => r.clone(),
            other => panic!("expected a refusal, got {other:?}"),
        };
        t.quarantine(&rejection);
        assert!(t.is_quarantined("acl/denied/#"));
        assert_eq!(t.quarantined().len(), 1);
        // Re-subscribing is the release valve.
        t.expect_sub("acl/denied/#");
        assert!(!t.is_quarantined("acl/denied/#"));
        // So is removing the subscription.
        t.quarantine(&rejection);
        t.forget("acl/denied/#");
        assert!(!t.is_quarantined("acl/denied/#"));
    }

    #[test]
    fn suback_table_covers_every_code_rumqttc_can_produce() {
        // Bytes taken from MQTT 5 §3.2.2.2.0 as encoded by mqtt.js's
        // `mqtt-packet/constants.js` MQTT5_SUBACK_CODES.
        for code in [0x00u8, 0x01, 0x02, 0x80, 0x83, 0x87, 0x8f, 0x91, 0x97, 0x9e, 0xa1, 0xa2] {
            assert_ne!(describe_sub(code), "unrecognized reason code", "code {code:#x}");
            assert_eq!(is_error(code), code >= 0x80, "code {code:#x}");
        }
        assert_eq!(describe_sub(0xfe), "unrecognized reason code");
        // The trap this table exists to avoid: the QoS grants are 0x00..0x02 and
        // "topic filter invalid" is 0x8F, *not* 0x8E (which is a PUBLISH code).
        assert_eq!(describe_sub(0x8e), "unrecognized reason code");
        assert_eq!(describe_sub(0x8f), "topic filter invalid");
    }

    #[test]
    fn unsuback_and_puback_tables_match_their_own_code_sets() {
        for code in [0x00u8, 0x11, 0x80, 0x83, 0x87, 0x8f, 0x91] {
            assert_ne!(describe_unsub(code), "unrecognized reason code", "code {code:#x}");
        }
        for code in [0x00u8, 0x10, 0x80, 0x83, 0x87, 0x90, 0x91, 0x92, 0x97, 0x99] {
            assert_ne!(describe_pub(code), "unrecognized reason code", "code {code:#x}");
        }
        // "No matching subscribers" is the honest middle case: the broker took
        // the packet, nobody was there to receive it.
        assert!(!is_error(0x10));
        assert!(!is_plain_success(0x10));
        assert!(is_plain_success(0x00));
        assert_eq!(describe_pub(0x10), "no matching subscribers");
    }
}
