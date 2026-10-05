//! MQTT topic-filter matching, shared by the console, the bridge and the
//! silence watchdog.
//!
//! Lives in its own module rather than in `mqtt_manager` so that consumers
//! which do not need a broker connection (notably `watchdog`) can depend on it
//! without dragging the Tauri app handle along.

use std::collections::HashMap;

/// MQTT5 shared subscription marker (spec §4.8.2): `$share/<ShareName>/<TopicFilter>`.
pub const SHARE_PREFIX: &str = "$share";

/// The two parts of a shared subscription filter.
#[derive(Debug, PartialEq, Eq)]
pub struct SharedFilter<'a> {
    pub share_name: &'a str,
    pub filter: &'a str,
}

/// Recognise `$share/<name>/<filter>`. Anything else is an ordinary filter.
pub fn parse_shared(filter: &str) -> Option<SharedFilter<'_>> {
    let mut segs = filter.splitn(3, '/');
    match (segs.next(), segs.next(), segs.next()) {
        (Some(SHARE_PREFIX), Some(name), Some(inner)) if !name.is_empty() && !inner.is_empty() => {
            Some(SharedFilter { share_name: name, filter: inner })
        }
        _ => None,
    }
}

/// Why a shared filter is malformed. A share name that contains `/` would shift
/// the boundary between group and topic filter, and a nested `$share` has no
/// meaning any broker implements.
pub fn shared_filter_error(filter: &str) -> Option<String> {
    let shared = parse_shared(filter)?;
    if shared.share_name.contains('+') || shared.share_name.contains('#') || shared.share_name.contains('/') {
        return Some("a share name may not contain '/', '+' or '#'".to_string());
    }
    if shared.share_name.starts_with('$') {
        // '$' leads are reserved for broker-defined system topics; a group
        // named that way is either a typo or a doubled-up `$share/$share/...`.
        return Some("a share name may not begin with '$' (reserved by brokers)".to_string());
    }
    if shared.filter.starts_with(&format!("{SHARE_PREFIX}/")) {
        return Some("a shared subscription cannot wrap another shared subscription".to_string());
    }
    None
}

/// MQTT topic filter matching (RFC 3.1.1 §4.7 / RFC 8428 §4 for `$` topics):
/// '+' matches exactly one level, '#' matches the remaining levels, and topics
/// whose first level begins with '$' are never matched by a filter that does
/// not itself begin with '$'.
///
/// A shared filter is matched on its **inner** filter: the broker strips
/// `$share/<group>/` before delivering, so the subscriber sees ordinary topic
/// names. Without that, a shared subscription would count zero hits while
/// visibly receiving messages.
pub fn wildcard_match(filter: &str, topic: &str) -> bool {
    let filter = parse_shared(filter).map(|s| s.filter).unwrap_or(filter);
    let f: Vec<&str> = filter.split('/').collect();
    let t: Vec<&str> = topic.split('/').collect();
    // System topics ($...) are only matched by filters that name them explicitly
    if t[0].starts_with('$') && !f[0].starts_with('$') {
        return false;
    }
    for (i, seg) in f.iter().enumerate() {
        match *seg {
            "#" => return i == f.len() - 1, // '#' must be last; matches remaining
            "+" => {
                if i >= t.len() {
                    return false;
                }
            }
            s => {
                if i >= t.len() || s != t[i] {
                    return false;
                }
            }
        }
    }
    f.len() == t.len()
}

/// Longest topic name MQTT allows (two-byte length prefix in the packet).
pub const MAX_TOPIC_LEN: usize = 65535;

/// Which of our filters a publish matched, according to the broker.
///
/// A v5 broker that supports Subscription Identifiers tags each delivered
/// publish with the ids of the subscriptions it matched (MQTT 5 §3.3.2.3.1).
/// That is the broker's own match, so it is both cheaper than rescanning every
/// filter and more accurate than guessing from the topic alone — but it only
/// answers for ids we handed out. An id we do not recognise is left out rather
/// than guessed at: inventing a filter here would attribute traffic to a
/// subscription the user never made.
pub fn matched_by_ids(ids: &[u32], by_id: &HashMap<u32, String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(filter) = by_id.get(id) {
            if !out.contains(filter) {
                out.push(filter.clone());
            }
        }
    }
    out
}

/// Which of our filters a publish matches, computed here.
///
/// The fallback for v3.1.1 (no such property) and for brokers that were told
/// they could not use it. Shared filters match on their inner filter, which
/// `wildcard_match` already handles.
pub fn matched_by_scan<'a, I: Iterator<Item = &'a String>>(topic: &str, filters: I) -> Vec<String> {
    filters
        .filter(|f| wildcard_match(f, topic))
        .cloned()
        .collect()
}

