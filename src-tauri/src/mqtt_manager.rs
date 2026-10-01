use std::collections::{HashMap, HashSet};
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use base64::Engine;
use bytes::Bytes;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

use crate::bench::{self, BenchManager, BenchProgress, BenchSpec, BenchStatus};
use crate::protocol::*;
use crate::scheduler::{self, RunStatus, ScheduleSpec, SchedulerManager};
use crate::topic::wildcard_match;
use crate::transport::{build_connection, MqttClient, NetEvent};
use crate::silence::{self, SilenceAlertEvent, SilenceWatchdog};
use crate::webhook;

/// Max emitted payload bytes in the console feed (base64 view)
const CONSOLE_PAYLOAD_CAP: usize = 64 * 1024;
/// Feed batching: flush cadence, per-emit chunk, and buffer ceiling. At
/// thousands of msgs/sec a per-message IPC event would flood the webview,
/// so messages ride 100 ms batches; overflow drops oldest (counted).
const FEED_FLUSH_MILLIS: u64 = 100;
const FEED_BATCH_MAX: usize = 200;
/// Byte ceiling per emit so one batch can never stall the flusher task
/// (200 x 64 KB base64 payloads would otherwise serialize ~12 MB per tick)
const FEED_BATCH_BYTES: usize = 512 * 1024;
const FEED_BUFFER_MAX: usize = 2000;
/// Rows evicted from the *display* buffer are still owed to SQLite; this is the
/// extra headroom kept for them before they are genuinely lost.
const FEED_ARCHIVE_MAX: usize = 2000;
/// Progress event throttle
const PROGRESS_EMIT_INTERVAL: std::time::Duration = std::time::Duration::from_millis(120);

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum FinalizeState {
    Streaming,
    Verifying,
    AwaitingApproval,
}

pub struct IncomingTransfer {
    pub meta: TransferMeta,
    pub topic_prefix: String,
    pub temp_path: PathBuf,
    pub final_path: PathBuf,
    pub file: Arc<Mutex<File>>,
    pub received_chunks: HashSet<usize>,
    pub bytes_received: u64,
    pub last_update: Instant,
    pub last_emit: Instant,
    pub last_bytes: u64,
    pub nack_rounds: usize,
    /// Sender requested a temporary pause; watchdog timeouts are suspended.
    pub paused: bool,
    pub verified: bool,
    pub finalize_state: FinalizeState,
}

/// Immutable context of an outgoing transfer, also used to re-send missing chunks.
pub struct SendContext {
    pub transfer_id: String,
    pub path: PathBuf,
    pub topic_prefix: String,
    pub file_name: String,
    pub file_size: u64,
    pub chunk_size: usize,
    pub total_chunks: usize,
    pub sha256: String,
    pub qos: u8,
}

#[derive(Clone)]
pub struct ActiveOutgoing {
    pub cancelled: Arc<AtomicBool>,
    pub paused: Arc<AtomicBool>,
    pub nack_rounds: Arc<AtomicUsize>,
    pub ctx: Arc<SendContext>,
}

/// Per-topic traffic meter: cumulative totals plus a one-second sliding
/// window so hot (high-rate) topics can be surfaced and ranked live.
#[derive(Debug, Clone, Default)]
struct TopicTraffic {
    count: u64,
    bytes: u64,
    /// Current second bucket
    window_sec: u64,
    window_count: u64,
    window_bytes: u64,
    /// Completed previous second (what the UI shows as "rate")
    prev_count: u64,
    prev_bytes: u64,
    /// Highest per-second message count / byte volume ever observed
    peak_count: u64,
    peak_bytes: u64,
    last_seen: u64,
}

/// Snapshot row returned to the frontend
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicStatRow {
    pub topic: String,
    pub count: u64,
    pub bytes: u64,
    pub rate: u64,
    pub bytes_rate: u64,
    pub peak_rate: u64,
    pub peak_bytes_rate: u64,
    pub last_seen: u64,
}

/// One batched feed emission to the console (up to FEED_BATCH_MAX rows)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedBatch {
    pub messages: Vec<MqttGenericMessage>,
    /// Cumulative feed drops since connect (stats remain exact)
    pub dropped: u64,
}

/// Cardinality guard for the traffic table. Configurable at runtime
/// (platforms with tens of thousands of topics can raise it); when full we
/// batch-evict the least recently active topics instead of refusing new ones.
const DEFAULT_TOPIC_STATS_CAP: usize = 5_000;
const MIN_TOPIC_STATS_CAP: usize = 100;
const MAX_TOPIC_STATS_CAP: usize = 200_000;

/// One broker `$SYS` metric line (latest value + last-update epoch seconds)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SysRow {
    pub topic: String,
    pub value: String,
    pub last_seen: u64,
}

pub struct MqttManager {
    client: RwLock<Option<MqttClient>>,
    loop_control: Mutex<Option<(JoinHandle<()>, Arc<AtomicBool>)>>,
    current_config: RwLock<Option<BrokerConfig>>,
    /// Topic filter -> QoS. Everything we want subscribed; re-applied on every CONNACK.
    subscriptions: Mutex<HashMap<String, crate::protocol::SubOptions>>,
    /// Topic filter -> number of matched inbound publishes (resettable stats)
    subscription_hits: Mutex<HashMap<String, u64>>,
    /// Actual topic -> live traffic meter (resettable)
    topic_stats: Mutex<HashMap<String, TopicTraffic>>,
    /// Broker `$SYS/*` metrics: topic -> (latest value, last-seen epoch secs)
    sys_metrics: Mutex<HashMap<String, (String, u64)>>,
    /// Silence watchdog: alerts when a topic filter stops carrying traffic
    pub silence_watchdog: Arc<SilenceWatchdog>,
    /// Registry of backend-scheduled publishes for this session
    pub scheduler: Arc<SchedulerManager>,
    /// Registry of built-in publish stress runs (latency + ack accounting)
    pub bench: Arc<BenchManager>,
    /// Optional persistent history store (attached at app setup)
    history: RwLock<Option<Arc<crate::history::HistoryStore>>>,
    /// Runtime-configurable tracking cap (LRU eviction when full)
    topic_stats_cap: std::sync::atomic::AtomicUsize,
    base_topic: RwLock<String>,
    download_dir: RwLock<PathBuf>,
    auto_receive: AtomicBool,
    /// Console feed staging buffer, drained to the UI in batches
    feed_buffer: Arc<Mutex<std::collections::VecDeque<MqttGenericMessage>>>,
    feed_dropped: Arc<std::sync::atomic::AtomicU64>,
    /// Evicted from `feed_buffer` but not yet mirrored to history
    feed_archive_only: Arc<Mutex<Vec<MqttGenericMessage>>>,
    /// Lost from history as well as the display (archive saturated)
    feed_lost: Arc<std::sync::atomic::AtomicU64>,
    incoming_transfers: Mutex<HashMap<String, IncomingTransfer>>,
    outgoing_transfers: Mutex<HashMap<String, ActiveOutgoing>>,
    is_connected: AtomicBool,
    /// `topic-alias-maximum` from the latest CONNACK; 0 means the broker takes no
    /// aliases, so an alias on a publish would be a protocol violation.
    broker_alias_max: AtomicU16,
}

impl Default for MqttManager {
    fn default() -> Self {
        Self::new()
    }
}

impl MqttManager {
    pub fn new() -> Self {
        let def_download = dirs::download_dir().unwrap_or_else(|| PathBuf::from("./downloads"));
        Self {
            client: RwLock::new(None),
            loop_control: Mutex::new(None),
            current_config: RwLock::new(None),
            subscriptions: Mutex::new(HashMap::new()),
            subscription_hits: Mutex::new(HashMap::new()),
            topic_stats: Mutex::new(HashMap::new()),
            sys_metrics: Mutex::new(HashMap::new()),
            silence_watchdog: Arc::new(SilenceWatchdog::default()),
            scheduler: Arc::new(SchedulerManager::new()),
            bench: Arc::new(crate::bench::BenchManager::new()),
            history: RwLock::new(None),
            topic_stats_cap: std::sync::atomic::AtomicUsize::new(DEFAULT_TOPIC_STATS_CAP),
            base_topic: RwLock::new("dropqtt".to_string()),
            download_dir: RwLock::new(def_download),
            auto_receive: AtomicBool::new(true),
            feed_buffer: Arc::new(Mutex::new(std::collections::VecDeque::new())),
            feed_dropped: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            feed_archive_only: Arc::new(Mutex::new(Vec::new())),
            feed_lost: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            incoming_transfers: Mutex::new(HashMap::new()),
            outgoing_transfers: Mutex::new(HashMap::new()),
            is_connected: AtomicBool::new(false),
            broker_alias_max: AtomicU16::new(0),
        }
    }

    pub async fn set_download_dir(&self, path: PathBuf) {
        let mut dir = self.download_dir.write().await;
        *dir = path;
    }

    pub async fn get_download_dir(&self) -> PathBuf {
        self.download_dir.read().await.clone()
    }

    pub fn set_auto_receive(&self, enabled: bool) {
        self.auto_receive.store(enabled, Ordering::SeqCst);
    }

    pub async fn get_connection_status(&self) -> ConnectionStatus {
        let connected = self.is_connected.load(Ordering::SeqCst);
        let config_guard = self.current_config.read().await;
        match config_guard.as_ref() {
            Some(cfg) => ConnectionStatus {
                connected,
                broker_host: cfg.host.clone(),
                broker_port: cfg.port,
                client_id: cfg.client_id.clone(),
            },
            None => ConnectionStatus {
                connected: false,
                broker_host: String::new(),
                broker_port: 1883,
                client_id: String::new(),
            },
        }
    }

