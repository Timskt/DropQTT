//! Persistent message history (SQLite).
//!
//! The console feed already batches inbound/outbound publishes on a 100 ms
//! cadence; each drained batch is mirrored here so history survives restarts
//! and can be searched / charted / traced long after the live feed scrolled
//! away. Writes happen inside a single transaction per batch to stay cheap even
//! at thousands of messages per second. A row-count cap keeps the DB bounded.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use base64::Engine;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::protocol::{MqttGenericMessage, PubProperties};

/// Hard ceiling on retained rows; older rows are trimmed after each append.
const MAX_HISTORY_ROWS: i64 = 100_000;
/// Trim only every N appends to keep the hot path cheap.
const TRIM_EVERY_BATCHES: u64 = 50;
/// Default age limit. 0 means "no age limit, only the row cap", which is what
/// the store did before this existed; silently discarding a month of history
/// because a new knob appeared would be the worse surprise.
pub const DEFAULT_RETENTION_DAYS: i64 = 0;
pub const MAX_RETENTION_DAYS: i64 = 3650;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    pub id: String,
    pub topic: String,
    pub payload: String,
    pub payload_base64: String,
    pub payload_len: usize,
    pub qos: u8,
    pub retain: bool,
    pub content_type: Option<String>,
    pub properties: PubProperties,
    pub truncated: bool,
    pub direction: String,
    /// Epoch milliseconds when recorded
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySeriesPoint {
    /// Bucket start (epoch ms, aligned to the requested interval)
    pub bucket: i64,
    pub count: i64,
}

/// A row that joined a trace, and *why* it joined. The reason is part of the
/// evidence: matching a correlation key says "this is the same request", while
/// matching a substring of a payload only says "these look related".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceHit {
    #[serde(flatten)]
    pub row: HistoryRow,
    /// `correlation` | `topic` | `payload`
    pub matched_by: String,
}

/// What one token's life looks like across everything this store recorded.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceResult {
    /// Oldest first: a story is read forward, unlike the history list.
    pub hits: Vec<TraceHit>,
    pub summary: TraceSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceSummary {
    pub count: usize,
    /// Distinct topics touched, in first-seen order.
    pub topics: Vec<String>,
    pub first_ms: Option<i64>,
    pub last_ms: Option<i64>,
    pub inbound: usize,
    pub outbound: usize,
    /// Distinct correlation keys in the result. More than one means the token
    /// covered several requests, and blending them into one timeline would be a
    /// lie worth showing.
    pub correlations: Vec<String>,
    pub truncated: bool,
}

/// The correlation of a message as lowercase hex of **its bytes**.
///
/// `correlation_hex` is only filled in when the wire bytes were not valid UTF-8,
/// so the text form has to be folded back to bytes — otherwise a request whose
/// correlation was typed as text and an answer that arrived as those same bytes
/// would look like two unrelated messages.
pub fn correlation_key(hex_form: Option<&str>, text_form: Option<&str>) -> Option<String> {
    if let Some(hex) = hex_form.map(str::trim).filter(|h| !h.is_empty()) {
        return Some(hex.to_ascii_lowercase());
    }
    let text = text_form.map(str::trim).filter(|t| !t.is_empty())?;
    Some(hex::encode(text.as_bytes()))
}

/// What to compare a typed token against. A person may paste the hex from the
/// RPC panel or type the correlation they set in a form, so both spellings of
/// the same bytes resolve to one key.
pub fn token_to_key(token: &str) -> String {
    let trimmed = token.trim();
    let looks_hex = !trimmed.is_empty()
        && trimmed.len().is_multiple_of(2)
        && trimmed.bytes().all(|b| b.is_ascii_hexdigit());
    if looks_hex {
        trimmed.to_ascii_lowercase()
    } else {
        hex::encode(trimmed.as_bytes())
    }
}

/// One topic's share of a time window.
///
/// "Which device was talking at 3 am" is answered by counting per topic, and
/// paging a filtered list to find it is how that question gets abandoned.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTopicRow {
    pub topic: String,
    pub count: i64,
    pub inbound: i64,
    pub outbound: i64,
    /// Sum of payload lengths, so a noisy topic and a chatty small one separate
    pub bytes: i64,
    pub first_ts: i64,
    pub last_ts: i64,
}

/// One topic's retained value and the versions of it we happened to record.
///
/// Every inbound row with `retain` set is one replacement of that topic's
/// retained value, and those rows are already in the store: this reads the
/// history of a value that no MQTT client shows, because a broker only ever
/// hands over the current one. It is what makes a *stale* retained value
/// visible — a config pushed once and never cleared keeps being delivered to
/// every new subscriber forever, and at connect time it looks brand new.
///
/// Claims are bounded by what we stored. A version published while this app was
/// disconnected is not missing here, it was never observed, and the view says so
/// rather than reporting a complete lineage.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetainedLineage {
    pub topic: String,
    /// Retained publishes we recorded for this topic, newest of them being `payload`.
    pub versions: i64,
    pub first_ts: i64,
    /// When the newest retained publish we hold arrived.
    pub last_ts: i64,
    /// The newest retained payload, lossy-decoded for display.
    pub payload: String,
    pub payload_b64: String,
    /// Length as the publisher sent it, so a truncated `payload` is recognisable.
    pub payload_len: usize,
    /// The newest row was stored cut off: this value is partial, not the whole thing.
    pub truncated: bool,
    /// An empty retained publish is how a publisher *deletes* a retained value, so the
    /// topic has no live value — that is a terminal state, not an empty one.
    pub cleared: bool,
    /// Older than the caller's bar, and still being handed to new subscribers.
    pub stale: bool,
}

/// One uninterrupted stretch of traffic from one entity on the timeline.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub messages: i64,
}