/// Why a string may not be used as a *publish* topic.
///
/// Wildcards are illegal in a PUBLISH (MQTT 5 §3.3.2.2 / 3.1.1 §4.7): a broker
/// may drop the packet, reject it, or -- on some builds -- tear down the whole
/// session. Empty levels are equally malformed. So the tool checks before it
/// sends, instead of letting a typo cost the user their connection.
///
/// `$`-prefixed topics are deliberately allowed through: publishing to `$SYS/…`
/// is a broker policy question, and a debugging client that refuses to try it
/// cannot show what the broker actually does.
pub fn publish_topic_error(topic: &str) -> Option<String> {
    if topic.is_empty() {
        return Some("Topic must not be empty".to_string());
    }
    if topic.contains('#') || topic.contains('+') {
        return Some("A publish topic may not contain wildcards ('+' or '#')".to_string());
    }
    if topic.contains('\0') {
        return Some("Topic may not contain a NUL character".to_string());
    }
    if topic.len() > MAX_TOPIC_LEN {
        return Some(format!("Topic is longer than the {}-byte MQTT limit", MAX_TOPIC_LEN));
    }
    if topic.split('/').any(|seg| seg.is_empty()) {
        return Some("Topic contains an empty level (check for a leading, trailing or doubled '/')".to_string());
    }
    None
}

