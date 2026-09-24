//! Persistent message history (SQLite).
//!
//! The console feed already batches inbound/outbound publishes on a 100 ms
//! cadence; each drained batch is mirrored here so history survives restarts
//! and can be searched / charted long after the live feed scrolled away.
//! Writes happen inside a single transaction per batch to stay cheap even at
//! thousands of messages per second. A row-count cap keeps the DB bounded.

use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::protocol::MqttGenericMessage;

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
}

pub struct HistoryStore {
    conn: Mutex<Connection>,
    batches: Mutex<u64>,
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
        Ok(Self {
            conn: Mutex::new(conn),
            batches: Mutex::new(0),
        })
    }

    /// Mirror one drained feed batch into the DB (transactional, cheap).
    pub fn append(&self, batch: &[MqttGenericMessage]) {
        if batch.is_empty() {
            return;
        }
        let fallback_ts = now_ms();
        let Ok(conn) = self.conn.lock() else { return };
        // Best-effort: a failed history write must never break the live feed.
        let _ = conn.execute("BEGIN IMMEDIATE", []);
        for m in batch {
            let ts = if m.timestamp_ms > 0 { m.timestamp_ms } else { fallback_ts };
            let _ = conn.execute(
                "INSERT OR REPLACE INTO messages \
                 (id, topic, payload, payload_b64, payload_len, qos, retain, content_type, direction, ts) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
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
                    ts
                ],
            );
        }
        let _ = conn.execute("COMMIT", []);
        drop(conn);

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
    pub fn query(&self, search: &str, direction: &str, limit: i64) -> Vec<HistoryRow> {
        let Ok(conn) = self.conn.lock() else { return Vec::new() };
        let limit = limit.clamp(1, 2000);
        let like = format!("%{}%", search.trim());
        let dir_filter = direction == "in" || direction == "out";
        let sql = "SELECT id, topic, payload, payload_b64, payload_len, qos, retain, content_type, direction, ts \
             FROM messages \
             WHERE (?1 = '' OR topic LIKE ?1 OR payload LIKE ?1) \
               AND (?2 = 0 OR direction = ?3) \
             ORDER BY ts DESC LIMIT ?4";
        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt
            .query_map(
                params![
                    if search.trim().is_empty() { "" } else { &like },
                    dir_filter as i64,
                    direction,
                    limit
                ],
                |r| {
                    Ok(HistoryRow {
                        id: r.get(0)?,
                        topic: r.get(1)?,
                        payload: r.get(2)?,
                        payload_base64: r.get(3)?,
                        payload_len: r.get::<_, i64>(4)? as usize,
                        qos: r.get::<_, i64>(5)? as u8,
                        retain: r.get::<_, i64>(6)? != 0,
                        content_type: r.get(7)?,
                        direction: r.get(8)?,
                        ts: r.get(9)?,
                    })
                },
            )
            .map(|it| it.filter_map(|x| x.ok()).collect())
            .unwrap_or_default();
        rows
    }

    /// Per-bucket message counts for a trend chart, optionally topic-filtered.
    pub fn series(&self, topic: &str, bucket_ms: i64, since_ms: i64) -> Vec<HistorySeriesPoint> {
        let Ok(conn) = self.conn.lock() else { return Vec::new() };
        let bucket = bucket_ms.max(1000);
        let like = format!("%{}%", topic.trim());
        let empty = topic.trim().is_empty();
        let sql = if empty {
            "SELECT (ts / ?1) * ?1 AS b, COUNT(*) FROM messages WHERE ts >= ?2 GROUP BY b ORDER BY b ASC"
        } else {
            "SELECT (ts / ?1) * ?1 AS b, COUNT(*) FROM messages WHERE ts >= ?2 AND topic LIKE ?3 GROUP BY b ORDER BY b ASC"
        };
        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let mapper = |r: &rusqlite::Row| -> rusqlite::Result<HistorySeriesPoint> {
            Ok(HistorySeriesPoint { bucket: r.get(0)?, count: r.get(1)? })
        };
        let mapped = if empty {
            stmt.query_map(params![bucket, since_ms], mapper)
        } else {
            stmt.query_map(params![bucket, since_ms, like], mapper)
        };
        match mapped {
            Ok(it) => it.filter_map(|x| x.ok()).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn stats(&self) -> HistoryStats {
        let empty = || HistoryStats { rows: 0, inbound: 0, outbound: 0, oldest_ts: None, newest_ts: None };
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
        HistoryStats { rows, inbound, outbound, oldest_ts: oldest, newest_ts: newest }
    }

    pub fn clear(&self) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute("DELETE FROM messages", []);
        }
    }
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
            payload_base64: String::new(),
            truncated: false,
            content_type: None,
            user_properties: Vec::new(),
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

        let all = store.query("", "all", 100);
        assert_eq!(all.len(), 3);

        // Topic substring search
        let only_a = store.query("sensor/a", "all", 100);
        assert_eq!(only_a.len(), 2);
        // Direction filter
        let outs = store.query("", "out", 100);
        assert_eq!(outs.len(), 1);
        assert_eq!(outs[0].topic, "sensor/b");

        // Payload text search
        let by_payload = store.query("world", "all", 100);
        assert_eq!(by_payload.len(), 1);

        let stats = store.stats();
        assert_eq!(stats.rows, 3);
        assert_eq!(stats.inbound, 2);
        assert_eq!(stats.outbound, 1);
        assert!(stats.newest_ts.is_some());

        // Series over a wide window returns at least one bucket totaling 3
        let since = stats.oldest_ts.unwrap() - 1000;
        let series = store.series("", 1000, since);
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

        let rows = store.query("sensor/a", "all", 10);
        assert_eq!(rows[0].ts, 1_700_000_000_456);
        assert_eq!(rows[1].ts, 1_700_000_000_123);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