/// A request that expected an answer, seen inside the window.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineMark {
    pub ts_ms: i64,
    pub topic: String,
    /// The correlation as lowercase hex of its bytes, which is how it is stored.
    pub correlation: Option<String>,
    /// False means no answer carrying these correlation bytes was seen **in this
    /// window**. An answer that arrived after it, or while we were disconnected,
    /// looks identical from here, so the view has to say so.
    pub answered: bool,
    pub rtt_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEntity {
    pub entity: String,
    pub segments: Vec<TimelineSegment>,
    pub marks: Vec<TimelineMark>,
    pub messages: i64,
    pub first_ms: i64,
    pub last_ms: i64,
    /// The longest silence between two segments. Zero means it never went quiet
    /// long enough to count as a gap at this threshold.
    pub longest_gap_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineResult {
    pub entities: Vec<TimelineEntity>,
    pub window_start_ms: i64,
    pub window_end_ms: i64,
    pub gap_ms: i64,
    pub depth: i64,
    /// Entities past the cap, so the view can say "and 12 more" rather than
    /// implying the window was quiet.
    pub entities_dropped: usize,
    pub rows_scanned: i64,
    /// The row cap was reached: the timeline covers the oldest slice of the window.
    pub truncated: bool,
}

/// How many rows one timeline build reads. Above this the result is truncated.
pub const TIMELINE_ROW_CAP: i64 = 50_000;
/// Marks kept per entity; a fleet that polls every second outruns any viewport.
pub const TIMELINE_MARK_CAP: usize = 200;

/// One stored row reduced to what the timeline needs: when, which way, what it
/// carried, and whether it expected an answer.
type TimelinePoint = (i64, String, Option<String>, String);

/// The first `depth` topic levels, which is how a topic becomes a row.
///
/// There is no device registry here on purpose: `devices/gw-7/telemetry` and
/// `devices/gw-7/status` share the prefix `devices/gw-7`, and that is the whole
/// of what this can claim to know.
fn entity_of(topic: &str, depth: i64) -> String {
    let depth = depth.max(1) as usize;
    let parts: Vec<&str> = topic.split('/').collect();
    if parts.len() <= depth {
        return topic.to_string();
    }
    parts[..depth].join("/")
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStats {
    pub rows: i64,
    pub inbound: i64,
    pub outbound: i64,
    pub oldest_ts: Option<i64>,
    pub newest_ts: Option<i64>,
    /// Rows dropped by the best-effort write path since this session opened
    pub lost_rows: u64,
    /// Age limit currently applied; 0 means only the row cap trims
    pub retention_days: i64,
    /// Rows the retention policy has deleted since this session opened. History
    /// that is deliberately pruned still has to be countable as gone.
    pub pruned_rows: u64,
}

pub struct HistoryStore {
    conn: Mutex<Connection>,
    batches: Mutex<u64>,
    /// Rows the write path could not persist. History stays best-effort on
    /// purpose (a busy DB must never stall the live feed), but "best-effort"
    /// without a counter is indistinguishable from "complete".
    lost_rows: AtomicU64,
    /// Age limit in days; 0 = no age limit. Kept in the DB so a restart cannot
    /// quietly widen or narrow what the operator asked for.
    retention_days: std::sync::atomic::AtomicI64,
    pruned_rows: AtomicU64,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl HistoryStore {
    pub fn open(path: &std::path::Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("open history db: {e}"))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("wal: {e}"))?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|e| format!("sync: {e}"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                topic TEXT NOT NULL,
                payload TEXT NOT NULL,
                payload_b64 TEXT NOT NULL,
                payload_len INTEGER NOT NULL,
                qos INTEGER NOT NULL,
                retain INTEGER NOT NULL,
                content_type TEXT,
                direction TEXT NOT NULL,
                ts INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts DESC);
             CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic);
             CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );",
        )
        .map_err(|e| format!("schema: {e}"))?;
        // Additive migration preserves existing captures when upgrading.
        let columns: Vec<String> = conn
            .prepare("PRAGMA table_info(messages)")
            .and_then(|mut s| s.query_map([], |r| r.get(1))?.collect())
            .map_err(|e| format!("history schema: {e}"))?;
        if !columns.iter().any(|c| c == "properties") {
            conn.execute("ALTER TABLE messages ADD COLUMN properties TEXT NOT NULL DEFAULT '{}'", [])
                .map_err(|e| format!("history migration: {e}"))?;
        }
        if !columns.iter().any(|c| c == "truncated") {
            conn.execute("ALTER TABLE messages ADD COLUMN truncated INTEGER NOT NULL DEFAULT 0", [])
                .map_err(|e| format!("history migration: {e}"))?;
        }
        if !columns.iter().any(|c| c == "correlation") {
            conn.execute("ALTER TABLE messages ADD COLUMN correlation TEXT", [])
                .map_err(|e| format!("history migration: {e}"))?;
            // Rows written before the column existed still carry their correlation
            // inside the `properties` JSON, so the key is recovered rather than left
            // null. A trace that only works for traffic captured after an upgrade is
            // a trap: the gap looks like "this device never spoke".
            conn.execute(
                "UPDATE messages SET correlation = COALESCE( \
                    nullif(lower(json_extract(properties, '$.correlationHex')), ''), \
                    nullif(lower(hex(json_extract(properties, '$.correlationData'))), '') \
                 ) WHERE correlation IS NULL AND properties IS NOT NULL AND properties <> '{}'",
                [],
            )
            .map_err(|e| format!("history correlation backfill: {e}"))?;
        }
        conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_corr ON messages(correlation)", [])
            .map_err(|e| format!("history index: {e}"))?;
        let retention_days = read_retention(&conn);
        Ok(Self {
            conn: Mutex::new(conn),
            batches: Mutex::new(0),
            lost_rows: AtomicU64::new(0),
            retention_days: std::sync::atomic::AtomicI64::new(retention_days),
            pruned_rows: AtomicU64::new(0),
        })
    }

    /// Mirror one drained feed batch into the DB (transactional, cheap).
    pub fn append(&self, batch: &[MqttGenericMessage]) {
        if batch.is_empty() {
            return;
        }
        let fallback_ts = now_ms();
        let Ok(conn) = self.conn.lock() else {
            self.lost_rows.fetch_add(batch.len() as u64, Ordering::SeqCst);
            return;
        };
        // Best-effort: a failed history write must never break the live feed.
        let mut inserted = 0u64;
        if conn.execute("BEGIN IMMEDIATE", []).is_err() {
            // Without the transaction every INSERT would autocommit, so a later
            // failure would leave part of the batch written while the accounting
            // below claims the whole thing was lost. Skip the batch instead and
            // let `lost_rows` state exactly how much history is missing.
            drop(conn);
            self.lost_rows.fetch_add(batch.len() as u64, Ordering::SeqCst);
            return;
        }
        for m in batch {
            let ts = if m.timestamp_ms > 0 { m.timestamp_ms } else { fallback_ts };
            let properties = PubProperties {
                content_type: m.content_type.clone(),
                user_properties: m.user_properties.clone(),
                response_topic: m.response_topic.clone(),
                correlation_data: m.correlation_data.clone(),
                correlation_hex: m.correlation_hex.clone(),
                // Kept so a replayed message declares the same payload format the
                // broker originally delivered it with.
                payload_format: m.payload_format,
                ..Default::default()
            };
            if conn
                .execute(
                "INSERT OR REPLACE INTO messages \
                 (id, topic, payload, payload_b64, payload_len, qos, retain, content_type, direction, ts, properties, truncated, correlation) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![
                    m.id,
                    m.topic,
                    m.payload,
                    m.payload_base64,
                    m.payload_len as i64,
                    m.qos as i64,
                    m.retain as i64,
                    m.content_type,
                    m.direction,
                    ts,
                    serde_json::to_string(&properties).unwrap_or_default(),
                    m.truncated,
                    correlation_key(m.correlation_hex.as_deref(), m.correlation_data.as_deref())
                ],
            )
                .is_ok()
            {
                inserted += 1;
            }
        }
        if conn.execute("COMMIT", []).is_err() {
            // A failed commit rolled the whole batch back, so the per-row
            // successes above never happened either.
            inserted = 0;
        }
        drop(conn);
        let lost = batch.len() as u64 - inserted;
        if lost > 0 {
            self.lost_rows.fetch_add(lost, Ordering::SeqCst);
        }

        // Periodic bounded trim (every N batches) keeps the DB capped cheaply.
        let count = self.batches.lock().map(|mut g| {
            *g += 1;
            *g
        }).ok();
        if matches!(count, Some(n) if n % TRIM_EVERY_BATCHES == 0) {
            self.trim();
        }
    }

    /// Age policy in days; 0 means the row cap is the only limit.
    pub fn retention_days(&self) -> i64 {
        self.retention_days.load(Ordering::SeqCst)
    }

    /// Set the age policy and apply it now. Clamped rather than rejected: this is
    /// called from a text input, and "36500" meaning "forever" is closer to what
    /// the operator meant than an error message.
    pub fn set_retention_days(&self, days: i64) -> Result<(), String> {
        let days = days.clamp(0, MAX_RETENTION_DAYS);
        {
            let conn = self.conn.lock().map_err(|_| "history store is unavailable".to_string())?;
            write_retention(&conn, days);
        }
        self.retention_days.store(days, Ordering::SeqCst);
        self.trim();
        Ok(())
    }

    /// Apply both bounds: drop what is older than the age policy, then enforce the
    /// row cap. What went is added to `pruned_rows` rather than returned, because
    /// history that was deliberately deleted still has to be countable as gone —
    /// otherwise a shrinking database is indistinguishable from a broken writer.
    fn trim(&self) {
        let Ok(conn) = self.conn.lock() else { return };
        let days = self.retention_days.load(Ordering::SeqCst);
        let mut pruned = 0u64;
        if days > 0 {
            let cutoff = now_ms() - days * 86_400_000;
            pruned += conn
                .execute("DELETE FROM messages WHERE ts < ?1", params![cutoff])
                .unwrap_or(0) as u64;
        }
        pruned += conn
            .execute(
                "DELETE FROM messages WHERE rowid NOT IN (SELECT rowid FROM messages ORDER BY ts DESC LIMIT ?1)",
                params![MAX_HISTORY_ROWS],
            )
            .unwrap_or(0) as u64;
        if pruned > 0 {
            self.pruned_rows.fetch_add(pruned, Ordering::SeqCst);
        }
    }

    /// Search recent history: free-text over topic+payload, optional direction.
    ///
    /// Reads fail loudly: a storage error must never render as "no matching
    /// messages", which would send a user chasing a topic that is in fact there.
    pub fn query(&self, search: &str, direction: &str, limit: i64, since_ms: i64, until_ms: i64) -> Result<Vec<HistoryRow>, String> {
        let conn = self.conn.lock().map_err(|_| "history store is unavailable".to_string())?;
        let limit = limit.clamp(1, 2000);
        let like = search_pattern(search);
        let dir_filter = direction == "in" || direction == "out";
        let sql = "SELECT id, topic, payload, payload_b64, payload_len, qos, retain, content_type, direction, ts, properties, truncated \
             FROM messages \
             WHERE (?1 = '' OR topic LIKE ?1 ESCAPE '\\' OR payload LIKE ?1 ESCAPE '\\') \
               AND (?2 = 0 OR direction = ?3) \
               AND ts >= ?5 AND ts <= ?6 \
             ORDER BY ts DESC, rowid DESC LIMIT ?4";
        let mut stmt = conn.prepare(sql).map_err(|e| format!("history query: {e}"))?;
        let rows = stmt
            .query_map(
                params![
                    if search.trim().is_empty() { "" } else { &like },
                    dir_filter as i64,
                    direction,
                    limit,
                    since_ms,
                    until_ms
                ],
                read_history_row,
            );
        let rows = rows
            .map_err(|e| format!("history query: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("history row unreadable: {e}"))?;
        Ok(rows)
    }

    /// One token's life, oldest first: every row whose correlation matches it
    /// exactly, plus the rows that merely mention it in their topic or payload.
    /// The three are kept apart in `matched_by` because they are three different
    /// claims, and a timeline that blends them reads as proof when it is only a
    /// hint.
    pub fn trace(&self, token: &str, limit: i64, since_ms: i64, until_ms: i64) -> Result<TraceResult, String> {
        let token = token.trim();
        if token.is_empty() {
            return Err("a trace needs something to follow".to_string());
        }
        let conn = self.conn.lock().map_err(|_| "history store is unavailable".to_string())?;
        let limit = limit.clamp(1, 2000);
        let like = search_pattern(token);
        let key = token_to_key(token);
        let mut stmt = conn
            .prepare(
                "SELECT id, topic, payload, payload_b64, payload_len, qos, retain, content_type, direction, ts, properties, truncated, \
                 CASE WHEN correlation = ?1 THEN 'correlation' \
                      WHEN topic LIKE ?2 ESCAPE '\\' THEN 'topic' \
                      ELSE 'payload' END \
                 FROM messages \
                 WHERE (correlation = ?1 OR topic LIKE ?2 ESCAPE '\\' OR payload LIKE ?2 ESCAPE '\\') \
                   AND ts >= ?3 AND ts <= ?4 \
                 ORDER BY ts ASC, rowid ASC LIMIT ?5",
            )
            .map_err(|e| format!("history trace: {e}"))?;
        let hits = stmt
            .query_map(params![key, like, since_ms, until_ms, limit], |r| {
                Ok(TraceHit {
                    row: read_history_row(r)?,
                    matched_by: r.get(12)?,
                })
            })
            .map_err(|e| format!("history trace: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("history row unreadable: {e}"))?;
        Ok(TraceResult {
            summary: summarize(&hits, limit as usize),
            hits,
        })
    }

    /// Uses the same text, direction and time predicates as the result list.
    pub fn series(&self, search: &str, direction: &str, bucket_ms: i64, since_ms: i64, until_ms: i64) -> Result<Vec<HistorySeriesPoint>, String> {
        let conn = self.conn.lock().map_err(|_| "history store is unavailable".to_string())?;
        let bucket = bucket_ms.max(1000);
        let like = search_pattern(search);
        let sql = "SELECT (ts / ?1) * ?1 AS b, COUNT(*) FROM messages \
            WHERE ts >= ?2 AND ts <= ?3 \
              AND (?4 = '' OR topic LIKE ?4 ESCAPE '\\' OR payload LIKE ?4 ESCAPE '\\') \
              AND (?5 = 0 OR direction = ?6) GROUP BY b ORDER BY b ASC";
        let mut stmt = conn.prepare(sql).map_err(|e| format!("history chart: {e}"))?;
        let mapper = |r: &rusqlite::Row| -> rusqlite::Result<HistorySeriesPoint> {
            Ok(HistorySeriesPoint { bucket: r.get(0)?, count: r.get(1)? })
        };
        let points = stmt
            .query_map(params![bucket, since_ms, until_ms, like, direction == "in" || direction == "out", direction], mapper)
            .map_err(|e| format!("history chart: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("history chart point unreadable: {e}"));
        points
    }

    pub fn stats(&self) -> HistoryStats {
        let empty = || HistoryStats {
            rows: 0,
            inbound: 0,
            outbound: 0,
            oldest_ts: None,
            newest_ts: None,
            lost_rows: self.lost_rows.load(Ordering::SeqCst),
            retention_days: self.retention_days.load(Ordering::SeqCst),
            pruned_rows: self.pruned_rows.load(Ordering::SeqCst),
        };
        let Ok(conn) = self.conn.lock() else { return empty() };
        // One pass for the three counts. Measured on 50k rows this statement is
        // the difference between ~400 ms and ~130 ms per call, and this runs on
        // every history load and every auto-refresh tick.
        let counts = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(direction = 'in'), 0), COALESCE(SUM(direction = 'out'), 0) FROM messages",
                [],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)),
            )
            .unwrap_or((0, 0, 0));
        let (rows, inbound, outbound) = counts;
        let oldest: Option<i64> = conn
            .query_row("SELECT MIN(ts) FROM messages", [], |r| r.get(0))
            .unwrap_or(None);
        let newest: Option<i64> = conn
            .query_row("SELECT MAX(ts) FROM messages", [], |r| r.get(0))
            .unwrap_or(None);
        HistoryStats {
            rows,
            inbound,
            outbound,
            oldest_ts: oldest,
            newest_ts: newest,
            lost_rows: self.lost_rows.load(Ordering::SeqCst),
            retention_days: self.retention_days.load(Ordering::SeqCst),
            pruned_rows: self.pruned_rows.load(Ordering::SeqCst),
        }
    }

    /// Per-topic totals over a window, busiest first.
    ///
    /// Takes the same text, direction and time predicates as the list and the
    /// chart: a strip that ignores the filter the user is looking at would be a
    /// third, contradictory view of "what is in this window".
    pub fn topics(
        &self,
        search: &str,
        direction: &str,
        since_ms: i64,
        until_ms: i64,
        limit: i64,
    ) -> Result<Vec<HistoryTopicRow>, String> {
        let conn = self.conn.lock().map_err(|_| "history store is unavailable".to_string())?;
        let limit = limit.clamp(1, 200);
        let like = search_pattern(search);
        let dir_filter = direction == "in" || direction == "out";
        let sql = "SELECT topic, COUNT(*), \
                      SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END), \
                      SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END), \
                      COALESCE(SUM(payload_len), 0), MIN(ts), MAX(ts) \
                   FROM messages \
                   WHERE (?1 = '' OR topic LIKE ?1 ESCAPE '\\' OR payload LIKE ?1 ESCAPE '\\') \
                     AND (?2 = 0 OR direction = ?3) \
                     AND ts >= ?4 AND ts <= ?5 \
                   GROUP BY topic ORDER BY COUNT(*) DESC LIMIT ?6";
        let mut stmt = conn.prepare(sql).map_err(|e| format!("history topics: {e}"))?;
        let rows = stmt
            .query_map(
                params![
                    if search.trim().is_empty() { "" } else { &like },
                    dir_filter as i64,
                    direction,
                    since_ms,
                    until_ms,
                    limit
                ],
                |r| {
                    Ok(HistoryTopicRow {
                        topic: r.get(0)?,
                        count: r.get(1)?,
                        inbound: r.get(2)?,
                        outbound: r.get(3)?,
                        bytes: r.get(4)?,
                        first_ts: r.get(5)?,
                        last_ts: r.get(6)?,
                    })
                })
            .map_err(|e| format!("history topics: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("history topic unreadable: {e}"))?;
        Ok(rows)
    }

    /// The retained value of each topic, plus every version of it this store holds.
    ///
    /// `now_ms` comes in rather than being read from a clock so the staleness
    /// judgement is testable and cannot disagree between two rows of one result.
    pub fn retained(
        &self,
        search: &str,
        limit: i64,
        now_ms: i64,
        stale_after_ms: i64,
    ) -> Result<Vec<RetainedLineage>, String> {
        let conn = self.conn.lock().map_err(|_| "history store is unavailable".to_string())?;
        let limit = limit.clamp(1, 200);
        let like = search_pattern(search);
        // The frame is written out because the default (UNBOUNDED PRECEDING to
        // CURRENT ROW) would make these running totals over the rows above each
        // row rather than counts of the whole topic -- and the newest row is the
        // one row this query keeps.
        let sql = "WITH kept AS ( \
               SELECT topic, payload, payload_b64, payload_len, truncated, ts, \
                      COUNT(*)  OVER w AS versions, \
                      MIN(ts)   OVER w AS first_ts, \
                      MAX(ts)   OVER w AS last_ts, \
                      ROW_NUMBER() OVER (PARTITION BY topic ORDER BY ts DESC, rowid DESC) AS newest \
                 FROM messages \
                WHERE retain = 1 AND direction = 'in' \
                  AND (?1 = '' OR topic LIKE ?1 ESCAPE '\\' OR payload LIKE ?1 ESCAPE '\\') \
                WINDOW w AS (PARTITION BY topic ORDER BY ts DESC, rowid DESC \
                             ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) \
             ) \
             SELECT topic, versions, first_ts, last_ts, payload, payload_b64, payload_len, truncated \
               FROM kept WHERE newest = 1 \
              ORDER BY last_ts DESC, topic ASC LIMIT ?2";
        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| format!("history retained: {e}"))?;
        let stale_after_ms = stale_after_ms.max(0);
        let rows = stmt
            .query_map(
                params![if search.trim().is_empty() { "" } else { &like }, limit],
                |r| {
                    let last_ts: i64 = r.get(3)?;
                    let payload_len: i64 = r.get(6)?;
                    let truncated: i64 = r.get(7)?;
                    Ok(RetainedLineage {
                        topic: r.get(0)?,
                        versions: r.get(1)?,
                        first_ts: r.get(2)?,
                        last_ts,
                        payload: r.get(4)?,
                        payload_b64: r.get(5)?,
                        payload_len: payload_len as usize,
                        truncated: truncated != 0,
                        // An empty retained publish deletes the value; there is no
                        // live retained payload left to go stale.
                        cleared: payload_len == 0,
                        stale: payload_len != 0
                            && now_ms.saturating_sub(last_ts) >= stale_after_ms,
                    })
                },
            )
            .map_err(|e| format!("history retained: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("history retained row unreadable: {e}"))?;
        Ok(rows)
    }

    /// Activity segments per topic prefix over a window.
    ///
    /// "How many times did this gateway drop off last night, and for how long" is
    /// a shape question, and paging a list of rows to answer it is how it goes
    /// unanswered. Everything here is inferred from traffic we actually stored: a
    /// device we were never subscribed to, or were disconnected from, is silent on
    /// this chart rather than absent — which is why the view states its threshold.
    pub fn timeline(
        &self,
        search: &str,
        since_ms: i64,
        until_ms: i64,
        depth: i64,
        gap_ms: i64,
        max_entities: i64,
    ) -> Result<TimelineResult, String> {
        let conn = self.conn.lock().map_err(|_| "history store is unavailable".to_string())?;
        let depth = depth.clamp(1, 4);
        let gap_ms = gap_ms.max(1_000);
        let max_entities = max_entities.clamp(1, 100);
        let like = search_pattern(search);
        // Topic only: a payload match does not identify who to draw a row for.
        let sql = "SELECT topic, ts, direction, correlation, \
                     CASE WHEN properties IS NULL THEN '' \
                          ELSE COALESCE(json_extract(properties, '$.responseTopic'), '') END \
                   FROM messages \
                   WHERE (?1 = '' OR topic LIKE ?1 ESCAPE '\\') AND ts >= ?2 AND ts <= ?3 \
                   ORDER BY ts ASC LIMIT ?4";
        let mut stmt = conn.prepare(sql).map_err(|e| format!("history timeline: {e}"))?;
        let rows = stmt
            .query_map(
                params![
                    if search.trim().is_empty() { "" } else { &like },
                    since_ms,
                    until_ms,
                    TIMELINE_ROW_CAP
                ],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, String>(4)?,
                    ))
                },
            )
            .map_err(|e| format!("history timeline: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("history timeline unreadable: {e}"))?;
        drop(stmt);

        let rows_scanned = rows.len() as i64;
        // An answer is any inbound row carrying correlation bytes; pairing is by
        // those bytes, so a reply on an unrelated topic still counts.
        let mut first_reply: HashMap<String, i64> = HashMap::new();
        for (_, ts, direction, correlation, _) in &rows {
            if direction != "in" {
                continue;
            }
            let Some(key) = correlation.as_deref().map(str::trim).filter(|c| !c.is_empty()) else {
                continue;
            };
            first_reply.entry(key.to_ascii_lowercase()).or_insert(*ts);
        }

        let mut grouped: HashMap<String, Vec<TimelinePoint>> = HashMap::new();
        for (topic, ts, direction, correlation, resp_topic) in &rows {
            grouped
                .entry(entity_of(topic, depth))
                .or_default()
                .push((*ts, direction.clone(), correlation.clone(), resp_topic.clone()));
        }

        let mut entities: Vec<TimelineEntity> = Vec::new();
        for (entity, mut points) in grouped {
            points.sort_by_key(|p| p.0);
            let mut segments: Vec<TimelineSegment> = Vec::new();
            for (ts, _, _, _) in &points {
                match segments.last_mut() {
                    Some(last) if *ts - last.end_ms <= gap_ms => {
                        last.end_ms = *ts;
                        last.messages += 1;
                    }
                    _ => segments.push(TimelineSegment { start_ms: *ts, end_ms: *ts, messages: 1 }),
                }
            }
            let longest_gap_ms = segments
                .windows(2)
                .map(|w| w[1].start_ms - w[0].end_ms)
                .max()
                .unwrap_or(0);
            let mut marks: Vec<TimelineMark> = points
                .iter()
                .filter(|(_, direction, _, resp)| *direction == "out" && !resp.is_empty())
                .map(|(ts, topic, correlation, _)| {
                    let rtt = correlation
                        .as_deref()
                        .map(str::trim)
                        .filter(|c| !c.is_empty())
                        .and_then(|c| first_reply.get(&c.to_ascii_lowercase()))
                        .map(|reply| reply - ts)
                        .filter(|rtt| *rtt >= 0);
                    TimelineMark {
                        ts_ms: *ts,
                        topic: topic.clone(),
                        correlation: correlation.clone(),
                        answered: rtt.is_some(),
                        rtt_ms: rtt,
                    }
                })
                .collect();
            marks.truncate(TIMELINE_MARK_CAP);
            entities.push(TimelineEntity {
                messages: points.len() as i64,
                first_ms: points.first().map(|p| p.0).unwrap_or(0),
                last_ms: points.last().map(|p| p.0).unwrap_or(0),
                longest_gap_ms,
                entity,
                segments,
                marks,
            });
        }
        entities.sort_by(|a, b| b.messages.cmp(&a.messages).then_with(|| a.entity.cmp(&b.entity)));
        let entities_dropped = entities.len().saturating_sub(max_entities as usize);
        entities.truncate(max_entities as usize);

        Ok(TimelineResult {
            entities,
            window_start_ms: since_ms,
            window_end_ms: until_ms,
            gap_ms,
            depth,
            entities_dropped,
            rows_scanned,
            truncated: rows_scanned >= TIMELINE_ROW_CAP,
        })
    }

    pub fn clear(&self) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute("DELETE FROM messages", []);
        }
    }
}

fn read_retention(conn: &Connection) -> i64 {
    conn.query_row("SELECT value FROM settings WHERE key = 'retention_days'", [], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(DEFAULT_RETENTION_DAYS)
}

fn write_retention(conn: &Connection, days: i64) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('retention_days', ?1)",
        params![days.to_string()],
    );
}

