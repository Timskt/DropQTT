use std::collections::{HashMap, HashSet};
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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

/// One terminal transition of a request/response call. Pending is not emitted:
/// the caller already holds the call it just created.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcEvent {
    pub kind: &'static str,
    pub call: crate::rpc::RpcCall,
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

/// A publish the broker refused (or dropped with "no matching subscribers"),
/// reported with the reason byte it sent. Carries no topic or payload: those are
/// the user's own, and the reason is what identifies the problem.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishRejection {
    pub code: u8,
    pub meaning: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_string: Option<String>,
}

/// Machine-readable form of a broker ack refusal, for the ops panel.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AckRejectedEvent {
    pub stage: String,
    pub code: u8,
    pub meaning: String,
}

/// The broker granted a subscription at a lower QoS than we asked for. That is
/// legal (MQTT 5 §3.2.2.2.0) and silently changes delivery semantics, so it is
/// reported rather than smoothed over.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QosDowngrade {
    pub filter: String,
    pub asked: u8,
    pub granted: u8,
}

pub struct MqttManager {
    client: RwLock<Option<MqttClient>>,
    loop_control: Mutex<Option<(JoinHandle<()>, Arc<AtomicBool>)>>,
    current_config: RwLock<Option<BrokerConfig>>,
    /// Topic filter -> QoS. Everything we want subscribed; re-applied on every CONNACK.
    subscriptions: Mutex<HashMap<String, crate::protocol::SubOptions>>,
    /// Topic filter -> number of matched inbound publishes (resettable stats)
    subscription_hits: Mutex<HashMap<String, u64>>,
    /// SUBACK/UNSUBACK attribution: which registered filter each reason byte
    /// belonged to, and which of them the broker refused.
    sub_acks: Mutex<crate::acks::AckTracker>,
    /// Actual topic -> live traffic meter (resettable)
    topic_stats: Mutex<HashMap<String, TopicTraffic>>,
    /// Broker `$SYS/*` metrics: topic -> (latest value, last-seen epoch secs)
    sys_metrics: Mutex<HashMap<String, (String, u64)>>,
    /// Silence watchdog: alerts when a topic filter stops carrying traffic
    pub silence_watchdog: Arc<SilenceWatchdog>,
    /// Message assertions: rules that judge inbound rows as they are routed
    pub assertions: Arc<crate::assertions::AssertionEngine>,
    /// Fault injection: loss, latency, duplicates and damage on demand, so the
    /// app's own failure paths can be tested rather than trusted
    pub faults: Arc<crate::faults::FaultInjector>,
    /// Scripted responder: replies a simulated device should make to inbound traffic
    pub responder: Arc<crate::responder::ResponderEngine>,
    /// Registry of backend-scheduled publishes for this session
    pub scheduler: Arc<SchedulerManager>,
    /// Registry of built-in publish stress runs (latency + ack accounting)
    pub bench: Arc<BenchManager>,
    /// MQTT5 request/response calls for this session
    rpc: Mutex<crate::rpc::RpcRegistry>,
    /// Refcounted interest in the response topics those calls declared
    rpc_watch: Mutex<crate::rpc::ResponseWatch>,
    /// Optional persistent history store (attached at app setup)
    history: RwLock<Option<Arc<crate::history::HistoryStore>>>,
    /// Runtime-configurable tracking cap (LRU eviction when full)
    topic_stats_cap: std::sync::atomic::AtomicUsize,
    base_topic: RwLock<String>,
    download_dir: RwLock<PathBuf>,
    auto_receive: AtomicBool,
    /// The app's own timings: flush cost, flush lateness, history write cost.
    self_timing: Mutex<crate::diagnostics::SelfTiming>,
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
    /// Sends whose peer never confirmed, cumulative for this session
    confirm_timeouts: std::sync::atomic::AtomicU64,
    /// Publishes refused outright by the broker (PUBACK/PUBREC/PUBCOMP >= 0x80)
    publish_rejected: std::sync::atomic::AtomicU64,
    /// Publishes the broker delivered to us since the process started.
    ///
    /// Deliberately never reset, unlike the per-topic counters: the metrics endpoint
    /// exports this as a Prometheus counter, and `rate()` over a series that someone
    /// can zero from the UI is not a rate but a wrong answer.
    received_total: std::sync::atomic::AtomicU64,
    /// Publishes we handed to the client since the process started, same rule.
    /// An `Arc` because the resend path runs in its own task, outside any `&self`.
    sent_total: Arc<std::sync::atomic::AtomicU64>,
    /// Everything the latest CONNACK announced. Sending outside it is a protocol
    /// violation the broker answers by dropping the session, so the forms and the
    /// publish path both consult this.
    broker_caps: RwLock<crate::transport::ConnCapabilities>,
    /// Subscription identifiers handed to the broker, both directions.
    sub_ids: Mutex<SubIds>,
}

/// MQTT 5 lets a client attach an integer to a subscription (Subscription
/// Identifier, §3.8.13) and the broker echoes it on every delivery that matched
/// (§3.3.2.3.1). That turns "which of my filters got this" from a local rescan of
/// every subscription into a lookup — and, more importantly, makes the answer the
/// broker's instead of our guess about its matching rules.
#[derive(Default)]
struct SubIds {
    next: u32,
    by_id: HashMap<u32, String>,
    id_of: HashMap<String, u32>,
}

/// Largest value the wire can carry: a four-byte variable integer.
const MAX_SUBSCRIPTION_ID: u32 = 268_435_455;

impl SubIds {
    /// The id to attach for this filter, allocating one on first use. A filter
    /// keeps its id across reconnects, so the CONNACK replay does not hand the
    /// broker a new label for the same subscription.
    fn assign(&mut self, filter: &str) -> Option<u32> {
        if let Some(id) = self.id_of.get(filter) {
            return Some(*id);
        }
        if self.next >= MAX_SUBSCRIPTION_ID {
            return None;
        }
        self.next += 1;
        self.id_of.insert(filter.to_string(), self.next);
        self.by_id.insert(self.next, filter.to_string());
        Some(self.next)
    }

