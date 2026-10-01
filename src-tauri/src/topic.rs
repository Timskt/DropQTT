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

#[cfg(test)]
mod tests {
    use super::wildcard_match;

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
