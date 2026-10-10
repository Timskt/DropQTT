//! Runtime diagnostics and health checks for the operations workspace.
//!
//! The snapshot is intentionally boring machine-readable data: no passwords,
//! usernames, PEM paths or message payloads are included. Everything is either
//! process/runtime metadata, aggregate counters or a local health result.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use serde::Serialize;

use crate::history::HistoryStats;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub generated_at: i64,
    /// Seconds this process has been alive.
    ///
    /// The message counters start over on a restart, so without this a scrape cannot
    /// tell "traffic stopped" from "the app was restarted" — and the two send very
    /// different people to look at it.
    pub uptime_secs: u64,
}

static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// Stamp the process start. Called once from `run()`, so the uptime is "how long this
/// process existed", not "how long someone has had the panel open".
pub fn mark_start() {
    let _ = START.set(std::time::Instant::now());
}

pub fn uptime_secs() -> u64 {
    START.get().map(|s| s.elapsed().as_secs()).unwrap_or(0)
}

/// Rolling timing for a repeating operation, over the last `WINDOW` calls.
///
/// We were bitten by Windows' ~15 ms timer granularity while chasing a throughput
/// ceiling, and the only clue available afterwards was a guess. This is the
/// instrument that would have named it: a rising `maxMs` on the feed flusher means
/// the app itself cannot keep up, regardless of what the broker is doing.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DurationStats {
    /// Samples inside the window (grows to `WINDOW`, then stays).
    pub window: usize,
    /// Total calls recorded since the app started, never trimmed.
    pub total_calls: u64,
    pub avg_ms: u64,
    pub max_ms: u64,
}

const STATS_WINDOW: usize = 256;

#[derive(Debug, Clone)]
pub struct Timing {
    ring: [u32; STATS_WINDOW],
    len: usize,
    next: usize,
    total_calls: u64,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            ring: [0; STATS_WINDOW],
            len: 0,
            next: 0,
            total_calls: 0,
        }
    }
}

impl Timing {
    pub fn record(&mut self, ms: u64) {
        self.ring[self.next] = ms.min(u32::MAX as u64) as u32;
        self.next = (self.next + 1) % STATS_WINDOW;
        self.len = self.len.min(STATS_WINDOW - 1) + 1;
        self.total_calls += 1;
    }

    pub fn snapshot(&self) -> DurationStats {
        let live = &self.ring[..self.len];
        let sum: u64 = live.iter().map(|v| *v as u64).sum();
        DurationStats {
            window: live.len(),
            total_calls: self.total_calls,
            avg_ms: if live.is_empty() { 0 } else { sum / live.len() as u64 },
            max_ms: live.iter().copied().max().unwrap_or(0) as u64,
        }
    }
}

/// The app's own timings, gathered where the work actually happens.
#[derive(Debug, Default)]
pub struct SelfTiming {
    pub flush: Timing,
    pub lag: Timing,
    pub history: Timing,
    last_flush: Option<std::time::Instant>,
}

impl SelfTiming {
    /// Called at the top of a flush tick; returns how late this tick was against
    /// the cadence, which is the number that says "the runtime is starved".
    pub fn note_flush_start(&mut self, now: std::time::Instant, cadence: std::time::Duration) -> Option<u64> {
        let late = self
            .last_flush
            .map(|prev| now.saturating_duration_since(prev).saturating_sub(cadence).as_millis() as u64);
        self.last_flush = Some(now);
        if let Some(ms) = late {
            self.lag.record(ms);
        }
        late
    }

    pub fn note_flush_end(&mut self, started: std::time::Instant) {
        self.flush.record(started.elapsed().as_millis() as u64);
    }

