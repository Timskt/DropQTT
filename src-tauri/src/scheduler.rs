use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;

use crate::protocol::PubProperties;

/// Fastest allowed cadence. Pacing is windowed (see `run_schedule`), so this is
/// no longer limited by OS timer wakeups; below ~10 ms a scheduled publish is
/// really a stress run and belongs to the bench lab, which is built for that.
pub const MIN_INTERVAL_MS: u64 = 10;
/// Slowest allowed cadence (24 h).
pub const MAX_INTERVAL_MS: u64 = 24 * 60 * 60 * 1000;
/// Concurrent runs per session, so a runaway UI cannot fork unbounded tasks.
pub const MAX_ACTIVE_RUNS: usize = 32;
/// A run dies after this many back-to-back publish failures. rumqttc buffers
/// publishes across a reconnect, so a real failure streak means the event loop
/// we are writing to is gone (disconnected or replaced).
pub const MAX_CONSECUTIVE_ERRORS: u32 = 5;

/// One scheduled publish: a payload template replayed on a fixed cadence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSpec {
    pub id: String,
    pub topic: String,
    /// Editor text; `${...}` tokens are substituted per fire
    pub payload: String,
    #[serde(default = "default_format")]
    pub format: String,
    pub interval_ms: u64,
    /// Total messages to send; 0 = until stopped
    #[serde(default)]
    pub count: u32,
    #[serde(default)]
    pub qos: u8,
    #[serde(default)]
    pub retain: bool,
    #[serde(default)]
    pub properties: PubProperties,
}

fn default_format() -> String {
    "text".to_string()
}

impl ScheduleSpec {
    /// Reject anything that cannot work before a task is spawned.
    pub fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty() {
            return Err("schedule id must not be empty".to_string());
        }
        if self.topic.trim().is_empty() {
            return Err("schedule topic must not be empty".to_string());
        }
        if self.topic.contains('#') || self.topic.contains('+') {
            return Err("a published topic cannot contain wildcards".to_string());
        }
        if self.qos > 2 {
            return Err("QoS must be 0, 1 or 2".to_string());
        }
        if !(MIN_INTERVAL_MS..=MAX_INTERVAL_MS).contains(&self.interval_ms) {
            return Err(format!(
                "interval must be between {} and {} ms",
                MIN_INTERVAL_MS, MAX_INTERVAL_MS
            ));
        }
        // A static payload is checked by encoding it for real. A templated one is
        // not: `${counter}` changes both length and characters as it counts up,
        // so no single probe can decide validity for every fire (hex `aa${seq}`
        // is odd-length until the counter reaches 10). Those surface on the first
        // fire instead, as a run error the UI can show.
        if self.payload.contains("${") {
            check_scheduling_format(&self.format)
        } else {
            encode_payload(&self.format, &self.payload).map(|_| ())
        }
    }
}

/// Live status of one run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Running,
    Completed,
    Failed,
    Stopped,
}

/// What the UI sees about a run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInfo {
    pub id: String,
    pub topic: String,
    pub format: String,
    pub interval_ms: u64,
    pub count: u32,
    pub qos: u8,
    pub retain: bool,
    pub sent: u32,
    pub errors: u32,
    pub status: RunStatus,
    pub last_error: Option<String>,
    pub started_at_ms: i64,
    pub last_fire_ms: Option<i64>,
}

#[derive(Debug)]
struct RunInner {
    sent: u32,
    errors: u32,
    /// Failures since the last success: only a streak kills the run
    consecutive_errors: u32,
    status: RunStatus,
    last_error: Option<String>,
    started_at_ms: i64,
    last_fire_ms: Option<i64>,
}

