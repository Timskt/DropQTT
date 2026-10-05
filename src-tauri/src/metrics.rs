//! Prometheus text exposition over a loopback socket, **off until asked for**.
//!
//! The operations panel already computes every number worth scraping; the only thing
//! it could not do was hand them to a machine. This module renders the same
//! `DiagnosticsSnapshot` in the exposition format and serves it from
//! `127.0.0.1:<port>` behind `GET /metrics`.
//!
//! Three deliberate constraints:
//! - Nothing listens unless the user enables it, and the setting is not persisted, so
//!   a restart never leaves an open port behind.
//! - The bind address is hard-coded to loopback. Exposing live broker counters on a
//!   LAN interface is not this app's job, and a parameter would only invite it.
//! - Metric names and labels carry no message payloads, no usernames, no passwords,
//!   no certificate paths and no health-check prose. The broker endpoint *is*
//!   included, because a scrape that cannot say which broker produced it is
//!   worthless; that is the same string the panel already displays.

use std::sync::Mutex;

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

use crate::bridge::BridgeManager;
use crate::diagnostics::DiagnosticsSnapshot;
use crate::mqtt_manager::MqttManager;
use crate::outbox::OutboxCounts;

/// The conventional Prometheus sidecar band; avoids every well-known broker port.
pub const DEFAULT_PORT: u16 = 9464;

/// Below this a bind would collide with system services and usually needs elevation,
/// so the command rejects it with words instead of an opaque OS error.
pub const MIN_PORT: u16 = 1024;

/// A scrape that never completes must not park a task forever.
const IO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// Enough for a request line and headers; a GET has no body worth reading.
const MAX_REQUEST_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsStatus {
    pub enabled: bool,
    pub port: u16,
    /// The floor the input box has to enforce. Quoted from the backend so the panel
    /// cannot drift from what `configure` will actually accept.
    pub min_port: u16,
}

struct Running {
    port: u16,
    handle: JoinHandle<()>,
}

fn status_of(enabled: bool, port: u16) -> MetricsStatus {
    MetricsStatus {
        enabled,
        port,
        min_port: MIN_PORT,
    }
}

/// Holds at most one listener task. `Default` is off, which is the state the app must
/// boot into.
#[derive(Default)]
pub struct MetricsHub {
    running: Mutex<Option<Running>>,
}

impl MetricsHub {
    pub fn status(&self) -> MetricsStatus {
        match &*self.running.lock().unwrap() {
            Some(r) => status_of(true, r.port),
            None => status_of(false, DEFAULT_PORT),
        }
    }

    /// Stop whatever is listening, then optionally bind `port` and serve.
    ///
    /// The bind happens here rather than inside the spawned task so "port already in
    /// use" comes back to the caller as text the panel can show. Failing silently in
    /// the background would leave a switch that reads *on* while nothing is served.
    pub async fn configure(
        &self,
        enabled: bool,
        port: u16,
        mqtt: std::sync::Arc<MqttManager>,
        bridge: std::sync::Arc<BridgeManager>,
    ) -> Result<MetricsStatus, String> {
        if enabled && port < MIN_PORT {
            // Rejected before anything is torn down, so a typo in the port box cannot
            // switch a working endpoint off on the way to failing.
            return Err(format!("port must be {MIN_PORT} or above"));
        }
        let old = self.running.lock().unwrap().take();
        if let Some(old) = old {
            old.handle.abort();
            // Aborting only *requests* cancellation; the socket belongs to the future
            // and stays bound until the runtime gets there. Awaiting the handle is what
            // proves the port is free before the next bind, without it a fast
            // off-and-on toggle fails with "port already in use".
            let _ = old.handle.await;
        }
        if !enabled {
            return Ok(status_of(false, port));
        }
        // std::net for the bind: it is a single syscall that returns immediately, so
        // it is safe on a runtime worker. tokio's `blocking_bind` would panic here.
        let std_listener = std::net::TcpListener::bind(("127.0.0.1", port))
            .map_err(|e| format!("could not listen on 127.0.0.1:{port}: {e}"))?;
        std_listener
            .set_nonblocking(true)
            .map_err(|e| format!("non-blocking mode: {e}"))?;
        let listener = TcpListener::from_std(std_listener).map_err(|e| format!("tokio: {e}"))?;
        let bound = listener
            .local_addr()
            .map_err(|e| format!("local addr: {e}"))?
            .port();
        *self.running.lock().unwrap() = Some(Running {
            port: bound,
            handle: tokio::spawn(serve(listener, mqtt, bridge)),
        });
        Ok(status_of(true, bound))
    }
}