    pub fn note_history(&mut self, started: std::time::Instant) {
        self.history.record(started.elapsed().as_millis() as u64);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttDiagnostics {
    pub configured: bool,
    pub connected: bool,
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub use_tls: bool,
    pub use_websocket: bool,
    pub protocol_version: u8,
    pub subscriptions: usize,
    pub incoming_active: usize,
    pub outgoing_active: usize,
    pub feed_buffered: usize,
    pub feed_buffer_capacity: usize,
    pub feed_dropped: u64,
    /// Evicted from the display buffer *and* lost from history because the
    /// archive queue was saturated. Non-zero means retention is incomplete.
    pub feed_lost: u64,
    /// Sends whose peer never sent a receipt, this session
    pub confirm_timeouts: u64,
    /// Request/response calls still waiting for an answer right now
    pub rpc_pending: usize,
    /// Request/response calls that were never answered, this session
    pub rpc_timeouts: u64,
    /// Subscriptions the broker refuses right now (SUBACK >= 0x80). Non-zero means
    /// the console is showing a subscription that receives nothing.
    pub subscriptions_rejected: usize,
    /// Unsubscribes the broker refuses. The app already dropped them locally, so
    /// the broker may still be delivering on them.
    pub unsubscribes_rejected: usize,
    /// Ack reason bytes with no filter of ours waiting for them
    pub acks_unattributed: u64,
    /// Publishes answered with a refusal this session (PUBACK/PUBREC/PUBCOMP)
    pub publish_rejected: u64,
    /// Application publishes delivered to us since the process started.
    ///
    /// Counted where the traffic meter is counted, so the two agree by construction and
    /// share its exclusions: broker `$SYS` deliveries and our own fault-injected drops
    /// are in neither. Separate from the per-topic counters because those are resettable
    /// and the history row count falls when retention prunes, so neither can serve as
    /// the monotonic base a `rate()` needs. This one answers "did traffic stop?".
    pub received_total: u64,
    /// Publishes we handed to the client since the process started
    pub sent_total: u64,
    pub topic_stats_count: usize,
    /// Backend-scheduled publishes still running
    pub scheduled_runs: usize,
    /// Bench lab runs still publishing
    pub bench_runs: usize,
    pub history_available: bool,
    pub history: HistoryStats,
    pub download_dir: String,
    pub download_dir_writable: bool,
    pub download_dir_error: Option<String>,
    /// How long the batched feed flush took (last 256 flushes)
    pub feed_flush: DurationStats,
    /// How late the flusher woke compared with its 100 ms cadence
    pub feed_lag: DurationStats,
    /// How long a history batch write took
    pub history_write: DurationStats,
    /// Fault rules armed right now. Non-zero means this session's traffic conditions
    /// are not the network's doing, and that has to be said before anyone spends an
    /// afternoon diagnosing a broker that was fine.
    pub fault_rules: usize,
    /// Messages dropped, delayed, duplicated, corrupted or mis-correlated by us
    pub fault_actions: u64,
    /// Scripted-responder rules armed: this app is answering traffic as a device
    pub responder_rules: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeDiagnostics {
    pub total_connections: usize,
    pub connected_connections: usize,
    pub configured_rules: usize,
    pub enabled_rules: usize,
    pub forwarded: u64,
    pub errors: u64,
    pub dropped: u64,
    /// Stopped by the bridge's hop cap. Reported apart from `dropped` because the fix is
    /// in the rule set — a loop is not the exclusion filter working as written.
    pub loop_broken: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub id: String,
    /// ok | warn | error
    pub level: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub runtime: RuntimeInfo,
    pub mqtt: MqttDiagnostics,
    pub bridge: BridgeDiagnostics,
    pub checks: Vec<DiagnosticCheck>,
}

fn check(id: &str, level: &str, detail: impl Into<String>) -> DiagnosticCheck {
    DiagnosticCheck {
        id: id.to_string(),
        level: level.to_string(),
        detail: detail.into(),
    }
}

/// Verify that the configured download directory is usable without leaving a
/// probe file behind. This catches permission and read-only-volume failures
/// before a real incoming transfer does.
pub fn probe_directory_writable(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("{} is not an existing directory", path.display()));
    }

    let probe = path.join(format!(".dropqtt-write-test-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&probe)?;
        file.write_all(b"dropqtt diagnostics")?;
        file.sync_all()
    })();
    let _ = fs::remove_file(&probe);
    result.map_err(|e| format!("{} is not writable: {e}", path.display()))
}

fn build_checks(mqtt: &MqttDiagnostics, bridge: &BridgeDiagnostics) -> Vec<DiagnosticCheck> {
    let mut checks = Vec::with_capacity(8);

    checks.push(if mqtt.download_dir_writable {
        check("download_dir", "ok", mqtt.download_dir.clone())
    } else {
        check(
            "download_dir",
            "error",
            mqtt.download_dir_error
                .clone()
                .unwrap_or_else(|| "Download directory is not writable".to_string()),
        )
    });

    checks.push(if mqtt.history_available {
        if mqtt.history.lost_rows > 0 {
            // Retention is what the history workspace promises, so a best-effort
            // write that lost rows has to be visible, not just loggable.
            check(
                "history_store",
                "warn",
                format!(
                    "{} rows available for search; {} row(s) could not be written this session",
                    mqtt.history.rows, mqtt.history.lost_rows
                ),
            )
        } else {
            check(
                "history_store",
                "ok",
                format!("{} rows available for search", mqtt.history.rows),
            )
        }
    } else {
        check(
            "history_store",
            "warn",
            "SQLite history store is unavailable; live messaging still works",
        )
    });

    checks.push(if mqtt.connected {
        check(
            "broker_connection",
            "ok",
            format!("{}:{} ({})", mqtt.host, mqtt.port, mqtt.client_id),
        )
    } else if mqtt.configured {
        check(
            "broker_connection",
            "warn",
            format!("Not connected to {}:{}", mqtt.host, mqtt.port),
        )
    } else {
        check(
            "broker_connection",
            "warn",
            "No broker has been selected yet",
        )
    });

    checks.push(if mqtt.configured && !mqtt.use_tls {
        check(
            "transport_security",
            "warn",
            if mqtt.use_websocket {
                "WebSocket transport is active without TLS"
            } else {
                "TCP transport is active without TLS"
            },
        )
    } else {
        check("transport_security", "ok", "TLS is enabled")
    });

    checks.push(if mqtt.connected && mqtt.subscriptions == 0 {
        check(
            "subscriptions",
            "warn",
            "Connected, but no topic subscriptions are registered",
        )
    } else {
        check(
            "subscriptions",
            "ok",
            format!("{} registered subscription(s)", mqtt.subscriptions),
        )
    });

    let pressure = if mqtt.feed_buffer_capacity == 0 {
        0.0
    } else {
        mqtt.feed_buffered as f64 / mqtt.feed_buffer_capacity as f64
    };
    checks.push(if mqtt.feed_dropped > 0 {
        check(
            "feed_pressure",
            "warn",
            format!(
                "{} feed row(s) dropped; traffic counters remain exact",
                mqtt.feed_dropped
            ),
        )
    } else if pressure >= 0.8 {
        check(
            "feed_pressure",
            "warn",
            format!(
                "Feed buffer is {}% full ({} / {})",
                (pressure * 100.0).round() as u32,
                mqtt.feed_buffered,
                mqtt.feed_buffer_capacity
            ),
        )
    } else {
        check(
            "feed_pressure",
            "ok",
            format!(
                "{} / {} buffered rows",
                mqtt.feed_buffered, mqtt.feed_buffer_capacity
            ),
        )
    });

    // An unconfirmed send is not a failure, but it is never normal either: either
    // the peer is offline, or it is not listening on the ctrl topic at all.
    let (transfer_level, transfer_detail) = if mqtt.confirm_timeouts > 0 {
        (
            "warn",
            format!(
                "{} inbound and {} outbound transfer(s) active; {} send(s) got no receipt from the peer \
                 (is it online and subscribed to <prefix>/ctrl/#?)",
                mqtt.incoming_active, mqtt.outgoing_active, mqtt.confirm_timeouts
            ),
        )
    } else {
        (
            "ok",
            format!(
                "{} inbound and {} outbound transfer(s) active",
                mqtt.incoming_active, mqtt.outgoing_active
            ),
        )
    };
    checks.push(check("transfer_activity", transfer_level, transfer_detail));

    // Waiting on an answer is normal; answers that never came are the thing a
    // user needs told, together with the one diagnostic that explains most of
    // them: nobody is listening on the response topic.
    let (rpc_level, rpc_detail) = if mqtt.rpc_timeouts > 0 {
        (
            "warn",
            format!(
                "{} request(s) never answered, {} still waiting (is a responder subscribed to the response topic?)",
                mqtt.rpc_timeouts, mqtt.rpc_pending
            ),
        )
    } else {
        (
            "ok",
            format!("{} request(s) waiting for an answer", mqtt.rpc_pending),
        )
    };
    checks.push(check("rpc_activity", rpc_level, rpc_detail));

    // The ack verdicts: a refused SUBSCRIBE is the one protocol answer that turns
    // a green subscription into a silent nothing, so it has its own line even when
    // everything else looks healthy.
    let ack_total = mqtt.subscriptions_rejected + mqtt.unsubscribes_rejected;
    let (ack_level, ack_detail) = if ack_total > 0 {
        (
            "warn",
            format!(
                "{} subscription(s) refused, {} unsubscribe(s) refused (see the subscriptions bar)",
                mqtt.subscriptions_rejected, mqtt.unsubscribes_rejected
            ),
        )
    } else if mqtt.publish_rejected > 0 {
        (
            "warn",
            format!("{} publish(es) refused by the broker", mqtt.publish_rejected),
        )
    } else {
        (
            "ok",
            format!(
                "{} subscription(s) registered, {} publish(es) refused",
                mqtt.subscriptions, mqtt.publish_rejected
            ),
        )
    };
    checks.push(check("ack_verdicts", ack_level, ack_detail));

    // Our own timing. A rising flush time or a flusher that wakes late is the
    // app saturating, not the broker being slow, and that distinction decides
    // where a person looks next.
    let slowest = mqtt.feed_flush.max_ms.max(mqtt.feed_lag.max_ms);
    let (timing_level, timing_detail) = if slowest >= 500 {
        (
            "warn",
            format!(
                "flush avg {} ms / max {} ms, lag avg {} ms / max {} ms — the app itself is falling behind",
                mqtt.feed_flush.avg_ms, mqtt.feed_flush.max_ms, mqtt.feed_lag.avg_ms, mqtt.feed_lag.max_ms
            ),
        )
    } else {
        (
            "ok",
            format!(
                "flush avg {} ms (max {}), lag avg {} ms (max {}), history write avg {} ms",
                mqtt.feed_flush.avg_ms,
                mqtt.feed_flush.max_ms,
                mqtt.feed_lag.avg_ms,
                mqtt.feed_lag.max_ms,
                mqtt.history_write.avg_ms
            ),
        )
    };
    checks.push(check("self_timing", timing_level, timing_detail));

    let (fault_level, fault_detail) = if mqtt.fault_rules > 0 {
        (
            "warn",
            format!(
                "{} fault rule(s) armed, {} actions taken this session — missing or damaged traffic may be ours, not the network's",
                mqtt.fault_rules, mqtt.fault_actions
            ),
        )
    } else {
        ("ok", "no fault injection armed".to_string())
    };
    checks.push(check("fault_injection", fault_level, fault_detail));

    let bridge_level =
        if (bridge.enabled_rules > 0 && bridge.connected_connections == 0) || bridge.errors > 0 {
            "warn"
        } else {
            "ok"
        };
    checks.push(check(
        "bridge_health",
        bridge_level,
        format!(
            "{}/{} connection(s), {} enabled rule(s), {} forwarded, {} error(s), {} dropped",
            bridge.connected_connections,
            bridge.total_connections,
            bridge.enabled_rules,
            bridge.forwarded,
            bridge.errors,
            bridge.dropped
        ),
    ));

    checks
}

pub fn build_snapshot(mut mqtt: MqttDiagnostics, bridge: BridgeDiagnostics) -> DiagnosticsSnapshot {
    match probe_directory_writable(Path::new(&mqtt.download_dir)) {
        Ok(()) => {
            mqtt.download_dir_writable = true;
            mqtt.download_dir_error = None;
        }
        Err(e) => {
            mqtt.download_dir_writable = false;
            mqtt.download_dir_error = Some(e);
        }
    }

    let checks = build_checks(&mqtt, &bridge);
    DiagnosticsSnapshot {
        runtime: RuntimeInfo {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            generated_at: chrono::Utc::now().timestamp_millis(),
            uptime_secs: uptime_secs(),
        },
        mqtt,
        bridge,
        checks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flush_lag_is_measured_against_the_cadence_not_from_zero() {
        let mut t = SelfTiming::default();
        let start = std::time::Instant::now();
        assert!(t.note_flush_start(start, std::time::Duration::from_millis(100)).is_none());
        // Exactly on schedule: no lag recorded.
        assert_eq!(
            t.note_flush_start(start + std::time::Duration::from_millis(100), std::time::Duration::from_millis(100)),
            Some(0)
        );
        // 250 ms after the last one against a 100 ms cadence is 150 ms late.
        assert_eq!(
            t.note_flush_start(start + std::time::Duration::from_millis(350), std::time::Duration::from_millis(100)),
            Some(150)
        );
        assert_eq!(t.lag.snapshot().total_calls, 2, "the first tick has nothing to compare with");
    }

    #[test]
    fn timing_window_reports_the_recent_worst_not_the_ever_worst() {
        let mut t = Timing::default();
        assert_eq!(t.snapshot().window, 0);
        assert_eq!(t.snapshot().avg_ms, 0);

        for ms in [2u64, 4, 6] {
            t.record(ms);
        }
        let s = t.snapshot();
        assert_eq!((s.window, s.total_calls, s.avg_ms, s.max_ms), (3, 3, 4, 6));

        // The ring is fixed: an early spike leaves the window once 256 later
        // samples have passed it, so "recently fine" stops being masked by history.
        let mut big = Timing::default();
        big.record(9_000);
        for _ in 0..STATS_WINDOW {
            big.record(1);
        }
        let s = big.snapshot();
        assert_eq!(s.window, STATS_WINDOW);
        assert_eq!(s.max_ms, 1, "the spike has aged out of the window");
        assert_eq!(s.total_calls, STATS_WINDOW as u64 + 1, "but the call count did not");

        // Absurd durations clamp instead of wrapping into a plausible number.
        let mut clamp = Timing::default();
        clamp.record(u64::MAX);
        assert_eq!(clamp.snapshot().max_ms, u32::MAX as u64);
    }


    fn mqtt() -> MqttDiagnostics {
        MqttDiagnostics {
            configured: true,
            connected: true,
            host: "broker.example".to_string(),
            port: 8883,
            client_id: "client".to_string(),
            use_tls: true,
            use_websocket: false,
            protocol_version: 5,
            subscriptions: 2,
            incoming_active: 0,
            outgoing_active: 1,
            feed_buffered: 0,
            feed_buffer_capacity: 2000,
            feed_dropped: 0,
            feed_lost: 0,
            confirm_timeouts: 0,
            rpc_pending: 0,
            rpc_timeouts: 0,
            subscriptions_rejected: 0,
            unsubscribes_rejected: 0,
            acks_unattributed: 0,
            publish_rejected: 0,
            received_total: 41,
            sent_total: 7,
            topic_stats_count: 4,
            scheduled_runs: 0,
            bench_runs: 0,
            history_available: true,
            history: HistoryStats {
                rows: 12,
                inbound: 8,
                outbound: 4,
                oldest_ts: Some(1),
                newest_ts: Some(2),
                ..Default::default()
            },
            download_dir: std::env::temp_dir().to_string_lossy().to_string(),
            download_dir_writable: true,
            download_dir_error: None,
            feed_flush: Timing::default().snapshot(),
            feed_lag: Timing::default().snapshot(),
            history_write: Timing::default().snapshot(),
            fault_rules: 0,
            fault_actions: 0,
            responder_rules: 0,
        }
    }

    #[test]
    fn healthy_snapshot_has_no_warnings() {
        let snapshot = build_snapshot(mqtt(), BridgeDiagnostics::default());
        assert!(snapshot.checks.iter().all(|c| c.level == "ok"));
    }

    /// Every key the snapshot can serialize, nested objects included.
    fn field_names(value: &serde_json::Value, out: &mut Vec<String>) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    out.push(key.to_lowercase());
                    field_names(child, out);
                }
            }
            serde_json::Value::Array(items) => items.iter().for_each(|item| field_names(item, out)),
            _ => {}
        }
    }

    /// A field may not be called one of these. `url` is in the list because the rule
    /// is that an alert endpoint never travels in an exported file at all.
    const CREDENTIAL_SHAPED: [&str; 12] = [
        "password", "passwd", "secret", "token", "apikey", "api_key", "credential",
        "authorization", "cert", "pem", "webhook", "url",
    ];

    #[test]
    fn the_snapshot_cannot_grow_a_field_that_holds_a_credential() {
        // The snapshot is one of the few artifacts an operator saves to disk and
        // attaches to a ticket, so the red line covers it. No producer puts a
        // credential in it today -- which is exactly the claim that needs a machine
        // policing it, because the leak would be the next field someone adds "to
        // debug this faster", not a deliberate copy of a password.
        let json =
            serde_json::to_value(build_snapshot(mqtt(), BridgeDiagnostics::default())).unwrap();
        let mut names = Vec::new();
        field_names(&json, &mut names);
        // Self-certifying: a walk that collected nothing would pass the assertion
        // below for the wrong reason (§4.84).
        assert!(
            names.len() > 60,
            "the walk saw only {} field names; the snapshot shape moved under it",
            names.len()
        );
        let offenders: Vec<_> = names
            .iter()
            .filter(|name| CREDENTIAL_SHAPED.iter().any(|needle| name.contains(needle)))
            .cloned()
            .collect();
        assert!(
            offenders.is_empty(),
            "diagnostics now exposes {offenders:?}: a credential or an alert endpoint must not be given a field to live in"
        );
    }

    #[test]
    fn dropped_feed_rows_are_surfaced() {
        let mut input = mqtt();
        input.feed_dropped = 7;
        let snapshot = build_snapshot(input, BridgeDiagnostics::default());
        let check = snapshot
            .checks
            .iter()
            .find(|c| c.id == "feed_pressure")
            .unwrap();
        assert_eq!(check.level, "warn");
        assert!(check.detail.contains('7'));
    }

    #[test]
    fn history_rows_that_could_not_be_written_are_reported() {
        let mut input = mqtt();
        input.history.lost_rows = 3;
        let snapshot = build_snapshot(input, BridgeDiagnostics::default());
        let check = snapshot.checks.iter().find(|c| c.id == "history_store").unwrap();
        assert_eq!(check.level, "warn");
        assert!(check.detail.contains('3'), "{}", check.detail);
    }

    #[test]
    fn unconfirmed_sends_raise_the_transfer_check() {
        let mut input = mqtt();
        input.confirm_timeouts = 2;
        let snapshot = build_snapshot(input, BridgeDiagnostics::default());
        let check = snapshot
            .checks
            .iter()
            .find(|c| c.id == "transfer_activity")
            .unwrap();
        assert_eq!(check.level, "warn");
        // The message has to name the fix, not just the symptom.
        assert!(check.detail.contains("ctrl/#"), "{}", check.detail);
        assert!(check.detail.contains('2'));
    }

    #[test]
    fn armed_faults_are_announced_before_anyone_blames_the_network() {
        let mut input = mqtt();
        let clean = build_snapshot(input.clone(), BridgeDiagnostics::default());
        assert_eq!(
            clean
                .checks
                .iter()
                .find(|c| c.id == "fault_injection")
                .unwrap()
                .level,
            "ok",
            "nothing armed is not a finding"
        );
        input.fault_rules = 2;
        input.fault_actions = 17;
        let snapshot = build_snapshot(input, BridgeDiagnostics::default());
        let check = snapshot
            .checks
            .iter()
            .find(|c| c.id == "fault_injection")
            .unwrap();
        assert_eq!(check.level, "warn");
        assert!(check.detail.contains("2 fault rule"), "{}", check.detail);
        assert!(check.detail.contains("17 actions"), "{}", check.detail);
    }
}