struct Run {
    spec: ScheduleSpec,
    inner: Mutex<RunInner>,
    cancel: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

/// Registry of scheduled publishes for the active console session. The spawn /
/// publish loop lives with the MQTT manager (it needs the client and the feed);
/// this type owns the bookkeeping so the state machine is testable on its own.
#[derive(Default)]
pub struct SchedulerManager {
    runs: Mutex<HashMap<String, Arc<Run>>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl SchedulerManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Cheap pre-spawn check so a rejected request never starts a task.
    pub fn preflight(&self, spec: &ScheduleSpec) -> Result<(), String> {
        spec.validate()?;
        let runs = lock(&self.runs);
        if let Some(existing) = runs.get(&spec.id) {
            if lock(&existing.inner).status == RunStatus::Running {
                return Err(format!("schedule '{}' is already running", spec.id));
            }
        }
        let active = runs
            .values()
            .filter(|r| lock(&r.inner).status == RunStatus::Running)
            .count();
        if active >= MAX_ACTIVE_RUNS {
            return Err(format!("at most {} schedules can run at once", MAX_ACTIVE_RUNS));
        }
        Ok(())
    }

    /// Adopt an already-spawned task. Re-registering a finished id replaces it.
    pub fn register(&self, spec: ScheduleSpec, cancel: Arc<AtomicBool>, handle: JoinHandle<()>) {
        let started_at_ms = chrono::Utc::now().timestamp_millis();
        let run = Arc::new(Run {
            spec,
            inner: Mutex::new(RunInner {
                sent: 0,
                errors: 0,
                consecutive_errors: 0,
                status: RunStatus::Running,
                last_error: None,
                started_at_ms,
                last_fire_ms: None,
            }),
            cancel,
            handle,
        });
        let previous = lock(&self.runs).insert(run.spec.id.clone(), run);
        if let Some(old) = previous {
            old.cancel.store(true, Ordering::SeqCst);
            old.handle.abort();
        }
    }

    /// Snapshot of every run, active first (newest start last within a group).
    pub fn snapshot(&self) -> Vec<RunInfo> {
        let mut rows: Vec<RunInfo> = lock(&self.runs)
            .values()
            .map(|r| {
                let inner = lock(&r.inner);
                RunInfo {
                    id: r.spec.id.clone(),
                    topic: r.spec.topic.clone(),
                    format: r.spec.format.clone(),
                    interval_ms: r.spec.interval_ms,
                    count: r.spec.count,
                    qos: r.spec.qos,
                    retain: r.spec.retain,
                    sent: inner.sent,
                    errors: inner.errors,
                    status: inner.status,
                    last_error: inner.last_error.clone(),
                    started_at_ms: inner.started_at_ms,
                    last_fire_ms: inner.last_fire_ms,
                }
            })
            .collect();
        rows.sort_by(|a, b| {
            let rank = |s: RunStatus| matches!(s, RunStatus::Running) as u8;
            rank(b.status)
                .cmp(&rank(a.status))
                .then(a.started_at_ms.cmp(&b.started_at_ms))
        });
        rows
    }

    pub fn info(&self, id: &str) -> Option<RunInfo> {
        self.snapshot().into_iter().find(|r| r.id == id)
    }

    pub fn running_count(&self) -> usize {
        lock(&self.runs)
            .values()
            .filter(|r| lock(&r.inner).status == RunStatus::Running)
            .count()
    }

    /// Record a successful fire; returns the run's status afterwards.
    pub fn record_fire(&self, id: &str, at_ms: i64) -> RunStatus {
        let run = lock(&self.runs).get(id).cloned();
        let Some(run) = run else { return RunStatus::Stopped };
        let mut inner = lock(&run.inner);
        inner.sent += 1;
        inner.consecutive_errors = 0;
        inner.last_fire_ms = Some(at_ms);
        inner.last_error = None;
        if inner.status == RunStatus::Running && run.spec.count > 0 && inner.sent >= run.spec.count
        {
            inner.status = RunStatus::Completed;
        }
        inner.status
    }