/// The one way a snapshot gets assembled, shared with the operations panel command so
/// the numbers on screen and the numbers scraped cannot drift apart.
pub async fn snapshot(
    mqtt: &std::sync::Arc<MqttManager>,
    bridge: &std::sync::Arc<BridgeManager>,
) -> DiagnosticsSnapshot {
    crate::diagnostics::build_snapshot(mqtt.diagnostics_snapshot().await, bridge.diagnostics_snapshot().await)
}

async fn serve(listener: TcpListener, mqtt: std::sync::Arc<MqttManager>, bridge: std::sync::Arc<BridgeManager>) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let (mqtt, bridge) = (mqtt.clone(), bridge.clone());
                tokio::spawn(handle_connection(stream, mqtt, bridge));
            }
            // A dropped accept only costs this one scrape; the next poll answers it.
            Err(_) => continue,
        }
    }
}

async fn handle_connection(stream: TcpStream, mqtt: std::sync::Arc<MqttManager>, bridge: std::sync::Arc<BridgeManager>) {
    // Split so a client that sends nothing cannot block the write half.
    let (mut read, mut write) = stream.into_split();
    let mut buf = vec![0u8; MAX_REQUEST_BYTES];
    let mut filled = 0usize;
    while filled < MAX_REQUEST_BYTES {
        match tokio::time::timeout(IO_TIMEOUT, read.read(&mut buf[filled..])).await {
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => break,
            Ok(Ok(n)) => {
                filled += n;
                if buf[..filled].windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
        }
    }
    let request = String::from_utf8_lossy(&buf[..filled]).to_string();
    // Rendered per request: a scrape must see current numbers, not those from the
    // moment the switch was flipped.
    let body = {
        let snap = snapshot(&mqtt, &bridge).await;
        let outbox = bridge.outbox_state();
        render(&snap, &outbox.counts, outbox.error.is_none())
    };
    let response = http_response(request_line(&request), &body);
    // A scrape that hung up mid-write gets no reply and there is nobody left to tell.
    // The timeout is the point: it is what stops a half-open connection from parking
    // this task, and `Ok` here means "served what we could", not "the write landed".
    if matches!(
        tokio::time::timeout(IO_TIMEOUT, write.write_all(response.as_bytes())).await,
        Ok(Ok(()))
    ) {
        let _ = tokio::time::timeout(IO_TIMEOUT, write.flush()).await;
    }
}

/// The first line of a request, which is all the routing needs.
fn request_line(raw: &str) -> &str {
    raw.lines().next().unwrap_or("")
}

/// Pure, so routing and status codes are covered without a socket.
///
/// The response never quotes the requested path: an unbounded echo on a local port is
/// how a debug endpoint turns into a reflection gadget.
fn http_response(request_line: &str, metrics_body: &str) -> String {
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let path = target.split('?').next().unwrap_or("");
    let is_metrics = path == "/metrics";
    let is_head = method == "HEAD";
    let status = match (method, is_metrics) {
        ("GET", true) | ("HEAD", true) => "200 OK",
        ("GET", false) | ("HEAD", false) => "404 Not Found",
        _ => "405 Method Not Allowed",
    };
    // HEAD promises the size a GET would return, and no bytes. Returning the body
    // anyway is how a client ends up reading the next request's response.
    let body_len = if status == "200 OK" && !is_head {
        metrics_body.len()
    } else {
        0
    };
    let allow = if is_metrics && status != "200 OK" {
        "Allow: GET, HEAD\r\n"
    } else {
        ""
    };
    let body = if body_len == 0 {
        ""
    } else {
        metrics_body
    };
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; version=0.0.4; charset=utf-8\r\n{allow}Content-Length: {body_len}\r\nConnection: close\r\n\r\n{body}"
    )
}