/// Reads the twelve storage columns every list query selects. The history list
/// and the trace need the same row, and two copies of this mapping is how one of
/// them eventually starts lying about `truncated`.
fn read_history_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryRow> {
    let payload_base64: String = r.get(3)?;
    let payload_len = r.get::<_, i64>(4)? as usize;
    let truncated = r.get::<_, bool>(11)?
        || base64::engine::general_purpose::STANDARD
            .decode(&payload_base64)
            .map(|bytes| bytes.len() != payload_len)
            .unwrap_or(true);
    Ok(HistoryRow {
        id: r.get(0)?,
        topic: r.get(1)?,
        payload: r.get(2)?,
        payload_base64,
        payload_len,
        qos: r.get::<_, i64>(5)? as u8,
        retain: r.get::<_, i64>(6)? != 0,
        content_type: r.get(7)?,
        properties: serde_json::from_str(&r.get::<_, String>(10)?).unwrap_or_default(),
        truncated,
        direction: r.get(8)?,
        ts: r.get(9)?,
    })
}

/// The counts the trace panel quotes, derived here so they describe what the
/// store found rather than what the UI decided to draw.
fn summarize(hits: &[TraceHit], limit: usize) -> TraceSummary {
    let mut topics: Vec<String> = Vec::new();
    let mut correlations: Vec<String> = Vec::new();
    let mut inbound = 0;
    let mut outbound = 0;
    for hit in hits {
        if !topics.contains(&hit.row.topic) {
            topics.push(hit.row.topic.clone());
        }
        if let Some(key) = correlation_key(
            hit.row.properties.correlation_hex.as_deref(),
            hit.row.properties.correlation_data.as_deref(),
        ) {
            if !correlations.contains(&key) {
                correlations.push(key);
            }
        }
        match hit.row.direction.as_str() {
            "in" => inbound += 1,
            "out" => outbound += 1,
            _ => {}
        }
    }
    TraceSummary {
        count: hits.len(),
        topics,
        first_ms: hits.first().map(|h| h.row.ts),
        last_ms: hits.last().map(|h| h.row.ts),
        inbound,
        outbound,
        correlations,
        truncated: hits.len() >= limit,
    }
}

