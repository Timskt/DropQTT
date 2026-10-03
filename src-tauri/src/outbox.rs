//! The webhook outbox: a bridge that is not connected cannot lose a message.
//!
//! MQTT→HTTP is the single most common integration this app does, and until now a
//! 5xx, a timeout or a restart dropped the payload on the floor with nothing but an
//! error counter to prove it happened. This is a local queue with exponential
//! backoff and a dead-letter state — explicitly *not* a message broker: entries
//! live on this disk, in this order, and are retried by this process.
//!
//! The target URL is deliberately **not** stored. A queued entry records which rule
//! produced it, and the rule owns the address; that keeps webhook targets out of a
//! second on-disk copy, and it means a rule whose URL was fixed while a message was
//! queued is retried to the fixed URL rather than to the broken one.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::sync::Mutex;

/// Attempts before an entry becomes a dead letter. With `backoff_ms` below this
/// spans a little over an hour of outage before giving up.
pub const MAX_ATTEMPTS: u32 = 8;
/// A queued body larger than this is not a webhook payload, it is a mistake.
pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
/// A cap on how many entries are retried per tick, so a long outage does not turn
/// recovery into a burst against the endpoint that just came back.
pub const MAX_DUE_PER_TICK: usize = 32;

/// `1s, 2s, 4s … 300s`. Capped so a returning endpoint is not hammered.
pub fn backoff_ms(attempts: u32) -> u64 {
    let shift = attempts.min(9);
    (1_000u64 << shift).min(300_000)
}

#[derive(Debug, Clone)]
pub struct OutboxEntry {
    pub id: i64,
    pub rule_id: String,
    pub topic: String,
    pub body: Vec<u8>,
    pub qos: u8,
    pub retain: bool,
    pub attempts: u32,
    /// Which sink of the rule owes this delivery: 0 is the rule's primary webhook,
    /// 1.. are its extra targets. Stored as an index, never as an address.
    pub target_index: usize,
}

/// One row of the panel's preview: enough to point at the debt, never enough to
/// leak a payload or an address.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxPreviewRow {
    pub rule_id: String,
    pub topic: String,
    pub attempts: u32,
    pub last_error: String,
    /// Which sink of the rule is still owed. 0 is the rule's primary webhook.
    pub target_index: usize,
}

/// Everything the bridge panel needs about the queue at once.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxState {
    pub counts: OutboxCounts,
    /// Set when the queue could not be opened: retries are then off, and the panel
    /// has to say so instead of showing a clean zero.
    pub error: Option<String>,
    /// The rows closest to giving up, dead letters first.
    pub preview: Vec<OutboxPreviewRow>,
    /// The panel quotes "attempt 5/8"; that 8 has to come from here, not from a
    /// number someone typed into a string.
    pub max_attempts: u32,
}

/// What the panel shows per rule. `delivered` counts successes *including* the ones
/// that never needed the queue, so it stays comparable with the bridge's own counter.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxCounts {
    pub pending: u64,
    pub dead: u64,
    pub delivered: u64,
    pub retries: u64,
}

#[derive(Debug)]
pub struct Outbox {
    conn: Mutex<Connection>,
    /// Non-zero only when the DB could not be opened at all; the caller must say so
    /// out loud rather than fall back to dropping messages quietly.
    broken: std::sync::atomic::AtomicBool,
}

