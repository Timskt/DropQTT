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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStats {
    pub rows: i64,
    pub inbound: i64,
    pub outbound: i64,
    pub oldest_ts: Option<i64>,
    pub newest_ts: Option<i64>,
    /// Rows dropped by the best-effort write path since this session opened
    pub lost_rows: u64,
}

pub struct HistoryStore {
    conn: Mutex<Connection>,
    batches: Mutex<u64>,
    /// Rows the write path could not persist. History stays best-effort on
    /// purpose (a busy DB must never stall the live feed), but "best-effort"
    /// without a counter is indistinguishable from "complete".
    lost_rows: AtomicU64,
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
             CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic);",
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
        Ok(Self {
            conn: Mutex::new(conn),
            batches: Mutex::new(0),
            lost_rows: AtomicU64::new(0),
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
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        for m in batch {
            let ts = if m.timestamp_ms > 0 { m.timestamp_ms } else { fallback_ts };
            let properties = PubProperties {
                content_type: m.content_type.clone(),
                user_properties: m.user_properties.clone(),
                response_topic: m.response_topic.clone(),
                correlation_data: m.correlation_data.clone(),
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

    fn trim(&self) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute(
                "DELETE FROM messages WHERE rowid NOT IN (SELECT rowid FROM messages ORDER BY ts DESC LIMIT ?1)",
                params![MAX_HISTORY_ROWS],
            );
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
        }
    }

    pub fn clear(&self) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute("DELETE FROM messages", []);
        }
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
            qos: 1,
            retain: false,
            timestamp: String::new(),
            timestamp_ms: 0,
            direction: dir.to_string(),
        }
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