fn search_pattern(search: &str) -> String {
    let search = search.trim();
    if search.is_empty() { return String::new(); }
    format!("%{}%", search.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::MqttGenericMessage;

    fn msg(id: &str, topic: &str, payload: &str, dir: &str) -> MqttGenericMessage {
        MqttGenericMessage {
            id: id.to_string(),
            topic: topic.to_string(),
            payload: payload.to_string(),
            payload_len: payload.len(),
            payload_base64: base64::engine::general_purpose::STANDARD.encode(payload),
            truncated: false,
            content_type: None,
            user_properties: Vec::new(),
            payload_format: None,
            response_topic: None,
            correlation_data: None,
            correlation_hex: None,
            matched_filters: Vec::new(),
            subscription_ids: Vec::new(),
            qos: 1,
            retain: false,
            timestamp: String::new(),
            timestamp_ms: 0,
            direction: dir.to_string(),
            assertion: None,
        }
    }

    fn temp_store(name: &str) -> (HistoryStore, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("dropqtt_hist_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("h.db");
        let store = HistoryStore::open(&path).expect("open");
        (store, path)
    }

    /// A message carrying its own timestamp, which is what the age policy judges.
    fn msg_at(id: &str, topic: &str, payload: &str, dir: &str, ts: i64) -> MqttGenericMessage {
        let mut m = msg(id, topic, payload, dir);
        m.timestamp_ms = ts;
        m
    }

    /// A retained publish: the only shape a broker keeps on behalf of later
    /// subscribers, and therefore the only one that has a history worth reading.
    fn kept_at(id: &str, topic: &str, payload: &str, dir: &str, ts: i64) -> MqttGenericMessage {
        let mut m = msg_at(id, topic, payload, dir, ts);
        m.retain = true;
        m
    }

    #[test]
    fn retained_shows_the_newest_value_and_counts_every_version_of_it() {
        let (store, _) = temp_store("retained_versions");
        store.append(&[
            kept_at("a1", "cfg/gw1/mode", "auto", "in", 1_000),
            kept_at("a2", "cfg/gw1/mode", "manual", "in", 2_000),
            kept_at("a3", "cfg/gw1/mode", "eco", "in", 3_000),
            // The same instant twice. Insertion order decides which is newest, and
            // guessing wrong here would present a superseded value as the current one.
            kept_at("b1", "cfg/gw2/mode", "first", "in", 5_000),
            kept_at("b2", "cfg/gw2/mode", "second", "in", 5_000),
            // Not retained values: one is our own publish, one the broker forgets.
            kept_at("c1", "cfg/gw3/mode", "ours", "out", 9_000),
            msg_at("c2", "cfg/gw4/mode", "ephemeral", "in", 9_500),
        ]);
        let rows = store.retained("", 50, 10_000, 1_000).unwrap();
        let by = |t: &str| rows.iter().find(|r| r.topic == t).cloned();

        let gw1 = by("cfg/gw1/mode").expect("three retained versions of one topic");
        assert_eq!(gw1.payload, "eco", "the newest replacement is the live value");
        assert_eq!(gw1.versions, 3);
        assert_eq!((gw1.first_ts, gw1.last_ts), (1_000, 3_000));
        assert_eq!(by("cfg/gw2/mode").map(|r| r.payload).as_deref(), Some("second"));
        assert!(by("cfg/gw3/mode").is_none(), "our own outbound publish is not the broker's retained value");
        assert!(by("cfg/gw4/mode").is_none(), "a publish without RETAIN is never a retained value");
    }

    #[test]
    fn an_empty_retained_publish_is_a_deletion_and_ends_the_lineage() {
        // MQTT deletes a retained value by publishing zero bytes with RETAIN set.
        // Reading that as "the value is empty" would leave the last row of the
        // timeline looking like a device that stopped saying anything.
        let (store, _) = temp_store("retained_cleared");
        store.append(&[
            kept_at("v1", "cfg/gw1/mode", "auto", "in", 1_000),
            kept_at("gone", "cfg/gw1/mode", "", "in", 9_000),
        ]);
        let row = store
            .retained("", 50, 100_000, 1_000)
            .unwrap()
            .into_iter()
            .find(|r| r.topic == "cfg/gw1/mode")
            .expect("the topic keeps a lineage after deletion");
        assert!(row.cleared, "an empty retained publish removes the value");
        assert_eq!(row.payload_len, 0);
        assert!(!row.stale, "there is no live retained value left to go stale");
        assert_eq!(row.versions, 2, "both the value and its deletion are versions");
        assert_eq!(row.last_ts, 9_000, "the deletion is the newest fact about it");

        // A value that comes back is no longer a deletion.
        store.append(&[kept_at("v2", "cfg/gw1/mode", "manual", "in", 20_000)]);
        let again = store
            .retained("", 50, 21_000, 1_000)
            .unwrap()
            .into_iter()
            .find(|r| r.topic == "cfg/gw1/mode")
            .unwrap();
        assert!(!again.cleared);
        assert_eq!(again.payload, "manual");
    }

    #[test]
    fn staleness_is_measured_on_the_callers_clock_against_the_callers_bar() {
        let (store, _) = temp_store("retained_stale");
        store.append(&[
            kept_at("old", "cfg/legacy", "set-once", "in", 1_000),
            kept_at("fresh", "cfg/current", "recent", "in", 9_500),
        ]);
        let rows = store.retained("", 50, 10_000, 1_000).unwrap();
        let old = rows.iter().find(|r| r.topic == "cfg/legacy").unwrap();
        let fresh = rows.iter().find(|r| r.topic == "cfg/current").unwrap();
        // 9_000 ms of age against a 1_000 ms bar, and 500 ms against the same bar:
        // the boundary is inclusive, so exactly-at-bar counts as stale.
        assert!(old.stale, "a retained value this old still reaches new subscribers");
        assert!(!fresh.stale, "500ms old is inside the bar");
        assert_eq!(old.last_ts, 1_000);

        // Raising the bar is the whole difference between a nuisance and a report.
        let generous = store.retained("", 50, 10_000, 60_000).unwrap();
        assert!(!generous.iter().find(|r| r.topic == "cfg/legacy").unwrap().stale);

        // A value stored truncated is a partial value: the row has to say so rather
        // than let someone diff against a payload that was cut on the way in.
        let mut cut = kept_at("cut", "cfg/big", "prefix…", "in", 9_600);
        cut.truncated = true;
        cut.payload_len = 4_000_000;
        store.append(&[cut]);
        let rows = store.retained("", 50, 10_000, 1_000).unwrap();
        let big = rows.iter().find(|r| r.topic == "cfg/big").unwrap();
        assert!(big.truncated);
        assert_eq!(big.payload_len, 4_000_000, "the real length survives the cut display");
    }

    #[test]
    fn retained_narrows_with_the_filter_and_respects_the_row_budget() {
        let (store, _) = temp_store("retained_scope");
        for i in 0..12 {
            store.append(&[kept_at(
                &format!("t{i}"),
                &format!("cfg/node{i}/mode"),
                &format!("v{i}"),
                "in",
                1_000 + i as i64 * 100,
            )]);
        }
        let all = store.retained("", 200, 5_000, 1_000).unwrap();
        assert_eq!(all.len(), 12);
        assert_eq!(all[0].topic, "cfg/node11/mode", "newest lineage first");

        let few = store.retained("", 4, 5_000, 1_000).unwrap();
        assert_eq!(few.len(), 4, "the budget is a promise, not a suggestion");

        let one = store.retained("cfg/node3/mode", 200, 5_000, 1_000).unwrap();
        assert_eq!(one.iter().map(|r| r.topic.as_str()).collect::<Vec<_>>(), vec!["cfg/node3/mode"]);
        // A `%` in the search box means percent-sign-in-a-topic, not "everything".
        assert!(store.retained("cfg/%", 200, 5_000, 1_000).unwrap().is_empty());
    }

    #[test]
    fn topics_aggregates_per_topic_over_the_window() {
        let (store, _) = temp_store("topics");
        let now = now_ms();
        store.append(&[
            msg_at("1", "device/a", "x", "in", now),
            msg_at("2", "device/a", "yyyy", "out", now),
            msg_at("3", "device/b", "z", "in", now - 60_000),
        ]);
        let rows = store.topics("", "all", 0, i64::MAX, 20).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].topic, "device/a", "busiest first");
        assert_eq!(rows[0].count, 2);
        assert_eq!((rows[0].inbound, rows[0].outbound), (1, 1));
        assert_eq!(rows[0].bytes, 5, "payload lengths, not row counts");
        assert_eq!(rows[0].first_ts, now, "both of a's rows are at `now`");
        let b = rows.iter().find(|r| r.topic == "device/b").expect("b present");
        assert_eq!(b.last_ts - b.first_ts, 0, "one row spans no time at all");
        // A window that ends before the older row must not see it.
        let late = store.topics("", "all", now - 1_000, i64::MAX, 20).unwrap();
        assert_eq!(late.iter().find(|r| r.topic == "device/b").map(|r| r.count), None);
        // The text filter narrows the strip exactly as it narrows the list.
        let only_a = store.topics("device/a", "all", 0, i64::MAX, 20).unwrap();
        assert_eq!(
            only_a.iter().map(|r| r.topic.as_str()).collect::<Vec<_>>(),
            vec!["device/a"]
        );
        let outs = store.topics("", "out", 0, i64::MAX, 20).unwrap();
        assert_eq!(outs.iter().find(|r| r.topic == "device/a").map(|r| r.count), Some(1));
    }

    #[test]
    fn age_policy_prunes_only_what_is_older_than_it() {
        let (store, _) = temp_store("retention");
        let now = now_ms();
        store.append(&[
            msg_at("old", "device/old", "x", "in", now - 10 * 86_400_000),
            msg_at("new", "device/new", "y", "in", now - 3_600_000),
        ]);
        assert_eq!(store.stats().rows, 2);
        assert_eq!(store.stats().retention_days, DEFAULT_RETENTION_DAYS);

        store.set_retention_days(5).unwrap();
        let stats = store.stats();
        assert_eq!(stats.rows, 1, "the ten-day-old row is gone");
        assert_eq!(stats.retention_days, 5);
        assert_eq!(stats.pruned_rows, 1, "pruning is counted, not silent");
        assert_eq!(
            store.query("", "all", 10, 0, i64::MAX).unwrap()[0].topic,
            "device/new"
        );
    }

    #[test]
    fn turning_the_age_policy_off_back_does_not_resurrect_or_evict() {
        let (store, _) = temp_store("retention_off");
        let now = now_ms();
        store.append(&[msg_at("ancient", "device/a", "x", "in", now - 400 * 86_400_000)]);
        store.set_retention_days(30).unwrap();
        assert_eq!(store.stats().rows, 0, "400 days old is past any sane policy");
        store.set_retention_days(0).unwrap();
        assert_eq!(store.stats().rows, 0, "0 means stop pruning, not delete more");
        assert_eq!(store.retention_days(), 0);
    }

    #[test]
    fn the_age_policy_survives_reopening_the_store() {
        // A restart that quietly reset retention would keep history the operator
        // asked to discard, or worse, start discarding what they asked to keep.
        let (store, path) = temp_store("retention_persist");
        store.set_retention_days(14).unwrap();
        drop(store);
        let reopened = HistoryStore::open(&path).expect("reopen");
        assert_eq!(reopened.retention_days(), 14);
    }

    #[test]
    fn an_absurd_retention_is_clamped_not_rejected() {
        let (store, _) = temp_store("retention_clamp");
        store.set_retention_days(999_999).unwrap();
        assert_eq!(store.retention_days(), MAX_RETENTION_DAYS);
        store.set_retention_days(-5).unwrap();
        assert_eq!(store.retention_days(), 0, "negative means no age limit");
    }

    #[test]
    fn append_query_series_stats_clear() {
        let dir = std::env::temp_dir().join(format!("dropqtt_hist_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = HistoryStore::open(&dir.join("h.db")).expect("open");

        store.append(&[
            msg("1", "sensor/a", "hello", "in"),
            msg("2", "sensor/b", "world", "out"),
            msg("3", "sensor/a", "again", "in"),
        ]);

        let all = store.query("", "all", 100, 0, i64::MAX).unwrap();
        assert_eq!(all.len(), 3);

        // Topic substring search
        let only_a = store.query("sensor/a", "all", 100, 0, i64::MAX).unwrap();
        assert_eq!(only_a.len(), 2);
        // Direction filter
        let outs = store.query("", "out", 100, 0, i64::MAX).unwrap();
        assert_eq!(outs.len(), 1);
        assert_eq!(outs[0].topic, "sensor/b");

        // Payload text search
        let by_payload = store.query("world", "all", 100, 0, i64::MAX).unwrap();
        assert_eq!(by_payload.len(), 1);

        let stats = store.stats();
        assert_eq!(stats.rows, 3);
        assert_eq!(stats.inbound, 2);
        assert_eq!(stats.outbound, 1);
        assert!(stats.newest_ts.is_some());

        // Series over a wide window returns at least one bucket totaling 3
        let since = stats.oldest_ts.unwrap() - 1000;
        let series = store.series("", "all", 1000, since, i64::MAX).unwrap();
        assert_eq!(series.iter().map(|p| p.count).sum::<i64>(), 3);

        store.clear();
        assert_eq!(store.stats().rows, 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn append_preserves_message_timestamp_ms() {
        let dir = std::env::temp_dir().join(format!("dropqtt_hist_ts_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = HistoryStore::open(&dir.join("h.db")).expect("open");
        let mut first = msg("ts-1", "sensor/a", "one", "in");
        first.timestamp_ms = 1_700_000_000_123;
        let mut second = msg("ts-2", "sensor/a", "two", "in");
        second.timestamp_ms = 1_700_000_000_456;
        store.append(&[first, second]);

        let rows = store.query("sensor/a", "all", 10, 0, i64::MAX).unwrap();
        assert_eq!(rows[0].ts, 1_700_000_000_456);
        assert_eq!(rows[1].ts, 1_700_000_000_123);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn filters_match_chart_and_treat_sql_wildcards_literally() {
        let store = HistoryStore::open(std::path::Path::new(":memory:")).unwrap();
        let mut messages = vec![
            msg("1", "sensor/a", "load_50%", "in"),
            msg("2", "sensor/b", "load_50%", "out"),
            msg("3", "sensor/c", "loadX500", "in"),
            msg("4", "sensor/d", "load_50%", "in"),
        ];
        for (i, m) in messages.iter_mut().enumerate() { m.timestamp_ms = (i as i64 + 1) * 1000; }
        store.append(&messages);
        let rows = store.query("load_50%", "in", 100, 1000, 3000).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "1");
        let series = store.series("load_50%", "in", 1000, 1000, 3000).unwrap();
        assert_eq!(series.iter().map(|p| p.count).sum::<i64>(), rows.len() as i64);
    }

    /// v0.9 shipped without `properties` / `truncated`. Upgrading in place must
    /// keep every existing capture readable and stay idempotent across restarts.
    #[test]
    fn legacy_database_is_migrated_without_losing_rows() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("dropqtt-hist-{}-{}", std::process::id(), nonce));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("history.sqlite");
        let legacy_b64 = base64::engine::general_purpose::STANDARD.encode("legacy");

        {
            let conn = Connection::open(&file).unwrap();
            conn.execute(
                "CREATE TABLE messages (
                    id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload TEXT NOT NULL,
                    payload_b64 TEXT NOT NULL, payload_len INTEGER NOT NULL,
                    qos INTEGER NOT NULL, retain INTEGER NOT NULL, content_type TEXT,
                    direction TEXT NOT NULL, ts INTEGER NOT NULL)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO messages VALUES ('legacy1','sensor/old','legacy',?1,6,1,0,NULL,'in',1000)",
                params![legacy_b64],
            )
            .unwrap();
        }

        {
            let store = HistoryStore::open(&file).unwrap();
            let rows = store.query("", "all", 100, 0, i64::MAX).unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].id, "legacy1");
            assert!(!rows[0].truncated, "intact legacy payload must stay replayable");
            assert!(rows[0].properties.user_properties.is_empty());
            let mut fresh = msg("new1", "sensor/new", "fresh", "out");
            fresh.response_topic = Some("sensor/new/reply".into());
            store.append(&[fresh]);
        }

        // Reopening runs the migration again; it must not error or duplicate.
        let store = HistoryStore::open(&file).unwrap();
        let rows = store.query("", "all", 100, 0, i64::MAX).unwrap();
        assert_eq!(rows.len(), 2);
        let fresh = rows.iter().find(|r| r.id == "new1").unwrap();
        assert_eq!(fresh.properties.response_topic.as_deref(), Some("sensor/new/reply"));
        assert!(rows.iter().any(|r| r.id == "legacy1"));

        // Windows refuses to delete a file that is still open.
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The whole point of the Result refactor: a broken store must not look
    /// like "no messages matched", or the user goes hunting for a topic that
    /// is actually there.
    #[test]
    fn storage_failure_is_not_reported_as_empty_results() {
        let store = HistoryStore::open(std::path::Path::new(":memory:")).unwrap();
        store.append(&[msg("1", "sensor/a", "hello", "in")]);
        assert_eq!(store.query("", "all", 100, 0, i64::MAX).unwrap().len(), 1);

        {
            let conn = store.conn.lock().unwrap();
            conn.execute_batch("DROP TABLE messages").unwrap();
        }
        assert!(store.query("", "all", 100, 0, i64::MAX).is_err());
        assert!(store.series("", "all", 1000, 0, i64::MAX).is_err());

        // The write path stays lenient, but it must not stay silent: the rows it
        // could not persist have to be countable afterwards.
        assert_eq!(store.stats().lost_rows, 0, "successful writes lose nothing");
        store.append(&[
            msg("2", "sensor/a", "x", "in"),
            msg("3", "sensor/b", "y", "out"),
        ]);
        assert_eq!(store.stats().lost_rows, 2);
    }

    #[test]
    fn history_preserves_properties_and_detects_incomplete_payloads() {
        let store = HistoryStore::open(std::path::Path::new(":memory:")).unwrap();
        let mut full = msg("full", "rpc/request", "hello", "in");
        full.response_topic = Some("rpc/response".into());
        full.correlation_data = Some("request-42".into());
        full.user_properties = vec![("device".into(), "edge-1".into())];
        let mut partial = msg("partial", "large", "prefix", "in");
        partial.payload_len = 100_000; // Legacy records did not store a truncation flag.
        let empty = msg("empty", "retained/clear", "", "out");
        store.append(&[full, partial, empty]);
        let rows = store.query("", "all", 100, 0, i64::MAX).unwrap();
        let full = rows.iter().find(|r| r.id == "full").unwrap();
        assert_eq!(full.properties.response_topic.as_deref(), Some("rpc/response"));
        assert_eq!(full.properties.correlation_data.as_deref(), Some("request-42"));
        assert_eq!(full.properties.user_properties, vec![("device".into(), "edge-1".into())]);
        assert!(!full.truncated);
        assert!(rows.iter().find(|r| r.id == "partial").unwrap().truncated);
        assert!(!rows.iter().find(|r| r.id == "empty").unwrap().truncated);
    }

    #[test]
    fn the_same_bytes_give_one_key_whether_text_or_hex() {
        assert_eq!(correlation_key(None, Some("c-7")).as_deref(), Some("632d37"));
        assert_eq!(
            correlation_key(Some("632D37"), None).as_deref(),
            Some("632d37"),
            "hex is normalised so a stored value and a typed one meet"
        );
        // Binary correlation has no usable text form; the hex is the only truth.
        assert_eq!(correlation_key(Some("00ff"), Some("")).as_deref(), Some("00ff"));
        assert_eq!(correlation_key(None, None), None);
        assert_eq!(correlation_key(Some(""), Some("   ")), None);
        assert_eq!(token_to_key("c-7"), token_to_key("632d37"));
        assert_eq!(token_to_key(" 632D37 "), "632d37");
    }

    #[test]
    fn a_trace_follows_one_request_across_topics_and_directions() {
        let (store, path) = temp_store("trace");
        let mut request = msg_at("r1", "lab/rpc/req", "{\"cmd\":\"ping\"}", "out", 1_000);
        request.correlation_data = Some("c-7".into());
        request.response_topic = Some("lab/rpc/reply".into());
        let mut reply = msg_at("r2", "lab/rpc/reply", "{\"pong\":true}", "in", 2_500);
        reply.correlation_hex = Some("632d37".into());
        let unrelated = msg_at("r3", "lab/other", "hello", "in", 3_000);
        store.append(&[request, reply, unrelated]);

        let trace = store.trace("c-7", 50, 0, i64::MAX).unwrap();
        assert_eq!(trace.hits.len(), 2, "only the rows carrying the correlation");
        assert_eq!(trace.hits[0].row.id, "r1", "a life story is read forward");
        assert_eq!(trace.hits[1].row.id, "r2");
        assert!(trace.hits.iter().all(|h| h.matched_by == "correlation"));
        let summary = &trace.summary;
        assert_eq!(summary.topics, vec!["lab/rpc/req".to_string(), "lab/rpc/reply".to_string()]);
        assert_eq!((summary.inbound, summary.outbound), (1, 1));
        assert_eq!((summary.first_ms, summary.last_ms), (Some(1_000), Some(2_500)));
        assert_eq!(summary.correlations, vec!["632d37".to_string()], "one request, not two blended");
        assert!(!summary.truncated);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_trace_says_how_each_row_joined_it() {
        let (store, path) = temp_store("trace-why");
        let by_topic = msg_at("t1", "devices/edge-7/state", "{}", "in", 1_000);
        let by_payload = msg_at("t2", "archive/all", "reported by edge-7", "in", 2_000);
        let mut by_corr = msg_at("t3", "elsewhere", "nothing", "out", 3_000);
        by_corr.correlation_data = Some("edge-7".into());
        store.append(&[by_topic, by_payload, by_corr]);

        let trace = store.trace("edge-7", 50, 0, i64::MAX).unwrap();
        let why: Vec<(&str, &str)> = trace
            .hits
            .iter()
            .map(|h| (h.row.id.as_str(), h.matched_by.as_str()))
            .collect();
        assert_eq!(why, vec![("t1", "topic"), ("t2", "payload"), ("t3", "correlation")]);
        // Only the third row is the same message; the other two merely mention it.
        assert_eq!(trace.summary.correlations, vec!["656467652d37".to_string()]);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn rows_recorded_before_the_correlation_column_are_still_traceable() {
        let dir = std::env::temp_dir().join(format!("dropqtt_hist_oldcorr_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("h.db");
        {
            let conn = Connection::open(&path).expect("create");
            // The exact pre-correlation schema: the key exists only inside the
            // properties JSON of these rows.
            conn.execute_batch(
                "CREATE TABLE messages (
                    id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload TEXT NOT NULL,
                    payload_b64 TEXT NOT NULL, payload_len INTEGER NOT NULL, qos INTEGER NOT NULL,
                    retain INTEGER NOT NULL, content_type TEXT, direction TEXT NOT NULL,
                    ts INTEGER NOT NULL, properties TEXT NOT NULL DEFAULT '{}',
                    truncated INTEGER NOT NULL DEFAULT 0
                 );",
            )
            .expect("old schema");
            for (id, topic, ts, props) in [
                ("old", "lab/req", 5_000, r#"{"correlationData":"c-7"}"#),
                ("oldbin", "lab/reply", 6_000, r#"{"correlationHex":"00FF"}"#),
                ("plain", "lab/other", 7_000, "{}"),
            ] {
                conn.execute(
                    "INSERT INTO messages (id, topic, payload, payload_b64, payload_len, qos, retain, content_type, direction, ts, properties, truncated)
                     VALUES (?1, ?2, 'x', 'eA==', 1, 1, 0, NULL, 'out', ?3, ?4, 0)",
                    params![id, topic, ts, props],
                )
                .expect("seed row");
            }
        }
        let store = HistoryStore::open(&path).expect("opening migrates and backfills");
        let text = store.trace("c-7", 50, 0, i64::MAX).unwrap();
        assert_eq!(text.hits.len(), 1, "the recovered key matches the typed correlation");
        assert_eq!(text.hits[0].matched_by, "correlation");
        // Uppercase hex on disk is normalised, so a pasted lowercase value finds it.
        let binary = store.trace("00ff", 50, 0, i64::MAX).unwrap();
        assert_eq!(binary.hits.iter().map(|h| h.row.id.as_str()).collect::<Vec<_>>(), vec!["oldbin"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_trace_says_when_it_stopped_short() {
        let (store, path) = temp_store("trace-limit");
        let batch: Vec<MqttGenericMessage> = (0..5)
            .map(|i| {
                let mut m = msg_at(format!("m{i}").as_str(), "lab/req", "{}", "out", 1_000 + i);
                m.correlation_data = Some("burst".into());
                m
            })
            .collect();
        store.append(&batch);
        let trace = store.trace("burst", 2, 0, i64::MAX).unwrap();
        assert_eq!(trace.summary.count, 2);
        assert!(trace.summary.truncated, "five matched, two were returned");
        assert_eq!(store.trace("   ", 10, 0, i64::MAX).err().unwrap(), "a trace needs something to follow");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_silence_past_the_threshold_splits_one_device_into_two_segments() {
        let (store, path) = temp_store("timeline-gap");
        store.append(&[
            msg_at("1", "devices/gw-7/telemetry", "{}", "in", 1_000),
            msg_at("2", "devices/gw-7/telemetry", "{}", "in", 2_000),
            // 88 s of nothing, which at a 30 s threshold is a dropout, not a gap.
            msg_at("3", "devices/gw-7/telemetry", "{}", "in", 90_000),
        ]);
        let tl = store.timeline("", 0, i64::MAX, 2, 30_000, 24).unwrap();
        assert_eq!(tl.entities.len(), 1);
        let one = &tl.entities[0];
        assert_eq!(one.entity, "devices/gw-7");
        assert_eq!(one.messages, 3);
        assert_eq!(
            one.segments.iter().map(|s| (s.start_ms, s.end_ms, s.messages)).collect::<Vec<_>>(),
            vec![(1_000, 2_000, 2), (90_000, 90_000, 1)],
            "the third message starts a new stretch"
        );
        assert_eq!(one.longest_gap_ms, 88_000);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn depth_decides_the_row_and_a_topic_shorter_than_it_stands_alone() {
        let (store, path) = temp_store("timeline-depth");
        store.append(&[
            msg_at("1", "devices/gw-7/telemetry", "{}", "in", 1_000),
            msg_at("2", "devices/gw-7/status", "{}", "in", 1_500),
            msg_at("3", "alerts", "{}", "in", 1_600),
        ]);
        let deep = store.timeline("", 0, i64::MAX, 2, 30_000, 24).unwrap();
        assert_eq!(deep.entities.iter().map(|e| e.entity.as_str()).collect::<Vec<_>>(), vec!["devices/gw-7", "alerts"], "the two-level topics merge, and a topic shorter than the depth keeps its own name");
        assert_eq!(deep.entities[0].messages, 2, "busiest row first");
        let shallow = store.timeline("alerts", 0, i64::MAX, 1, 30_000, 24).unwrap();
        assert_eq!(shallow.entities[0].entity, "alerts", "one level groups by first segment");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_request_is_answered_only_when_the_correlation_bytes_come_back() {
        let (store, path) = temp_store("timeline-rpc");
        let mut asked = msg_at("1", "devices/gw-7/cmd", "{\"open\":true}", "out", 1_000);
        asked.response_topic = Some("devices/gw-7/reply".into());
        asked.correlation_data = Some("c-1".into());
        let mut asked_again = msg_at("2", "devices/gw-7/cmd", "{\"open\":false}", "out", 2_000);
        asked_again.response_topic = Some("devices/gw-7/reply".into());
        asked_again.correlation_data = Some("c-lost".into());
        let mut answered = msg_at("3", "devices/gw-7/reply", "{\"ok\":true}", "in", 2_600);
        answered.correlation_data = Some("c-1".into());
        store.append(&[asked, asked_again, answered]);

        let tl = store.timeline("", 0, i64::MAX, 2, 30_000, 24).unwrap();
        let marks = &tl.entities[0].marks;
        assert_eq!(marks.len(), 2, "both commands show, whichever way they ended");
        assert!(marks[0].answered && marks[0].rtt_ms == Some(1_600), "reply at 2600 minus request at 1000");
        assert_eq!(
            marks[0].correlation.as_deref(),
            Some("632d31"),
            "the stored key is hex of the correlation bytes, as everywhere else"
        );
        assert!(!marks[1].answered, "a correlation that never came back stays unanswered");
        assert_eq!(marks[1].rtt_ms, None);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_busy_window_caps_entities_and_says_so_rather_than_looking_quiet() {
        let (store, path) = temp_store("timeline-cap");
        let batch: Vec<MqttGenericMessage> = (0..30)
            .map(|i| msg_at(format!("d{i}").as_str(), &format!("devices/gw-{i}/telemetry"), "{}", "in", 1_000 + i))
            .collect();
        store.append(&batch);
        let tl = store.timeline("", 0, i64::MAX, 2, 30_000, 10).unwrap();
        assert_eq!(tl.entities.len(), 10);
        assert_eq!(tl.entities_dropped, 20);
        assert!(!tl.truncated, "30 rows is nowhere near the scan cap");
        assert_eq!(tl.rows_scanned, 30);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