impl Outbox {
    pub fn open(path: &std::path::Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("open outbox db: {e}"))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("outbox wal: {e}"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                rule_id TEXT NOT NULL,
                topic TEXT NOT NULL,
                body BLOB NOT NULL,
                qos INTEGER NOT NULL,
                retain INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                target_index INTEGER NOT NULL DEFAULT 0,
                next_try_ms INTEGER NOT NULL,
                state TEXT NOT NULL DEFAULT 'pending',
                last_error TEXT,
                created_ms INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(state, next_try_ms);
             CREATE TABLE IF NOT EXISTS outbox_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );",
        )
        .map_err(|e| format!("outbox schema: {e}"))?;
        // A queue written before fan-out existed has no target column. Adding it in
        // place keeps the entries already owed — recreating the table would throw
        // away exactly the work this module exists to preserve.
        let has_target: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('outbox') WHERE name = 'target_index'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| format!("outbox schema probe: {e}"))?;
        if has_target == 0 {
            conn.execute("ALTER TABLE outbox ADD COLUMN target_index INTEGER NOT NULL DEFAULT 0", [])
                .map_err(|e| format!("outbox target column: {e}"))?;
        }
        Ok(Self {
            conn: Mutex::new(conn),
            broken: std::sync::atomic::AtomicBool::new(false),
        })
    }

    pub fn is_broken(&self) -> bool {
        self.broken.load(std::sync::atomic::Ordering::Relaxed)
    }

    fn with_conn<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, rusqlite::Error>,
    ) -> Result<T, String> {
        match self.conn.lock() {
            Ok(mut guard) => f(&mut guard).map_err(|e| e.to_string()),
            Err(_) => Err("outbox lock poisoned".to_string()),
        }
    }

    pub fn enqueue(&self, entry: &OutboxEntry, now_ms: i64) -> Result<i64, String> {
        if entry.body.len() > MAX_BODY_BYTES {
            return Err(format!(
                "queued body is {} B, over the {MAX_BODY_BYTES} B outbox limit",
                entry.body.len()
            ));
        }
        let attempts = entry.attempts;
        let next = now_ms + backoff_ms(attempts) as i64;
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO outbox (id, rule_id, topic, body, qos, retain, attempts, target_index, next_try_ms, state, created_ms)
                 VALUES (NULL, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9)",
                params![entry.rule_id, entry.topic, entry.body, entry.qos as i64, entry.retain as i64, attempts as i64, entry.target_index as i64, next, now_ms],
            )?;
            Ok(conn.last_insert_rowid())
        })
        .map_err(|e| {
            self.broken.store(true, std::sync::atomic::Ordering::Relaxed);
            format!("outbox enqueue: {e}")
        })
    }

    /// Entries whose backoff has elapsed, oldest first, capped per tick.
    pub fn due(&self, now_ms: i64) -> Result<Vec<OutboxEntry>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, rule_id, topic, body, qos, retain, attempts, target_index
                 FROM outbox WHERE state = 'pending' AND next_try_ms <= ?1
                 ORDER BY next_try_ms ASC, id ASC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![now_ms, MAX_DUE_PER_TICK as i64], |r| {
                Ok(OutboxEntry {
                    id: r.get(0)?,
                    rule_id: r.get(1)?,
                    topic: r.get(2)?,
                    body: r.get(3)?,
                    qos: r.get::<_, i64>(4)?.max(0) as u8,
                    retain: r.get::<_, i64>(5)? != 0,
                    attempts: r.get::<_, i64>(6)?.max(0) as u32,
                    target_index: r.get::<_, i64>(7)?.max(0) as usize,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()
        })
    }

    /// A delivered entry leaves the queue; the counter is what the panel shows when
    /// the queue itself is empty.
    pub fn record_success(&self, id: i64) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                // The first success has to seed the counter at 1: with '0' as the
                // inserted value the upsert only ever counts from the second one.
                "INSERT INTO outbox_meta (key, value) VALUES ('delivered', '1')
                 ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)",
                [],
            )?;
            conn.execute("DELETE FROM outbox WHERE id = ?1", params![id])?;
            Ok(())
        })
    }

    /// Reschedule with a backoff that grows with *this entry's* attempt count, and
    /// turn it into a dead letter once the attempts run out. Returns `dead`.
    pub fn record_failure(&self, id: i64, attempts: u32, error: &str, now_ms: i64) -> Result<bool, String> {
        let next_attempts = attempts + 1;
        let dead = next_attempts >= MAX_ATTEMPTS;
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE outbox SET attempts = ?2, last_error = ?3, next_try_ms = ?4, state = ?5 WHERE id = ?1",
                params![id, next_attempts as i64, error, now_ms + backoff_ms(next_attempts) as i64, if dead { "dead" } else { "pending" }],
            )?;
            Ok(())
        })?;
        Ok(dead)
    }

    pub fn counts(&self) -> OutboxCounts {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return OutboxCounts::default(),
        };
        let scalar = |sql: &str| -> u64 {
            conn.query_row(sql, [], |r| r.get::<_, i64>(0))
                .unwrap_or(0)
                .max(0) as u64
        };
        let delivered = conn
            .query_row("SELECT value FROM outbox_meta WHERE key = 'delivered'", [], |r| {
                r.get::<_, String>(0)
            })
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        OutboxCounts {
            pending: scalar("SELECT COUNT(*) FROM outbox WHERE state = 'pending'"),
            dead: scalar("SELECT COUNT(*) FROM outbox WHERE state = 'dead'"),
            delivered,
            retries: scalar("SELECT COALESCE(SUM(attempts), 0) FROM outbox"),
        }
    }

    pub fn counts_for(&self, rule_id: &str) -> OutboxCounts {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return OutboxCounts::default(),
        };
        let one = |sql: &str| -> u64 {
            conn.query_row(sql, params![rule_id], |r| r.get::<_, i64>(0))
                .unwrap_or(0)
                .max(0) as u64
        };
        OutboxCounts {
            pending: one("SELECT COUNT(*) FROM outbox WHERE rule_id = ?1 AND state = 'pending'"),
            dead: one("SELECT COUNT(*) FROM outbox WHERE rule_id = ?1 AND state = 'dead'"),
            delivered: 0,
            retries: one("SELECT COALESCE(SUM(attempts),0) FROM outbox WHERE rule_id = ?1"),
        }
    }

    /// Drop dead letters, optionally only one rule's. Returns how many went away.
    pub fn drop_dead(&self, rule_id: Option<&str>) -> Result<u64, String> {
        self.with_conn(|conn| match rule_id {
            Some(id) => Ok(conn.execute("DELETE FROM outbox WHERE state = 'dead' AND rule_id = ?1", params![id])? as u64),
            None => Ok(conn.execute("DELETE FROM outbox WHERE state = 'dead'", [])? as u64),
        })
    }

    /// Retry now: clear the backoff timer on every pending entry.
    pub fn flush_now(&self, rule_id: Option<&str>) -> Result<u64, String> {
        self.with_conn(|conn| match rule_id {
            Some(id) => Ok(conn.execute(
                "UPDATE outbox SET next_try_ms = 0 WHERE state = 'pending' AND rule_id = ?1",
                params![id],
            )? as u64),
            None => Ok(conn.execute("UPDATE outbox SET next_try_ms = 0 WHERE state = 'pending'", [])? as u64),
        })
    }

    /// A short preview for the panel: topic, attempts, the last error and which
    /// sink of the rule it belongs to. Never the body and never the URL — the
    /// panel resolves the index against the live rule to name the target.
    pub fn preview(&self, limit: usize) -> Result<Vec<OutboxPreviewRow>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT rule_id, topic, attempts, COALESCE(last_error, ''), target_index FROM outbox
                 ORDER BY CASE state WHEN 'dead' THEN 0 ELSE 1 END, next_try_ms ASC LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit as i64], |r| {
                Ok(OutboxPreviewRow {
                    rule_id: r.get(0)?,
                    topic: r.get(1)?,
                    attempts: r.get::<_, i64>(2)?.max(0) as u32,
                    last_error: r.get(3)?,
                    target_index: r.get::<_, i64>(4)?.max(0) as usize,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_outbox(name: &str) -> (Outbox, PathBuf) {
        let dir = std::env::temp_dir().join(format!("dropqtt_outbox_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("outbox.db");
        (Outbox::open(&path).expect("open"), path)
    }

    fn entry(rule: &str) -> OutboxEntry {
        OutboxEntry {
            id: 0,
            rule_id: rule.to_string(),
            topic: "home/temperature".to_string(),
            body: b"{\"v\":21.5}".to_vec(),
            qos: 1,
            retain: false,
            attempts: 0,
            target_index: 0,
        }
    }

    #[test]
    fn backoff_doubles_and_stops_at_five_minutes() {
        assert_eq!(backoff_ms(0), 1_000);
        assert_eq!(backoff_ms(3), 8_000);
        assert_eq!(backoff_ms(9), 300_000);
        assert_eq!(backoff_ms(40), 300_000, "a huge attempt count must not overflow");
    }

    #[test]
    fn a_queued_entry_is_due_only_after_its_backoff() {
        let (box_, path) = temp_outbox("due");
        let id = box_.enqueue(&entry("r1"), 1_000).expect("enqueue");
        assert!(id > 0);
        assert!(box_.due(1_500).expect("due").is_empty(), "1s backoff has not elapsed");
        let due = box_.due(2_100).expect("due");
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].rule_id, "r1");
        assert_eq!(due[0].body, b"{\"v\":21.5}".to_vec());
        assert_eq!(box_.counts().pending, 1);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn success_removes_the_row_and_counts_the_delivery() {
        let (box_, path) = temp_outbox("success");
        let id = box_.enqueue(&entry("r1"), 1_000).expect("enqueue");
        box_.record_failure(id, 0, "502 bad gateway", 2_100).expect("fail once");
        assert_eq!(box_.counts().pending, 1);
        box_.record_success(id).expect("succeed");
        assert_eq!(box_.counts().pending, 0);
        assert_eq!(box_.counts().delivered, 1);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_dead_letter_stays_visible_and_is_never_retried_again() {
        let (box_, path) = temp_outbox("dead");
        let id = box_.enqueue(&entry("r1"), 1_000).expect("enqueue");
        let mut dead = false;
        for attempt in 0..MAX_ATTEMPTS {
            dead = box_.record_failure(id, attempt, "connection refused", 2_000 + attempt as i64).expect("fail");
        }
        assert!(dead, "the last attempt reports it as dead");
        let counts = box_.counts();
        assert_eq!((counts.dead, counts.pending), (1, 0));
        assert!(box_.due(i64::MAX).expect("due").is_empty(), "dead letters are not due");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn backoff_grows_per_entry_rather_than_staying_at_one_second() {
        let (box_, path) = temp_outbox("growing");
        let id = box_.enqueue(&entry("r1"), 0).expect("enqueue");
        box_.record_failure(id, 0, "timeout", 100).expect("first failure");
        // Attempt 1 → 2s from the failure time, so nothing is due at 1.5s...
        assert!(box_.due(1_500).expect("due").is_empty());
        // ...and the row records what it is waiting for.
        let due = box_.due(2_500).expect("due");
        assert_eq!(due[0].attempts, 1);
        box_.record_failure(id, 1, "timeout", 2_500).expect("second failure");
        assert!(box_.due(4_000).expect("due").is_empty(), "4s backoff now");
        assert_eq!(box_.due(7_000).expect("due").len(), 1);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn flush_now_makes_pending_entries_due_without_losing_them() {
        let (box_, path) = temp_outbox("flush");
        box_.enqueue(&entry("r1"), 0).expect("enqueue");
        box_.enqueue(&entry("r2"), 0).expect("enqueue");
        assert_eq!(box_.flush_now(Some("r1")).expect("flush"), 1);
        let due = box_.due(1).expect("due");
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].rule_id, "r1");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn dropping_dead_letters_leaves_pending_work_alone() {
        let (box_, path) = temp_outbox("drop");
        let id = box_.enqueue(&entry("r1"), 0).expect("enqueue");
        box_.record_failure(id, MAX_ATTEMPTS - 1, "gone", 10).expect("final failure");
        box_.enqueue(&entry("r1"), 0).expect("second entry");
        assert_eq!(box_.drop_dead(Some("r1")).expect("drop"), 1);
        assert_eq!(box_.counts().pending, 1);
        assert_eq!(box_.counts().dead, 0);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn the_preview_never_carries_a_body_or_a_target_url() {
        let (box_, path) = temp_outbox("preview");
        box_.enqueue(&entry("r1"), 0).expect("enqueue");
        let rows = box_.preview(10).expect("preview");
        assert_eq!(rows[0].topic, "home/temperature");
        let blob = format!("{rows:?}");
        assert!(!blob.contains("21.5"), "the payload must not leak into the list");
        assert!(!blob.contains("http"), "no target in the preview");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn an_oversized_body_is_refused_rather_than_stored() {
        let (box_, path) = temp_outbox("oversize");
        let mut big = entry("r1");
        big.body = vec![b'x'; MAX_BODY_BYTES + 1];
        assert!(box_.enqueue(&big, 0).is_err());
        assert_eq!(box_.counts().pending, 0);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn per_rule_counts_only_see_their_own_queue() {
        let (box_, path) = temp_outbox("per-rule");
        box_.enqueue(&entry("r1"), 0).expect("enqueue");
        box_.enqueue(&entry("r1"), 0).expect("enqueue");
        box_.enqueue(&entry("r2"), 0).expect("enqueue");
        assert_eq!(box_.counts_for("r1").pending, 2);
        assert_eq!(box_.counts_for("r2").pending, 1);
        assert_eq!(box_.counts_for("missing").pending, 0);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn the_queue_survives_reopening_the_database() {
        let (box_, path) = temp_outbox("reopen");
        box_.enqueue(&entry("r1"), 0).expect("enqueue");
        drop(box_);
        let again = Outbox::open(&path).expect("reopen");
        assert_eq!(again.counts().pending, 1);
        assert_eq!(again.due(10_000).expect("due").len(), 1);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn two_sinks_of_one_rule_are_two_separate_debts() {
        let (box_, path) = temp_outbox("fanout");
        let mut to_archive = entry("r1");
        to_archive.target_index = 2;
        box_.enqueue(&entry("r1"), 0).expect("primary sink");
        box_.enqueue(&to_archive, 0).expect("extra sink");
        let due = box_.due(10_000).expect("due");
        assert_eq!(due.iter().map(|e| e.target_index).collect::<Vec<_>>(), vec![0, 2]);
        // One sink coming back says nothing about the other.
        box_.record_success(due[0].id).expect("delivered one");
        assert_eq!(box_.counts_for("r1").pending, 1);
        let rows = box_.preview(5).expect("preview");
        assert_eq!(rows[0].target_index, 2, "the preview says which sink is still owed");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_queue_written_before_fan_out_is_upgraded_rather_than_rebuilt() {
        let dir = std::env::temp_dir().join(format!("dropqtt_outbox_upgrade_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("outbox.db");
        {
            let conn = Connection::open(&path).expect("create");
            // The pre-fan-out schema, with no target_index column at all.
            conn.execute_batch(
                "CREATE TABLE outbox (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    rule_id TEXT NOT NULL,
                    topic TEXT NOT NULL,
                    body BLOB NOT NULL,
                    qos INTEGER NOT NULL,
                    retain INTEGER NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_try_ms INTEGER NOT NULL,
                    state TEXT NOT NULL DEFAULT 'pending',
                    last_error TEXT,
                    created_ms INTEGER NOT NULL
                 );
                 CREATE TABLE outbox_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            )
            .expect("old schema");
            conn.execute(
                "INSERT INTO outbox (rule_id, topic, body, qos, retain, attempts, next_try_ms, state, created_ms)
                 VALUES ('r1', 'home/t', ?1, 1, 0, 2, 500, 'pending', 1)",
                params![b"{\"v\":1}".to_vec()],
            )
            .expect("seed row");
        }
        let upgraded = Outbox::open(&path).expect("opening upgrades the schema in place");
        let due = upgraded.due(10_000).expect("due");
        assert_eq!(due.len(), 1, "the owed delivery survived the upgrade");
        assert_eq!(due[0].target_index, 0, "the primary sink is index 0");
        assert_eq!(due[0].attempts, 2, "and its attempt history is intact");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
