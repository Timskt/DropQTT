//! MQTT topic-filter matching, shared by the console, the bridge and the
//! silence watchdog.
//!
//! Lives in its own module rather than in `mqtt_manager` so that consumers
//! which do not need a broker connection (notably `watchdog`) can depend on it
//! without dragging the Tauri app handle along.

/// MQTT topic filter matching (RFC 3.1.1 §4.7 / RFC 8428 §4 for `$` topics):
/// '+' matches exactly one level, '#' matches the remaining levels, and topics
/// whose first level begins with '$' are never matched by a filter that does
/// not itself begin with '$'.
pub fn wildcard_match(filter: &str, topic: &str) -> bool {
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
    use super::{filter_topic_error, publish_topic_error, wildcard_match};

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