    /// Sanitized aggregate state for the diagnostics workspace. Secrets,
    /// payloads and certificate paths are deliberately excluded.
    pub async fn diagnostics_snapshot(&self) -> crate::diagnostics::MqttDiagnostics {
        let config = self.current_config.read().await.clone();
        let history_available = self.history.read().await.is_some();
        let history = self.history_stats().await;
        let download_dir = self.download_dir.read().await.clone();
        let subscriptions = self.subscriptions.lock().await.len();
        let incoming_active = self.incoming_transfers.lock().await.len();
        let outgoing_active = self.outgoing_transfers.lock().await.len();
        let feed_buffered = self.feed_buffer.lock().await.len();
        let topic_stats_count = self.topic_stats.lock().await.len();
        let connected = self.is_connected.load(Ordering::SeqCst);

        let (configured, host, port, client_id, use_tls, use_websocket, protocol_version) =
            match config {
                Some(cfg) => (
                    true,
                    cfg.host,
                    cfg.port,
                    cfg.client_id,
                    cfg.use_tls,
                    cfg.use_websocket,
                    cfg.protocol_version,
                ),
                None => (false, String::new(), 1883, String::new(), false, false, 3),
            };

        crate::diagnostics::MqttDiagnostics {
            configured,
            connected,
            host,
            port,
            client_id,
            use_tls,
            use_websocket,
            protocol_version,
            subscriptions,
            incoming_active,
            outgoing_active,
            feed_buffered,
            feed_buffer_capacity: FEED_BUFFER_MAX,
            feed_dropped: self.feed_dropped.load(Ordering::SeqCst),
            feed_lost: self.feed_lost.load(Ordering::SeqCst),
            topic_stats_count,
            scheduled_runs: self.scheduler.running_count(),
            bench_runs: self.bench.running_count(),
            history_available,
            history,
            download_dir: download_dir.to_string_lossy().to_string(),
            download_dir_writable: false,
            download_dir_error: None,
        }
    }

    pub async fn test_connection(config: BrokerConfig) -> Result<u64, String> {
        let rand_suffix: String = uuid::Uuid::new_v4().simple().to_string()[..6].to_string();
        let mut test_cfg = config.clone();
        let cid: String = format!("{}_t{}", config.client_id, rand_suffix)
            .chars()
            .take(23)
            .collect();
        test_cfg.client_id = cid;

        let (client, mut eventloop) = build_connection(&test_cfg)?;
        let start = Instant::now();
        let deadline = tokio::time::sleep(std::time::Duration::from_secs(6));
        tokio::pin!(deadline);

        loop {
            let result = tokio::select! {
                _ = &mut deadline => return Err("Connection timed out after 6 seconds".to_string()),
                r = eventloop.poll() => r,
            };
            match result {
                NetEvent::Connected(_) => {
                    let latency = start.elapsed().as_millis() as u64;
                    client.disconnect().await;
                    return Ok(latency);
                }
                NetEvent::ConnectionError(e) => {
                    return Err(format!("Connection error: {}", e));
                }
                _ => {}
            }
        }
    }

