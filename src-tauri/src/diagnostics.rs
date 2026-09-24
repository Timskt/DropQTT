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
    pub topic_stats_count: usize,
    pub history_available: bool,
    pub history: HistoryStats,
    pub download_dir: String,
    pub download_dir_writable: bool,
    pub download_dir_error: Option<String>,
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
        check(
            "history_store",
            "ok",
            format!("{} rows available for search", mqtt.history.rows),
        )
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

    checks.push(check(
        "transfer_activity",
        "ok",
        format!(
            "{} inbound and {} outbound transfer(s) active",
            mqtt.incoming_active, mqtt.outgoing_active
        ),
    ));

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
        },
        mqtt,
        bridge,
        checks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            topic_stats_count: 4,
            history_available: true,
            history: HistoryStats {
                rows: 12,
                inbound: 8,
                outbound: 4,
                oldest_ts: Some(1),
                newest_ts: Some(2),
            },
            download_dir: std::env::temp_dir().to_string_lossy().to_string(),
            download_dir_writable: true,
            download_dir_error: None,
        }
    }

    #[test]
    fn healthy_snapshot_has_no_warnings() {
        let snapshot = build_snapshot(mqtt(), BridgeDiagnostics::default());
        assert!(snapshot.checks.iter().all(|c| c.level == "ok"));
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
}