    fn forget(&mut self, filter: &str) {
        if let Some(id) = self.id_of.remove(filter) {
            self.by_id.remove(&id);
        }
    }
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
            sub_acks: Mutex::new(crate::acks::AckTracker::default()),
            topic_stats: Mutex::new(HashMap::new()),
            sys_metrics: Mutex::new(HashMap::new()),
            silence_watchdog: Arc::new(SilenceWatchdog::default()),
            assertions: Arc::new(crate::assertions::AssertionEngine::default()),
            faults: Arc::new(crate::faults::FaultInjector::default()),
            responder: Arc::new(crate::responder::ResponderEngine::default()),
            scheduler: Arc::new(SchedulerManager::new()),
            bench: Arc::new(crate::bench::BenchManager::new()),
            rpc: Mutex::new(crate::rpc::RpcRegistry::default()),
            rpc_watch: Mutex::new(crate::rpc::ResponseWatch::default()),
            history: RwLock::new(None),
            topic_stats_cap: std::sync::atomic::AtomicUsize::new(DEFAULT_TOPIC_STATS_CAP),
            base_topic: RwLock::new("dropqtt".to_string()),
            download_dir: RwLock::new(def_download),
            auto_receive: AtomicBool::new(true),
            self_timing: Mutex::new(crate::diagnostics::SelfTiming::default()),
            feed_buffer: Arc::new(Mutex::new(std::collections::VecDeque::new())),
            feed_dropped: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            feed_archive_only: Arc::new(Mutex::new(Vec::new())),
            feed_lost: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            incoming_transfers: Mutex::new(HashMap::new()),
            outgoing_transfers: Mutex::new(HashMap::new()),
            is_connected: AtomicBool::new(false),
            broker_caps: RwLock::new(crate::transport::ConnCapabilities::default()),
            sub_ids: Mutex::new(SubIds::default()),
            confirm_timeouts: std::sync::atomic::AtomicU64::new(0),
            publish_rejected: std::sync::atomic::AtomicU64::new(0),
            received_total: std::sync::atomic::AtomicU64::new(0),
            sent_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }

    /// Record that a publish was accepted by the client.
    ///
    /// Every send path calls this rather than touching the field, so "what we sent"
    /// cannot come to mean different things depending on which button was pressed.
    fn note_sent(&self) {
        self.sent_total.fetch_add(1, Ordering::SeqCst);
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

        let rpc_stats = {
            let reg = self.rpc.lock().await;
            (reg.pending(), reg.timeouts())
        };
        let faults = self.faults.stats();
        let fault_rules = faults.iter().filter(|f| f.enabled).count();
        let fault_actions: u64 = faults
            .iter()
            .map(|f| {
                let c = f.counts;
                c.dropped + c.delayed + c.duplicated + c.corrupted + c.mis_correlated
            })
            .sum();
        let timings = {
            let t = self.self_timing.lock().await;
            (
                t.flush.snapshot(),
                t.lag.snapshot(),
                t.history.snapshot(),
            )
        };
        let ack_stats = {
            let tracker = self.sub_acks.lock().await;
            let (un_sub, un_unsub) = tracker.unattributed();
            (
                tracker.rejections().len(),
                tracker.unsubscribe_rejections().len(),
                un_sub + un_unsub,
            )
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
            confirm_timeouts: self.confirm_timeouts.load(Ordering::SeqCst),
            rpc_pending: rpc_stats.0,
            rpc_timeouts: rpc_stats.1,
            subscriptions_rejected: ack_stats.0,
            unsubscribes_rejected: ack_stats.1,
            acks_unattributed: ack_stats.2,
            publish_rejected: self.publish_rejected.load(Ordering::SeqCst),
            received_total: self.received_total.load(Ordering::SeqCst),
            sent_total: self.sent_total.load(Ordering::SeqCst),
            topic_stats_count,
            scheduled_runs: self.scheduler.running_count(),
            bench_runs: self.bench.running_count(),
            history_available,
            history,
            download_dir: download_dir.to_string_lossy().to_string(),
            download_dir_writable: false,
            download_dir_error: None,
            feed_flush: timings.0,
            feed_lag: timings.1,
            history_write: timings.2,
            fault_rules,
            fault_actions,
            responder_rules: self.responder.rule_count(),
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
        // A deliberate connect is the user asking again -- after changing a password, an
        // ACL, or a broker -- so the health probe gets one more attempt. An automatic
        // reconnect must not do this, or a refusal loops once per second.
        self.sub_acks.lock().await.lift_quarantine(crate::acks::SYS_PROBE_FILTER);

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
                    NetEvent::Connected(caps) => {
                        let ids_allowed = caps.subscription_ids_available;
                        *this.broker_caps.write().await = caps;
                        // Start every silence timer from now: a gap while we were
                        // disconnected is our own outage, not the device's.
                        this.silence_watchdog
                            .set_connected(true, chrono::Utc::now().timestamp());
                        // (Re)apply every registered subscription after CONNACK,
                        // including automatic reconnects.
                        if let Some(client) = this.client.read().await.clone() {
                            let subs: Vec<(String, crate::protocol::SubOptions)> = {
                                let tracker = this.sub_acks.lock().await;
                                this.subscriptions
                                    .lock()
                                    .await
                                    .iter()
                                    // A quarantined filter is one the broker refused;
                                    // rumqttc treats that as fatal, so replaying it
                                    // would drop the session again on every reconnect.
                                    .filter(|(t, _)| !tracker.is_quarantined(t))
                                    .map(|(t, o)| {
                                        let mut o = *o;
                                        if !ids_allowed {
                                            // An id we asked for against a *different*
                                            // broker must not be replayed here: a server
                                            // that does not support the property answers
                                            // with a refusal, and that refusal is fatal.
                                            o.subscription_id = None;
                                        }
                                        (t.clone(), o)
                                    })
                                    .collect()
                            };
                            // One SUBSCRIBE packet per filter, so each SUBACK's
                            // single reason byte can be attributed by order.
                            {
                                let mut tracker = this.sub_acks.lock().await;
                                tracker.reset_pending();
                                for (topic, _) in &subs {
                                    tracker.expect_sub(topic);
                                }
                                if !tracker.is_quarantined(crate::acks::SYS_PROBE_FILTER) {
                                    tracker.expect_sub(crate::acks::SYS_PROBE_FILTER);
                                }
                            }
                            for (topic, opts) in subs {
                                let _ = client.subscribe(&topic, &opts).await;
                            }
                            // Broker health metrics — subscribed out-of-band so
                            // $SYS never pollutes the console feed or traffic stats.
                            // Quarantined like any refused filter: rumqttc treats the
                            // refusal as fatal, so replaying it drops the session again
                            // on every reconnect and re-toast once per second forever.
                            if !this.sub_acks.lock().await.is_quarantined(crate::acks::SYS_PROBE_FILTER) {
                                let _ = client
                                    .subscribe(
                                        crate::acks::SYS_PROBE_FILTER,
                                        &crate::protocol::SubOptions { qos: 0, ..Default::default() },
                                    )
                                    .await;
                            }
                        }
                        let first = !this.is_connected.swap(true, Ordering::SeqCst);
                        if first {
                            let _ = app_handle.emit("broker-connected", ());
                        }
                        let _ = app_handle.emit("broker-status", this.get_connection_status().await);
                    }
                    NetEvent::ConnectionError(e) => {
                        // Those packet ids are gone with the session.
                        this.sub_acks.lock().await.reset_pending();
                        if this.is_connected.swap(false, Ordering::SeqCst) {
                            let _ = app_handle.emit("broker-status", this.get_connection_status().await);
                        }
                        let _ = app_handle.emit("broker-disconnected", e);
                        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                    }
                    NetEvent::Publish(publish) => {
                        this.route_message(&app_handle, publish).await;
                    }
                    NetEvent::PublishAcked { code, reason_string } => {
                        // Only the bench lab cares, and it compares this against
                        // `sent` to show client-side backpressure — which is only
                        // meaningful if a refused PUBACK is not counted as one.
                        match code {
                            0x00 => this.bench.record_ack(),
                            // The broker accepted the packet and had nowhere to
                            // put it. Not a failure, not a delivery: its own bucket.
                            0x10 => this.bench.record_no_subscribers(),
                            c => {
                                this.publish_rejected.fetch_add(1, Ordering::SeqCst);
                                this.bench.record_nack();
                                let _ = app_handle.emit(
                                    "publish-rejected",
                                    PublishRejection {
                                        code: c,
                                        meaning: crate::acks::describe_pub(c).to_string(),
                                        reason_string,
                                    },
                                );
                            }
                        }
                    }
                    NetEvent::SubAck { codes, reason_string } => {
                        this.apply_sub_ack(&app_handle, &codes, reason_string, true)
                            .await;
                    }
                    NetEvent::UnsubAck { codes, reason_string } => {
                        this.apply_sub_ack(&app_handle, &codes, reason_string, false)
                            .await;
                    }
                    NetEvent::AckRejected { stage, code, text } => {
                        this.handle_ack_rejected(&app_handle, stage, code, &text)
                            .await;
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
        *self.broker_caps.write().await = crate::transport::ConnCapabilities::default();
        // Disarm so the outage we are about to cause is not reported as the
        // device having gone quiet.
        self.silence_watchdog.set_connected(false, 0);
        // Scheduled publishes aim at the session that is ending, so they stop with
        // it instead of erroring against a dropped client. connect() also lands
        // here, which is what makes a broker switch reset the registry.
        self.scheduler.stop_all();
        self.bench.stop_all();
        // No answer can arrive on a link we just closed, so open calls finish as
        // timeouts and their temporary response subscriptions are not replayed
        // onto the next broker.
        let expired: Vec<crate::rpc::RpcCall> = {
            let mut reg = self.rpc.lock().await;
            reg.expire_all()
        };
        for call in expired {
            let dead = self.rpc_watch.lock().await.release(&call.response_topic);
            if let Some(dead) = dead {
                let _ = self.unsubscribe_topic(dead).await;
            }
        }

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
        // In-flight SUBACK/UNSUBACK slots die with this eventloop; leaving them
        // would let a later answer be blamed on a filter we never asked about.
        self.sub_acks.lock().await.reset_pending();
    }

    pub async fn subscribe_topic(&self, topic: String, opts: crate::protocol::SubOptions) -> Result<(), String> {
        if let Some(err) = crate::topic::shared_filter_error(topic.trim()) {
            // Before the general filter check: `$share/a+b/x` is a mistake about
            // the *share name*, and saying so beats reporting a wildcard problem
            // in a filter the user never wrote.
            return Err(err);
        }
        if let Some(err) = crate::topic::filter_topic_error(topic.trim()) {
            return Err(err);
        }
        if let Some(err) = crate::transport::subscribe_capability_error(
            topic.trim(),
            &self.broker_caps.read().await.clone(),
        ) {
            // Better a refusal now than a SUBACK the client library treats as fatal.
            return Err(err);
        }
        if crate::topic::parse_shared(topic.trim()).is_some() && opts.no_local {
            // No-local means "do not send me my own publishes"; a shared group
            // already decides delivery among members. Mosquitto 2.1.0 made this
            // combination a protocol error, so refusing here matches the broker
            // the user will eventually meet instead of a silent SUBACK surprise.
            return Err("a shared subscription cannot also set No Local".to_string());
        }
        let topic = topic.trim().to_string();
        let mut opts = opts;
        if self.broker_caps.read().await.subscription_ids_available {
            // Ask the broker to label its deliveries. If it never answers, the
            // hit accounting falls back to matching locally, so nothing here
            // depends on the broker honouring the request.
            opts.subscription_id = self.sub_ids.lock().await.assign(&topic);
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
            // Only a SUBSCRIBE that reached the wire can be attributed: queueing
            // a slot for a packet that was never sent would mis-pair the next
            // broker's answer onto this filter.
            self.sub_acks.lock().await.expect_sub(&topic);
        }
        Ok(())
    }

    pub async fn unsubscribe_topic(&self, topic: String) -> Result<(), String> {
        let topic = topic.trim().to_string();
        self.subscriptions.lock().await.remove(&topic);
        self.subscription_hits.lock().await.remove(&topic);
        self.sub_ids.lock().await.forget(&topic);
        {
            let mut tracker = self.sub_acks.lock().await;
            // Our own verdict on it is finished business; anything still awaiting
            // a SUBACK for it must not consume the next unrelated answer.
            tracker.forget(&topic);
            if self.client.read().await.is_some() {
                tracker.expect_unsub(&topic);
            }
        }
        if let Some(client) = self.client.read().await.clone() {
            client.unsubscribe(&topic).await;
        }
        Ok(())
    }

    /// Pair SUBACK/UNSUBACK reason bytes with the filters they answered, then
    /// make the result visible: a refusal is emitted as an event, and a granted
    /// QoS lower than requested is recorded as a downgrade.
    ///
    /// `is_sub` selects the queue; the two ack kinds share the shape but not the
    /// FIFO, so a burst of unsubs cannot corrupt subscription attribution.
    async fn apply_sub_ack(
        &self,
        app: &AppHandle,
        codes: &[u8],
        reason_string: Option<String>,
        is_sub: bool,
    ) {
        if codes.is_empty() {
            return;
        }
        let now_ms = chrono::Utc::now().timestamp_millis();
        // The asked-for QoS comes from the registry, not from the SUBACK.
        let registered: HashMap<String, crate::protocol::SubOptions> =
            self.subscriptions.lock().await.clone();
        let outcomes = {
            let mut tracker = self.sub_acks.lock().await;
            let outcomes = if is_sub {
                tracker.apply_sub(codes, reason_string, now_ms)
            } else {
                tracker.apply_unsub(codes, reason_string, now_ms)
            };
            for outcome in &outcomes {
                if let crate::acks::Outcome::Granted { filter, granted_qos } = outcome {
                    if let (Some(granted), Some(asked)) = (*granted_qos, registered.get(filter)) {
                        tracker.note_granted_qos(filter, asked.qos, granted);
                    }
                }
            }
            outcomes
        };
        for outcome in outcomes {
            match outcome {
                crate::acks::Outcome::Rejected(r) => {
                    // The chip goes red and the reason is named; the counter and
                    // the list are additionally visible in the ops panel.
                    self.sub_acks.lock().await.quarantine(&r);
                    let _ = app.emit(
                        if is_sub {
                            "subscription-rejected"
                        } else {
                            "unsubscribe-rejected"
                        },
                        &r,
                    );
                }
                crate::acks::Outcome::Granted { filter, granted_qos } => {
                    let asked = registered.get(&filter).map(|o| o.qos);
                    if let (Some(asked), Some(granted)) = (asked, granted_qos) {
                        if granted < asked {
                            let _ = app.emit(
                                "subscription-downgraded",
                                &QosDowngrade {
                                    filter,
                                    asked,
                                    granted,
                                },
                            );
                        }
                    }
                }
                // Counted by the tracker and reported through diagnostics; there
                // is no filter to blame and no user action to name.
                crate::acks::Outcome::Unattributed { .. } => {}
            }
        }
    }

    /// Turn a broker ack refusal into a report. The session has already been
    /// dropped by rumqttc at this point, so this is also the only place the user
    /// learns *why* the connection went away.
    async fn handle_ack_rejected(
        &self,
        app: &AppHandle,
        stage: crate::transport::AckStage,
        code: u8,
        text: &str,
    ) {
        use crate::transport::AckStage as A;
        let now_ms = chrono::Utc::now().timestamp_millis();
        let meaning = match stage {
            A::Subscribe | A::Unsubscribe => crate::acks::describe_sub(code),
            _ => crate::acks::describe_pub(code),
        };
        match stage {
            A::Subscribe => {
                let rejection = self
                    .sub_acks
                    .lock()
                    .await
                    .refuse_oldest_pending_sub(code, text, now_ms);
                if let Some(r) = rejection {
                    let _ = app.emit("subscription-rejected", &r);
                }
            }
            A::Unsubscribe => {
                let rejection = self
                    .sub_acks
                    .lock()
                    .await
                    .refuse_oldest_pending_unsub(code, text, now_ms);
                if let Some(r) = rejection {
                    let _ = app.emit("unsubscribe-rejected", &r);
                }
            }
            A::PublishAck | A::PublishReceive | A::PublishComplete | A::PublishRelease => {
                self.publish_rejected.fetch_add(1, Ordering::SeqCst);
                self.bench.record_nack();
                let _ = app.emit(
                    "publish-rejected",
                    PublishRejection {
                        code,
                        meaning: meaning.to_string(),
                        reason_string: Some(text.to_string()),
                    },
                );
            }
            A::Connect | A::ServerDisconnect => {}
        }
        // The link really did go down; say so in terms the UI can render instead of
        // leaking `MqttState(SubFail { .. })` into a banner.
        if self.is_connected.swap(false, Ordering::SeqCst) {
            let _ = app.emit("broker-status", self.get_connection_status().await);
        }
        let _ = app.emit(
            "broker-disconnected",
            format!("{:?} refused by the broker: {} (0x{:02X})", stage, meaning, code),
        );
        let _ = app.emit(
            "ack-rejected",
            AckRejectedEvent {
                stage: format!("{:?}", stage),
                code,
                meaning: meaning.to_string(),
            },
        );
    }

    /// What the connected broker announced about itself (v5 CONNACK properties).
    pub async fn broker_capabilities(&self) -> crate::transport::ConnCapabilities {
        self.broker_caps.read().await.clone()
    }

    /// Filters the broker currently refuses, for the UI and the ops panel.
    pub async fn get_rejected_subscriptions(&self) -> Vec<crate::acks::Rejection> {
        self.sub_acks.lock().await.rejections()
    }

    /// All ack verdicts the console shows: refused subscriptions, refused
    /// unsubscribes, and subscriptions the broker capped at a lower QoS.
    pub async fn sub_ack_state(&self) -> crate::acks::AckState {
        self.sub_acks.lock().await.state()
    }

    /// `(unattributed SUBACK, unattributed UNSUBACK)` reason bytes.
    pub async fn unattributed_acks(&self) -> (u64, u64) {
        self.sub_acks.lock().await.unattributed()
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

    /// One token's life across everything the store recorded, oldest first.
    pub async fn trace_history(
        &self,
        token: &str,
        limit: i64,
        since_ms: i64,
        until_ms: i64,
    ) -> Result<crate::history::TraceResult, String> {
        let store = self
            .history
            .read()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| "message history is not available".to_string())?;
        store.trace(token, limit, since_ms, until_ms)
    }

    /// Segments per topic prefix, for the timeline view. Same blocking-read shape
    /// as every other history query, and the same reason (see §1.7 of the audit).
    pub async fn history_timeline(
        &self,
        search: &str,
        since_ms: i64,
        until_ms: i64,
        depth: i64,
        gap_ms: i64,
        max_entities: i64,
    ) -> Result<crate::history::TimelineResult, String> {
        let store = self
            .history
            .read()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| "message history is not available".to_string())?;
        store.timeline(search, since_ms, until_ms, depth, gap_ms, max_entities)
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

    /// Per-topic totals over the same window the list uses.
    pub async fn history_topics(
        &self,
        search: &str,
        direction: &str,
        since_ms: i64,
        until_ms: i64,
        limit: i64,
    ) -> Result<Vec<crate::history::HistoryTopicRow>, String> {
        let store = self
            .history
            .read()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| "message history is not available".to_string())?;
        store.topics(search, direction, since_ms, until_ms, limit)
    }

    /// Age policy for the store, in days (0 = only the row cap trims).
    pub async fn set_history_retention(&self, days: i64) -> Result<(), String> {
        let store = self
            .history
            .read()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| "message history is not available".to_string())?;
        store.set_retention_days(days)
    }

    pub async fn history_stats(&self) -> crate::history::HistoryStats {
        self.history
            .read()
            .await
            .as_ref()
            .map(|h| h.stats())
            // An empty default, not a zeroed copy of the fields: a new counter
            // added to the stats must not have to be repeated here.
            .unwrap_or_default()
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
        let tick = Instant::now();
        {
            let mut t = self.self_timing.lock().await;
            t.note_flush_start(tick, std::time::Duration::from_millis(FEED_FLUSH_MILLIS));
        }
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
        // Mirror to SQLite before the batch reaches the UI. This stays on the
        // current thread on purpose: measured A/B (bench lab, 6.10) showed the
        // send loop caps at ~90-200 msg/s with *no* inbound traffic at all, so
        // archiving is not the limiter, and moving it to the blocking pool bought
        // nothing while costing a batch clone per tick. A transaction here is
        // sub-millisecond at our batch sizes; if it ever becomes visible, the
        // fix is fewer/larger writes, not a thread hop.
        if let Some(h) = self.history.read().await.as_ref() {
            let wrote = !archive.is_empty() || !batch.is_empty();
            let wrote_started = Instant::now();
            if !archive.is_empty() {
                h.append(&archive);
            }
            if !batch.is_empty() {
                h.append(&batch);
            }
            if wrote {
                self.self_timing.lock().await.note_history(wrote_started);
            }
        }
        if batch.is_empty() {
            self.self_timing.lock().await.note_flush_end(tick);
            return;
        }
        let dropped = self.feed_dropped.load(Ordering::SeqCst);
        let _ = app.emit(
            "mqtt-messages",
            FeedBatch { messages: batch, dropped },
        );
        // Timed last on purpose: this is the cost the UI thread pays per tick,
        // serialization and emit included, which is what a rising number points at.
        self.self_timing.lock().await.note_flush_end(tick);
    }

    pub async fn get_subscription_stats(&self) -> HashMap<String, u64> {
        self.subscription_hits.lock().await.clone()
    }

    /// Which filters we asked the broker to label, and with what. An absent filter
    /// means its hit count came from our own topic matching rather than its word.
    pub async fn get_subscription_ids(&self) -> HashMap<String, u32> {
        self.sub_ids.lock().await.id_of.clone()
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
        let mut window = tokio::time::interval(bench::PACING_WINDOW);
        window.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut ticker = tokio::time::interval(std::time::Duration::from_millis(500));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let limit =
            (spec.duration_sec > 0).then(|| std::time::Duration::from_secs(spec.duration_sec as u64));
        let started = Instant::now();
        let mut seq: u32 = 0;
        loop {
            tokio::select! {
                _ = window.tick() => {
                    if cancel.load(Ordering::SeqCst) {
                        return;
                    }
                    let elapsed = started.elapsed();
                    if let Some(limit) = limit {
                        if elapsed >= limit {
                            self.bench.finish(&spec.id, BenchStatus::Finished, None);
                            self.emit_bench_progress(&app).await;
                            return;
                        }
                    }
                    let target = bench::paced_target(elapsed, spec.rate, seq as u64);
                    while (seq as u64) < target {
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
                        self.note_sent();
                        seq = seq.wrapping_add(1);
                        self.bench.record_sent(&spec.id);
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
        if let Some(err) = crate::topic::publish_topic_error(params.topic.trim()) {
            return Err(err);
        }
        let client = self
            .client
            .read()
            .await
            .clone()
            .ok_or_else(|| "MQTT client not connected".to_string())?;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(params.payload_base64.as_bytes())
            .map_err(|e| format!("Invalid base64 payload: {}", e))?;
        let mut payload: Bytes = Bytes::from(decoded);
        // Judged before the broker-limit checks and before the feed echo, so what
        // the console shows as sent is what actually went out — damaged or not.
        let fault = self.faults.apply_outbound(&params.topic, &mut payload);
        if fault.drop {
            return Err("publish dropped by fault injection".to_string());
        }
        if fault.delay_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(fault.delay_ms)).await;
        }
        let payload_len = payload.len();
        // Check the broker's advertised limits first: rumqttc treats an oversized
        // alias as a protocol violation and drops the whole connection for it.
        let caps = self.broker_caps.read().await.clone();
        if let Some(err) = crate::transport::alias_rejection(params.properties.topic_alias, caps.topic_alias_max) {
            return Err(err);
        }
        // Same reasoning as the alias gate: rumqttc does not negotiate these down,
        // it sends what it is told and the broker decides how unkind to be.
        if let Some(err) = crate::transport::qos_rejection(params.qos, caps.max_qos) {
            return Err(err);
        }
        if let Some(err) = crate::transport::retain_rejection(params.retain, caps.retain_available) {
            return Err(err);
        }
        if let Some(err) = crate::transport::packet_size_rejection(
            payload_len,
            params.topic.len(),
            caps.max_packet_size,
        ) {
            return Err(err);
        }

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
            .publish(&params.topic, params.qos, params.retain, payload.clone(), props.as_ref())
            .await
            .map_err(|e| format!("Failed to publish: {}", e))?;
        self.note_sent();
        if fault.duplicate {
            // From the wire's point of view a re-delivery and a second send are the
            // same event, so this is the honest way to inject one.
            if client
                .publish(&params.topic, params.qos, params.retain, payload.clone(), props.as_ref())
                .await
                .is_ok()
            {
                self.note_sent();
            }
        }

        // Echoed from the bytes that were actually sent: an injected corruption has
        // to show up in the console row too, or the app would be reporting a
        // publish it did not perform.
        let display_text = String::from_utf8_lossy(&payload).to_string();

        let msg = MqttGenericMessage {
            id: uuid::Uuid::new_v4().to_string(),
            topic: params.topic.clone(),
            payload: display_text,
            payload_len,
            payload_base64: base64::engine::general_purpose::STANDARD.encode(&payload),
            truncated: false,
            content_type: params.properties.content_type.clone(),
            user_properties: params.properties.user_properties.clone(),
            response_topic: params.properties.response_topic.clone(),
            correlation_data: params.properties.correlation_data.clone(),
            correlation_hex: params
                .properties
                .correlation_data
                .as_deref()
                .map(|s| hex::encode(s.as_bytes())),
            payload_format: params.properties.payload_format,
            // Our own publish: no subscription of ours matched it, and the broker
            // attaches identifiers only to deliveries.
            matched_filters: Vec::new(),
            subscription_ids: Vec::new(),
            qos: params.qos,
            retain: params.retain,
            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
            direction: "out".to_string(),
            assertion: None,
        };
        self.push_feed(msg).await;

        Ok(())
    }

    /// Send one responder reply and echo it into the feed as an outbound row, so a
    /// simulated device shows up exactly where a real peer's traffic would. Broker
    /// limits are checked here too: a reply the broker would refuse is our bug, and
    /// it has to arrive as an error the rule can be seen carrying.
    async fn publish_as_device(&self, reply: &crate::responder::PendingReply) -> Result<(), String> {
        if let Some(err) = crate::topic::publish_topic_error(&reply.topic) {
            return Err(err);
        }
        let client = self
            .client
            .read()
            .await
            .clone()
            .ok_or_else(|| "MQTT client not connected".to_string())?;
        let caps = self.broker_caps.read().await.clone();
        if let Some(err) = crate::transport::qos_rejection(reply.qos, caps.max_qos) {
            return Err(err);
        }
        if let Some(err) = crate::transport::retain_rejection(reply.retain, caps.retain_available) {
            return Err(err);
        }
        let bytes = Bytes::from(reply.payload.clone());
        let payload_len = bytes.len();
        if let Some(err) = crate::transport::packet_size_rejection(
            payload_len,
            reply.topic.len(),
            caps.max_packet_size,
        ) {
            return Err(err);
        }
        client
            .publish(&reply.topic, reply.qos, reply.retain, bytes.clone(), None)
            .await
            .map_err(|e| format!("responder publish failed: {e}"))?;
        self.note_sent();
        let msg = MqttGenericMessage {
            id: uuid::Uuid::new_v4().to_string(),
            topic: reply.topic.clone(),
            payload: reply.payload.clone(),
            payload_len,
            payload_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
            truncated: false,
            content_type: None,
            user_properties: Vec::new(),
            response_topic: None,
            correlation_data: None,
            correlation_hex: None,
            payload_format: None,
            matched_filters: Vec::new(),
            subscription_ids: Vec::new(),
            qos: reply.qos,
            retain: reply.retain,
            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
            direction: "out".to_string(),
            assertion: None,
        };
        self.push_feed(msg).await;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Request / response (MQTT5)
    // ------------------------------------------------------------------

    /// Publish a request, open its response topic, and pair the answer by
    /// correlation data. Returns the call as recorded so the UI can show which
    /// response topic it settled on even when the user left that field blank.
    pub async fn rpc_request(
        self: &Arc<Self>,
        app: AppHandle,
        spec: crate::rpc::RpcSpec,
    ) -> Result<crate::rpc::RpcCall, String> {
        if spec.topic.trim().is_empty() {
            return Err("Request topic must not be empty".to_string());
        }
        let timeout_ms = crate::rpc::clamp_timeout(spec.timeout_ms);
        let attempts_total = crate::rpc::clamp_attempts(spec.attempts.unwrap_or(0));
        let expected = crate::rpc::clamp_collect(spec.collect.unwrap_or(0));
        let base_topic = self.base_topic.read().await.clone();
        let id = uuid::Uuid::new_v4().to_string();
        let correlation = spec
            .correlation_data
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| id.clone());
        let response_topic = spec
            .response_topic
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("{base_topic}/rpc/{}", &id[..8]));

        // Subscribe before publishing: a peer that answers in microseconds must
        // not be able to reply into a topic we have not opened yet.
        let already_ours = self.subscriptions.lock().await.contains_key(&response_topic);
        self.subscribe_topic(
            response_topic.clone(),
            crate::protocol::SubOptions {
                qos: spec.qos.max(1),
                ..Default::default()
            },
        )
        .await?;
        self.rpc_watch.lock().await.acquire(&response_topic, already_ours);

        let params = ConsolePublishParams {
            topic: spec.topic.clone(),
            payload_base64: spec.payload_base64.clone(),
            qos: spec.qos,
            retain: spec.retain,
            properties: PubProperties {
                content_type: spec.content_type.clone(),
                user_properties: spec.user_properties.clone(),
                message_expiry: spec.message_expiry,
                response_topic: Some(response_topic.clone()),
                correlation_data: Some(correlation.clone()),
                correlation_hex: None,
                payload_format: spec.payload_format,
                topic_alias: spec.topic_alias,
            },
        };
        let sent_at_ms = chrono::Utc::now().timestamp_millis();
        // A retry sends these same bytes again, with the same correlation.
        let retry_params = params.clone();
        if let Err(e) = self.publish_console(app.clone(), params).await {
            // The request never went out, so the topic we opened is ours to close.
            let dead = self.rpc_watch.lock().await.release(&response_topic);
            if let Some(dead) = dead {
                let _ = self.unsubscribe_topic(dead).await;
            }
            return Err(e);
        }

        let call = crate::rpc::RpcCall {
            id,
            request_topic: spec.topic.clone(),
            response_topic: response_topic.clone(),
            correlation,
            sent_at_ms,
            timeout_ms,
            state: crate::rpc::RpcState::Pending,
            rtt_ms: None,
            reply: None,
            paired_by_position: false,
            attempt: 0,
            attempts_total,
            expected,
            replies: Vec::new(),
        };
        self.rpc.lock().await.record(call.clone());

        let manager = self.clone();
        let tid = call.id.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(timeout_ms)).await;
                let retry = {
                    let mut reg = manager.rpc.lock().await;
                    match reg.get(&tid) {
                        // Answered, or cleared from the list, while we slept.
                        Some(c) if c.state != crate::rpc::RpcState::Pending => None,
                        None => None,
                        Some(_) => Some(reg.retry_slot(&tid)),
                    }
                };
                match retry {
                    None => break,
                    Some(false) => {
                        let expired = manager.rpc.lock().await.expire(&tid);
                        if let Some(call) = expired {
                            let dead = manager.rpc_watch.lock().await.release(&call.response_topic);
                            if let Some(dead) = dead {
                                let _ = manager.unsubscribe_topic(dead).await;
                            }
                            let _ = app.emit(
                                "rpc-event",
                                RpcEvent {
                                    kind: "timeout",
                                    call,
                                },
                            );
                        }
                        break;
                    }
                    Some(true) => {
                        // Same correlation on purpose: a device that answers the
                        // first send late still pairs with this call.
                        let current = manager.rpc.lock().await.get(&tid);
                        if let Some(call) = current {
                            let _ = app.emit(
                                "rpc-event",
                                RpcEvent {
                                    kind: "retry",
                                    call: call.clone(),
                                },
                            );
                        }
                        if manager.publish_console(app.clone(), retry_params.clone()).await.is_err() {
                            // The retry could not be sent; that is the last attempt.
                            let expired = manager.rpc.lock().await.expire(&tid);
                            if let Some(call) = expired {
                                let dead =
                                    manager.rpc_watch.lock().await.release(&call.response_topic);
                                if let Some(dead) = dead {
                                    let _ = manager.unsubscribe_topic(dead).await;
                                }
                                let _ = app.emit(
                                    "rpc-event",
                                    RpcEvent {
                                        kind: "timeout",
                                        call,
                                    },
                                );
                            }
                            break;
                        }
                    }
                }
            }
        });

        Ok(call)
    }

    pub async fn rpc_list(&self) -> Vec<crate::rpc::RpcCall> {
        self.rpc.lock().await.snapshot()
    }

    pub async fn rpc_clear_finished(&self) -> usize {
        let dropped: Vec<String> = {
            let reg = self.rpc.lock().await;
            reg.snapshot()
                .iter()
                .filter(|c| c.state != crate::rpc::RpcState::Pending)
                .map(|c| c.response_topic.clone())
                .collect()
        };
        let n = self.rpc.lock().await.clear_finished();
        // Rows cleared from the list are calls that already finished; make sure
        // no watch is left holding a subscription they were the last user of.
        for topic in dropped {
            let dead = self.rpc_watch.lock().await.release(&topic);
            if let Some(dead) = dead {
                let _ = self.unsubscribe_topic(dead).await;
            }
        }
        n
    }

    /// Try to pair an inbound message with an open request.
    #[allow(clippy::too_many_arguments)]
    async fn rpc_observe(
        &self,
        app: &AppHandle,
        topic: &str,
        correlation: Option<&[u8]>,
        payload: &[u8],
        qos: u8,
        retain: bool,
        content_type: Option<&str>,
    ) {
        if self.rpc.lock().await.pending() == 0 {
            return;
        }
        let now_ms = chrono::Utc::now().timestamp_millis();
        let reply = crate::rpc::RpcReply {
            topic: topic.to_string(),
            payload_base64: base64::engine::general_purpose::STANDARD.encode(payload),
            payload_len: payload.len(),
            qos,
            retain,
            correlation_hex: correlation.map(hex::encode),
            content_type: content_type.map(str::to_string),
            timestamp_ms: now_ms,
        };
        let matched = {
            let mut reg = self.rpc.lock().await;
            reg.match_reply(topic, correlation, now_ms, reply)
        };
        let Some(matched) = matched else {
            return;
        };
        // A broadcast request is not finished just because one answer came: closing
        // the response topic there would silently cap the collection at one.
        let finished = matched.state != crate::rpc::RpcState::Pending;
        if finished {
            let dead = self.rpc_watch.lock().await.release(&matched.response_topic);
            if let Some(dead) = dead {
                let _ = self.unsubscribe_topic(dead).await;
            }
        }
        let _ = app.emit(
            "rpc-event",
            RpcEvent {
                kind: if finished { "resolved" } else { "partial" },
                call: matched,
            },
        );
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
        // Pacing is windowed, not one publish per timer wake. Windows only
        // resolves wakeups every ~10-16 ms, so a short interval simply lost
        // messages against its own schedule (the same wall the bench lab hit;
        // see docs §4.21). Each window fires whatever the elapsed time says is
        // already due, and a long stall still discharges only a bounded catch-up
        // instead of dumping the backlog -- an absolute grid on purpose, so a
        // suspended laptop does not resume into a burst.
        const WINDOW: std::time::Duration = std::time::Duration::from_millis(20);
        let period_ms = spec.interval_ms.max(1);
        let per_window = (WINDOW.as_millis() as u64 / period_ms).max(1);
        let mut window = tokio::time::interval(WINDOW);
        window.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let started = Instant::now();
        let mut seq: u64 = 0;
        loop {
            window.tick().await;
            if cancel.load(Ordering::SeqCst) {
                return;
            }
            // +1 keeps the historical behaviour of firing the first publish
            // immediately rather than one period in.
            let due = (started.elapsed().as_millis() as u64 / period_ms) + 1;
            let target = due.min(seq + per_window * 4);
            let devices = spec.device_count();
            while seq < target {
                seq += 1;
                let now_ms = chrono::Utc::now().timestamp_millis();
                let random = (uuid::Uuid::new_v4().as_u128() & u128::from(u32::MAX)) as u32;
                // One draft, N devices: every tick emits one copy per simulated
                // device, with `${device}` substituted in the topic as well as the
                // payload, so `site/${device}/telemetry` fans out by itself.
                for device in 1..=devices {
                    let topic =
                        scheduler::render_template(&spec.topic, seq, now_ms, random, device);
                    let rendered =
                        scheduler::render_template(&spec.payload, seq, now_ms, random, device);
                    let params = match scheduler::encode_payload(&spec.format, &rendered) {
                        Ok(bytes) => ConsolePublishParams {
                            topic,
                            payload_base64: base64::engine::general_purpose::STANDARD
                                .encode(&bytes),
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
                    match self.publish_console(app.clone(), params).await {
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
                    if cancel.load(Ordering::SeqCst) {
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

    async fn route_message(self: &Arc<Self>, app: &AppHandle, mut publish: crate::transport::NormalizedPublish) {
        // Fault injection sits ahead of every consumer of the delivery, so a lost
        // message is missing from the traffic meter, history, the feed, RPC pairing
        // and the assertions alike. That is the point: this is what makes those
        // paths testable rather than merely observable.
        let mut copies = 1usize;
        if self.faults.is_active() {
            let plan = self.faults.apply_inbound(&mut publish);
            if plan.drop {
                return;
            }
            if plan.delay_ms > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(plan.delay_ms)).await;
            }
            if plan.duplicate {
                copies = 2;
            }
        }
        if copies > 1 {
            // The injected copy is a re-delivery of the same publish, so it is not
            // judged a second time — that would count one delivery twice.
            self.deliver(app, publish.clone()).await;
        }
        self.deliver(app, publish).await;
    }

    async fn deliver(self: &Arc<Self>, app: &AppHandle, publish: crate::transport::NormalizedPublish) {
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

        // Counted here, beside the traffic meter, so the two agree by construction:
        // `$SYS` redelivery and our own injected losses are out of both. A counter
        // that moved on every resubscribe would never let `rate() == 0` mean
        // "the application traffic stopped", which is the only reason it exists.
        self.received_total.fetch_add(1, Ordering::SeqCst);

        // Per-topic traffic meter (count / bytes / per-second rate)
        self.record_topic(&topic, publish.payload.len() as u64).await;

        // Subscription hit stats. When the broker tagged this delivery with the
        // ids of the subscriptions it matched, that is its own answer and costs a
        // lookup. An id we do not recognise (a session takeover, or a broker that
        // invents labels) falls back to our own match rather than reporting a
        // delivery that apparently reached nobody.
        let by_ids = if publish.subscription_ids.is_empty() {
            Vec::new()
        } else {
            let ids = self.sub_ids.lock().await;
            crate::topic::matched_by_ids(&publish.subscription_ids, &ids.by_id)
        };
        let matched = if by_ids.is_empty() {
            let subs = self.subscriptions.lock().await;
            crate::topic::matched_by_scan(&topic, subs.keys())
        } else {
            by_ids
        };
        if !matched.is_empty() {
            let mut hits = self.subscription_hits.lock().await;
            for filter in &matched {
                *hits.entry(filter.clone()).or_insert(0) += 1;
            }
        }

        // Console feed: surface everything except raw chunk data. A bench run
        // started with mirror=false is a load generator rather than something to
        // read, and routing its traffic through copy/encode/archive measures our
        // own pipeline instead of the broker. Traffic stats and hit counts stay
        // live: they are what the run is being judged on.
        let is_chunk_topic = topic.split('/').any(|seg| seg == "chunk");
        if !is_chunk_topic && self.bench.mirrors(&topic) {
            let payload_len = publish.payload.len();
            let truncated = payload_len > CONSOLE_PAYLOAD_CAP;
            let stored_bytes: Vec<u8> = if truncated {
                publish.payload[..CONSOLE_PAYLOAD_CAP].to_vec()
            } else {
                publish.payload.to_vec()
            };
            let (corr_text, corr_hex) = publish
                .correlation_data
                .as_deref()
                .map(crate::protocol::correlation_forms)
                .unwrap_or((None, None));
            let mut msg = MqttGenericMessage {
                id: uuid::Uuid::new_v4().to_string(),
                topic: topic.clone(),
                payload: String::from_utf8_lossy(&stored_bytes).to_string(),
                payload_len,
                payload_base64: base64::engine::general_purpose::STANDARD.encode(&stored_bytes),
                truncated,
                content_type: publish.content_type.clone(),
                user_properties: publish.user_properties.clone(),
                response_topic: publish.response_topic.clone(),
                correlation_data: corr_text,
                correlation_hex: corr_hex,
                payload_format: publish.payload_format,
                matched_filters: matched.clone(),
                subscription_ids: publish.subscription_ids.clone(),
                qos: publish.qos,
                retain: publish.retain,
                timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
                direction: "in".to_string(),
                assertion: None,
            };
            // Judged here, on the row the console shows: the verdict is a live
            // opinion about the rules as they are now, which is also why replayed
            // history rows carry none.
            if let Some(violation) = self.assertions.apply(&mut msg) {
                let _ = app.emit("assertion-violation", violation);
            }
            self.push_feed(msg).await;
        }

        // Scripted responder: stand in for the device on the other end. Planned from
        // the same delivery the console just showed, and skipped for chunk traffic —
        // answering our own file-transfer protocol would be talking to ourselves.
        if self.responder.is_active() && !is_chunk_topic {
            let text = String::from_utf8_lossy(&publish.payload).to_string();
            let replies = self.responder.plan(&topic, &text, chrono::Utc::now().timestamp_millis());
            for reply in replies {
                let me = self.clone();
                let app = app.clone();
                tokio::spawn(async move {
                    if reply.delay_ms > 0 {
                        tokio::time::sleep(std::time::Duration::from_millis(reply.delay_ms)).await;
                    }
                    if let Err(e) = me.publish_as_device(&reply).await {
                        me.responder.record_failure(&reply.rule_id, &e);
                        let _ = app.emit("responder-error", e);
                    }
                });
            }
        }

        // Pair against open requests before the transfer dispatch: a response
        // topic can live anywhere in the tree, including inside a chunk tree.
        self.rpc_observe(
            app,
            &topic,
            publish.correlation_data.as_deref(),
            &publish.payload,
            publish.qos,
            publish.retain,
            publish.content_type.as_deref(),
        )
        .await;

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
                        // An OS error is data, not UI copy: keep it language-neutral so
                        // an English interface does not suddenly show one Chinese sentence.
                        Some(format!("write failed (chunk {chunk_idx}): {detail}")),
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

    /// Does the receiver still own an incoming transfer this finalize task was
    /// spawned for? A cancel drops the entry, so a late finalize sees false and
    /// must not announce a result for a transfer the user already killed.
    async fn incoming_is_live(&self, transfer_id: &str) -> bool {
        self.incoming_transfers.lock().await.get(transfer_id).is_some_and(|entry| {
            matches!(
                entry.finalize_state,
                FinalizeState::Streaming | FinalizeState::Verifying
            )
        })
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

        // A cancel removes the entry, so an in-flight finalize must stop here
        // instead of publishing a result for a transfer the user already killed.
        if !self.incoming_is_live(&transfer_id).await {
            return;
        }

        let verified = match verify_sha256(&temp_path, &expected_hash).await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("SHA-256 verification error: {:?}", e);
                false
            }
        };

        if !verified {
            // Claim the entry before complaining: a transfer the user cancelled has
            // no business reporting an integrity failure to its sender.
            let ours = self.incoming_transfers.lock().await.remove(&transfer_id).is_some();
            if !ours {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return;
            }
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
            // The removal doubles as the liveness check: if a cancel took the entry
            // while we were verifying, this finalize must stay silent.
            let ours = self.incoming_transfers.lock().await.remove(&transfer_id).is_some();
            if !ours {
                return;
            }
            self.deliver_incoming(&app, &transfer_id, &temp_path, &final_path, &topic_prefix, &expected_hash, &file_name, file_size, total_chunks)
                .await;
        } else {
            let still_ours = {
                let mut incoming = self.incoming_transfers.lock().await;
                match incoming.get_mut(&transfer_id) {
                    Some(entry)
                        if matches!(
                            entry.finalize_state,
                            FinalizeState::Streaming | FinalizeState::Verifying
                        ) =>
                    {
                        entry.verified = true;
                        entry.finalize_state = FinalizeState::AwaitingApproval;
                        true
                    }
                    _ => false,
                }
            };
            if !still_ours {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return;
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
        // Remove entry first so the File handle is closed before rename; the
        // caller owns that decision (approve removes too), this must not re-check.

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
                let sent = self.sent_total.clone();
                tokio::spawn(async move {
                    resend_chunks(client, app_resend, ctx, missing, sent).await;
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

        // The prefix becomes part of every publish topic, so a wildcard typed
        // into the channel box would put an illegal name on the wire mid-transfer.
        if let Some(err) = crate::topic::publish_topic_error(&topic_prefix) {
            return Err(err);
        }

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
        self.note_sent();

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
        let manager = self.clone();

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

                match client.publish(&chunk_topic, qos_val, false, payload, None).await {
                    Ok(()) => manager.note_sent(),
                    Err(e) => {
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
                    if is_last {
                        // The peer has to hash the whole file before it can
                        // confirm. If that receipt never arrives the row would sit
                        // in "awaiting peer confirmation" until the app restarts,
                        // indistinguishable from a slow but live transfer, so give
                        // it a size-scaled deadline and a terminal state of its own.
                        let this = manager.clone();
                        let app_t = app_handle.clone();
                        let tid_t = tid.clone();
                        tokio::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_secs(
                                crate::protocol::confirm_grace_secs(file_size),
                            ))
                            .await;
                            // A COMPLETED or ERROR receipt already removed it.
                            let unconfirmed = this.outgoing_transfers.lock().await.remove(&tid_t);
                            if let Some(active) = unconfirmed {
                                let ctx = active.ctx;
                                this.confirm_timeouts.fetch_add(1, Ordering::SeqCst);
                                emit_progress(
                                    &app_t, &ctx.transfer_id, &ctx.topic_prefix, &ctx.file_name,
                                    "send", ctx.file_size, ctx.file_size, ctx.total_chunks,
                                    ctx.total_chunks, 0.0, "confirm_timeout",
                                    Some("peer never confirmed the transfer".to_string()),
                                    &ctx.sha256,
                                    Some(ctx.path.to_string_lossy().to_string()),
                                );
                            }
                        });
                    }
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
    pub async fn pause_transfer(&self, transfer_id: &str) -> Result<(), String> {
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
            Ok(())
        } else {
            Err(format!("no outgoing transfer '{transfer_id}' to pause"))
        }
    }

    pub async fn resume_transfer(&self, transfer_id: &str) -> Result<(), String> {
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
            Ok(())
        } else {
            Err(format!("no outgoing transfer '{transfer_id}' to resume"))
        }
    }

    /// Cancel either direction. The UI shows one cancel action on any live row,
    /// so a receiver-side cancel has to be real too, not a silent no-op.
    pub async fn cancel_transfer(
        &self,
        app: AppHandle,
        transfer_id: String,
    ) -> Result<(), String> {
        let prefix = {
            let outgoing = self.outgoing_transfers.lock().await;
            outgoing.get(&transfer_id).map(|trans| {
                trans.cancelled.store(true, Ordering::SeqCst);
                trans.paused.store(false, Ordering::SeqCst);
                trans.ctx.topic_prefix.clone()
            })
        };
        if let Some(prefix) = prefix {
            self.publish_ctrl(
                &prefix,
                &transfer_id,
                ControlMessage {
                    msg_type: "CANCEL".to_string(),
                    transfer_id: transfer_id.clone(),
                    chunk_index: None,
                    missing: None,
                    message: Some("Cancelled by sender".to_string()),
                },
            )
            .await;
            return Ok(());
        }
        if self.incoming_transfers.lock().await.contains_key(&transfer_id) {
            return self.reject_transfer(app, transfer_id).await;
        }
        Err(format!("no active transfer '{transfer_id}' to cancel"))
    }

    async fn publish_ctrl(&self, topic_prefix: &str, transfer_id: &str, ctrl: ControlMessage) {
        if let Some(client) = self.client.read().await.clone() {
            let topic = format!("{}/ctrl/{}", topic_prefix, transfer_id);
            if let Ok(payload) = serde_json::to_vec(&ctrl) {
                // Control receipts ride QoS 1 regardless of data QoS
                if client.publish(&topic, 1, false, Bytes::from(payload), None).await.is_ok() {
                    self.note_sent();
                }
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
    sent: Arc<std::sync::atomic::AtomicU64>,
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
        if client.publish(&topic, ctx.qos, false, Bytes::from(buf), None).await.is_ok() {
            sent.fetch_add(1, Ordering::SeqCst);
        }
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