    /// Record a failed fire; returns the current consecutive-error streak.
    pub fn record_error(&self, id: &str, error: &str) -> u32 {
        let run = lock(&self.runs).get(id).cloned();
        let Some(run) = run else { return MAX_CONSECUTIVE_ERRORS };
        let mut inner = lock(&run.inner);
        if inner.status != RunStatus::Running {
            return MAX_CONSECUTIVE_ERRORS;
        }
        inner.errors += 1;
        inner.consecutive_errors += 1;
        inner.last_error = Some(error.to_string());
        if inner.consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
            inner.status = RunStatus::Failed;
        }
        inner.consecutive_errors
    }

    /// Terminal failure that retrying cannot fix (a payload that cannot encode):
    /// records why and stops the run in one step.
    pub fn fail(&self, id: &str, error: &str) {
        if let Some(run) = lock(&self.runs).get(id).cloned() {
            let mut inner = lock(&run.inner);
            inner.errors += 1;
            inner.status = RunStatus::Failed;
            inner.last_error = Some(error.to_string());
        }
    }

    /// Move a run to a terminal status without touching its counters.
    pub fn mark(&self, id: &str, status: RunStatus) {
        if let Some(run) = lock(&self.runs).get(id).cloned() {
            lock(&run.inner).status = status;
        }
    }

    /// User-initiated stop. The row stays visible with status `stopped` until
    /// `clear_finished` drops it.
    pub fn stop(&self, id: &str) -> bool {
        let run = lock(&self.runs).get(id).cloned();
        let Some(run) = run else { return false };
        run.cancel.store(true, Ordering::SeqCst);
        run.handle.abort();
        let mut inner = lock(&run.inner);
        if inner.status == RunStatus::Running {
            inner.status = RunStatus::Stopped;
        }
        true
    }

    /// Stops every run; returns how many were still active. Used when the
    /// connection goes away: the target of these publishes no longer exists.
    pub fn stop_all(&self) -> usize {
        let runs: Vec<Arc<Run>> = lock(&self.runs).values().cloned().collect();
        let mut stopped = 0;
        for run in runs {
            let was_running = {
                let mut inner = lock(&run.inner);
                let running = inner.status == RunStatus::Running;
                if running {
                    inner.status = RunStatus::Stopped;
                }
                running
            };
            run.cancel.store(true, Ordering::SeqCst);
            run.handle.abort();
            if was_running {
                stopped += 1;
            }
        }
        stopped
    }

    /// Forget terminal runs; returns how many rows were removed.
    pub fn clear_finished(&self) -> usize {
        let mut runs = lock(&self.runs);
        let before = runs.len();
        runs.retain(|_, r| lock(&r.inner).status == RunStatus::Running);
        before - runs.len()
    }
}

