//! MQTT5 request/response pairing.
//!
//! Deliberately free of Tauri, sockets and clocks passed in as arguments: the
//! registry is a pure state machine so the matching rules (which are the whole
//! risk of this feature) can be unit-tested without an app handle.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const DEFAULT_TIMEOUT_MS: u64 = 5_000;
pub const MIN_TIMEOUT_MS: u64 = 100;
pub const MAX_TIMEOUT_MS: u64 = 120_000;
/// Keep at most this many finished calls on screen until the user clears them.
const MAX_FINISHED_KEPT: usize = 100;
/// Retries beyond this are a device that is not answering, not a flaky link.
pub const MAX_ATTEMPTS: u8 = 5;
/// A broadcast collection this wide is a load test; use the bench lab for that.
pub const MAX_COLLECT: u8 = 32;

/// 0 means "not specified", which is one for both of these.
pub fn clamp_attempts(requested: u8) -> u8 {
    if requested == 0 {
        1
    } else {
        requested.min(MAX_ATTEMPTS)
    }
}

pub fn clamp_collect(requested: u8) -> u8 {
    if requested == 0 {
        1
    } else {
        requested.min(MAX_COLLECT)
    }
}

/// A timeout of 0 means "not specified"; anything else is clamped into the
/// band where a timer is still meaningful and a mistake is still survivable.
pub fn clamp_timeout(requested: u64) -> u64 {
    if requested == 0 {
        DEFAULT_TIMEOUT_MS
    } else {
        requested.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RpcState {
    Pending,
    Resolved,
    Timeout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcReply {
    pub topic: String,
    pub payload_base64: String,
    pub payload_len: usize,
    pub qos: u8,
    pub retain: bool,
    /// Correlation data exactly as it arrived, hex-encoded for display. It is an
    /// opaque byte string on the wire, so decoding it as UTF-8 would be a claim
    /// the bytes never made.
    pub correlation_hex: Option<String>,
    pub content_type: Option<String>,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcCall {
    pub id: String,
    pub request_topic: String,
    pub response_topic: String,
    pub correlation: String,
    pub sent_at_ms: i64,
    pub timeout_ms: u64,
    pub state: RpcState,
    pub rtt_ms: Option<u64>,
    pub reply: Option<RpcReply>,
    /// True when the reply carried no correlation data and was paired by order.
    /// Worth showing forever: it is a weaker claim than an exact match.
    #[serde(default)]
    pub paired_by_position: bool,
    /// Which send this is, 0-based: a retried request keeps the same correlation so
    /// a late answer to the first send still pairs.
    #[serde(default)]
    pub attempt: u8,
    #[serde(default = "one")]
    pub attempts_total: u8,
    /// A broadcast request stays pending until this many answers arrive.
    #[serde(default = "one")]
    pub expected: u8,
    /// Every answer received, in arrival order. `reply` stays the first one so
    /// existing readers keep working.
    #[serde(default)]
    pub replies: Vec<RpcReply>,
}

fn one() -> u8 {
    1
}

/// What the UI asks for. `response_topic` and `correlation_data` are optional:
/// the caller may let the backend generate both so it can send a plain request
/// and still get a matched answer.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcSpec {
    pub topic: String,
    #[serde(default)]
    pub payload_base64: String,
    #[serde(default)]
    pub qos: u8,
    #[serde(default)]
    pub retain: bool,
    #[serde(default)]
    pub timeout_ms: u64,
    #[serde(default)]
    pub response_topic: Option<String>,
    #[serde(default)]
    pub correlation_data: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub user_properties: Vec<(String, String)>,
    #[serde(default)]
    pub payload_format: Option<u8>,
    #[serde(default)]
    pub topic_alias: Option<u16>,
    /// Sends allowed before the call is written off as unanswered (1 = no retry).
    #[serde(default)]
    pub attempts: Option<u8>,
    /// Answers to wait for on a broadcast request (1 = one-to-one).
    #[serde(default)]
    pub collect: Option<u8>,
    #[serde(default)]
    pub message_expiry: Option<u32>,
}

#[derive(Default)]
pub struct RpcRegistry {
    calls: HashMap<String, RpcCall>,
    /// Insertion order, used both for FIFO pairing and for trimming.
    order: Vec<String>,
    timeouts: u64,
}

impl RpcRegistry {
    pub fn record(&mut self, call: RpcCall) {
        self.order.push(call.id.clone());
        self.calls.insert(call.id.clone(), call);
        self.trim_finished();
    }

    pub fn pending(&self) -> usize {
        self.calls.values().filter(|c| c.state == RpcState::Pending).count()
    }

    pub fn timeouts(&self) -> u64 {
        self.timeouts
    }

    /// Newest request first, which is how the panel lists them.
    pub fn snapshot(&self) -> Vec<RpcCall> {
        let mut rows: Vec<RpcCall> = self.order.iter().filter_map(|id| self.calls.get(id).cloned()).collect();
        rows.reverse();
        rows
    }

    pub fn get(&self, id: &str) -> Option<RpcCall> {
        self.calls.get(id).cloned()
    }

    /// Pair an inbound message against a pending request.
    ///
    /// A reply that carries correlation data must match it **byte for byte**
    /// against what we published; a reply that carries none (or a zero-length
    /// value, which says nothing) is paired with the oldest pending request on
    /// that topic, because plenty of devices just answer on the response topic.
    pub fn match_reply(
        &mut self,
        topic: &str,
        correlation: Option<&[u8]>,
        now_ms: i64,
        reply: RpcReply,
    ) -> Option<RpcCall> {
        let wanted = correlation.filter(|b| !b.is_empty());
        let mut pick: Option<(usize, bool)> = None; // (order index, paired_by_position)
        for (idx, id) in self.order.iter().enumerate() {
            let Some(call) = self.calls.get(id) else { continue };
            if call.state != RpcState::Pending || call.response_topic != topic {
                continue;
            }
            match wanted {
                Some(corr) => {
                    // The request went out as the UTF-8 bytes of this text, so
                    // that is the only fair comparison.
                    if call.correlation.as_bytes() == corr {
                        pick = Some((idx, false));
                        break;
                    }
                }
                None => {
                    pick = Some((idx, true));
                    break;
                }
            }
        }
        let (idx, paired_by_position) = pick?;
        let id = self.order.get(idx)?.clone();
        let call = self.calls.get_mut(&id)?;
        if call.rtt_ms.is_none() {
            // RTT is the first answer's, not the last: that is the number a person
            // reads off the panel when asking "how fast does this device reply".
            call.rtt_ms = Some((now_ms - call.sent_at_ms).max(0) as u64);
            call.reply = Some(reply.clone());
            call.paired_by_position = paired_by_position;
        }
        call.replies.push(reply);
        if call.replies.len() as u8 >= call.expected {
            call.state = RpcState::Resolved;
        }
        let matched = call.clone();
        self.trim_finished();
        Some(matched)
    }

    /// Claim one more send for a still-pending call. True means "retry, same
    /// correlation"; false means the call is finished or out of attempts, and the
    /// caller should let it expire instead.
    pub fn retry_slot(&mut self, id: &str) -> bool {
        let Some(call) = self.calls.get_mut(id) else { return false };
        if call.state != RpcState::Pending {
            return false;
        }
        if call.attempt + 1 >= call.attempts_total {
            return false;
        }
        call.attempt += 1;
        true
    }

    /// Fail a call whose answer never came. Returns None when the reply won the
    /// race, which is the whole point of keeping this on the same lock.
    pub fn expire(&mut self, id: &str) -> Option<RpcCall> {
        let call = self.calls.get_mut(id)?;
        if call.state != RpcState::Pending {
            return None;
        }
        call.state = RpcState::Timeout;
        self.timeouts += 1;
        let out = call.clone();
        self.trim_finished();
        Some(out)
    }

    /// A link that went away cannot answer, so every open call on it is finished
    /// as a timeout rather than left pending forever.
    pub fn expire_all(&mut self) -> Vec<RpcCall> {
        let mut out = Vec::new();
        for id in self.order.clone() {
            if let Some(call) = self.expire(&id) {
                out.push(call);
            }
        }
        out
    }

    pub fn clear_finished(&mut self) -> usize {
        let gone: Vec<String> = self
            .order
            .iter()
            .filter(|id| self.calls.get(*id).map(|c| c.state != RpcState::Pending).unwrap_or(true))
            .cloned()
            .collect();
        let n = gone.len();
        self.order.retain(|id| !gone.contains(id));
        for id in gone {
            self.calls.remove(&id);
        }
        n
    }

    fn trim_finished(&mut self) {
        let mut finished = self
            .order
            .iter()
            .filter(|id| self.calls.get(*id).map(|c| c.state != RpcState::Pending).unwrap_or(false))
            .cloned()
            .collect::<Vec<_>>();
        if finished.len() <= MAX_FINISHED_KEPT {
            return;
        }
        let drop_count = finished.len() - MAX_FINISHED_KEPT;
        let to_drop: Vec<String> = finished.drain(..drop_count).collect();
        self.order.retain(|id| !to_drop.contains(id));
        for id in to_drop {
            self.calls.remove(&id);
        }
    }
}

/// Reference-counted interest in response topics.
///
/// Two rules matter: the topic is only unsubscribed once the last call that
/// needed it is finished, and a topic the user already subscribed to by hand is
/// never unsubscribed on their behalf.
#[derive(Default)]
pub struct ResponseWatch {
    entries: HashMap<String, WatchEntry>,
}

#[derive(Debug, Clone, Copy)]
struct WatchEntry {
    refs: usize,
    mine: bool,
}

impl ResponseWatch {
    /// Call before the first publish that will use `topic` as its response
    /// topic. `already_subscribed` must reflect the user's own subscription
    /// list at that moment.
    pub fn acquire(&mut self, topic: &str, already_subscribed: bool) {
        let entry = self.entries.entry(topic.to_string()).or_insert(WatchEntry {
            refs: 0,
            mine: !already_subscribed,
        });
        entry.refs += 1;
    }

    /// Returns `Some(topic)` only when this release must unsubscribe it.
    pub fn release(&mut self, topic: &str) -> Option<String> {
        let entry = self.entries.get_mut(topic)?;
        entry.refs = entry.refs.saturating_sub(1);
        if entry.refs == 0 && entry.mine {
            self.entries.remove(topic);
            return Some(topic.to_string());
        }
        if entry.refs == 0 {
            // Borrowed from the user: forget the watch, keep their subscription.
            self.entries.remove(topic);
        }
        None
    }

    pub fn refs(&self, topic: &str) -> usize {
        self.entries.get(topic).map(|e| e.refs).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(id: &str, response_topic: &str, correlation: &str, sent_at_ms: i64) -> RpcCall {
        RpcCall {
            id: id.to_string(),
            request_topic: "dev/req".to_string(),
            response_topic: response_topic.to_string(),
            correlation: correlation.to_string(),
            sent_at_ms,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            state: RpcState::Pending,
            rtt_ms: None,
            reply: None,
            paired_by_position: false,
            attempt: 0,
            attempts_total: 1,
            expected: 1,
            replies: Vec::new(),
        }
    }

    /// Replies arrive as bytes, so the test helper speaks bytes too.
    fn reply(topic: &str, correlation: Option<&[u8]>) -> RpcReply {
        RpcReply {
            topic: topic.to_string(),
            payload_base64: "cG9uZw==".to_string(),
            payload_len: 4,
            qos: 1,
            retain: false,
            correlation_hex: correlation.map(hex::encode),
            content_type: None,
            timestamp_ms: 0,
        }
    }

    /// The manager stamps arrivals with its own clock; a test that cares about
    /// order has to say so per reply.
    fn stamped(topic: &str, correlation: Option<&[u8]>, at: i64) -> RpcReply {
        RpcReply {
            timestamp_ms: at,
            ..reply(topic, correlation)
        }
    }

    #[test]
    fn timeouts_are_clamped_into_a_usable_band() {
        assert_eq!(clamp_timeout(0), DEFAULT_TIMEOUT_MS);
        assert_eq!(clamp_timeout(1), MIN_TIMEOUT_MS);
        assert_eq!(clamp_timeout(5_000), 5_000);
        assert_eq!(clamp_timeout(9_999_999), MAX_TIMEOUT_MS);
    }

    #[test]
    fn a_reply_with_matching_correlation_resolves_with_round_trip() {
        let mut reg = RpcRegistry::default();
        reg.record(call("a", "dev/resp", "corr-a", 1_000));
        let matched = reg
            .match_reply("dev/resp", Some(b"corr-a"), 1_340, reply("dev/resp", Some(b"corr-a")))
            .expect("pairs");
        assert_eq!(matched.state, RpcState::Resolved);
        assert_eq!(matched.rtt_ms, Some(340));
        assert!(!matched.paired_by_position);
        assert_eq!(reg.pending(), 0);
        let stored = reg.get("a").expect("kept");
        assert_eq!(stored.reply.as_ref().unwrap().payload_base64, "cG9uZw==");
        assert_eq!(
            stored.reply.as_ref().unwrap().correlation_hex.as_deref(),
            Some("636f72722d61"),
            "the reply keeps what actually arrived, as hex"
        );
    }

    #[test]
    fn a_binary_reply_cannot_pair_through_a_lossy_text_decoding() {
        // The bug this guards: correlation data is an opaque byte string, and the
        // receiving side used to run it through `String::from_utf8_lossy` before
        // comparing. A device echoing 0xFF 0x00 became "\u{FFFD}\u{0}" - which is
        // precisely the text a user could paste back from an earlier log line, so
        // the old code would pair a reply with a request it had never seen.
        let mut reg = RpcRegistry::default();
        reg.record(call("a", "dev/resp", "\u{fffd}\u{0}", 1_000));
        let echoed = [0xffu8, 0x00];
        assert_ne!(
            "\u{fffd}\u{0}".as_bytes(),
            &echoed[..],
            "the replacement char encodes to EF BF BD, so these are different bytes"
        );
        assert!(
            reg.match_reply("dev/resp", Some(&echoed), 1_200, reply("dev/resp", Some(&echoed)))
                .is_none(),
            "bytes must be compared to bytes"
        );
        assert_eq!(reg.pending(), 1);
        // A reply that is genuinely not text still records what arrived.
        let note = reply("dev/resp", Some(&echoed));
        assert_eq!(note.correlation_hex.as_deref(), Some("ff00"));
    }

    #[test]
    fn the_bytes_of_a_text_correlation_still_pair_exactly() {
        // The positive half: the common case did not regress, because the request
        // went out as these same UTF-8 bytes.
        let mut reg = RpcRegistry::default();
        reg.record(call("a", "dev/resp", "\u{fffd}\u{0}", 1_000));
        let bytes = "\u{fffd}\u{0}".as_bytes();
        let matched = reg
            .match_reply("dev/resp", Some(bytes), 1_200, reply("dev/resp", Some(bytes)))
            .expect("pairs");
        assert!(!matched.paired_by_position);
    }

    #[test]
    fn padding_in_the_reply_is_not_trimmed_away() {
        // MQTT says correlation data is echoed verbatim. A device that pads it is
        // broken, and the honest response is a visible timeout whose row shows the
        // hex — not a pairing invented by trimming.
        let mut reg = RpcRegistry::default();
        reg.record(call("a", "dev/resp", "corr-a", 1_000));
        assert!(reg
            .match_reply("dev/resp", Some(b"corr-a "), 1_200, reply("dev/resp", Some(b"corr-a ")))
            .is_none());
        assert_eq!(reg.pending(), 1);
    }

    #[test]
    fn a_blank_correlation_pairs_by_position_not_by_luck() {
        let mut reg = RpcRegistry::default();
        reg.record(call("old", "dev/resp", "corr-old", 1_000));
        reg.record(call("new", "dev/resp", "corr-new", 1_500));
        let first = reg
            .match_reply("dev/resp", None::<&[u8]>, 1_800, reply("dev/resp", None))
            .expect("pairs");
        assert_eq!(first.id, "old");
        assert!(first.paired_by_position);
        let second = reg
            .match_reply("dev/resp", Some(b""), 1_900, reply("dev/resp", Some(b"")))
            .expect("pairs");
        assert_eq!(second.id, "new");
        assert!(second.paired_by_position);
        assert!(
            reg.get("old").unwrap().paired_by_position,
            "the weaker pairing claim must stay on the stored row, not only in the event"
        );
    }

    #[test]
    fn a_reply_naming_somebody_else_is_not_ours() {
        let mut reg = RpcRegistry::default();
        reg.record(call("a", "dev/resp", "corr-a", 1_000));
        assert!(reg
            .match_reply("dev/resp", Some(b"corr-zzz"), 1_200, reply("dev/resp", Some(b"corr-zzz")))
            .is_none());
        assert_eq!(reg.pending(), 1);
        assert!(reg
            .match_reply("dev/other", Some(b"corr-a"), 1_200, reply("dev/other", Some(b"corr-a")))
            .is_none());
        assert_eq!(reg.pending(), 1);
    }

    #[test]
    fn the_first_reply_wins_a_double_answer() {
        let mut reg = RpcRegistry::default();
        reg.record(call("a", "dev/resp", "corr-a", 1_000));
        reg.match_reply("dev/resp", Some(b"corr-a"), 1_100, reply("dev/resp", Some(b"corr-a")))
            .unwrap();
        assert!(reg
            .match_reply("dev/resp", Some(b"corr-a"), 9_000, reply("dev/resp", Some(b"corr-a")))
            .is_none());
        assert_eq!(reg.snapshot()[0].rtt_ms, Some(100));
    }

    #[test]
    fn expiry_only_touches_pending_calls_and_counts_it() {
        let mut reg = RpcRegistry::default();
        reg.record(call("a", "dev/resp", "corr-a", 1_000));
        reg.record(call("b", "dev/resp", "corr-b", 1_000));
        reg.match_reply("dev/resp", Some(b"corr-b"), 1_200, reply("dev/resp", Some(b"corr-b")))
            .unwrap();
        assert!(reg.expire("b").is_none(), "a resolved call must not also time out");
        let timed = reg.expire("a").expect("pending call expires");
        assert_eq!(timed.state, RpcState::Timeout);
        assert_eq!(reg.timeouts(), 1);
        assert_eq!(reg.pending(), 0);
        assert!(reg.expire("missing-id").is_none());
    }

    #[test]
    fn a_dropped_link_times_out_every_open_call_at_once() {
        let mut reg = RpcRegistry::default();
        reg.record(call("a", "dev/resp", "corr-a", 1_000));
        reg.record(call("b", "dev/resp", "corr-b", 1_000));
        reg.match_reply("dev/resp", Some(b"corr-b"), 1_200, reply("dev/resp", Some(b"corr-b")))
            .unwrap();
        let gone = reg.expire_all();
        assert_eq!(gone.len(), 1, "only the still-pending call is reported");
        assert_eq!(gone[0].id, "a");
        assert_eq!(reg.timeouts(), 1);
        assert_eq!(reg.pending(), 0);
        assert!(reg.expire_all().is_empty(), "nothing left to expire");
    }

    #[test]
    fn clear_finished_keeps_the_calls_still_waiting() {
        let mut reg = RpcRegistry::default();
        reg.record(call("a", "dev/resp", "corr-a", 1_000));
        reg.record(call("b", "dev/resp", "corr-b", 1_000));
        reg.match_reply("dev/resp", Some(b"corr-b"), 1_200, reply("dev/resp", Some(b"corr-b")))
            .unwrap();
        assert_eq!(reg.clear_finished(), 1);
        assert_eq!(reg.snapshot().len(), 1);
        assert_eq!(reg.snapshot()[0].id, "a");
    }

    #[test]
    fn rows_are_listed_newest_request_first() {
        let mut reg = RpcRegistry::default();
        reg.record(call("a", "dev/resp", "corr-a", 1_000));
        reg.record(call("b", "dev/resp", "corr-b", 2_000));
        let ids: Vec<String> = reg.snapshot().iter().map(|c| c.id.clone()).collect();
        assert_eq!(ids, vec!["b".to_string(), "a".to_string()]);
    }

    #[test]
    fn a_borrowed_response_topic_is_never_unsubscribed_for_the_user() {
        let mut watch = ResponseWatch::default();
        watch.acquire("dev/resp", true);
        watch.acquire("dev/resp", true);
        assert_eq!(watch.refs("dev/resp"), 2);
        assert_eq!(watch.release("dev/resp"), None);
        assert_eq!(watch.release("dev/resp"), None, "pre-existing subscription stays");
        assert_eq!(watch.refs("dev/resp"), 0);
    }

    #[test]
    fn a_topic_we_created_is_released_only_by_the_last_call() {
        let mut watch = ResponseWatch::default();
        watch.acquire("dev/resp", false);
        watch.acquire("dev/resp", false);
        assert_eq!(watch.release("dev/resp"), None);
        assert_eq!(watch.refs("dev/resp"), 1);
        assert_eq!(watch.release("dev/resp").as_deref(), Some("dev/resp"));
        assert_eq!(watch.refs("dev/resp"), 0);
        assert_eq!(watch.release("dev/resp"), None, "releasing twice must not double-unsubscribe");
    }

    #[test]
    fn ownership_is_sticky_so_a_borrowed_topic_is_never_taken_away() {
        let mut watch = ResponseWatch::default();
        // The first call finds the user already subscribed, so the topic is
        // borrowed for as long as we hold refs -- even if a later call would
        // have created it itself.
        watch.acquire("dev/resp", true);
        watch.acquire("dev/resp", false);
        assert_eq!(watch.refs("dev/resp"), 2);
        assert_eq!(watch.release("dev/resp"), None);
        assert_eq!(
            watch.release("dev/resp"),
            None,
            "unsubscribing here would take away a subscription the user made"
        );
        assert_eq!(watch.refs("dev/resp"), 0);
    }

    #[test]
    fn finished_rows_are_trimmed_without_touching_pending_ones() {
        let mut reg = RpcRegistry::default();
        reg.record(call("pending", "dev/resp", "p", 1_000));
        for i in 0..(MAX_FINISHED_KEPT + 40) {
            let id = format!("f{i}");
            reg.record(call(&id, "dev/resp", &id, 2_000));
            reg.match_reply("dev/resp", Some(id.as_bytes()), 2_100, reply("dev/resp", Some(id.as_bytes())))
                .unwrap();
        }
        let rows = reg.snapshot();
        assert_eq!(rows.len(), MAX_FINISHED_KEPT + 1, "trimming caps finished rows");
        assert!(rows.iter().any(|c| c.id == "pending"), "pending rows are never dropped");
    }

    fn collecting(id: &str, expected: u8) -> RpcCall {
        RpcCall {
            expected,
            ..call(id, "dev/resp", id, 1_000)
        }
    }

    #[test]
    fn a_broadcast_request_waits_for_every_answer_it_asked_for() {
        let mut reg = RpcRegistry::default();
        reg.record(collecting("c1", 3));
        let first = reg
            .match_reply("dev/resp", Some("c1".as_bytes()), 1_100, stamped("dev/resp", Some(b"c1"), 1_100))
            .expect("paired");
        assert_eq!(first.state, RpcState::Pending, "one of three is not an answer");
        assert_eq!(first.rtt_ms, Some(100), "RTT is the first reply's");
        let second = reg
            .match_reply("dev/resp", Some("c1".as_bytes()), 1_200, stamped("dev/resp", Some(b"c1"), 1_200))
            .expect("paired again");
        assert_eq!(second.state, RpcState::Pending);
        let third = reg
            .match_reply("dev/resp", Some("c1".as_bytes()), 1_300, stamped("dev/resp", Some(b"c1"), 1_300))
            .expect("third closes it");
        assert_eq!(third.state, RpcState::Resolved);
        assert_eq!(third.replies.len(), 3);
        // The headline reply stays the first one, so a single-answer reader is unaffected.
        assert_eq!(third.reply.expect("first reply").timestamp_ms, 1_100);
        assert_eq!(third.rtt_ms, Some(100));
    }

    #[test]
    fn a_broadcast_that_never_fills_up_reports_what_it_did_hear() {
        let mut reg = RpcRegistry::default();
        reg.record(collecting("c1", 3));
        reg.match_reply("dev/resp", Some("c1".as_bytes()), 1_100, reply("dev/resp", Some(b"c1")));
        let expired = reg.expire("c1").expect("still pending, so it expires");
        assert_eq!(expired.state, RpcState::Timeout);
        assert_eq!(expired.replies.len(), 1, "partial answers are not discarded");
        assert_eq!(reg.timeouts(), 1);
    }

    #[test]
    fn retry_slots_run_out_and_a_resolved_call_needs_another() {
        let mut reg = RpcRegistry::default();
        reg.record(RpcCall {
            attempts_total: 3,
            ..call("r1", "dev/resp", "r1", 1_000)
        });
        assert!(reg.retry_slot("r1"));
        assert!(reg.retry_slot("r1"));
        assert!(!reg.retry_slot("r1"), "three sends is what was asked for");
        assert_eq!(reg.get("r1").unwrap().attempt, 2);

        let mut reg = RpcRegistry::default();
        reg.record(collecting("done", 1));
        reg.match_reply("dev/resp", Some("done".as_bytes()), 1_100, reply("dev/resp", Some(b"done")));
        assert!(!reg.retry_slot("done"), "it already answered");
        assert!(!reg.retry_slot("ghost"), "a cleared call cannot be retried");
    }

    #[test]
    fn the_clamps_keep_one_where_zero_means_unspecified() {
        assert_eq!(clamp_attempts(0), 1);
        assert_eq!(clamp_attempts(2), 2);
        assert_eq!(clamp_attempts(200), MAX_ATTEMPTS);
        assert_eq!(clamp_collect(0), 1);
        assert_eq!(clamp_collect(8), 8);
        assert_eq!(clamp_collect(255), MAX_COLLECT);
    }
}