    pub async fn connect(self: &Arc<Self>, app: AppHandle, config: BrokerConfig) -> Result<(), String> {
        self.disconnect().await;

        let (client, mut eventloop) = build_connection(&config)?;

        *self.client.write().await = Some(client.clone());
        *self.current_config.write().await = Some(config.clone());
        let base_topic = config.base_topic.clone().unwrap_or_else(|| "dropqtt".to_string());
        *self.base_topic.write().await = base_topic.clone();
        self.is_connected.store(false, Ordering::SeqCst);

        let shutdown = Arc::new(AtomicBool::new(false));
        let this = self.clone();
        let app_handle = app.clone();
        let flag = shutdown.clone();

        let handle = tokio::spawn(async move {
            // IMPORTANT: rumqttc's EventLoop::poll is NOT cancellation-safe —
            // wrapping it in select! (previous design) cancelled it mid-flight
            // every 100 ms tick, corrupting connection state and causing the
            // sporadic auto-disconnects. Keep this loop pure; the feed flusher
            // runs on its own task so batch serialization never blocks keepalive.
            while !flag.load(Ordering::SeqCst) {
                match eventloop.poll().await {
                    NetEvent::Connected(alias_max) => {
                        this.broker_alias_max.store(alias_max, Ordering::SeqCst);
                        // Start every silence timer from now: a gap while we were
                        // disconnected is our own outage, not the device's.
                        this.silence_watchdog
                            .set_connected(true, chrono::Utc::now().timestamp());
                        // (Re)apply every registered subscription after CONNACK,
                        // including automatic reconnects.
                        if let Some(client) = this.client.read().await.clone() {
                            let subs: Vec<(String, crate::protocol::SubOptions)> = this
                                .subscriptions
                                .lock()
                                .await
                                .iter()
                                .map(|(t, o)| (t.clone(), *o))
                                .collect();
                            for (topic, opts) in subs {
                                let _ = client.subscribe(&topic, &opts).await;
                            }
                            // Broker health metrics — subscribed out-of-band so
                            // $SYS never pollutes the console feed or traffic stats.
                            let _ = client
                                .subscribe("$SYS/#", &crate::protocol::SubOptions { qos: 0, ..Default::default() })
                                .await;
                        }
                        let first = !this.is_connected.swap(true, Ordering::SeqCst);
                        if first {
                            let _ = app_handle.emit("broker-connected", ());
                        }
                        let _ = app_handle.emit("broker-status", this.get_connection_status().await);
                    }
                    NetEvent::ConnectionError(e) => {
                        if this.is_connected.swap(false, Ordering::SeqCst) {
                            let _ = app_handle.emit("broker-status", this.get_connection_status().await);
                        }
                        let _ = app_handle.emit("broker-disconnected", e);
                        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                    }
                    NetEvent::Publish(publish) => {
                        this.route_message(&app_handle, publish).await;
                    }
                    NetEvent::PublishAcked => {
                        // Only the bench lab cares, and it compares this against
                        // `sent` to show client-side backpressure.
                        this.bench.record_ack();
                    }
                    NetEvent::Other => {}
                }
            }
        });

        // Dedicated feed flusher: drains staged rows on a fixed cadence on its
        // own task; performs the final drain when the connection shuts down.
        let this_flush = self.clone();
        let app_flush = app.clone();
        let flag_flush = shutdown.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(FEED_FLUSH_MILLIS)).await;
                let stopping = flag_flush.load(Ordering::SeqCst);
                this_flush.flush_feed(&app_flush).await;
                if stopping {
                    break;
                }
            }
        });

        // Silence watchdog tick: evaluates thresholds once a second (last-seen
        // has one-second resolution) and delivers alerts off the poll task so a
        // slow endpoint can never stall MQTT processing.
        let this_wd = self.clone();
        let app_wd = app.clone();
        let flag_wd = shutdown.clone();
        tokio::spawn(async move {
            let client = webhook::client();
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                if flag_wd.load(Ordering::SeqCst) {
                    break;
                }
                if !this_wd.is_connected.load(Ordering::SeqCst) {
                    continue;
                }
                let alerts = this_wd.silence_watchdog.evaluate(chrono::Utc::now().timestamp());
                for alert in alerts {
                    let Ok(client) = client.as_ref().cloned() else {
                        let _ = app_wd.emit("silence-alert", SilenceAlertEvent {
                            rule_id: alert.rule_id, rule_name: alert.rule_name,
                            topic_filter: alert.topic_filter, silent_for_sec: alert.silent_for_sec,
                            ok: false, error: Some("HTTP client unavailable".into()),
                            target: String::new(),
                            timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
                        });
                        continue;
                    };
                    let config = silence::alert_webhook(&alert.webhook);
                    let body = Bytes::from(silence::alert_body(&alert));
                    let app = app_wd.clone();
                    let event = SilenceAlertEvent {
                        rule_id: alert.rule_id,
                        rule_name: alert.rule_name,
                        topic_filter: alert.topic_filter,
                        silent_for_sec: alert.silent_for_sec,
                        ok: true,
                        error: None,
                        target: config.display_target(),
                        timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
                    };
                    tokio::spawn(async move {
                        let outcome = match webhook::deliver(&client, &config, body).await {
                            Ok(()) => event,
                            Err(e) => SilenceAlertEvent { error: Some(e), ..event },
                        };
                        let _ = app.emit("silence-alert", outcome);
                    });
                }
            }
        });

        *self.loop_control.lock().await = Some((handle, shutdown));
        Ok(())
    }

    pub async fn disconnect(&self) {
        self.is_connected.store(false, Ordering::SeqCst);
        self.broker_alias_max.store(0, Ordering::SeqCst);
        // Disarm so the outage we are about to cause is not reported as the
        // device having gone quiet.
        self.silence_watchdog.set_connected(false, 0);
        // Scheduled publishes aim at the session that is ending, so they stop with
        // it instead of erroring against a dropped client. connect() also lands
        // here, which is what makes a broker switch reset the registry.
        self.scheduler.stop_all();
        self.bench.stop_all();

        let control = self.loop_control.lock().await.take();
        let client = self.client.write().await.take();
        let handle = if let Some((handle, flag)) = control {
            flag.store(true, Ordering::SeqCst);
            Some(handle)
        } else {
            None
        };

        if let Some(client) = client {
            let _ = client.disconnect().await;
        }
        if let Some(handle) = handle {
            // Give the event loop a chance to put DISCONNECT on the wire before
            // cancelling its poll; dropping the timeout future is the fallback abort.
            let _ = tokio::time::timeout(std::time::Duration::from_millis(500), handle).await;
        }

        // Abandon partial incoming transfers (temp files removed, UI notified)
        let mut incoming = self.incoming_transfers.lock().await;
        for trans in incoming.values_mut() {
            let _ = tokio::fs::remove_file(&trans.temp_path).await;
        }
        incoming.clear();

        // Drop the previous broker's $SYS snapshot so a reconnect starts clean
        self.sys_metrics.lock().await.clear();
    }

    pub async fn subscribe_topic(&self, topic: String, opts: crate::protocol::SubOptions) -> Result<(), String> {
        if topic.trim().is_empty() {
            return Err("Topic must not be empty".to_string());
        }
        self.subscriptions.lock().await.insert(topic.clone(), opts);
        self.subscription_hits.lock().await.entry(topic.clone()).or_insert(0);
        if let Some(client) = self.client.read().await.clone() {
            // Registration above still guarantees a retry on the next CONNACK,
            // but surface this attempt's failure so troubleshooters can react.
            client
                .subscribe(&topic, &opts)
                .await
                .map_err(|e| format!("Subscribe failed for {topic}: {e}"))?;
        }
        Ok(())
    }

    pub async fn unsubscribe_topic(&self, topic: String) -> Result<(), String> {
        self.subscriptions.lock().await.remove(&topic);
        self.subscription_hits.lock().await.remove(&topic);
        if let Some(client) = self.client.read().await.clone() {
            client.unsubscribe(&topic).await;
        }
        Ok(())
    }

    /// Latest broker `$SYS` metrics, sorted by topic (hottest health first).
    pub async fn get_broker_sys(&self) -> Vec<SysRow> {
        let m = self.sys_metrics.lock().await;
        let mut rows: Vec<SysRow> = m
            .iter()
            .map(|(topic, (value, seen))| SysRow {
                topic: topic.clone(),
                value: value.clone(),
                last_seen: *seen,
            })
            .collect();
        rows.sort_by(|a, b| a.topic.cmp(&b.topic));
        rows
    }

    pub async fn clear_broker_sys(&self) {
        self.sys_metrics.lock().await.clear();
    }

    /// Attach the persistent history store (called once at app setup).
    pub fn attach_history(&self, store: Arc<crate::history::HistoryStore>) {
        if let Ok(mut g) = self.history.try_write() {
            *g = Some(store);
        }
    }

    pub async fn query_history(
        &self,
        search: &str,
        direction: &str,
        limit: i64,
        since_ms: i64,
        until_ms: i64,
    ) -> Result<Vec<crate::history::HistoryRow>, String> {
        let store = self
            .history
            .read()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| "message history is not available".to_string())?;
        store.query(search, direction, limit, since_ms, until_ms)
    }

    pub async fn history_series(
        &self,
        topic: &str,
        direction: &str,
        bucket_ms: i64,
        since_ms: i64,
        until_ms: i64,
    ) -> Result<Vec<crate::history::HistorySeriesPoint>, String> {
        let store = self
            .history
            .read()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| "message history is not available".to_string())?;
        store.series(topic, direction, bucket_ms, since_ms, until_ms)
    }

    pub async fn history_stats(&self) -> crate::history::HistoryStats {
        self.history
            .read()
            .await
            .as_ref()
            .map(|h| h.stats())
            .unwrap_or(crate::history::HistoryStats { rows: 0, inbound: 0, outbound: 0, oldest_ts: None, newest_ts: None })
    }

    pub async fn clear_history(&self) {
        if let Some(h) = self.history.read().await.as_ref() {
            h.clear();
        }
    }

    /// Stage one console-feed message (never blocks the routing path; the
    /// UI receives 100 ms batches instead of one IPC event per message)
    async fn push_feed(&self, msg: MqttGenericMessage) {
        let evicted = {
            let mut buf = self.feed_buffer.lock().await;
            let evicted = if buf.len() >= FEED_BUFFER_MAX {
                // Sustained overload: the oldest row leaves the *display* path.
                // It must still reach SQLite — dropping precisely the burst a
                // user is trying to diagnose is the worst failure mode for a
                // tool whose pitch is full traffic retention.
                self.feed_dropped.fetch_add(1, Ordering::SeqCst);
                buf.pop_front()
            } else {
                None
            };
            buf.push_back(msg);
            evicted
        };
        if let Some(evicted) = evicted {
            let mut archive = self.feed_archive_only.lock().await;
            if archive.len() < FEED_ARCHIVE_MAX {
                archive.push(evicted);
            } else {
                // Archive saturated: this one is genuinely gone.
                self.feed_lost.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    /// Drain staged messages into batched `mqtt-messages` events, capped by
    /// both message count and serialized size so emits stay cheap.
    async fn flush_feed(self: &Arc<Self>, app: &AppHandle) {
        let batch: Vec<MqttGenericMessage> = {
            let mut buf = self.feed_buffer.lock().await;
            let mut bytes = 0usize;
            let mut batch: Vec<MqttGenericMessage> = Vec::with_capacity(64);
            while let Some(m) = buf.pop_front() {
                bytes += m.payload_base64.len();
                batch.push(m);
                if batch.len() >= FEED_BATCH_MAX || bytes >= FEED_BATCH_BYTES {
                    break;
                }
            }
            batch
        };
        // Rows evicted from the display since the last tick still belong in history.
        let archive: Vec<MqttGenericMessage> =
            std::mem::take(&mut *self.feed_archive_only.lock().await);
        if batch.is_empty() && archive.is_empty() {
            return;
        }
        // Mirror to SQLite before the batch is consumed by the emit.
        if let Some(h) = self.history.read().await.as_ref() {
            if !archive.is_empty() {
                h.append(&archive);
            }
            if !batch.is_empty() {
                h.append(&batch);
            }
        }
        if batch.is_empty() {
            return;
        }
        let dropped = self.feed_dropped.load(Ordering::SeqCst);
        let _ = app.emit(
            "mqtt-messages",
            FeedBatch { messages: batch, dropped },
        );
    }

    pub async fn get_subscription_stats(&self) -> HashMap<String, u64> {
        self.subscription_hits.lock().await.clone()
    }

    pub async fn reset_subscription_stats(&self) {
        let mut hits = self.subscription_hits.lock().await;
        for v in hits.values_mut() {
            *v = 0;
        }
    }

    /// Record one inbound publish against its actual topic (O(1), second buckets).
    /// When the tracking cap is full, batch-evict the least recently active 10%
    /// so fresh topics always get admitted.
    async fn record_topic(&self, topic: &str, bytes: u64) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut stats = self.topic_stats.lock().await;
        let entry = match stats.get_mut(topic) {
            Some(e) => e,
            None => {
                let cap = self.topic_stats_cap.load(Ordering::SeqCst);
                if stats.len() >= cap {
                    let evict_n = (cap / 10).max(1);
                    let mut by_age: Vec<(&String, u64)> =
                        stats.iter().map(|(t, e)| (t, e.last_seen)).collect();
                    by_age.sort_by_key(|(_, ts)| *ts);
                    let victims: Vec<String> = by_age
                        .into_iter()
                        .take(evict_n)
                        .map(|(t, _)| t.clone())
                        .collect();
                    for v in victims {
                        stats.remove(&v);
                    }
                }
                stats.entry(topic.to_string()).or_default()
            }
        };
        if entry.window_sec != now {
            // Roll the second bucket forward, tracking the peak
            entry.peak_count = entry.peak_count.max(entry.window_count);
            entry.peak_bytes = entry.peak_bytes.max(entry.window_bytes);
            entry.prev_count = entry.window_count;
            entry.prev_bytes = entry.window_bytes;
            entry.window_count = 0;
            entry.window_bytes = 0;
            entry.window_sec = now;
        }
        entry.count += 1;
        entry.bytes += bytes;
        entry.window_count += 1;
        entry.window_bytes += bytes;
        entry.last_seen = now;
    }

    /// Current traffic table, hottest (msgs/sec) first.
    /// Rate decays to zero once a topic has been quiet for >2s, so stale
    /// last-second values don't masquerade as live traffic.
    pub async fn get_topic_stats(&self) -> Vec<TopicStatRow> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let stats = self.topic_stats.lock().await;
        let mut rows: Vec<TopicStatRow> = stats
            .iter()
            .map(|(topic, t)| {
                let live = now.saturating_sub(t.window_sec) <= 2;
                TopicStatRow {
                    topic: topic.clone(),
                    count: t.count,
                    bytes: t.bytes,
                    rate: if live { t.prev_count } else { 0 },
                    bytes_rate: if live { t.prev_bytes } else { 0 },
                    peak_rate: t.peak_count,
                    peak_bytes_rate: t.peak_bytes,
                    last_seen: t.last_seen,
                }
            })
            .collect();
        rows.sort_by(|a, b| b.rate.cmp(&a.rate).then(b.count.cmp(&a.count)));
        rows
    }

    pub async fn reset_topic_stats(&self) {
        self.topic_stats.lock().await.clear();
    }

    /// Runtime-configurable tracking cap (clamped to 100..=200_000)
    pub fn set_topic_stats_cap(&self, cap: usize) {
        self.topic_stats_cap
            .store(cap.clamp(MIN_TOPIC_STATS_CAP, MAX_TOPIC_STATS_CAP), Ordering::SeqCst);
    }

    pub fn get_topic_stats_cap(&self) -> usize {
        self.topic_stats_cap.load(Ordering::SeqCst)
    }

    /// Built-in publish stress lab: pushes `rate` msgs/sec of `size` bytes across
    /// `topics` for `duration_sec` (0 = until stopped) on the session client.
    /// Runs live in `bench::BenchManager`, so they can be listed, stopped, and
    /// timed from the copies the broker loops back to us.
    pub async fn bench_start(
        self: &Arc<Self>,
        app: AppHandle,
        spec: BenchSpec,
    ) -> Result<(), String> {
        self.bench.preflight(&spec)?;
        let client = self
            .client
            .read()
            .await
            .clone()
            .ok_or_else(|| "MQTT client not connected".to_string())?;
        let cancel = Arc::new(AtomicBool::new(false));
        let manager = self.clone();
        let task_app = app.clone();
        let task_spec = spec.clone();
        let task_cancel = cancel.clone();
        let handle = tokio::spawn(async move {
            manager
                .run_bench(task_app, client, task_spec, task_cancel)
                .await
        });
        self.bench.register(spec, cancel, handle);
        Ok(())
    }

    async fn run_bench(
        self: &Arc<Self>,
        app: AppHandle,
        client: MqttClient,
        spec: BenchSpec,
        cancel: Arc<AtomicBool>,
    ) {
        // Absolute grid, same reasoning as `run_schedule`: `rate` is a total across
        // topics, so one message leaves every 1e6/rate microseconds.
        let period = std::time::Duration::from_micros(1_000_000 / spec.rate as u64);
        let mut next = tokio::time::Instant::now();
        let mut ticker = tokio::time::interval(std::time::Duration::from_millis(500));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let limit =
            (spec.duration_sec > 0).then(|| std::time::Duration::from_secs(spec.duration_sec as u64));
        let started = Instant::now();
        let mut seq: u32 = 0;
        loop {
            tokio::select! {
                _ = tokio::time::sleep_until(next) => {
                    if cancel.load(Ordering::SeqCst) {
                        return;
                    }
                    if let Some(limit) = limit {
                        if started.elapsed() >= limit {
                            self.bench.finish(&spec.id, BenchStatus::Finished, None);
                            self.emit_bench_progress(&app).await;
                            return;
                        }
                    }
                    let topic = spec.topics[(seq as usize) % spec.topics.len()].clone();
                    let payload = Bytes::from(bench::bench_payload(
                        spec.size as usize,
                        seq,
                        chrono::Utc::now().timestamp_millis(),
                    ));
                    if let Err(e) = client.publish(&topic, spec.qos, spec.retain, payload, None).await {
                        self.bench.finish(&spec.id, BenchStatus::Failed, Some(e.to_string()));
                        self.emit_bench_progress(&app).await;
                        return;
                    }
                    seq = seq.wrapping_add(1);
                    self.bench.record_sent(&spec.id);
                    next += period;
                    if tokio::time::Instant::now() > next + period {
                        next = tokio::time::Instant::now();
                    }
                }
                _ = ticker.tick() => {
                    self.emit_bench_progress(&app).await;
                }
            }
        }
    }

    pub fn bench_progress(&self) -> Vec<BenchProgress> {
        self.bench.progress()
    }

    pub async fn bench_stop(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        if !self.bench.stop(id) {
            return Err(format!("no bench run named '{id}'"));
        }
        self.emit_bench_progress(app).await;
        Ok(())
    }

    pub fn bench_clear_finished(&self) -> usize {
        self.bench.clear_finished()
    }

    /// One throttled event carries every run, so a 20k msg/s bench never emits
    /// per-message and the panel still shows live percentiles.
    async fn emit_bench_progress(&self, app: &AppHandle) {
        let _ = app.emit("bench-progress", self.bench.progress());
    }

    pub async fn publish_console(
        &self,
        app: AppHandle,
        params: ConsolePublishParams,
    ) -> Result<(), String> {
        let _ = &app; // feed echoes now ride the batched flusher instead of per-msg emits
        let client = self
            .client
            .read()
            .await
            .clone()
            .ok_or_else(|| "MQTT client not connected".to_string())?;
        // Check the broker's advertised limit first: rumqttc treats an oversized
        // alias as a protocol violation and drops the whole connection for it.
        if let Some(err) = crate::transport::alias_rejection(
            params.properties.topic_alias,
            self.broker_alias_max.load(Ordering::SeqCst),
        ) {
            return Err(err);
        }

        let payload = base64::engine::general_purpose::STANDARD
            .decode(params.payload_base64.as_bytes())
            .map_err(|e| format!("Invalid base64 payload: {}", e))?;
        let payload_len = payload.len();
        let payload: Bytes = Bytes::from(payload);

        let props = if params.properties.content_type.is_some()
            || !params.properties.user_properties.is_empty()
            || params.properties.message_expiry.is_some()
            || params.properties.response_topic.is_some()
            || params.properties.correlation_data.is_some()
            || params.properties.payload_format.is_some()
            || params.properties.topic_alias.is_some()
        {
            Some(params.properties.clone())
        } else {
            None
        };

        client
            .publish(&params.topic, params.qos, params.retain, payload, props.as_ref())
            .await
            .map_err(|e| format!("Failed to publish: {}", e))?;

        let display_text = {
            let decoded: Vec<u8> = base64::engine::general_purpose::STANDARD
                .decode(params.payload_base64.as_bytes())
                .unwrap_or_default();
            String::from_utf8_lossy(&decoded).to_string()
        };

        let msg = MqttGenericMessage {
            id: uuid::Uuid::new_v4().to_string(),
            topic: params.topic.clone(),
            payload: display_text,
            payload_len,
            payload_base64: params.payload_base64.clone(),
            truncated: false,
            content_type: params.properties.content_type.clone(),
            user_properties: params.properties.user_properties.clone(),
            response_topic: params.properties.response_topic.clone(),
            correlation_data: params.properties.correlation_data.clone(),
            payload_format: params.properties.payload_format,
            qos: params.qos,
            retain: params.retain,
            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
            direction: "out".to_string(),
        };
        self.push_feed(msg).await;

        Ok(())
    }

    // ------------------------------------------------------------------
    // Scheduled publishing
    // ------------------------------------------------------------------

    /// Start a scheduled publish on the session's own client. The cadence lives
    /// in the backend rather than a webview `setInterval` so it survives panel
    /// unmounts, view switches and broker reconnects, and so tick *n* is aimed at
    /// a fixed period instead of "one period after the last round-trip finished".
    pub async fn schedule_start(
        self: &Arc<Self>,
        app: AppHandle,
        spec: ScheduleSpec,
    ) -> Result<(), String> {
        self.scheduler.preflight(&spec)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let manager = self.clone();
        let task_app = app.clone();
        let task_spec = spec.clone();
        let task_cancel = cancel.clone();
        let handle =
            tokio::spawn(async move { manager.run_schedule(task_app, task_spec, task_cancel).await });
        self.scheduler.register(spec, cancel, handle);
        Ok(())
    }

    async fn run_schedule(
        self: &Arc<Self>,
        app: AppHandle,
        spec: ScheduleSpec,
        cancel: Arc<AtomicBool>,
    ) {
        let period = std::time::Duration::from_millis(spec.interval_ms);
        // Absolute grid: fire n is aimed at `next`, which advances by exactly one
        // period no matter how long the publish took. A tokio `interval` with the
        // Delay policy (and a webview `setInterval`) both re-arm from "now", so
        // every tick's own cost leaked into the cadence — measured at 100 ms the
        // Delay version ran p50 110 ms and finished 60 ticks in 6.55 s instead of
        // 5.9 s. Falling more than one period behind (suspend, stalled runtime)
        // re-anchors instead of discharging a burst of catch-up publishes.
        let mut next = tokio::time::Instant::now();
        let mut seq: u64 = 0;
        loop {
            tokio::time::sleep_until(next).await;
            if cancel.load(Ordering::SeqCst) {
                return;
            }
            seq += 1;
            next += period;
            if tokio::time::Instant::now() > next + period {
                next = tokio::time::Instant::now();
            }
            let now_ms = chrono::Utc::now().timestamp_millis();
            let random = (uuid::Uuid::new_v4().as_u128() & u128::from(u32::MAX)) as u32;
            let rendered = scheduler::render_template(&spec.payload, seq, now_ms, random);
            let params = match scheduler::encode_payload(&spec.format, &rendered) {
                Ok(bytes) => ConsolePublishParams {
                    topic: spec.topic.clone(),
                    payload_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                    qos: spec.qos,
                    retain: spec.retain,
                    properties: spec.properties.clone(),
                },
                Err(e) => {
                    self.scheduler.fail(&spec.id, &e);
                    self.emit_schedule_event(&app, &spec.id).await;
                    return;
                }
            };
            let outcome = self.publish_console(app.clone(), params).await;
            match outcome {
                Ok(()) => match self.scheduler.record_fire(&spec.id, now_ms) {
                    RunStatus::Completed | RunStatus::Failed | RunStatus::Stopped => {
                        self.emit_schedule_event(&app, &spec.id).await;
                        return;
                    }
                    RunStatus::Running => {}
                },
                Err(e) => {
                    let streak = self.scheduler.record_error(&spec.id, &e);
                    if streak >= scheduler::MAX_CONSECUTIVE_ERRORS {
                        self.emit_schedule_event(&app, &spec.id).await;
                        return;
                    }
                }
            }
        }
    }

    pub fn schedule_list(&self) -> Vec<scheduler::RunInfo> {
        self.scheduler.snapshot()
    }

    pub async fn schedule_stop(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        if !self.scheduler.stop(id) {
            return Err(format!("no schedule named '{id}' in this session"));
        }
        self.emit_schedule_event(app, id).await;
        Ok(())
    }

    pub fn schedule_clear_finished(&self) -> usize {
        self.scheduler.clear_finished()
    }

    /// Terminal-state notification. Progress is polled by the UI instead, so this
    /// stays quiet even for a run that fires many times a second.
    async fn emit_schedule_event(&self, app: &AppHandle, id: &str) {
        if let Some(info) = self.scheduler.info(id) {
            let _ = app.emit("schedule-event", info);
        }
    }

    // ------------------------------------------------------------------
    // Message routing
    // ------------------------------------------------------------------

    async fn route_message(self: &Arc<Self>, app: &AppHandle, publish: crate::transport::NormalizedPublish) {
        let topic = publish.topic;

        // Silence watchdog needs every publish, including $SYS, to be able to
        // watch broker-side topics too.
        self.silence_watchdog.observe(&topic, chrono::Utc::now().timestamp());
        // Bench latency: a looped-back copy of our own publish carries the send
        // timestamp, which is what makes publish-to-return timing measurable.
        self.bench.observe(&topic, &publish.payload, chrono::Utc::now().timestamp_millis());

        // Broker $SYS metrics: capture latest value, keep out of feed + traffic.
        if topic.starts_with("$SYS/") {
            let value = String::from_utf8_lossy(&publish.payload).trim().to_string();
            let now = chrono::Utc::now().timestamp().max(0) as u64;
            self.sys_metrics.lock().await.insert(topic, (value, now));
            return;
        }

        // Per-topic traffic meter (count / bytes / per-second rate)
        self.record_topic(&topic, publish.payload.len() as u64).await;

        // Subscription hit stats: which registered filters is this publish matching?
        {
            let subs = self.subscriptions.lock().await;
            if !subs.is_empty() {
                let mut hits = self.subscription_hits.lock().await;
                for filter in subs.keys() {
                    if wildcard_match(filter, &topic) {
                        *hits.entry(filter.clone()).or_insert(0) += 1;
                    }
                }
            }
        }

        // Console feed: surface everything except raw chunk data
        let is_chunk_topic = topic.split('/').any(|seg| seg == "chunk");
        if !is_chunk_topic {
            let payload_len = publish.payload.len();
            let truncated = payload_len > CONSOLE_PAYLOAD_CAP;
            let stored_bytes: Vec<u8> = if truncated {
                publish.payload[..CONSOLE_PAYLOAD_CAP].to_vec()
            } else {
                publish.payload.to_vec()
            };
            let msg = MqttGenericMessage {
                id: uuid::Uuid::new_v4().to_string(),
                topic: topic.clone(),
                payload: String::from_utf8_lossy(&stored_bytes).to_string(),
                payload_len,
                payload_base64: base64::engine::general_purpose::STANDARD.encode(&stored_bytes),
                truncated,
                content_type: publish.content_type.clone(),
                user_properties: publish.user_properties.clone(),
                response_topic: publish.response_topic.clone(),
                correlation_data: publish.correlation_data.clone(),
                payload_format: publish.payload_format,
                qos: publish.qos,
                retain: publish.retain,
                timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
                direction: "in".to_string(),
            };
            self.push_feed(msg).await;
        }

        if topic.ends_with("/meta") {
            self.handle_meta(app, &topic, publish.payload).await;
        } else if let Some((_prefix, tail)) = topic.split_once("/chunk/") {
            self.handle_chunk(app, &topic, tail, publish.payload).await;
        } else if let Some((_prefix, tail)) = topic.split_once("/ctrl/") {
            self.handle_ctrl(app, tail, publish.payload).await;
        }
    }

    async fn handle_meta(self: &Arc<Self>, app: &AppHandle, topic: &str, payload: Bytes) {
        let meta: TransferMeta = match serde_json::from_slice(&payload) {
            Ok(m) => m,
            Err(_) => return,
        };

        // Ignore self-originated transfers and malformed metadata
        let my_client_id = {
            let cfg = self.current_config.read().await;
            cfg.as_ref().map(|c| c.client_id.clone()).unwrap_or_default()
        };
        if meta.sender_id == my_client_id || meta.sender_id.is_empty() {
            return;
        }
        if meta.chunk_size == 0
            || meta.chunk_size > 8 * 1024 * 1024
            || meta.total_chunks == 0
            || meta.sha256.len() != 64
        {
            return;
        }
        let expected_chunks =
            meta.file_size.div_ceil(meta.chunk_size as u64).max(1) as usize;
        if expected_chunks != meta.total_chunks {
            return;
        }
        // transfer_id is embedded in the temp file name — reject traversal.
        if !is_safe_transfer_id(&meta.transfer_id) {
            eprintln!("Rejected transfer with unsafe id");
            return;
        }

        let mut incoming = self.incoming_transfers.lock().await;
        if incoming.contains_key(&meta.transfer_id) {
            // Duplicate/replayed meta: keep the ongoing transfer untouched.
            return;
        }

        let topic_prefix = topic.strip_suffix("/meta").unwrap_or(topic).to_string();
        let download_dir = self.download_dir.read().await.clone();
        let _ = tokio::fs::create_dir_all(&download_dir).await;

        let safe_name = sanitize_file_name(&meta.file_name);
        let temp_path = download_dir.join(format!(".dropqtt_{}.tmp", meta.transfer_id));
        let final_path = get_unique_path(&download_dir, &safe_name);

        let file = match File::create(&temp_path).await {
            Ok(f) => Arc::new(Mutex::new(f)),
            Err(e) => {
                eprintln!("Failed to create temp file {:?}: {:?}", temp_path, e);
                return;
            }
        };

        incoming.insert(
            meta.transfer_id.clone(),
            IncomingTransfer {
                meta: meta.clone(),
                topic_prefix: topic_prefix.clone(),
                temp_path: temp_path.clone(),
                final_path: final_path.clone(),
                file,
                received_chunks: HashSet::new(),
                bytes_received: 0,
                last_update: Instant::now(),
                last_emit: Instant::now(),
                last_bytes: 0,
                nack_rounds: 0,
                paused: false,
                verified: false,
                finalize_state: FinalizeState::Streaming,
            },
        );
        drop(incoming);

        emit_progress(
            app,
            &meta.transfer_id,
            &topic_prefix,
            &safe_name,
            "receive",
            0,
            meta.file_size,
            0,
            meta.total_chunks,
            0.0,
            "transferring",
            None,
            &meta.sha256,
            Some(final_path.to_string_lossy().to_string()),
        );

        // Watchdog: NACK missing chunks, fail on timeout
        let this = self.clone();
        let app_watch = app.clone();
        let tid = meta.transfer_id.clone();
        tokio::spawn(async move {
            run_watchdog(this, app_watch, tid).await;
        });
    }

    async fn handle_chunk(
        self: &Arc<Self>,
        app: &AppHandle,
        full_topic: &str,
        tail: &str,
        payload: Bytes,
    ) {
        let parts: Vec<&str> = tail.split('/').collect();
        if parts.len() < 2 {
            return;
        }
        let transfer_id = parts[0].to_string();
        let chunk_idx: usize = match parts[1].parse() {
            Ok(idx) => idx,
            Err(_) => return,
        };
        let topic_prefix = full_topic
            .split_once("/chunk/")
            .map(|(p, _)| p.to_string())
            .unwrap_or_default();

        let mut complete_now: Option<(PathBuf, PathBuf, String, String, String, u64, usize)> = None;

        {
            let mut incoming = self.incoming_transfers.lock().await;
            let entry = match incoming.get_mut(&transfer_id) {
                Some(e) => e,
                None => return, // No meta seen yet (out-of-order) — QoS1 redelivery will retry
            };

            if entry.finalize_state != FinalizeState::Streaming {
                return;
            }
            if chunk_idx >= entry.meta.total_chunks || entry.received_chunks.contains(&chunk_idx) {
                return;
            }

            // Strict size validation per chunk position
            let expected_len = expected_chunk_len(
                entry.meta.file_size,
                entry.meta.chunk_size,
                entry.meta.total_chunks,
                chunk_idx,
            );
            if payload.len() != expected_len {
                eprintln!(
                    "Chunk {} size mismatch for {}: got {} B, expected {} B — ignored",
                    chunk_idx, transfer_id, payload.len(), expected_len
                );
                return;
            }

            let offset = (chunk_idx * entry.meta.chunk_size) as u64;
            {
                let mut f = entry.file.lock().await;
                let io_res = match f.seek(SeekFrom::Start(offset)).await {
                    Ok(_) => f.write_all(&payload).await.map_err(|e| format!("write: {e}")),
                    Err(e) => Err(format!("seek: {e}")),
                };
                drop(f);
                if let Err(detail) = io_res {
                    // Real failure (disk full / permission): report it now instead
                    // of letting the watchdog misattribute it to a timeout.
                    eprintln!(
                        "Disk I/O failed for {} chunk {}: {}",
                        transfer_id, chunk_idx, detail
                    );
                    let temp_path = entry.temp_path.clone();
                    let save_path = entry.final_path.to_string_lossy().to_string();
                    emit_progress(
                        app,
                        &transfer_id,
                        &topic_prefix,
                        &entry.meta.file_name,
                        "receive",
                        entry.bytes_received,
                        entry.meta.file_size,
                        entry.received_chunks.len(),
                        entry.meta.total_chunks,
                        0.0,
                        "failed",
                        Some(format!("写入失败 (chunk {chunk_idx}): {detail}")),
                        &entry.meta.sha256,
                        Some(save_path),
                    );
                    incoming.remove(&transfer_id);
                    let _ = std::fs::remove_file(&temp_path);
                    return;
                }
            }

            entry.received_chunks.insert(chunk_idx);
            entry.bytes_received += payload.len() as u64;
            entry.last_update = Instant::now();

            let done = entry.received_chunks.len() >= entry.meta.total_chunks;
            if done {
                entry.finalize_state = FinalizeState::Verifying;
                complete_now = Some((
                    entry.temp_path.clone(),
                    entry.final_path.clone(),
                    entry.meta.sha256.clone(),
                    entry.meta.file_name.clone(),
                    topic_prefix.clone(),
                    entry.meta.file_size,
                    entry.meta.total_chunks,
                ));
            }

            let chunks_done = entry.received_chunks.len();
            let speed_bps = {
                let elapsed = entry.last_emit.elapsed().as_secs_f64().max(0.001);
                let delta = entry.bytes_received.saturating_sub(entry.last_bytes);
                entry.last_bytes = entry.bytes_received;
                entry.last_emit = Instant::now();
                delta as f64 / elapsed
            };

            emit_progress(
                app,
                &transfer_id,
                &topic_prefix,
                &entry.meta.file_name,
                "receive",
                entry.bytes_received,
                entry.meta.file_size,
                chunks_done,
                entry.meta.total_chunks,
                speed_bps,
                if done { "verifying" } else { "transferring" },
                None,
                &entry.meta.sha256,
                Some(entry.final_path.to_string_lossy().to_string()),
            );
        }

        if let Some((temp_path, final_path, expected_hash, file_name, prefix, file_size, total_chunks)) =
            complete_now
        {
            let this = self.clone();
            let app_fin = app.clone();
            let tid = transfer_id.clone();
            tokio::spawn(async move {
                this.finalize_incoming(
                    app_fin, tid, temp_path, final_path, expected_hash, file_name, prefix,
                    file_size, total_chunks,
                )
                .await;
            });
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn finalize_incoming(
        self: Arc<Self>,
        app: AppHandle,
        transfer_id: String,
        temp_path: PathBuf,
        final_path: PathBuf,
        expected_hash: String,
        file_name: String,
        topic_prefix: String,
        file_size: u64,
        total_chunks: usize,
    ) {
        // Flush & close the file before verifying
        {
            let incoming = self.incoming_transfers.lock().await;
            if let Some(entry) = incoming.get(&transfer_id) {
                let mut f = entry.file.lock().await;
                let _ = f.flush().await;
                let _ = f.sync_all().await;
            }
        }

        let verified = match verify_sha256(&temp_path, &expected_hash).await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("SHA-256 verification error: {:?}", e);
                false
            }
        };

        if !verified {
            self.publish_ctrl(
                &topic_prefix,
                &transfer_id,
                ControlMessage {
                    msg_type: "ERROR".to_string(),
                    transfer_id: transfer_id.clone(),
                    chunk_index: None,
                    missing: None,
                    message: Some("SHA-256 integrity check failed on receiver".to_string()),
                },
            )
            .await;
            let _ = tokio::fs::remove_file(&temp_path).await;
            self.incoming_transfers.lock().await.remove(&transfer_id);
            emit_progress(
                &app,
                &transfer_id,
                &topic_prefix,
                &file_name,
                "receive",
                file_size,
                file_size,
                total_chunks,
                total_chunks,
                0.0,
                "failed",
                Some("SHA-256 integrity check failed!".to_string()),
                &expected_hash,
                None,
            );
            return;
        }

        let auto = self.auto_receive.load(Ordering::SeqCst);
        if auto {
            self.deliver_incoming(&app, &transfer_id, &temp_path, &final_path, &topic_prefix, &expected_hash, &file_name, file_size, total_chunks)
                .await;
        } else {
            let mut incoming = self.incoming_transfers.lock().await;
            if let Some(entry) = incoming.get_mut(&transfer_id) {
                entry.verified = true;
                entry.finalize_state = FinalizeState::AwaitingApproval;
            }
            emit_progress(
                &app,
                &transfer_id,
                &topic_prefix,
                &file_name,
                "receive",
                file_size,
                file_size,
                total_chunks,
                total_chunks,
                0.0,
                "awaiting_approval",
                None,
                &expected_hash,
                Some(temp_path.to_string_lossy().to_string()),
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn deliver_incoming(
        &self,
        app: &AppHandle,
        transfer_id: &str,
        temp_path: &Path,
        final_path: &Path,
        topic_prefix: &str,
        expected_hash: &str,
        file_name: &str,
        file_size: u64,
        total_chunks: usize,
    ) {
        // Remove entry first so the File handle is closed before rename
        self.incoming_transfers.lock().await.remove(transfer_id);

        let target = {
            let dir = self.download_dir.read().await.clone();
            let fresh = get_unique_path(&dir, file_name);
            if final_path.exists() { fresh } else { final_path.to_path_buf() }
        };

        match tokio::fs::rename(temp_path, &target).await {
            Ok(_) => {
                self.publish_ctrl(
                    topic_prefix,
                    transfer_id,
                    ControlMessage {
                        msg_type: "COMPLETED".to_string(),
                        transfer_id: transfer_id.to_string(),
                        chunk_index: None,
                        missing: None,
                        message: Some("Verified and saved successfully".to_string()),
                    },
                )
                .await;
                emit_progress(
                    app,
                    transfer_id,
                    topic_prefix,
                    file_name,
                    "receive",
                    file_size,
                    file_size,
                    total_chunks,
                    total_chunks,
                    0.0,
                    "completed",
                    None,
                    expected_hash,
                    Some(target.to_string_lossy().to_string()),
                );
            }
            Err(e) => {
                let _ = tokio::fs::remove_file(temp_path).await;
                self.publish_ctrl(
                    topic_prefix,
                    transfer_id,
                    ControlMessage {
                        msg_type: "ERROR".to_string(),
                        transfer_id: transfer_id.to_string(),
                        chunk_index: None,
                        missing: None,
                        message: Some(format!("Failed to save file: {e}")),
                    },
                )
                .await;
                emit_progress(
                    app,
                    transfer_id,
                    topic_prefix,
                    file_name,
                    "receive",
                    file_size,
                    file_size,
                    total_chunks,
                    total_chunks,
                    0.0,
                    "failed",
                    Some(format!("Failed to save file: {:?}", e)),
                    expected_hash,
                    None,
                );
            }
        }
    }

    pub async fn approve_transfer(&self, app: AppHandle, transfer_id: String) -> Result<(), String> {
        let entry = {
            let mut incoming = self.incoming_transfers.lock().await;
            match incoming.get_mut(&transfer_id) {
                Some(e) if e.finalize_state == FinalizeState::AwaitingApproval && e.verified => {
                    // take the entry out (clone needed parts); File drops here
                    let temp = e.temp_path.clone();
                    let file_name = e.meta.file_name.clone();
                    let prefix = e.topic_prefix.clone();
                    let sha = e.meta.sha256.clone();
                    let size = e.meta.file_size;
                    let chunks = e.meta.total_chunks;
                    incoming.remove(&transfer_id);
                    Some((temp, file_name, prefix, sha, size, chunks))
                }
                _ => None,
            }
        };
        match entry {
            Some((temp_path, file_name, topic_prefix, sha, size, chunks)) => {
                let final_path = {
                    let dir = self.download_dir.read().await.clone();
                    get_unique_path(&dir, &file_name)
                };
                self.deliver_incoming(
                    &app, &transfer_id, &temp_path, &final_path, &topic_prefix, &sha, &file_name,
                    size, chunks,
                )
                .await;
                Ok(())
            }
            None => Err("Transfer is not awaiting approval".to_string()),
        }
    }

    pub async fn reject_transfer(&self, app: AppHandle, transfer_id: String) -> Result<(), String> {
        let entry = {
            let mut incoming = self.incoming_transfers.lock().await;
            if let Some(e) = incoming.get(&transfer_id) {
                let temp = e.temp_path.clone();
                let file_name = e.meta.file_name.clone();
                let prefix = e.topic_prefix.clone();
                let sha = e.meta.sha256.clone();
                incoming.remove(&transfer_id);
                Some((temp, file_name, prefix, sha))
            } else {
                None
            }
        };
        match entry {
            Some((temp_path, file_name, topic_prefix, sha)) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                self.publish_ctrl(
                    &topic_prefix,
                    &transfer_id,
                    ControlMessage {
                        msg_type: "ERROR".to_string(),
                        transfer_id: transfer_id.clone(),
                        chunk_index: None,
                        missing: None,
                        message: Some("Receiver rejected the transfer".to_string()),
                    },
                )
                .await;
                emit_progress(
                    &app,
                    &transfer_id,
                    &topic_prefix,
                    &file_name,
                    "receive",
                    0,
                    0,
                    0,
                    0,
                    0.0,
                    "cancelled",
                    Some("Rejected by receiver".to_string()),
                    &sha,
                    None,
                );
                Ok(())
            }
            None => Err("Unknown transfer".to_string()),
        }
    }

    async fn handle_ctrl(&self, app: &AppHandle, tail: &str, payload: Bytes) {
        let transfer_id = tail.split('/').next().unwrap_or("");
        let ctrl: ControlMessage = match serde_json::from_slice(&payload) {
            Ok(c) => c,
            Err(_) => return,
        };
        if ctrl.transfer_id != transfer_id || transfer_id.is_empty() {
            return;
        }

        enum IncomingAction {
            StateChanged,
            Cancelled {
                temp_path: PathBuf,
                topic_prefix: String,
                file_name: String,
                sha: String,
            },
        }

        // Sender-originated lifecycle controls target an incoming transfer.
        let incoming_action = {
            let mut incoming = self.incoming_transfers.lock().await;
            match incoming.get_mut(&ctrl.transfer_id) {
                Some(entry) => match ctrl.msg_type.as_str() {
                    "PAUSE" => {
                        entry.paused = true;
                        entry.last_update = Instant::now();
                        Some(IncomingAction::StateChanged)
                    }
                    "RESUME" => {
                        entry.paused = false;
                        entry.last_update = Instant::now();
                        Some(IncomingAction::StateChanged)
                    }
                    "CANCEL" => {
                        let action = IncomingAction::Cancelled {
                            temp_path: entry.temp_path.clone(),
                            topic_prefix: entry.topic_prefix.clone(),
                            file_name: entry.meta.file_name.clone(),
                            sha: entry.meta.sha256.clone(),
                        };
                        incoming.remove(&ctrl.transfer_id);
                        Some(action)
                    }
                    _ => None,
                },
                None => None,
            }
        };

        if let Some(action) = incoming_action {
            if let IncomingAction::Cancelled {
                temp_path,
                topic_prefix,
                file_name,
                sha,
            } = action
            {
                let _ = tokio::fs::remove_file(&temp_path).await;
                emit_progress(
                    app,
                    transfer_id,
                    &topic_prefix,
                    &file_name,
                    "receive",
                    0,
                    0,
                    0,
                    0,
                    0.0,
                    "cancelled",
                    Some("Cancelled by sender".to_string()),
                    &sha,
                    None,
                );
            }
            return;
        }

        let active = {
            let outgoing = self.outgoing_transfers.lock().await;
            outgoing.get(&ctrl.transfer_id).cloned()
        };
        let active = match active {
            Some(a) => a,
            None => return, // receipt for another sender
        };

        match ctrl.msg_type.as_str() {
            "COMPLETED" => {
                let ctx = active.ctx.clone();
                self.outgoing_transfers.lock().await.remove(&ctx.transfer_id);
                emit_progress(
                    app,
                    &ctx.transfer_id,
                    &ctx.topic_prefix,
                    &ctx.file_name,
                    "send",
                    ctx.file_size,
                    ctx.file_size,
                    ctx.total_chunks,
                    ctx.total_chunks,
                    0.0,
                    "delivered",
                    None,
                    &ctx.sha256,
                    Some(ctx.path.to_string_lossy().to_string()),
                );
            }
            "ERROR" => {
                let ctx = active.ctx.clone();
                self.outgoing_transfers.lock().await.remove(&ctx.transfer_id);
                emit_progress(
                    app,
                    &ctx.transfer_id,
                    &ctx.topic_prefix,
                    &ctx.file_name,
                    "send",
                    0,
                    ctx.file_size,
                    0,
                    ctx.total_chunks,
                    0.0,
                    "failed",
                    ctrl.message.clone().or_else(|| Some("Receiver reported an error".to_string())),
                    &ctx.sha256,
                    Some(ctx.path.to_string_lossy().to_string()),
                );
            }
            "NACK" => {
                let missing: Vec<usize> = ctrl.missing.unwrap_or_default();
                if missing.is_empty() {
                    return;
                }
                let rounds = active.nack_rounds.fetch_add(1, Ordering::SeqCst);
                if rounds >= 8 {
                    return; // give up; receiver-side watchdog will eventually time out
                }
                let ctx = active.ctx.clone();
                let client = match self.client.read().await.clone() {
                    Some(c) => c,
                    None => return,
                };
                let app_resend = app.clone();
                tokio::spawn(async move {
                    resend_chunks(client, app_resend, ctx, missing).await;
                });
            }
            _ => {}
        }
    }

    // ------------------------------------------------------------------
    // Outgoing transfers
    // ------------------------------------------------------------------

    pub async fn send_file(
        self: &Arc<Self>,
        app: AppHandle,
        file_path_str: String,
        chunk_size: usize,
        qos_val: u8,
        custom_publish_topic: Option<String>,
    ) -> Result<String, String> {
        let path = PathBuf::from(&file_path_str);
        if !path.exists() {
            return Err("Selected file does not exist".to_string());
        }

        let file_meta = tokio::fs::metadata(&path)
            .await
            .map_err(|e| format!("Cannot read file metadata: {}", e))?;
        let file_size = file_meta.len();

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown_file")
            .to_string();

        let chunk_size = chunk_size.clamp(16 * 1024, 4 * 1024 * 1024);
        let total_chunks = if file_size == 0 {
            1
        } else {
            file_size.div_ceil(chunk_size as u64) as usize
        };

        let transfer_id = uuid::Uuid::new_v4().to_string();
        let base_topic = self.base_topic.read().await.clone();

        let topic_prefix = match custom_publish_topic {
            Some(ref t) if !t.trim().is_empty() => {
                let mut clean = t.trim().trim_end_matches('/').to_string();
                if clean.ends_with("/meta") {
                    clean = clean.strip_suffix("/meta").unwrap_or(&clean).to_string();
                } else if clean.ends_with("/#") {
                    clean = clean.strip_suffix("/#").unwrap_or(&clean).to_string();
                }
                clean
            }
            _ => {
                let channel = self.current_channel_name().await;
                format!("{}/{}", base_topic, channel)
            }
        };

        let client = self
            .client
            .read()
            .await
            .clone()
            .ok_or_else(|| "MQTT client not connected".to_string())?;

        let client_id = {
            let cfg = self.current_config.read().await;
            cfg.as_ref().map(|c| c.client_id.clone()).unwrap_or_default()
        };

        // 1. Hash phase
        emit_progress(
            &app, &transfer_id, &topic_prefix, &file_name, "send",
            0, file_size, 0, total_chunks, 0.0, "verifying", None, "",
            Some(file_path_str.clone()),
        );

        let mut hasher = Sha256::new();
        let mut f = File::open(&path)
            .await
            .map_err(|e| format!("Failed to open file: {}", e))?;
        let mut buffer = vec![0u8; 256 * 1024];
        loop {
            let n = f
                .read(&mut buffer)
                .await
                .map_err(|e| format!("Failed to read file for hashing: {}", e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        drop(f);
        let sha256_hash = hex::encode(hasher.finalize());

        let meta = TransferMeta {
            transfer_id: transfer_id.clone(),
            sender_id: client_id,
            file_name: file_name.clone(),
            file_size,
            chunk_size,
            total_chunks,
            sha256: sha256_hash.clone(),
            timestamp: chrono::Utc::now().timestamp(),
        };

        let meta_topic = format!("{}/meta", topic_prefix);
        let meta_payload = serde_json::to_vec(&meta).map_err(|e| e.to_string())?;

        client
            .publish(&meta_topic, qos_val, false, Bytes::from(meta_payload), None)
            .await
            .map_err(|e| format!("Failed to publish meta: {}", e))?;

        // 2. Register controls for this transfer
        let cancelled = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        let ctx = Arc::new(SendContext {
            transfer_id: transfer_id.clone(),
            path: path.clone(),
            topic_prefix: topic_prefix.clone(),
            file_name: file_name.clone(),
            file_size,
            chunk_size,
            total_chunks,
            sha256: sha256_hash.clone(),
            qos: qos_val,
        });
        {
            let mut outgoing = self.outgoing_transfers.lock().await;
            outgoing.insert(
                transfer_id.clone(),
                ActiveOutgoing {
                    cancelled: cancelled.clone(),
                    paused: paused.clone(),
                    nack_rounds: Arc::new(AtomicUsize::new(0)),
                    ctx: ctx.clone(),
                },
            );
        }

        // The sender has to listen on the very ctrl topic its peer answers to:
        // NACK is the only trigger for chunk retransmission and COMPLETED is the
        // only proof the receiver actually verified the file. Without this the
        // resilience the protocol defines never engages, and the row sits at
        // "awaiting peer confirmation" forever. Registered rather than ad-hoc so
        // a mid-transfer reconnect replays it.
        let ctrl_filter = format!("{}/ctrl/{}", topic_prefix, transfer_id);
        let _ = self
            .subscribe_topic(
                ctrl_filter.clone(),
                crate::protocol::SubOptions { qos: 1, ..Default::default() },
            )
            .await;

        // Delayed cleanup so late NACKs can still be served
        {
            let this = self.clone();
            let tid = transfer_id.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                {
                    let mut outgoing = this.outgoing_transfers.lock().await;
                    outgoing.remove(&tid);
                }
                let _ = this.unsubscribe_topic(ctrl_filter).await;
            });
        }

        // 3. Chunk streaming task
        let app_handle = app.clone();
        let tid = transfer_id.clone();
        let prefix_for_chunks = topic_prefix.clone();

        tokio::spawn(async move {
            let mut file = match File::open(&path).await {
                Ok(f) => f,
                Err(e) => {
                    emit_progress(
                        &app_handle, &tid, &prefix_for_chunks, &file_name, "send",
                        0, file_size, 0, total_chunks, 0.0, "failed",
                        Some(format!("Failed to open file: {}", e)), &sha256_hash,
                        Some(file_path_str.clone()),
                    );
                    return;
                }
            };

            let mut chunk_buf = vec![0u8; chunk_size];
            let mut bytes_sent: u64 = 0;
            let mut last_emit = Instant::now();
            let mut last_emit_bytes: u64 = 0;

            for chunk_idx in 0..total_chunks {
                if cancelled.load(Ordering::SeqCst) {
                    emit_progress(
                        &app_handle, &tid, &prefix_for_chunks, &file_name, "send",
                        bytes_sent, file_size, chunk_idx, total_chunks, 0.0, "cancelled",
                        Some("Transfer cancelled by sender".to_string()), &sha256_hash,
                        Some(file_path_str.clone()),
                    );
                    return;
                }

                let mut paused_now = false;
                while paused.load(Ordering::SeqCst) {
                    if cancelled.load(Ordering::SeqCst) {
                        emit_progress(
                            &app_handle, &tid, &prefix_for_chunks, &file_name, "send",
                            bytes_sent, file_size, chunk_idx, total_chunks, 0.0, "cancelled",
                            Some("Transfer cancelled by sender".to_string()), &sha256_hash,
                            Some(file_path_str.clone()),
                        );
                        return;
                    }
                    if !paused_now {
                        paused_now = true;
                        emit_progress(
                            &app_handle, &tid, &prefix_for_chunks, &file_name, "send",
                            bytes_sent, file_size, chunk_idx, total_chunks, 0.0, "paused",
                            None, &sha256_hash, Some(file_path_str.clone()),
                        );
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                }

                let to_read =
                    expected_chunk_len(file_size, chunk_size, total_chunks, chunk_idx);

                let read_bytes = if to_read > 0 {
                    match file.read_exact(&mut chunk_buf[..to_read]).await {
                        Ok(_) => to_read,
                        Err(e) => {
                            emit_progress(
                                &app_handle, &tid, &prefix_for_chunks, &file_name, "send",
                                bytes_sent, file_size, chunk_idx, total_chunks, 0.0, "failed",
                                Some(format!("Failed to read chunk {}: {:?}", chunk_idx, e)),
                                &sha256_hash, Some(file_path_str.clone()),
                            );
                            return;
                        }
                    }
                } else {
                    0
                };

                let chunk_topic =
                    format!("{}/chunk/{}/{}", prefix_for_chunks, tid, chunk_idx);
                let payload = Bytes::copy_from_slice(&chunk_buf[..read_bytes]);

                if let Err(e) = client.publish(&chunk_topic, qos_val, false, payload, None).await {
                    // Real failure: propagate to UI instead of silently "completing"
                    emit_progress(
                        &app_handle, &tid, &prefix_for_chunks, &file_name, "send",
                        bytes_sent, file_size, chunk_idx, total_chunks, 0.0, "failed",
                        Some(format!(
                            "Broker rejected chunk {} ({} B): {} — check broker max packet size",
                            chunk_idx, read_bytes, e
                        )),
                        &sha256_hash, Some(file_path_str.clone()),
                    );
                    return;
                }

                bytes_sent += read_bytes as u64;

                let now = Instant::now();
                let is_last = chunk_idx + 1 == total_chunks;
                if is_last || now.duration_since(last_emit) >= PROGRESS_EMIT_INTERVAL {
                    let elapsed = now.duration_since(last_emit).as_secs_f64().max(0.001);
                    let speed = (bytes_sent - last_emit_bytes) as f64 / elapsed;
                    last_emit = now;
                    last_emit_bytes = bytes_sent;
                    emit_progress(
                        &app_handle, &tid, &prefix_for_chunks, &file_name, "send",
                        bytes_sent, file_size, chunk_idx + 1, total_chunks, speed,
                        if is_last { "sent" } else { "transferring" },
                        None, &sha256_hash, Some(file_path_str.clone()),
                    );
                }

                // Pacing to avoid choking the loop buffer on large files
                if chunk_size > 256 * 1024 {
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
            }
        });

        Ok(transfer_id)
    }

    /// Lifecycle controls use the same per-transfer ctrl topic as
    /// NACK/COMPLETED/ERROR, so both peers can react without a second channel.
    pub async fn pause_transfer(&self, transfer_id: &str) {
        let prefix = {
            let outgoing = self.outgoing_transfers.lock().await;
            outgoing.get(transfer_id).map(|trans| {
                trans.paused.store(true, Ordering::SeqCst);
                trans.ctx.topic_prefix.clone()
            })
        };
        if let Some(prefix) = prefix {
            self.publish_ctrl(
                &prefix,
                transfer_id,
                ControlMessage {
                    msg_type: "PAUSE".to_string(),
                    transfer_id: transfer_id.to_string(),
                    chunk_index: None,
                    missing: None,
                    message: None,
                },
            )
            .await;
        }
    }

    pub async fn resume_transfer(&self, transfer_id: &str) {
        let prefix = {
            let outgoing = self.outgoing_transfers.lock().await;
            outgoing.get(transfer_id).map(|trans| {
                trans.paused.store(false, Ordering::SeqCst);
                trans.ctx.topic_prefix.clone()
            })
        };
        if let Some(prefix) = prefix {
            self.publish_ctrl(
                &prefix,
                transfer_id,
                ControlMessage {
                    msg_type: "RESUME".to_string(),
                    transfer_id: transfer_id.to_string(),
                    chunk_index: None,
                    missing: None,
                    message: None,
                },
            )
            .await;
        }
    }

    pub async fn cancel_transfer(&self, transfer_id: &str) {
        let prefix = {
            let outgoing = self.outgoing_transfers.lock().await;
            outgoing.get(transfer_id).map(|trans| {
                trans.cancelled.store(true, Ordering::SeqCst);
                trans.paused.store(false, Ordering::SeqCst);
                trans.ctx.topic_prefix.clone()
            })
        };
        if let Some(prefix) = prefix {
            self.publish_ctrl(
                &prefix,
                transfer_id,
                ControlMessage {
                    msg_type: "CANCEL".to_string(),
                    transfer_id: transfer_id.to_string(),
                    chunk_index: None,
                    missing: None,
                    message: Some("Cancelled by sender".to_string()),
                },
            )
            .await;
        }
    }

    async fn publish_ctrl(&self, topic_prefix: &str, transfer_id: &str, ctrl: ControlMessage) {
        if let Some(client) = self.client.read().await.clone() {
            let topic = format!("{}/ctrl/{}", topic_prefix, transfer_id);
            if let Ok(payload) = serde_json::to_vec(&ctrl) {
                // Control receipts ride QoS 1 regardless of data QoS
                let _ = client.publish(&topic, 1, false, Bytes::from(payload), None).await;
            }
        }
    }

    /// Placeholder channel name for default topics (used when no custom publish topic).
    async fn current_channel_name(&self) -> String {
        let subs = self.subscriptions.lock().await;
        let base = self.base_topic.read().await.clone();
        // derive from the first registered wildcard like base/channel/#
        for topic in subs.keys() {
            if let Some(rest) = topic.strip_prefix(&base) {
                let rest = rest.trim_matches('/').trim_end_matches("/#");
                if !rest.is_empty() && !rest.contains('#') && !rest.contains('/') {
                    return rest.to_string();
                }
            }
        }
        "public-lobby".to_string()
    }

}

// ----------------------------------------------------------------------
// Free functions
// ----------------------------------------------------------------------

fn expected_chunk_len(file_size: u64, chunk_size: usize, total_chunks: usize, idx: usize) -> usize {
    if idx + 1 == total_chunks {
        let consumed = (idx * chunk_size) as u64;
        file_size.saturating_sub(consumed) as usize
    } else {
        chunk_size
    }
}

fn sanitize_file_name(name: &str) -> String {
    // Reduce to a single safe basename: strip every path component (both POSIX
    // and Windows separators), drop filesystem-hostile chars, and refuse the
    // traversal tokens. Callers MUST pass the result to `dir.join`.
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("");
    let cleaned: String = base
        .chars()
        .filter(|c| {
            !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0') && !c.is_control()
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        "received_file".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Validate a peer-supplied transfer id used to build temp file names: only a
/// conservative charset, bounded length. Rejects path separators / traversal.
fn is_safe_transfer_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn get_unique_path(dir: &Path, file_name: &str) -> PathBuf {
    // Defense in depth: always operate on a sanitized basename so the joined
    // result can never escape `dir`, regardless of what a caller passes.
    let file_name = sanitize_file_name(file_name);
    let target = dir.join(&file_name);
    if !target.exists() {
        return target;
    }

    let stem = Path::new(&file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = Path::new(&file_name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();

    let mut counter = 1;
    loop {
        let candidate = dir.join(format!("{}_{}{}", stem, counter, ext));
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

#[allow(clippy::too_many_arguments)]
fn emit_progress(
    app: &AppHandle,
    transfer_id: &str,
    channel: &str,
    file_name: &str,
    direction: &str,
    bytes_transferred: u64,
    total_bytes: u64,
    chunks_transferred: usize,
    total_chunks: usize,
    speed_bps: f64,
    status: &str,
    error_message: Option<String>,
    sha256: &str,
    save_path: Option<String>,
) {
    let _ = app.emit(
        "transfer-progress",
        TransferProgress {
            transfer_id: transfer_id.to_string(),
            channel: channel.to_string(),
            file_name: file_name.to_string(),
            direction: direction.to_string(),
            bytes_transferred,
            total_bytes,
            chunks_transferred,
            total_chunks,
            speed_bps,
            status: status.to_string(),
            error_message,
            sha256: sha256.to_string(),
            save_path,
        },
    );
}

async fn verify_sha256(path: &Path, expected_hex: &str) -> Result<bool, std::io::Error> {
    let mut file = File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];

    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    let calculated = hex::encode(hasher.finalize());
    Ok(calculated.eq_ignore_ascii_case(expected_hex))
}

async fn run_watchdog(
    this: Arc<MqttManager>,
    app: AppHandle,
    transfer_id: String,
) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        let nack_plan: Option<(String, Vec<usize>)> = {
            let mut incoming = this.incoming_transfers.lock().await;
            let entry = match incoming.get_mut(&transfer_id) {
                Some(e) => e,
                None => return,
            };
            if entry.finalize_state != FinalizeState::Streaming {
                return;
            }

            if entry.paused {
                entry.last_update = Instant::now();
                continue;
            }

            let stale_secs = entry.last_update.elapsed().as_secs();
            let complete = entry.received_chunks.len() >= entry.meta.total_chunks;

            if complete {
                if stale_secs > 60 {
                    // stuck despite all-chunks flag (should not happen) — drop it
                    let temp = entry.temp_path.clone();
                    let prefix = entry.topic_prefix.clone();
                    let name = entry.meta.file_name.clone();
                    let sha = entry.meta.sha256.clone();
                    let total = entry.meta.total_chunks;
                    incoming.remove(&transfer_id);
                    let _ = tokio::fs::remove_file(&temp).await;
                    emit_progress(
                        &app, &transfer_id, &prefix, &name, "receive",
                        0, 0, 0, total, 0.0, "failed",
                        Some("Transfer stalled".to_string()), &sha, None,
                    );
                }
                continue;
            }

            if stale_secs < 10 {
                continue;
            }

            if entry.nack_rounds >= 7 {
                let temp = entry.temp_path.clone();
                let prefix = entry.topic_prefix.clone();
                let name = entry.meta.file_name.clone();
                let sha = entry.meta.sha256.clone();
                let size = entry.meta.file_size;
                let total = entry.meta.total_chunks;
                let have = entry.received_chunks.len();
                incoming.remove(&transfer_id);
                let _ = tokio::fs::remove_file(&temp).await;
                emit_progress(
                    &app, &transfer_id, &prefix, &name, "receive",
                    0, size, have, total, 0.0, "failed",
                    Some(format!(
                        "Timed out: {} of {} chunks never arrived",
                        total - have, total
                    )),
                    &sha, None,
                );
                return;
            }

            entry.nack_rounds += 1;
            entry.last_update = Instant::now(); // reset stale timer
            let missing: Vec<usize> = (0..entry.meta.total_chunks)
                .filter(|i| !entry.received_chunks.contains(i))
                .take(1024)
                .collect();
            Some((entry.topic_prefix.clone(), missing))
        };

        if let Some((prefix, missing)) = nack_plan {
            let ctrl = ControlMessage {
                msg_type: "NACK".to_string(),
                transfer_id: transfer_id.clone(),
                chunk_index: None,
                missing: Some(missing),
                message: None,
            };
            this.publish_ctrl(&prefix, &transfer_id, ctrl).await;
        }
    }
}

async fn resend_chunks(
    client: MqttClient,
    _app: AppHandle,
    ctx: Arc<SendContext>,
    missing: Vec<usize>,
) {
    let mut file = match File::open(&ctx.path).await {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Resend failed, cannot open {:?}: {:?}", ctx.path, e);
            return;
        }
    };

    for idx in missing {
        if idx >= ctx.total_chunks {
            continue;
        }
        let len = expected_chunk_len(ctx.file_size, ctx.chunk_size, ctx.total_chunks, idx);
        let mut buf = vec![0u8; len];
        let offset = (idx * ctx.chunk_size) as u64;
        if file.seek(SeekFrom::Start(offset)).await.is_err() {
            continue;
        }
        if file.read_exact(&mut buf).await.is_err() {
            continue;
        }
        let topic = format!("{}/chunk/{}/{}", ctx.topic_prefix, ctx.transfer_id, idx);
        let _ = client.publish(&topic, ctx.qos, false, Bytes::from(buf), None).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn topic_traffic_counts_and_ranks_by_rate() {
        let mgr = MqttManager::new();
        mgr.record_topic("hot/topic", 10).await;
        mgr.record_topic("hot/topic", 20).await;
        mgr.record_topic("cold/topic", 5).await;

        let rows = mgr.get_topic_stats().await;
        assert_eq!(rows.len(), 2);
        // Sorted by rate desc, then count desc — hot topic first with 2 msgs / 30 B
        assert_eq!(rows[0].topic, "hot/topic");
        assert_eq!(rows[0].count, 2);
        assert_eq!(rows[0].bytes, 30);

        mgr.reset_topic_stats().await;
        assert!(mgr.get_topic_stats().await.is_empty());
    }

    #[tokio::test]
    async fn topic_stats_cap_evicts_least_recent_when_full() {
        let mgr = MqttManager::new();
        mgr.set_topic_stats_cap(100); // clamped min
        assert_eq!(mgr.get_topic_stats_cap(), 100);

        // t_old is strictly older than the rest
        mgr.record_topic("t_old", 1).await;
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        for i in 0..100 {
            mgr.record_topic(&format!("t_{}", i), 1).await;
        }
        // Cap full: admitting a new topic batch-evicts the oldest 10%
        mgr.record_topic("t_new", 1).await;
        let rows = mgr.get_topic_stats().await;
        assert!(rows.len() <= 100, "cap respected, got {}", rows.len());
        assert!(
            !rows.iter().any(|r| r.topic == "t_old"),
            "least recently active topic evicted"
        );
        assert!(rows.iter().any(|r| r.topic == "t_new"), "new topic admitted");
    }

    #[tokio::test]
    async fn topic_traffic_rolls_second_window_and_tracks_peak() {
        let mgr = MqttManager::new();
        for _ in 0..3 {
            mgr.record_topic("burst", 1).await;
        }
        // Same-second bucket not closed yet: rate reads 0
        assert_eq!(mgr.get_topic_stats().await[0].rate, 0);

        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        mgr.record_topic("burst", 1).await; // forces the roll

        let row = &mgr.get_topic_stats().await[0];
        assert_eq!(row.rate, 3, "previous second had 3 msgs");
        assert_eq!(row.peak_rate, 3);
        assert_eq!(row.count, 4);
    }

    #[test]
    fn sanitize_strips_traversal_and_absolute() {
        assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("/absolute/name.txt"), "name.txt");
        assert_eq!(sanitize_file_name("..\\windows\\evil.exe"), "evil.exe");
        assert_eq!(sanitize_file_name(".."), "received_file");
        assert_eq!(sanitize_file_name(""), "received_file");
        assert_eq!(sanitize_file_name("ok file.log"), "ok file.log");
    }

    #[test]
    fn get_unique_path_stays_inside_dir() {
        let dir = std::path::Path::new("/tmp/dropqtt_test_dir");
        for evil in ["/etc/passwd", "../../.ssh/authorized_keys", "..\\evil"] {
            let p = get_unique_path(dir, evil);
            assert!(p.starts_with(dir), "{} escaped dir: {:?}", evil, p);
            assert_eq!(p.parent(), Some(dir));
        }
    }

    #[test]
    fn transfer_id_charset_enforced() {
        assert!(is_safe_transfer_id("abc-123_XY"));
        assert!(!is_safe_transfer_id("../../x"));
        assert!(!is_safe_transfer_id("a/b"));
        assert!(!is_safe_transfer_id("a\\b"));
        assert!(!is_safe_transfer_id(""));
        assert!(!is_safe_transfer_id(&"x".repeat(200)));
    }

}