/// Replace `${...}` placeholders. Mirrors `src/utils/template.ts` so the manual
/// and scheduled paths emit the same text; unknown names stay verbatim.
pub fn render_template(text: &str, counter: u64, now_ms: i64, random: u32) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    let mut rest = text;
    while let Some(pos) = rest.find("${") {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + 2..];
        let closed = after.find('}');
        let token = match closed {
            Some(end) => token_value(&after[..end], counter, now_ms, random).map(|v| (v, end)),
            None => None,
        };
        match token {
            Some((value, end)) => {
                out.push_str(&value);
                rest = &after[end + 1..];
            }
            // Not one of ours. Emit just the `$` and rescan from the `{`: that
            // leaves the unknown name verbatim and still lets a nested `${seq}`
            // inside `${x${seq}}` be substituted, exactly like the JS regex in
            // src/utils/template.ts does. It also always shrinks `rest`.
            None => {
                out.push('$');
                rest = &rest[pos + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn token_value(name: &str, counter: u64, now_ms: i64, random: u32) -> Option<String> {
    match name {
        "timestamp" | "ts" => Some(now_ms.to_string()),
        "iso" => chrono::DateTime::from_timestamp_millis(now_ms)
            .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            .or_else(|| Some(now_ms.to_string())),
        "uuid" => Some(uuid::Uuid::new_v4().to_string()),
        "random" => Some((random % 1_000_000).to_string()),
        "counter" | "seq" => Some(counter.to_string()),
        _ => None,
    }
}

/// Editor text → wire bytes. Same contract as `payloadToBytes` in the frontend,
/// minus CBOR (no encoder in the backend; that format stays manual-publish only).
pub fn encode_payload(format: &str, text: &str) -> Result<Vec<u8>, String> {
    check_scheduling_format(format)?;
    match format {
        "text" | "markdown" | "html" => Ok(text.as_bytes().to_vec()),
        "json" => {
            serde_json::from_str::<serde_json::Value>(text)
                .map_err(|e| format!("invalid JSON payload: {e}"))?;
            Ok(text.as_bytes().to_vec())
        }
        "base64" => {
            let clean: String = text.chars().filter(|c| !c.is_whitespace()).collect();
            base64::engine::general_purpose::STANDARD
                .decode(&clean)
                .map_err(|e| format!("invalid Base64 payload: {e}"))
        }
        "hex" => {
            let clean: String = text
                .chars()
                .filter(|c| !c.is_whitespace() && *c != ':')
                .collect();
            hex::decode(&clean)
                .map_err(|_| "hex payload must be an even number of hex digits".to_string())
        }
        other => Err(format!("unsupported payload format '{other}'")),
    }
}

/// Formats the backend can encode on its own. Kept separate from the encoder so
/// template payloads can be format-checked without pretending to render them.
pub fn check_scheduling_format(format: &str) -> Result<(), String> {
    match format {
        "text" | "json" | "markdown" | "html" | "base64" | "hex" => Ok(()),
        "cbor" => Err(
            "scheduled publishing supports Text, JSON, Markdown, HTML, Base64 and Hex; \
             publish CBOR manually"
                .to_string(),
        ),
        other => Err(format!("unknown payload format '{other}'")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(id: &str, interval_ms: u64, count: u32) -> ScheduleSpec {
        ScheduleSpec {
            id: id.to_string(),
            topic: "sched/test".to_string(),
            payload: "hello".to_string(),
            format: "text".to_string(),
            interval_ms,
            count,
            qos: 1,
            retain: false,
            properties: PubProperties::default(),
        }
    }

    fn cancel_flag() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }

    /// A registered run needs a live task handle so `abort()` has something to
    /// cancel; a pending task parks without occupying a worker.
    fn park_handle() -> JoinHandle<()> {
        tokio::spawn(async { std::future::pending::<()>().await })
    }

    #[test]
    fn template_tokens_render() {
        let out = render_template(
            r#"{"ts":${ts},"i":${counter},"r":${random},"iso":"${iso}"}"#,
            7,
            1_700_000_000_123,
            42,
        );
        assert_eq!(
            out,
            r#"{"ts":1700000000123,"i":7,"r":42,"iso":"2023-11-14T22:13:20.123Z"}"#
        );
    }

    #[test]
    fn template_keeps_unknown_and_unclosed_placeholders() {
        assert_eq!(render_template("${nope} ${counter}", 3, 0, 0), "${nope} 3");
        assert_eq!(render_template("tail ${", 3, 0, 0), "tail ${");
        assert_eq!(render_template("${a${seq}", 9, 0, 0), "${a9");
    }

    #[test]
    fn template_replaces_every_occurrence() {
        assert_eq!(render_template("${seq}-${seq}", 2, 0, 0), "2-2");
        assert_eq!(render_template("counter=off", 2, 0, 0), "counter=off");
    }

    #[test]
    fn uuid_token_is_unique_and_well_formed() {
        let a = render_template("${uuid}", 1, 0, 0);
        let b = render_template("${uuid}", 1, 0, 0);
        assert_ne!(a, b);
        assert_eq!(a.matches('-').count(), 4);
        assert_eq!(a.len(), 36);
    }

    #[test]
    fn payload_formats_encode_like_the_frontend() {
        assert_eq!(encode_payload("text", "héllo").unwrap(), "héllo".as_bytes());
        assert_eq!(encode_payload("base64", "SGVsbG8gRHJvcFFUVA==").unwrap(), b"Hello DropQTT");
        assert_eq!(encode_payload("hex", "48 65:6c 6c 6f").unwrap(), b"Hello");
        assert!(encode_payload("json", "{\"a\":1}").is_ok());
        assert!(encode_payload("json", "{\"a\":}").is_err());
        assert!(encode_payload("hex", "abc").is_err());
        assert!(encode_payload("base64", "not base64!").is_err());
        assert!(encode_payload("cbor", "{}").is_err());
        assert!(encode_payload("protobuf", "x").is_err());
    }

    #[test]
    fn validation_rejects_unusable_schedules() {
        assert!(spec("a", 1_000, 0).validate().is_ok());
        assert!(spec("", 1_000, 0).validate().is_err());

        let mut wildcard = spec("a", 1_000, 0);
        wildcard.topic = "sensors/#".to_string();
        assert!(wildcard.validate().is_err());

        assert!(
            spec("a", MIN_INTERVAL_MS - 1, 0).validate().is_err(),
            "below the cadence floor"
        );
        assert!(spec("a", MAX_INTERVAL_MS + 1, 0).validate().is_err());
        assert!(spec("a", MIN_INTERVAL_MS, 0).validate().is_ok(), "floor is inclusive");

        let mut broken_json = spec("a", 1_000, 0);
        broken_json.format = "json".to_string();
        broken_json.payload = "{oops".to_string();
        assert!(broken_json.validate().is_err());

        // Static payloads are encoding-checked; templated ones only get the
        // format gate, because no single probe proves every fire (see validate).
        let mut hex_static = spec("a", 1_000, 0);
        hex_static.format = "hex".to_string();
        hex_static.payload = "deadbeef".to_string();
        assert!(hex_static.validate().is_ok());
        hex_static.payload = "abc".to_string();
        assert!(hex_static.validate().is_err(), "odd number of digits");
        hex_static.payload = "aa${seq}".to_string();
        assert!(hex_static.validate().is_ok(), "tokenised: deferred to fire time");

        let mut cbor = spec("a", 1_000, 0);
        cbor.format = "cbor".to_string();
        cbor.payload = "{\"a\":${seq}}".to_string();
        assert!(cbor.validate().is_err(), "rejected even with tokens");
        cbor.payload = "{}".to_string();
        assert!(cbor.validate().is_err());
        cbor.format = "protobuf".to_string();
        assert!(cbor.validate().is_err());
    }

    #[tokio::test]
    async fn registry_tracks_progress_and_completion() {
        let sched = SchedulerManager::new();
        let s = spec("r1", 1_000, 3);
        assert_eq!(sched.preflight(&s), Ok(()));
        sched.register(s, cancel_flag(), park_handle());

        assert_eq!(sched.running_count(), 1);
        assert_eq!(sched.record_fire("r1", 10), RunStatus::Running);
        assert_eq!(sched.record_fire("r1", 20), RunStatus::Running);
        assert_eq!(sched.record_fire("r1", 30), RunStatus::Completed);

        let info = sched.info("r1").expect("row visible after completion");
        assert_eq!(info.sent, 3);
        assert_eq!(info.status, RunStatus::Completed);
        assert_eq!(info.last_fire_ms, Some(30));
        assert_eq!(sched.running_count(), 0, "completed runs are not active");
    }

    #[tokio::test]
    async fn open_ended_run_never_completes_on_its_own() {
        let sched = SchedulerManager::new();
        sched.register(spec("r2", 1_000, 0), cancel_flag(), park_handle());
        for i in 0..50 {
            assert_eq!(sched.record_fire("r2", i), RunStatus::Running);
        }
        assert_eq!(sched.info("r2").unwrap().sent, 50);
    }

    #[tokio::test]
    async fn error_streak_fails_the_run_and_a_success_resets_it() {
        let sched = SchedulerManager::new();
        sched.register(spec("r3", 1_000, 0), cancel_flag(), park_handle());
        assert_eq!(sched.record_error("r3", "boom"), 1);
        assert_eq!(sched.record_error("r3", "boom"), 2);
        assert_eq!(sched.record_fire("r3", 5), RunStatus::Running, "recovered");
        for streak in 1..=MAX_CONSECUTIVE_ERRORS {
            assert_eq!(sched.record_error("r3", "gone"), streak);
        }
        let info = sched.info("r3").unwrap();
        assert_eq!(info.status, RunStatus::Failed);
        assert_eq!(info.errors, 2 + MAX_CONSECUTIVE_ERRORS);
        assert_eq!(info.last_error.as_deref(), Some("gone"));
        assert_eq!(info.sent, 1);
    }

    #[tokio::test]
    async fn stop_flags_cancel_and_keeps_the_row_visible() {
        let sched = SchedulerManager::new();
        let cancel = cancel_flag();
        sched.register(spec("r4", 1_000, 0), cancel.clone(), park_handle());
        assert!(sched.stop("r4"));
        assert!(cancel.load(Ordering::SeqCst));
        assert_eq!(sched.info("r4").unwrap().status, RunStatus::Stopped);
        assert!(!sched.stop("missing"));
        assert_eq!(sched.clear_finished(), 1);
        assert!(sched.snapshot().is_empty());
    }

    #[tokio::test]
    async fn stop_all_reports_only_actively_running_rows() {
        let sched = SchedulerManager::new();
        for id in ["a", "b"] {
            sched.register(spec(id, 1_000, 0), cancel_flag(), park_handle());
        }
        sched.record_fire("b", 1);
        sched.mark("b", RunStatus::Completed);
        assert_eq!(sched.stop_all(), 1);
        assert_eq!(sched.info("a").unwrap().status, RunStatus::Stopped);
        assert_eq!(sched.info("b").unwrap().status, RunStatus::Completed, "already done");
    }

    #[tokio::test]
    async fn a_finished_id_can_be_restarted_and_replaces_the_old_row() {
        let sched = SchedulerManager::new();
        let first = cancel_flag();
        sched.register(spec("r5", 1_000, 1), first.clone(), park_handle());
        assert_eq!(sched.record_fire("r5", 1), RunStatus::Completed);
        assert!(sched.preflight(&spec("r5", 1_000, 1)).is_ok());
        sched.register(spec("r5", 1_000, 1), cancel_flag(), park_handle());
        assert_eq!(sched.snapshot().len(), 1);
        assert_eq!(sched.info("r5").unwrap().status, RunStatus::Running);
        assert_eq!(sched.info("r5").unwrap().sent, 0, "counters restart");
    }

    #[tokio::test]
    async fn a_running_id_cannot_be_restarted_and_capacity_is_capped() {
        let sched = SchedulerManager::new();
        sched.register(spec("busy", 1_000, 0), cancel_flag(), park_handle());
        assert!(sched.preflight(&spec("busy", 1_000, 0)).is_err());

        for i in 0..MAX_ACTIVE_RUNS - 1 {
            let s = spec(&format!("r{i}"), 1_000, 0);
            assert_eq!(sched.preflight(&s), Ok(()));
            sched.register(s, cancel_flag(), park_handle());
        }
        assert_eq!(sched.running_count(), MAX_ACTIVE_RUNS);
        assert!(sched.preflight(&spec("overflow", 1_000, 0)).is_err());
    }

    #[tokio::test]
    async fn snapshot_puts_active_runs_first() {
        let sched = SchedulerManager::new();
        sched.register(spec("old-done", 1_000, 1), cancel_flag(), park_handle());
        sched.record_fire("old-done", 1);
        sched.register(spec("live", 1_000, 0), cancel_flag(), park_handle());
        let ids: Vec<String> = sched.snapshot().into_iter().map(|r| r.id).collect();
        assert_eq!(ids, vec!["live".to_string(), "old-done".to_string()]);
    }
}