fn escape_label(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str(r"\\"),
            '"' => out.push_str(r#"\""#),
            '\n' => out.push_str(r"\n"),
            _ => out.push(ch),
        }
    }
    out
}

fn level_value(level: &str) -> u8 {
    match level {
        "ok" => 0,
        "warn" => 1,
        _ => 2,
    }
}

struct Writer {
    out: String,
}

impl Writer {
    /// One `# HELP` / `# TYPE` pair, then the samples under it. A parser needs the
    /// type before the first sample carrying that name.
    fn head(&mut self, name: &str, help: &str, kind: &str) {
        self.out.push_str(&format!("# HELP {name} {help}\n# TYPE {name} {kind}\n"));
    }

    fn gauge(&mut self, name: &str, help: &str, value: i64) {
        self.head(name, help, "gauge");
        self.sample(name, &[], &value.to_string());
    }

    fn counter(&mut self, name: &str, help: &str, value: u64) {
        self.head(name, help, "counter");
        self.sample(name, &[], &value.to_string());
    }

    fn sample(&mut self, name: &str, labels: &[(&str, String)], value: &str) {
        let rendered: Vec<String> = labels
            .iter()
            .map(|(k, v)| format!("{k}=\"{}\"", escape_label(v)))
            .collect();
        let suffix = if rendered.is_empty() {
            String::new()
        } else {
            format!("{{{}}}", rendered.join(","))
        };
        self.out.push_str(&format!("{name}{suffix} {value}\n"));
    }
}

