use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;

/// Concurrent bench runs per session.
pub const MAX_BENCH_RUNS: usize = 4;
pub const MIN_RATE: u32 = 1;
pub const MAX_RATE: u32 = 20_000;
pub const MIN_SIZE: u32 = 1;
pub const MAX_SIZE: u32 = 4096;
pub const MAX_DURATION_SEC: u32 = 3600;

/// Bytes each bench message carries so the looped-back copy can be timed:
/// magic (3) + seq u32 (4) + send epoch-ms i64 (8).
pub const HEADER_LEN: usize = 15;
const MAGIC: &[u8; 3] = b"BQ1";

/// Latency samples kept for the percentiles. A run at 20k msg/s would otherwise
/// retain hundreds of thousands of samples, so we keep the most recent window
/// and report how many were dropped — a percentile over "the last 10k" is what
/// the operator reads as "right now", and the counter keeps it honest.
pub const LATENCY_WINDOW: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchSpec {
    pub id: String,
    /// Round-robin across these exact topics; wildcards are not publishable
    pub topics: Vec<String>,
    /// Total messages per second across all topics
    pub rate: u32,
    /// Payload size in bytes
    pub size: u32,
    #[serde(default)]
    pub qos: u8,
    #[serde(default)]
    pub retain: bool,
    /// 0 = until stopped
    pub duration_sec: u32,
}

impl BenchSpec {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty() {
            return Err("bench id must not be empty".to_string());
        }
        if self.topics.is_empty() || self.topics.iter().all(|t| t.trim().is_empty()) {
            return Err("bench needs at least one topic".to_string());
        }
        for topic in &self.topics {
            if topic.contains('#') || topic.contains('+') {
                return Err(format!("'{topic}' is a subscription filter, not a publish topic"));
            }
        }
        if !(MIN_RATE..=MAX_RATE).contains(&self.rate) {
            return Err(format!("rate must be between {MIN_RATE} and {MAX_RATE} msg/s"));
        }
        if !(MIN_SIZE..=MAX_SIZE).contains(&self.size) {
            return Err(format!("payload size must be between {MIN_SIZE} and {MAX_SIZE} bytes"));
        }
        if self.qos > 2 {
            return Err("QoS must be 0, 1 or 2".to_string());
        }
        if self.duration_sec > MAX_DURATION_SEC {
            return Err(format!("duration must be at most {MAX_DURATION_SEC} seconds"));
        }
        Ok(())
    }
}

/// Build the wire payload. Sizes below `HEADER_LEN` cannot carry the timing
/// header, so they stay exactly as requested and simply report no latency.
pub fn bench_payload(size: usize, seq: u32, send_ms: i64) -> Vec<u8> {
    if size < HEADER_LEN {
        return vec![b'b'; size];
    }
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&seq.to_be_bytes());
    out.extend_from_slice(&send_ms.to_be_bytes());
    while out.len() < size {
        out.push(b'x');
    }
    out
}

