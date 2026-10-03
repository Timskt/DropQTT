//! Persistent message history (SQLite).
//!
//! The console feed already batches inbound/outbound publishes on a 100 ms
//! cadence; each drained batch is mirrored here so history survives restarts
//! and can be searched / charted long after the live feed scrolled away.
//! Writes happen inside a single transaction per batch to stay cheap even at
//! thousands of messages per second. A row-count cap keeps the DB bounded.

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
                 (id, topic, payload, payload_b64, payload_len, qos, retain, content_type, direction, ts, properties, truncated) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
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
                    m.truncated
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
                |r| {
                    let payload_base64: String = r.get(3)?;
                    let payload_len = r.get::<_, i64>(4)? as usize;
                    let truncated = r.get::<_, bool>(11)?
                        || base64::engine::general_purpose::STANDARD.decode(&payload_base64)
                            .map(|bytes| bytes.len() != payload_len).unwrap_or(true);
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
                },
            );
        let rows = rows
            .map_err(|e| format!("history query: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("history row unreadable: {e}"))?;
        Ok(rows)
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
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
            .unwrap_or(0);
        let inbound: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages WHERE direction = 'in'", [], |r| r.get(0))
            .unwrap_or(0);
        let outbound: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages WHERE direction = 'out'", [], |r| r.get(0))
            .unwrap_or(0);
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
}