/// Why a string may not be used as a *subscription filter*.
pub fn filter_topic_error(filter: &str) -> Option<String> {
    if filter.is_empty() {
        return Some("Topic filter must not be empty".to_string());
    }
    if filter.contains('\0') {
        return Some("Filter may not contain a NUL character".to_string());
    }
    if filter.len() > MAX_TOPIC_LEN {
        return Some(format!("Filter is longer than the {}-byte MQTT limit", MAX_TOPIC_LEN));
    }
    let segs: Vec<&str> = filter.split('/').collect();
    if segs.iter().any(|s| s.is_empty()) {
        return Some("Filter contains an empty level (check for a leading, trailing or doubled '/')".to_string());
    }
    for (i, seg) in segs.iter().enumerate() {
        if seg.contains('#') && (*seg != "#" || i != segs.len() - 1) {
            return Some("'#' is only valid as the last level on its own".to_string());
        }
        if seg.contains('+') && *seg != "+" {
            return Some("'+' must occupy a whole level, not sit inside one".to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        filter_topic_error, matched_by_ids, matched_by_scan, parse_shared, publish_topic_error,
        shared_filter_error, wildcard_match,
    };
    use std::collections::HashMap;

    #[test]
    fn broker_ids_resolve_to_the_filters_we_handed_them_out_for() {
        let mut by_id = HashMap::new();
        by_id.insert(1u32, "sensors/#".to_string());
        by_id.insert(2u32, "sensors/room1/temp".to_string());
        assert_eq!(
            matched_by_ids(&[2, 1], &by_id),
            vec!["sensors/room1/temp".to_string(), "sensors/#".to_string()]
        );
        // One delivery can legitimately carry the same id twice only if the broker
        // repeated it; counting it once keeps a hit total from inflating.
        assert_eq!(matched_by_ids(&[1, 1], &by_id), vec!["sensors/#".to_string()]);
    }

    #[test]
    fn an_id_we_never_issued_is_left_out_instead_of_guessed_at() {
        let mut by_id = HashMap::new();
        by_id.insert(1u32, "a/#".to_string());
        // 7 is not ours. Inventing a filter for it would attribute traffic to a
        // subscription the user never made, which is worse than saying nothing.
        assert_eq!(matched_by_ids(&[7], &by_id), Vec::<String>::new());
        assert_eq!(matched_by_ids(&[7, 1], &by_id), vec!["a/#".to_string()]);
    }

    #[test]
    fn the_broker_answer_is_trusted_over_our_own_match() {
        // If the broker says id 1 matched, we report that filter even if our
        // local matcher disagrees. The whole value of the identifier is that the
        // broker owns the matching rules (shared groups, $-topic policy, etc).
        let mut by_id = HashMap::new();
        by_id.insert(1u32, "sensors/temp".to_string());
        let matched = matched_by_ids(&[1], &by_id);
        assert_eq!(matched, vec!["sensors/temp".to_string()]);
        assert!(!wildcard_match("sensors/temp", "sensors/humidity"));
    }

    #[test]
    fn the_local_scan_is_the_fallback_and_honours_shared_filters() {
        let subs: Vec<String> = vec![
            "$share/g1/sensors/+".to_string(),
            "sensors/#".to_string(),
            "other/x".to_string(),
        ];
        let mut matched = matched_by_scan("sensors/room1", subs.iter());
        matched.sort();
        assert_eq!(
            matched,
            vec!["$share/g1/sensors/+".to_string(), "sensors/#".to_string()],
            "a shared group and a wildcard can both cover the same delivery"
        );
        let mut wide = matched_by_scan("sensors/room1/temp", subs.iter());
        wide.sort();
        assert_eq!(wide, vec!["sensors/#".to_string()]);
        assert!(matched_by_scan("nothing/here", subs.iter()).is_empty());
    }

    #[test]
    fn a_shared_filter_matches_on_its_inner_filter() {
        // The broker delivers plain topic names to shared members, so hit
        // accounting has to compare against what actually arrives.
        assert!(wildcard_match("$share/g1/sensors/temp", "sensors/temp"));
        assert!(wildcard_match("$share/g1/sensors/#", "sensors/room1/temp"));
        assert!(wildcard_match("$share/consumers/edge/+/data", "edge/a/data"));
        assert!(!wildcard_match("$share/g1/sensors/temp", "sensors/humidity"));
        // The delivered topic still obeys the normal $ rule.
        assert!(!wildcard_match("$share/g1/#", "$SYS/broker/uptime"));
        assert!(wildcard_match("$share/g1/$SYS/broker/uptime", "$SYS/broker/uptime"));
    }

    #[test]
    fn shared_filters_are_parsed_only_when_complete() {
        assert_eq!(
            parse_shared("$share/g1/a/b"),
            Some(super::SharedFilter { share_name: "g1", filter: "a/b" })
        );
        assert_eq!(parse_shared("$share//a"), None, "empty share name");
        assert_eq!(parse_shared("$share/g1/"), None, "empty topic filter");
        assert_eq!(parse_shared("$share/g1"), None, "no topic filter at all");
        assert_eq!(parse_shared("a/b"), None);
    }

    #[test]
    fn share_names_may_not_re_enter_the_topic_tree() {
        assert!(shared_filter_error("$share/g1/a/b").is_none());
        assert!(shared_filter_error("$share/a+b/c").is_some(), "wildcard in share name");
        assert!(shared_filter_error("$share/a#/#").is_some());
        assert!(
            shared_filter_error("$share/g/$share/x/#").is_some(),
            "inner filter that is itself shared"
        );
        assert!(
            shared_filter_error("$share/$share/x/#").is_some(),
            "a $-led group is reserved, and here it is a doubled prefix"
        );
        // Ordinary filters are not this rule's business.
        assert!(shared_filter_error("a/+").is_none());
    }

    #[test]
    fn the_filter_validator_accepts_well_formed_shared_filters() {
        assert!(filter_topic_error("$share/g1/sensors/#").is_none());
        assert!(filter_topic_error("$share/g1/").is_some(), "trailing empty level");
    }

    #[test]
    fn publish_topics_reject_wildcards_anywhere() {
        assert!(publish_topic_error("dropqtt/+/status").is_some());
        assert!(publish_topic_error("dropqtt/status/#").is_some());
        assert!(publish_topic_error("a/b+#/c").is_some());
        assert!(publish_topic_error("room/devices").is_none());
    }

    #[test]
    fn publish_topics_reject_malformed_names() {
        assert!(publish_topic_error("").is_some());
        assert!(publish_topic_error("a//b").is_some());
        assert!(publish_topic_error("/a/b").is_some());
        assert!(publish_topic_error("a/b/").is_some());
        assert!(publish_topic_error("a\0b").is_some());
        assert!(publish_topic_error(&"a".repeat(70000)).is_some());
    }

    #[test]
    fn publish_topics_still_allow_dollar_prefixed_names() {
        // Deliberate: the broker is the authority on $SYS writes, and a debug
        // client must be able to observe that refusal.
        assert!(publish_topic_error("$SYS/test").is_none());
    }

    #[test]
    fn filters_accept_the_legal_wildcard_shapes() {
        assert!(filter_topic_error("a/#").is_none());
        assert!(filter_topic_error("a/+/c").is_none());
        assert!(filter_topic_error("#").is_none());
        assert!(filter_topic_error("+/+").is_none());
        assert!(filter_topic_error("$SYS/#").is_none());
    }

    #[test]
    fn filters_reject_the_illegal_wildcard_shapes() {
        assert!(filter_topic_error("a/#/c").is_some(), "'#' must be last");
        assert!(filter_topic_error("a/b#").is_some(), "'#' must be a whole level");
        assert!(filter_topic_error("a/b+c").is_some(), "'+' must be a whole level");
        assert!(filter_topic_error("a//b").is_some());
        assert!(filter_topic_error("").is_some());
    }
    #[test]
    fn exact_match() {
        assert!(wildcard_match("a/b", "a/b"));
        assert!(!wildcard_match("a/b", "a/b/c"));
        assert!(!wildcard_match("a/b/c", "a/b"));
    }

    #[test]
    fn single_level_wildcard() {
        assert!(wildcard_match("a/+/c", "a/b/c"));
        assert!(wildcard_match("a/+/c", "a/x/c"));
        assert!(!wildcard_match("a/+/c", "a/b"));
        assert!(!wildcard_match("a/+/c", "a/b/c/d"));
    }

    #[test]
    fn multi_level_wildcard() {
        assert!(wildcard_match("a/#", "a/b"));
        assert!(wildcard_match("a/#", "a/b/c/d"));
        assert!(wildcard_match("a/b/#", "a/b")); // parents/# matches the parent
        assert!(wildcard_match("#", "anything/at/all"));
        assert!(!wildcard_match("a/#", "b/c"));
    }

    #[test]
    fn system_topics() {
        assert!(!wildcard_match("#", "$SYS/broker/uptime"));
        assert!(!wildcard_match("a/+", "$SYS/a/b"));
        assert!(wildcard_match("$SYS/#", "$SYS/broker/uptime"));
        assert!(wildcard_match("$SYS/broker/uptime", "$SYS/broker/uptime"));
    }
}