/// Recover `(seq, send_ms)` from a looped-back payload, if it is one of ours.
pub fn parse_bench_payload(bytes: &[u8]) -> Option<(u32, i64)> {
    if bytes.len() < HEADER_LEN || &bytes[..MAGIC.len()] != MAGIC {
        return None;
    }
    let seq = u32::from_be_bytes([bytes[3], bytes[4], bytes[5], bytes[6]]);
    let mut ts = [0u8; 8];
    ts.copy_from_slice(&bytes[7..15]);
    Some((seq, i64::from_be_bytes(ts)))
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencySummary {
    /// Samples inside the reported window
    pub samples: usize,
    /// Samples that fell out of the window
    pub dropped: u64,
    pub p50_ms: u32,
    pub p95_ms: u32,
    pub p99_ms: u32,
    pub max_ms: u32,
    pub mean_ms: f64,
}

/// Rolling latency window plus the running totals the summary needs.
#[derive(Default)]
pub struct LatencySamples {
    window: VecDeque<u32>,
    dropped: u64,
    count: u64,
    sum: u64,
    max: u32,
}

impl LatencySamples {
    pub fn record(&mut self, ms: u32) {
        self.count += 1;
        self.sum += u64::from(ms);
        self.max = self.max.max(ms);
        if self.window.len() >= LATENCY_WINDOW {
            self.window.pop_front();
            self.dropped += 1;
        }
        self.window.push_back(ms);
    }

    /// Percentiles over the retained window only; `mean` and `max` cover every
    /// sample ever seen, which is why both are labelled separately.
    pub fn summary(&self) -> LatencySummary {
        let mut sorted: Vec<u32> = self.window.iter().copied().collect();
        sorted.sort_unstable();
        let at = |p: f64| -> u32 {
            if sorted.is_empty() {
                return 0;
            }
            let idx = ((sorted.len() - 1) as f64 * p).round() as usize;
            sorted[idx]
        };
        LatencySummary {
            samples: sorted.len(),
            dropped: self.dropped,
            p50_ms: at(0.50),
            p95_ms: at(0.95),
            p99_ms: at(0.99),
            max_ms: self.max,
            mean_ms: if self.count == 0 {
                0.0
            } else {
                self.sum as f64 / self.count as f64
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BenchStatus {
    Running,
    Finished,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchProgress {
    pub id: String,
    pub topics: Vec<String>,
    pub rate: u32,
    pub size: u32,
    pub qos: u8,
    pub retain: bool,
    pub sent: u64,
    /// QoS1 PUBACK / QoS2 PUBCOMP received since the run started, carrying a
    /// plain success reason. A refused ack never lands here.
    pub acked: u64,
    /// PUBACK/PUBREC refused with a reason code of 0x80 or above
    pub nacked: u64,
    /// PUBACK said "no matching subscribers": the broker took the packet and had
    /// nowhere to put it. Not a failure, not a delivery.
    pub no_subscribers: u64,
    /// Loopback copies we timed
    pub observed: u64,
    pub elapsed_ms: u64,
    pub status: BenchStatus,
    pub last_error: Option<String>,
    pub latency: LatencySummary,
}

pub struct BenchRun {
    spec: BenchSpec,
    cancel: Arc<AtomicBool>,
    handle: JoinHandle<()>,
    started_ms: i64,
    sent: AtomicU64,
    acked: AtomicU64,
    nacked: AtomicU64,
    no_subscribers: AtomicU64,
    inner: Mutex<RunInner>,
}

#[derive(Default)]
struct RunInner {
    latency: LatencySamples,
    observed: u64,
    status: Option<BenchStatus>,
    last_error: Option<String>,
    /// Wall clock when the run reached a terminal status. Without it the elapsed
    /// counter keeps ticking after the run is over, and a finished run reads as
    /// one that has mysteriously lost rate.
    finished_ms: Option<i64>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Registry of running and finished bench jobs. The publish loop lives with the
/// MQTT manager (it needs the client and sees the acks); this owns the counters.
#[derive(Default)]
pub struct BenchManager {
    runs: Mutex<HashMap<String, Arc<BenchRun>>>,
}

impl BenchManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn preflight(&self, spec: &BenchSpec) -> Result<(), String> {
        spec.validate()?;
        let runs = lock(&self.runs);
        let active = runs.values().filter(|r| r.status() == BenchStatus::Running).count();
        if active >= MAX_BENCH_RUNS {
            return Err(format!("at most {MAX_BENCH_RUNS} bench runs at once"));
        }
        Ok(())
    }

    pub fn register(&self, spec: BenchSpec, cancel: Arc<AtomicBool>, handle: JoinHandle<()>) {
        let run = Arc::new(BenchRun {
            spec,
            cancel,
            handle,
            started_ms: chrono::Utc::now().timestamp_millis(),
            sent: AtomicU64::new(0),
            acked: AtomicU64::new(0),
            nacked: AtomicU64::new(0),
            no_subscribers: AtomicU64::new(0),
            inner: Mutex::new(RunInner {
                latency: LatencySamples::default(),
                observed: 0,
                status: Some(BenchStatus::Running),
                last_error: None,
                finished_ms: None,
            }),
        });
        let previous = lock(&self.runs).insert(run.spec.id.clone(), run);
        if let Some(old) = previous {
            old.cancel.store(true, Ordering::SeqCst);
            old.handle.abort();
        }
    }

    pub fn progress(&self) -> Vec<BenchProgress> {
        let mut rows: Vec<BenchProgress> = lock(&self.runs)
            .values()
            .map(|r| {
                let inner = lock(&r.inner);
                BenchProgress {
                    id: r.spec.id.clone(),
                    topics: r.spec.topics.clone(),
                    rate: r.spec.rate,
                    size: r.spec.size,
                    qos: r.spec.qos,
                    retain: r.spec.retain,
                    sent: r.sent.load(Ordering::SeqCst),
                    acked: r.acked.load(Ordering::SeqCst),
                    nacked: r.nacked.load(Ordering::SeqCst),
                    no_subscribers: r.no_subscribers.load(Ordering::SeqCst),
                    observed: inner.observed,
                    elapsed_ms: (inner
                        .finished_ms
                        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis())
                        - r.started_ms)
                        .max(0) as u64,
                    status: inner.status.unwrap_or(BenchStatus::Running),
                    last_error: inner.last_error.clone(),
                    latency: inner.latency.summary(),
                }
            })
            .collect();
        rows.sort_by(|a, b| {
            let rank = |s: BenchStatus| (s == BenchStatus::Running) as u8;
            rank(b.status).cmp(&rank(a.status)).then(a.id.cmp(&b.id))
        });
        rows
    }

    pub fn stop(&self, id: &str) -> bool {
        let run = lock(&self.runs).get(id).cloned();
        let Some(run) = run else { return false };
        run.cancel.store(true, Ordering::SeqCst);
        run.handle.abort();
        run.set_status(BenchStatus::Stopped, None);
        true
    }

    pub fn stop_all(&self) -> usize {
        let runs: Vec<Arc<BenchRun>> = lock(&self.runs).values().cloned().collect();
        let mut stopped = 0;
        for run in runs {
            if run.status() == BenchStatus::Running {
                run.cancel.store(true, Ordering::SeqCst);
                run.handle.abort();
                run.set_status(BenchStatus::Stopped, None);
                stopped += 1;
            }
        }
        stopped
    }

    pub fn clear_finished(&self) -> usize {
        let mut runs = lock(&self.runs);
        let before = runs.len();
        runs.retain(|_, r| r.status() == BenchStatus::Running);
        before - runs.len()
    }

    /// Count one looped-back copy and time it. Returns true when the payload was
    /// ours, so the caller can tell "measured" from "not a bench message".
    pub fn observe(&self, topic: &str, payload: &[u8], now_ms: i64) -> bool {
        let runs = lock(&self.runs);
        let mut matched = false;
        for run in runs.values() {
            if !run.spec.topics.iter().any(|t| t == topic) {
                continue;
            }
            let Some((_seq, send_ms)) = parse_bench_payload(payload) else {
                continue;
            };
            matched = true;
            // A clock skew or a stale retained copy can read negative; recording
            // it as 0 would drag the percentiles down without explaining itself.
            let ms = (now_ms - send_ms).max(0) as u32;
            let mut inner = lock(&run.inner);
            inner.observed += 1;
            inner.latency.record(ms);
        }
        matched
    }

    pub fn record_ack(&self) {
        let runs = lock(&self.runs);
        for run in runs.values() {
            if run.status() == BenchStatus::Running {
                run.acked.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    /// A refused PUBACK/PUBREC. Not credited to `acked`, because "the broker
    /// answered" and "the broker accepted" are different claims — and a run that
    /// shows 100% acked while every publish was refused is exactly the failure
    /// this counter exists to make visible.
    pub fn record_nack(&self) {
        let runs = lock(&self.runs);
        for run in runs.values() {
            if run.status() == BenchStatus::Running {
                run.nacked.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    /// PUBACK with reason 0x10: accepted, but nobody was subscribed. Typical when
    /// the bench runs without the loopback subscription (or that subscription was
    /// itself refused), and it must not be read as either a delivery or a failure.
    pub fn record_no_subscribers(&self) {
        let runs = lock(&self.runs);
        for run in runs.values() {
            if run.status() == BenchStatus::Running {
                run.no_subscribers.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    pub fn record_sent(&self, id: &str) {
        if let Some(run) = lock(&self.runs).get(id).cloned() {
            // Same guard as `record_ack`: once a run is terminal its counters are
            // frozen, so a late in-flight publish cannot resurrect its totals.
            if run.status() == BenchStatus::Running {
                run.sent.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    pub fn finish(&self, id: &str, status: BenchStatus, error: Option<String>) {
        if let Some(run) = lock(&self.runs).get(id).cloned() {
            run.set_status(status, error);
        }
    }

    pub fn is_running(&self, id: &str) -> bool {
        lock(&self.runs).get(id).map(|r| r.status() == BenchStatus::Running).unwrap_or(false)
    }

    /// Active runs, for the ops snapshot: a bench keeps publishing even when the
    /// user has left the console workspace, and diagnostics is where that shows up.
    pub fn running_count(&self) -> usize {
        lock(&self.runs)
            .values()
            .filter(|r| r.status() == BenchStatus::Running)
            .count()
    }
}

impl BenchRun {
    fn status(&self) -> BenchStatus {
        lock(&self.inner).status.unwrap_or(BenchStatus::Running)
    }

    fn set_status(&self, status: BenchStatus, error: Option<String>) {
        let mut inner = lock(&self.inner);
        inner.status = Some(status);
        inner.last_error = error;
        inner.finished_ms = Some(chrono::Utc::now().timestamp_millis());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(id: &str) -> BenchSpec {
        BenchSpec {
            id: id.to_string(),
            topics: vec!["bench/hot".to_string()],
            rate: 1000,
            size: 64,
            qos: 1,
            retain: false,
            duration_sec: 5,
        }
    }

    fn park_handle() -> JoinHandle<()> {
        tokio::spawn(async { std::future::pending::<()>().await })
    }

    #[test]
    fn payload_carries_seq_and_send_time() {
        let bytes = bench_payload(64, 7, 1_700_000_000_123);
        assert_eq!(bytes.len(), 64);
        assert_eq!(parse_bench_payload(&bytes), Some((7, 1_700_000_000_123)));
    }

    #[test]
    fn tiny_payloads_stay_tiny_and_report_no_latency() {
        let bytes = bench_payload(4, 1, 0);
        assert_eq!(bytes.len(), 4);
        assert_eq!(parse_bench_payload(&bytes), None);
        // Foreign traffic is never mistaken for a bench sample.
        assert_eq!(parse_bench_payload(b"hello world, nothing here"), None);
        assert_eq!(parse_bench_payload(&bench_payload(15, 0, 0)), Some((0, 0)));
    }

    #[test]
    fn validation_rejects_unusable_bench_specs() {
        assert_eq!(spec("a").validate(), Ok(()));
        assert!(spec("").validate().is_err());
        let mut empty = spec("a");
        empty.topics = vec!["  ".to_string()];
        assert!(empty.validate().is_err());
        let mut wildcard = spec("a");
        wildcard.topics = vec!["bench/+".to_string()];
        assert!(wildcard.validate().is_err());
        let mut zero = spec("a");
        zero.rate = 0;
        assert!(zero.validate().is_err());
        zero.rate = MAX_RATE + 1;
        assert!(zero.validate().is_err());
        let mut size = spec("a");
        size.size = 0;
        assert!(size.validate().is_err());
        size.size = MAX_SIZE + 1;
        assert!(size.validate().is_err());
        let mut qos = spec("a");
        qos.qos = 3;
        assert!(qos.validate().is_err());
        let mut long = spec("a");
        long.duration_sec = MAX_DURATION_SEC + 1;
        assert!(long.validate().is_err());
        assert!(spec("open").validate().is_ok(), "duration 0 means until stopped");
    }

    #[test]
    fn percentiles_come_from_the_retained_window() {
        let mut s = LatencySamples::default();
        for ms in 1..=100u32 {
            s.record(ms);
        }
        let sum = s.summary();
        assert_eq!(sum.samples, 100);
        assert_eq!(sum.dropped, 0);
        assert_eq!(sum.p50_ms, 51);
        assert_eq!(sum.p95_ms, 95);
        assert_eq!(sum.p99_ms, 99);
        assert_eq!(sum.max_ms, 100);
        assert!((sum.mean_ms - 50.5).abs() < 1e-9);
    }

    #[test]
    fn window_overflow_is_counted_not_hidden() {
        let mut s = LatencySamples::default();
        for ms in 0..(LATENCY_WINDOW as u32 + 250) {
            s.record(ms);
        }
        let sum = s.summary();
        assert_eq!(sum.samples, LATENCY_WINDOW);
        assert_eq!(sum.dropped, 250);
        assert_eq!(sum.max_ms, LATENCY_WINDOW as u32 + 249, "max spans every sample");
        // The window now holds the newest samples, so its median moved up.
        assert!(sum.p50_ms > LATENCY_WINDOW as u32 / 2);
    }

    #[tokio::test]
    async fn observe_only_times_matching_topics_and_skews_are_clamped() {
        let mgr = BenchManager::new();
        let mut two = spec("r1");
        two.topics = vec!["bench/a".to_string(), "bench/b".to_string()];
        mgr.register(two, Arc::new(AtomicBool::new(false)), park_handle());

        let payload = bench_payload(64, 3, 1_000);
        assert!(mgr.observe("bench/b", &payload, 1_050));
        assert!(!mgr.observe("bench/other", &payload, 1_050), "not our topic");
        assert!(!mgr.observe("bench/a", b"foreign", 1_050), "not our payload");
        // A retained copy published in the future (clock skew) must not go negative.
        assert!(mgr.observe("bench/a", &bench_payload(64, 4, 9_000), 1_050));

        let rows = mgr.progress();
        assert_eq!(rows[0].observed, 2);
        assert_eq!(rows[0].latency.samples, 2);
        assert_eq!(rows[0].latency.max_ms, 50);
    }

    #[tokio::test]
    async fn acks_and_sends_count_only_running_runs() {
        let mgr = BenchManager::new();
        mgr.register(spec("r2"), Arc::new(AtomicBool::new(false)), park_handle());
        mgr.record_sent("r2");
        mgr.record_sent("r2");
        mgr.record_ack();
        assert_eq!(mgr.progress()[0].sent, 2);
        assert_eq!(mgr.progress()[0].acked, 1);

        mgr.finish("r2", BenchStatus::Finished, None);
        mgr.record_ack();
        let row = &mgr.progress()[0];
        assert_eq!(row.acked, 1, "a finished run stops accruing acks");
        assert_eq!(row.status, BenchStatus::Finished);
        assert!(!mgr.is_running("r2"));
    }

    #[tokio::test]
    async fn a_refused_publish_is_never_counted_as_acked() {
        let mgr = BenchManager::new();
        mgr.register(spec("r3"), Arc::new(AtomicBool::new(false)), park_handle());
        mgr.record_sent("r3");
        mgr.record_nack();
        mgr.record_no_subscribers();
        let row = &mgr.progress()[0];
        assert_eq!(row.sent, 1);
        assert_eq!(row.acked, 0, "a nack is not an ack");
        assert_eq!(row.nacked, 1);
        assert_eq!(row.no_subscribers, 1);
    }

    #[tokio::test]
    async fn terminal_runs_freeze_their_counters_and_elapsed() {
        let mgr = BenchManager::new();
        mgr.register(spec("r6"), Arc::new(AtomicBool::new(false)), park_handle());
        mgr.record_sent("r6");
        mgr.record_sent("r6");
        assert_eq!(mgr.progress()[0].sent, 2);

        mgr.stop("r6");
        mgr.record_sent("r6");
        mgr.record_ack();
        let frozen = &mgr.progress()[0];
        assert_eq!(frozen.sent, 2, "a stopped run stops counting");
        assert_eq!(frozen.acked, 0);
        assert_eq!(frozen.status, BenchStatus::Stopped);

        let at_stop = mgr.progress()[0].elapsed_ms;
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert_eq!(
            mgr.progress()[0].elapsed_ms,
            at_stop,
            "elapsed must stop at the finish, or a finished run reads as lost rate"
        );
    }

    #[tokio::test]
    async fn stop_cancels_the_task_and_clear_finished_drops_only_terminal_rows() {
        let mgr = BenchManager::new();
        let cancel = Arc::new(AtomicBool::new(false));
        mgr.register(spec("r3"), cancel.clone(), park_handle());
        mgr.register(spec("r4"), Arc::new(AtomicBool::new(false)), park_handle());
        assert_eq!(mgr.stop_all(), 2);
        assert!(cancel.load(Ordering::SeqCst));
        assert_eq!(mgr.progress()[0].status, BenchStatus::Stopped);
        assert_eq!(mgr.clear_finished(), 2);
        assert!(mgr.progress().is_empty());
    }

    #[tokio::test]
    async fn capacity_is_capped_and_finished_ids_can_be_reused() {
        let mgr = BenchManager::new();
        for i in 0..MAX_BENCH_RUNS {
            let s = spec(&format!("r{i}"));
            assert_eq!(mgr.preflight(&s), Ok(()));
            mgr.register(s, Arc::new(AtomicBool::new(false)), park_handle());
        }
        assert!(mgr.preflight(&spec("overflow")).is_err());
        mgr.finish("r0", BenchStatus::Finished, None);
        assert_eq!(mgr.preflight(&spec("r1-again")), Ok(()), "a slot freed up");
        assert!(mgr.preflight(&spec("")).is_err(), "validation still runs");
    }

    #[tokio::test]
    async fn failure_reason_is_surfaced_to_the_ui() {
        let mgr = BenchManager::new();
        mgr.register(spec("r5"), Arc::new(AtomicBool::new(false)), park_handle());
        mgr.finish("r5", BenchStatus::Failed, Some("MQTT client not connected".to_string()));
        let row = &mgr.progress()[0];
        assert_eq!(row.status, BenchStatus::Failed);
        assert_eq!(row.last_error.as_deref(), Some("MQTT client not connected"));
    }
}