/// Render a snapshot in the Prometheus exposition format.
///
/// `outbox_available` is the difference between "the queue is empty" and "there is no
/// queue"; exporting zeros for an absent feature makes a dashboard page someone over
/// a number that means nothing.
pub fn render(snapshot: &DiagnosticsSnapshot, outbox: &OutboxCounts, outbox_available: bool) -> String {
    let mut w = Writer { out: String::new() };
    let mqtt = &snapshot.mqtt;
    let bridge = &snapshot.bridge;

    w.head("dropqtt_info", "Build metadata for this DropQT instance.", "gauge");
    w.sample(
        "dropqtt_info",
        &[
            ("version", snapshot.runtime.app_version.clone()),
            ("os", snapshot.runtime.os.clone()),
            ("arch", snapshot.runtime.arch.clone()),
        ],
        "1",
    );

    w.gauge(
        "dropqtt_mqtt_configured",
        "1 when a broker profile has been selected.",
        mqtt.configured as i64,
    );
    w.head("dropqtt_mqtt_connected", "1 while the console is connected to its broker.", "gauge");
    w.sample(
        "dropqtt_mqtt_connected",
        &[("endpoint", format!("{}:{}", mqtt.host, mqtt.port))],
        &(mqtt.connected as i64).to_string(),
    );
    w.gauge(
        "dropqtt_mqtt_protocol_version",
        "MQTT protocol version in use (4 = 3.1.1, 5 = 5.0).",
        mqtt.protocol_version as i64,
    );
    w.gauge(
        "dropqtt_mqtt_tls",
        "1 when the transport is encrypted.",
        mqtt.use_tls as i64,
    );
    w.gauge(
        "dropqtt_mqtt_websocket",
        "1 when the transport is a WebSocket.",
        mqtt.use_websocket as i64,
    );
    w.gauge(
        "dropqtt_mqtt_subscriptions",
        "Subscriptions registered with the broker.",
        mqtt.subscriptions as i64,
    );
    w.gauge(
        "dropqtt_mqtt_subscriptions_rejected",
        "Subscriptions the broker is refusing now (SUBACK >= 0x80): the console is showing a subscription that receives nothing.",
        mqtt.subscriptions_rejected as i64,
    );
    w.gauge(
        "dropqtt_mqtt_unsubscribes_rejected",
        "Unsubscribes the broker refused; delivery may continue on them.",
        mqtt.unsubscribes_rejected as i64,
    );
    w.counter(
        "dropqtt_mqtt_publish_rejected_total",
        "Publishes answered with a refusal this session.",
        mqtt.publish_rejected,
    );
    // The two series a dashboard actually alerts on, which is why they are counters
    // and not the resettable per-topic counts: `rate(dropqtt_messages_received_total[1m]) == 0`
    // over a configured, connected session is "the broker went quiet".
    w.counter(
        "dropqtt_messages_received_total",
        "Application publishes delivered since the process started. Broker $SYS traffic and fault-injected drops are excluded, so rate() == 0 means the application traffic stopped.",
        mqtt.received_total,
    );
    w.counter(
        "dropqtt_messages_sent_total",
        "Publishes we handed to the client since the process started.",
        mqtt.sent_total,
    );
    w.counter(
        "dropqtt_mqtt_acks_unattributed_total",
        "Ack reason bytes that arrived with no pending request of ours.",
        mqtt.acks_unattributed,
    );
    w.gauge(
        "dropqtt_topics_tracked",
        "Distinct topics in the traffic table.",
        mqtt.topic_stats_count as i64,
    );

    w.gauge(
        "dropqtt_feed_buffered",
        "Rows waiting in the display buffer.",
        mqtt.feed_buffered as i64,
    );
    w.gauge(
        "dropqtt_feed_buffer_capacity",
        "Display buffer limit, as quoted by the backend.",
        mqtt.feed_buffer_capacity as i64,
    );
    w.counter(
        "dropqtt_feed_dropped_total",
        "Rows evicted from the display buffer; traffic counters stay exact.",
        mqtt.feed_dropped,
    );
    w.counter(
        "dropqtt_feed_lost_total",
        "Rows evicted and also lost from history. Non-zero means retention is incomplete.",
        mqtt.feed_lost,
    );

    w.gauge(
        "dropqtt_transfers_inbound",
        "Inbound file transfers active now.",
        mqtt.incoming_active as i64,
    );
    w.gauge(
        "dropqtt_transfers_outbound",
        "Outbound file transfers active now.",
        mqtt.outgoing_active as i64,
    );
    w.counter(
        "dropqtt_transfer_confirm_timeouts_total",
        "Sends whose peer never sent a receipt.",
        mqtt.confirm_timeouts,
    );

    w.gauge(
        "dropqtt_rpc_pending",
        "Requests waiting for an answer right now.",
        mqtt.rpc_pending as i64,
    );
    w.counter(
        "dropqtt_rpc_timeouts_total",
        "Requests that were never answered.",
        mqtt.rpc_timeouts,
    );

    w.gauge(
        "dropqtt_scheduled_runs",
        "Backend-scheduled publishes still running.",
        mqtt.scheduled_runs as i64,
    );
    w.gauge(
        "dropqtt_bench_runs",
        "Bench lab runs still publishing.",
        mqtt.bench_runs as i64,
    );
    w.gauge(
        "dropqtt_responder_rules",
        "Scripted-responder rules armed; the app is answering traffic as a device.",
        mqtt.responder_rules as i64,
    );
    w.gauge(
        "dropqtt_fault_rules",
        "Fault-injection rules armed; dropped or damaged traffic may be ours, not the network's.",
        mqtt.fault_rules as i64,
    );
    w.counter(
        "dropqtt_fault_actions_total",
        "Messages dropped, delayed, duplicated, corrupted or mis-correlated by fault injection.",
        mqtt.fault_actions,
    );

    w.gauge(
        "dropqtt_history_available",
        "1 when the SQLite history store is open.",
        mqtt.history_available as i64,
    );
    w.gauge(
        "dropqtt_history_rows",
        "Stored rows available for search.",
        mqtt.history.rows,
    );
    w.gauge(
        "dropqtt_history_rows_inbound",
        "Stored inbound rows.",
        mqtt.history.inbound,
    );
    w.gauge(
        "dropqtt_history_rows_outbound",
        "Stored outbound rows.",
        mqtt.history.outbound,
    );
    w.counter(
        "dropqtt_history_lost_rows_total",
        "History rows that could not be written this session.",
        mqtt.history.lost_rows,
    );

    w.head(
        "dropqtt_self_timing_ms",
        "App self-timing in ms, labelled by operation and statistic.",
        "gauge",
    );
    w.head(
        "dropqtt_self_timing_window_samples",
        "Samples inside the timing window, so a max over three samples is not read as a max over 256.",
        "gauge",
    );
    w.head(
        "dropqtt_self_timing_calls_total",
        "Calls recorded since the app started, never trimmed.",
        "counter",
    );
    for (name, stats) in [
        ("feed_flush", &mqtt.feed_flush),
        ("feed_lag", &mqtt.feed_lag),
        ("history_write", &mqtt.history_write),
    ] {
        let op = name.to_string();
        for (stat, value) in [("avg", stats.avg_ms), ("max", stats.max_ms)] {
            w.sample(
                "dropqtt_self_timing_ms",
                &[("op", op.clone()), ("stat", stat.to_string())],
                &value.to_string(),
            );
        }
        w.sample(
            "dropqtt_self_timing_window_samples",
            &[("op", op.clone())],
            &stats.window.to_string(),
        );
        w.sample(
            "dropqtt_self_timing_calls_total",
            &[("op", op)],
            &stats.total_calls.to_string(),
        );
    }

    w.gauge(
        "dropqtt_bridge_connections",
        "Bridge connections configured.",
        bridge.total_connections as i64,
    );
    w.gauge(
        "dropqtt_bridge_connections_connected",
        "Bridge connections currently up.",
        bridge.connected_connections as i64,
    );
    w.gauge(
        "dropqtt_bridge_rules",
        "Bridge rules configured.",
        bridge.configured_rules as i64,
    );
    w.gauge(
        "dropqtt_bridge_rules_enabled",
        "Bridge rules enabled.",
        bridge.enabled_rules as i64,
    );
    w.counter(
        "dropqtt_bridge_forwarded_total",
        "Messages forwarded by the bridge.",
        bridge.forwarded,
    );
    w.counter(
        "dropqtt_bridge_errors_total",
        "Bridge delivery attempts that failed.",
        bridge.errors,
    );
    w.counter(
        "dropqtt_bridge_dropped_total",
        "Messages the bridge gave up on.",
        bridge.dropped,
    );

    if outbox_available {
        w.gauge(
            "dropqtt_outbox_pending",
            "Webhook deliveries queued for retry.",
            outbox.pending as i64,
        );
        w.gauge(
            "dropqtt_outbox_dead",
            "Webhook deliveries that exhausted every attempt.",
            outbox.dead as i64,
        );
        w.counter(
            "dropqtt_outbox_delivered_total",
            "Webhook deliveries completed, including those that never needed the queue.",
            outbox.delivered,
        );
        w.counter(
            "dropqtt_outbox_retries_total",
            "Webhook retry attempts made this session.",
            outbox.retries,
        );
    }

    w.head(
        "dropqtt_check_status",
        "Health check verdict: 0 ok, 1 warn, 2 error. The prose lives in the panel, not in a label.",
        "gauge",
    );
    for c in &snapshot.checks {
        w.sample(
            "dropqtt_check_status",
            &[("id", c.id.clone())],
            &level_value(&c.level).to_string(),
        );
    }

    w.out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::{BridgeDiagnostics, DiagnosticCheck, MqttDiagnostics, RuntimeInfo, Timing};
    use crate::history::HistoryStats;

    fn snapshot() -> DiagnosticsSnapshot {
        DiagnosticsSnapshot {
            runtime: RuntimeInfo {
                app_version: "0.9.0".into(),
                os: "windows".into(),
                arch: "x64".into(),
                generated_at: 1,
            },
            mqtt: MqttDiagnostics {
                configured: true,
                connected: true,
                host: "127.0.0.1".into(),
                port: 1883,
                client_id: "secret-client".into(),
                use_tls: false,
                use_websocket: true,
                protocol_version: 5,
                subscriptions: 3,
                incoming_active: 1,
                outgoing_active: 2,
                feed_buffered: 40,
                feed_buffer_capacity: 2000,
                feed_dropped: 5,
                feed_lost: 1,
                confirm_timeouts: 2,
                rpc_pending: 4,
                rpc_timeouts: 6,
                subscriptions_rejected: 1,
                unsubscribes_rejected: 0,
                acks_unattributed: 7,
                publish_rejected: 8,
                received_total: 9,
                sent_total: 10,
                topic_stats_count: 9,
                scheduled_runs: 10,
                bench_runs: 11,
                history_available: true,
                history: HistoryStats {
                    rows: 12,
                    inbound: 13,
                    outbound: 14,
                    lost_rows: 15,
                    ..Default::default()
                },
                download_dir: "C:/secret/dir".into(),
                download_dir_writable: true,
                download_dir_error: None,
                feed_flush: Timing::default().snapshot(),
                feed_lag: Timing::default().snapshot(),
                history_write: Timing::default().snapshot(),
                fault_rules: 1,
                fault_actions: 2,
                responder_rules: 3,
            },
            bridge: BridgeDiagnostics {
                total_connections: 2,
                connected_connections: 1,
                configured_rules: 4,
                enabled_rules: 3,
                forwarded: 100,
                errors: 2,
                dropped: 1,
            },
            checks: vec![
                DiagnosticCheck {
                    id: "broker_connection".into(),
                    level: "ok".into(),
                    detail: "ZZ-detail-marker-a".into(),
                },
                DiagnosticCheck {
                    id: "fault_injection".into(),
                    level: "warn".into(),
                    detail: "ZZ-detail-marker-b".into(),
                },
            ],
        }
    }

    fn body() -> String {
        render(&snapshot(), &OutboxCounts::default(), true)
    }

    #[test]
    fn every_line_is_a_comment_or_a_numeric_sample() {
        let text = body();
        for line in text.lines() {
            if line.starts_with("# HELP ") || line.starts_with("# TYPE ") {
                continue;
            }
            assert!(line.starts_with("dropqtt_"), "series without the app prefix: {line:?}");
            let value = line.rsplit(' ').next().unwrap();
            assert!(value.parse::<f64>().is_ok(), "non-numeric value in {line:?}");
            assert!(line.contains(' '), "sample with no value: {line:?}");
        }
    }

    #[test]
    fn no_two_samples_share_an_identity() {
        // A duplicate name+label-set is what the self-timing family produced once the
        // HELP block was hoisted: valid-looking text a scraper rejects at ingest.
        let text = body();
        let mut seen: Vec<&str> = Vec::new();
        for line in text.lines() {
            if line.starts_with('#') {
                continue;
            }
            let identity = line.rsplit(' ').next().unwrap();
            let identity = &line[..line.len() - identity.len() - 1];
            assert!(!seen.contains(&identity), "duplicate series: {identity:?}");
            seen.push(identity);
        }
        assert!(seen.len() > 40, "only {} series rendered", seen.len());
    }

    #[test]
    fn help_and_type_pairs_are_complete_and_in_order() {
        let text = body();
        let mut named: Vec<&str> = Vec::new();
        let mut types: Vec<&str> = Vec::new();
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("# HELP ") {
                named.push(rest.split(' ').next().unwrap());
            } else if let Some(rest) = line.strip_prefix("# TYPE ") {
                types.push(rest.split(' ').next().unwrap());
            }
        }
        assert_eq!(named, types);
        assert!(named.len() > 20, "expected the full counter set, got {}", named.len());
    }

    #[test]
    fn sensitive_fields_and_check_prose_never_reach_the_output() {
        let text = body();
        assert!(!text.contains("secret-client"), "client id must not be exported");
        assert!(!text.contains("C:/secret/dir"), "download path must not be exported");
        assert!(!text.contains("ZZ-detail-marker"), "check details are prose, not labels");
    }

    #[test]
    fn the_broker_endpoint_is_labelled_and_escaped() {
        let mut s = snapshot();
        s.mqtt.host = "10.0.0.1\"evil\n".into();
        let text = render(&s, &OutboxCounts::default(), true);
        assert!(
            text.contains(r#"dropqtt_mqtt_connected{endpoint="10.0.0.1\"evil\n:1883"} 1"#),
            "{text}"
        );
        // The injected newline must not become a real line break in the exposition.
        assert!(!text.contains("\n:1883"), "raw newline leaked into a label value");
    }

    #[test]
    fn check_verdicts_become_numbers() {
        let text = body();
        assert!(text.contains(r#"dropqtt_check_status{id="broker_connection"} 0"#), "{text}");
        assert!(text.contains(r#"dropqtt_check_status{id="fault_injection"} 1"#), "{text}");
    }

    #[test]
    fn a_missing_outbox_exports_no_zero_series() {
        let text = render(&snapshot(), &OutboxCounts::default(), false);
        assert!(!text.contains("dropqtt_outbox_"), "{text}");
        assert!(body().contains("dropqtt_outbox_pending 0"));
    }

    #[test]
    fn counters_are_the_monotonic_ones_and_snapshots_are_gauges() {
        let text = body();
        for name in [
            "dropqtt_feed_dropped_total",
            "dropqtt_rpc_timeouts_total",
            "dropqtt_bridge_forwarded_total",
            "dropqtt_messages_received_total",
            "dropqtt_messages_sent_total",
        ] {
            assert!(
                text.contains(&format!("# TYPE {name} counter")),
                "{name} should be a counter"
            );
        }
        for name in ["dropqtt_mqtt_subscriptions", "dropqtt_feed_buffered", "dropqtt_rpc_pending"] {
            assert!(
                text.contains(&format!("# TYPE {name} gauge")),
                "{name} is a snapshot, not a total"
            );
        }
    }

    #[test]
    fn routing_only_serves_get_metrics() {
        assert!(http_response("GET /metrics HTTP/1.1", "BODY").starts_with("HTTP/1.1 200 OK"));
        assert!(http_response("GET /metrics?x=1 HTTP/1.1", "BODY").starts_with("HTTP/1.1 200 OK"));
        assert!(http_response("HEAD /metrics HTTP/1.1", "BODY").starts_with("HTTP/1.1 200 OK"));
        assert!(http_response("GET / HTTP/1.1", "BODY").starts_with("HTTP/1.1 404"));
        assert!(http_response("GET /../secrets HTTP/1.1", "BODY").starts_with("HTTP/1.1 404"));
        assert!(http_response("POST /metrics HTTP/1.1", "BODY").starts_with("HTTP/1.1 405"));
        assert!(http_response("", "BODY").starts_with("HTTP/1.1 405"));
    }

    #[test]
    fn a_refused_request_echoes_nothing_of_the_path() {
        let response = http_response("GET /dropqtt/secrets?token=abc HTTP/1.1", "BODY");
        assert!(!response.contains("secrets"), "{response}");
        assert!(!response.contains("token"), "{response}");
        assert!(response.contains("Content-Length: 0"));
    }

    #[test]
    fn head_promises_the_size_but_sends_no_body() {
        let response = http_response("HEAD /metrics HTTP/1.1", "abc");
        assert!(response.contains("Content-Length: 0"), "{response}");
        assert!(response.ends_with("\r\n\r\n"), "{response:?}");
        let get = http_response("GET /metrics HTTP/1.1", "abc");
        assert!(get.contains("Content-Length: 3"));
        assert!(get.ends_with("abc"));
    }

    #[test]
    fn a_refused_method_on_metrics_offers_the_allowed_ones() {
        assert!(http_response("PUT /metrics HTTP/1.1", "B").contains("Allow: GET, HEAD"));
        assert!(!http_response("GET /nope HTTP/1.1", "B").contains("Allow:"));
    }

    #[test]
    fn request_line_extraction_survives_an_empty_or_headerless_request() {
        assert_eq!(request_line("GET /metrics HTTP/1.1\r\nHost: x\r\n\r\n"), "GET /metrics HTTP/1.1");
        assert_eq!(request_line(""), "");
        assert_eq!(request_line("\r\nGET"), "");
    }

    #[test]
    fn status_reports_off_before_anything_is_enabled() {
        let hub = MetricsHub::default();
        let status = hub.status();
        assert!(!status.enabled);
        assert_eq!(status.port, DEFAULT_PORT);
        // The panel's input floor is this number; a second constant in the frontend
        // would let the two disagree about what counts as a usable port.
        assert_eq!(status.min_port, MIN_PORT);
    }

    #[tokio::test]
    async fn a_port_below_the_floor_is_rejected_before_the_bind() {
        let hub = MetricsHub::default();
        let err = hub
            .configure(
                true,
                80,
                std::sync::Arc::new(MqttManager::default()),
                std::sync::Arc::new(BridgeManager::default()),
            )
            .await
            .unwrap_err();
        assert!(err.contains("must be"), "{err}");
        assert!(!hub.status().enabled, "a rejected request must leave the endpoint off");
    }

    #[tokio::test]
    async fn reconfiguring_replaces_the_listener_rather_than_leaking_it() {
        // Two live listeners on two ports would mean a switch that cannot be turned
        // off, so the old task has to be aborted on every reconfigure. Needs a runtime:
        // handing a std listener to tokio requires the reactor.
        let hub = MetricsHub::default();
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port_a = taken.local_addr().unwrap().port();
        drop(taken);
        let mqtt = std::sync::Arc::new(MqttManager::default());
        let bridge = std::sync::Arc::new(BridgeManager::default());
        let first = hub.configure(true, port_a, mqtt.clone(), bridge.clone()).await.unwrap();
        assert!(first.enabled);
        assert_eq!(first.port, port_a);
        assert!(
            hub.configure(true, port_a, mqtt.clone(), bridge.clone())
                .await
                .is_ok(),
            "the previous listener must have been released before rebinding"
        );
        assert!(hub.status().enabled);
        hub.configure(false, port_a, mqtt, bridge).await.unwrap();
        assert!(!hub.status().enabled);
    }

    #[tokio::test]
    async fn a_bad_bind_leaves_the_hub_off() {
        // Someone else holds the port: the hub must not claim to be listening, or the
        // panel shows a URL that answers nothing.
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = taken.local_addr().unwrap().port();
        let hub = MetricsHub::default();
        let err = hub
            .configure(
                true,
                port,
                std::sync::Arc::new(MqttManager::default()),
                std::sync::Arc::new(BridgeManager::default()),
            )
            .await
            .unwrap_err();
        assert!(err.contains("could not listen"), "{err}");
        assert!(!hub.status().enabled);
    }

    #[tokio::test]
    async fn turning_off_before_anything_was_started_is_not_an_error() {
        let hub = MetricsHub::default();
        let status = hub
            .configure(
                false,
                DEFAULT_PORT,
                std::sync::Arc::new(MqttManager::default()),
                std::sync::Arc::new(BridgeManager::default()),
            )
            .await
            .unwrap();
        assert!(!status.enabled);
    }
}
