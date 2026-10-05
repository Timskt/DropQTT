//! Message assertions: the difference between watching traffic and testing it.
//!
//! A rule is a topic filter plus one predicate over what arrived on it. The
//! grammar is deliberately tiny - a path, a comparison, a literal - because a
//! general expression language already exists in this app (the QuickJS transform
//! hooks) and running arbitrary script on every inbound publish is not what an
//! acceptance gate should be doing. What the panel needs is a verdict per message
//! that can be explained in one line.
//!
//! Three outcomes, not two: **Passed**, **Violated**, and **Unevaluable**. A rule
//! of the shape `$.tempC < 80` cannot judge a binary payload or a document where
//! `tempC` is absent, and reporting that as a pass would be the exact failure this
//! project has spent rounds removing elsewhere.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use crate::protocol::MqttGenericMessage;

/// Largest stored predicate text; anything longer is a paste mistake, not a rule.
pub const MAX_EXPR_LEN: usize = 200;
pub const MAX_RULES: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AssertOutcome {
    Passed,
    Violated,
    /// The rule could not be applied to this message at all.
    Unevaluable,
}

impl AssertOutcome {
    pub fn is_violation(self) -> bool {
        self == AssertOutcome::Violated
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Op {
    Lt,
    Le,
    Gt,
    Ge,
    Eq,
    Ne,
    /// Substring test on text fields.
    Contains,
    NotContains,
    /// "field exists and is not null"
    Present,
    Absent,
}

/// Where the rule looks. Kept as an enum rather than a free-form path so a typo is
/// a parse error at add time instead of a rule that silently never fires.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Field {
    /// Whole payload, decoded as text when it is valid UTF-8.
    Payload,
    /// A JSON pointer-ish path into the payload: `$.tempC`, `$.metrics[0].v`.
    Json(String),
    Topic,
    Qos,
    Retain,
    Size,
    ContentType,
    Direction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssertionRule {
    pub id: String,
    /// MQTT filter; shared filters match on their inner filter like everywhere else.
    pub filter: String,
    pub field: Field,
    pub op: Op,
    /// Compared against numbers when both sides are numbers, else as text.
    #[serde(default)]
    pub expected: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Human note; never used in evaluation.
    #[serde(default)]
    pub label: String,
    /// The predicate exactly as it was written, so the editor can show what the
    /// user typed instead of a canonicalised re-format of it.
    #[serde(default)]
    pub text: String,
}

fn default_true() -> bool {
    true
}

/// A value pulled out of a message, tagged so comparisons stay honest.
#[derive(Debug, Clone, PartialEq)]
enum Value {
    Missing,
    Null,
    Number(f64),
    Text(String),
    Bool(bool),
}

impl Value {
    fn as_text(&self) -> Option<String> {
        match self {
            Value::Text(t) => Some(t.clone()),
            Value::Number(n) => Some(n.to_string()),
            Value::Bool(b) => Some(b.to_string()),
            Value::Missing | Value::Null => None,
        }
    }

    fn as_number(&self) -> Option<f64> {
        match self {
            Value::Number(n) => Some(*n),
            Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            Value::Text(t) => t.trim().parse::<f64>().ok(),
            Value::Missing | Value::Null => None,
        }
    }
}

/// Why a rule was rejected at add time.
pub fn rule_error(rule: &AssertionRule) -> Option<String> {
    if rule.filter.trim().is_empty() {
        return Some("an assertion needs a topic filter".to_string());
    }
    if let Some(err) = crate::topic::filter_topic_error(rule.filter.trim()) {
        return Some(err);
    }
    if rule.expr().len() > MAX_EXPR_LEN {
        return Some(format!("predicate is longer than {MAX_EXPR_LEN} characters"));
    }
    if !matches!(rule.op, Op::Present | Op::Absent) && rule.expected.trim().is_empty() {
        return Some("this operator needs a value to compare against".to_string());
    }
    if matches!(rule.op, Op::Lt | Op::Le | Op::Gt | Op::Ge)
        && rule.expected.trim().parse::<f64>().is_err()
    {
        // `<` and `>` only ever compare numbers, so a right side that is not one is
        // a typo that would sit there reporting every message as unreadable.
        return Some("this comparison needs a number on the right".to_string());
    }
    if let Field::Json(path) = &rule.field {
        // A JSON path that cannot be parsed would only ever be Unevaluable, which
        // is a silent rule.
        if let Some(err) = json_path_error(path) {
            return Some(err);
        }
    }
    if matches!(rule.field, Field::Json(_)) && matches!(rule.op, Op::Contains | Op::NotContains) {
        // Substring tests over a JSON *node* would stringify arrays and objects,
        // which is how a rule starts matching things nobody wrote.
        return Some("use == or != for a JSON value; contains is for text fields".to_string());
    }
    None
}

impl AssertionRule {
    /// Canonical form of the comparison. Also what the length budget judges, so a
    /// rule cannot smuggle an overlong predicate in as free text.
    pub fn expr(&self) -> String {
        format!("{:?} {:?} {}", self.field, self.op, self.expected)
    }

    /// What the UI quotes: the line as written when there is one.
    pub fn display(&self) -> String {
        let text = self.text.trim();
        if text.is_empty() {
            self.expr()
        } else {
            text.to_string()
        }
    }
}

fn json_path_error(path: &str) -> Option<String> {
    if !path.starts_with("$.") || path.len() < 3 {
        return Some(r#"a payload path must look like $.name or $.list[0].v"#.to_string());
    }
    for seg in path[2..].split('.') {
        if seg.is_empty() {
            return Some("the payload path has an empty segment".to_string());
        }
        let name = seg.split('[').next().unwrap_or(seg);
        if name.is_empty()
            || !name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Some(format!("'{name}' is not a usable object key"));
        }
        if let Some(rest) = seg.strip_prefix(name) {
            if !rest.is_empty() && !brackets_are_indices(rest) {
                return Some(format!("'{seg}' must end with a [index] list subscript"));
            }
        }
    }
    None
}

/// `", "[12]", "[0][1]"` are indices; anything else is not.
fn brackets_are_indices(rest: &str) -> bool {
    let mut s = rest;
    while !s.is_empty() {
        let Some(open) = s.strip_prefix('[') else { return false };
        let Some(close) = open.find(']') else { return false };
        if !open[..close].chars().all(|c| c.is_ascii_digit()) || open[..close].is_empty() {
            return false;
        }
        s = &open[close + 1..];
    }
    true
}

fn parse_op(raw: &str) -> Option<Op> {
    Some(match raw.trim() {
        "<" => Op::Lt,
        "<=" => Op::Le,
        ">" => Op::Gt,
        ">=" => Op::Ge,
        "==" | "=" => Op::Eq,
        "!=" => Op::Ne,
        "~" | "contains" => Op::Contains,
        "!~" | "!contains" => Op::NotContains,
        "exists" => Op::Present,
        "missing" => Op::Absent,
        _ => return None,
    })
}

/// Parse the one-line form the UI and scenario files use:
/// `$.tempC < 80`, `payload contains error`, `qos >= 1`, `$.deviceId exists`.
pub fn parse_rule(id: &str, filter: &str, predicate: &str) -> Result<AssertionRule, String> {
    let text = predicate.trim();
    if text.is_empty() {
        return Err("the predicate is empty".to_string());
    }
    // The two word operators that take no right side have to be read as a suffix: a
    // scan for ` exists ` would demand a trailing space that the line never has.
    {
        let lower = text.to_ascii_lowercase();
        for (word, op) in [("exists", Op::Present), ("missing", Op::Absent)] {
            let Some(rest) = lower.strip_suffix(word) else { continue };
            if !rest.chars().next_back().is_some_and(|c| c.is_whitespace()) {
                continue;
            }
            let lhs = text[..rest.len()].trim_end();
            let rule = AssertionRule {
                id: id.to_string(),
                filter: filter.trim().to_string(),
                field: parse_field(lhs)?,
                op,
                expected: String::new(),
                enabled: true,
                label: String::new(),
                text: text.to_string(),
            };
            return match rule_error(&rule) {
                Some(err) => Err(err),
                None => Ok(rule),
            };
        }
    }
    // Longest operator first: `<=` must not parse as `<` followed by junk, and
    // `!contains` must not be caught by the bare `contains` inside it.
    for op in ["<=", ">=", "!=", "==", "!~", "~", "<", ">", "=", "!contains", "contains"] {
        let sep = if op.len() > 2 { format!(" {op} ") } else { op.to_string() };
        if let Some(pos) = text.find(&sep) {
            let (lhs, rhs) = (text[..pos].trim(), text[pos + sep.len()..].trim());
            if lhs.is_empty() {
                return Err("the predicate has no left side".to_string());
            }
            let Some(parsed) = parse_op(op) else {
                return Err(format!("'{op}' is not a supported operator"));
            };
            let rule = AssertionRule {
                id: id.to_string(),
                filter: filter.trim().to_string(),
                field: parse_field(lhs)?,
                op: parsed,
                expected: rhs.to_string(),
                enabled: true,
                label: String::new(),
                text: text.to_string(),
            };
            return match rule_error(&rule) {
                Some(err) => Err(err),
                None => Ok(rule),
            };
        }
    }
    // A bare `$.x` reads as "must be present", which is what people type.
    let rule = AssertionRule {
        id: id.to_string(),
        filter: filter.trim().to_string(),
        field: parse_field(text)?,
        op: Op::Present,
        expected: String::new(),
        enabled: true,
        label: String::new(),
        text: text.to_string(),
    };
    match rule_error(&rule) {
        Some(err) => Err(err),
        None => Ok(rule),
    }
}

fn parse_field(raw: &str) -> Result<Field, String> {
    let t = raw.trim();
    if t.starts_with("$.") {
        return Ok(Field::Json(t.to_string()));
    }
    let lower = t.to_ascii_lowercase();
    Ok(match lower.as_str() {
        "payload" | "text" | "body" => Field::Payload,
        "topic" => Field::Topic,
        "qos" => Field::Qos,
        "retain" | "retained" => Field::Retain,
        "size" | "bytes" | "length" => Field::Size,
        "contenttype" | "content_type" | "content-type" | "ctype" => Field::ContentType,
        "direction" | "dir" => Field::Direction,
        other => {
            if json_path_error(&format!("$.{other}")).is_none() {
                // `tempC` alone is readable and unambiguous: a top-level member.
                Field::Json(format!("$.{other}"))
            } else {
                return Err(format!("'{other}' is not a field this can judge"));
            }
        }
    })
}

/// Read one field out of a message.
fn value_of(msg: &MqttGenericMessage, field: &Field) -> Value {
    match field {
        Field::Topic => Value::Text(msg.topic.clone()),
        Field::Qos => Value::Number(f64::from(msg.qos)),
        Field::Retain => Value::Bool(msg.retain),
        Field::Size => Value::Number(msg.payload_len as f64),
        Field::Direction => Value::Text(msg.direction.clone()),
        Field::ContentType => match msg.content_type.as_deref() {
            Some(t) => Value::Text(t.to_string()),
            None => Value::Missing,
        },
        Field::Payload => match msg.payload_base64.is_empty() {
            false => match base64::engine::general_purpose::STANDARD.decode(&msg.payload_base64) {
                Ok(bytes) => match String::from_utf8(bytes) {
                    Ok(text) => Value::Text(text),
                    Err(_) => Value::Missing,
                },
                Err(_) => Value::Missing,
            },
            true => Value::Text(msg.payload.clone()),
        },
        Field::Json(path) => json_value(msg, path),
    }
}

/// Decode the payload once per JSON rule; a non-JSON document is Unevaluable, not
/// a violation, because the rule says nothing about it.
fn json_value(msg: &MqttGenericMessage, path: &str) -> Value {
    let text = payload_text(msg);
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Value::Missing;
    };
    let mut cur = root;
    for seg in path[2..].split('.') {
        let (name, subs) = seg.split_once('[').map_or((seg, String::new()), |(n, rest)| (n, format!("[{rest}")));
        let obj = match cur {
            serde_json::Value::Object(o) => o,
            _ => return Value::Missing,
        };
        let Some(next) = obj.get(name) else { return Value::Missing };
        cur = next.clone();
        if !subs.is_empty() {
            for idx in subs.split("[").filter_map(|s| s.trim_end_matches(']').trim().parse::<usize>().ok()) {
                let arr = match cur {
                    serde_json::Value::Array(a) => a,
                    _ => return Value::Missing,
                };
                match arr.get(idx) {
                    Some(v) => cur = v.clone(),
                    None => return Value::Missing,
                }
            }
        }
    }
    match cur {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(b),
        serde_json::Value::Number(n) => Value::Number(n.as_f64().unwrap_or(f64::NAN)),
        serde_json::Value::String(s) => Value::Text(s),
        other => Value::Text(other.to_string()),
    }
}

fn payload_text(msg: &MqttGenericMessage) -> String {
    if msg.payload_base64.is_empty() {
        return msg.payload.clone();
    }
    match base64::engine::general_purpose::STANDARD.decode(&msg.payload_base64) {
        Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
        Err(_) => msg.payload.clone(),
    }
}

/// Judge one message with one rule.
pub fn evaluate(rule: &AssertionRule, msg: &MqttGenericMessage) -> AssertOutcome {
    if !crate::topic::wildcard_match(rule.filter.trim(), &msg.topic) {
        // Not this rule's business. Reported as a pass so a caller can fold rules
        // without a non-matching message turning red.
        return AssertOutcome::Passed;
    }
    let got = value_of(msg, &rule.field);
    if matches!(rule.op, Op::Present) {
        return match got {
            Value::Missing | Value::Null => AssertOutcome::Violated,
            _ => AssertOutcome::Passed,
        };
    }
    if matches!(rule.op, Op::Absent) {
        return match got {
            Value::Missing | Value::Null => AssertOutcome::Passed,
            _ => AssertOutcome::Violated,
        };
    }
    if matches!(got, Value::Missing | Value::Null) {
        return AssertOutcome::Unevaluable;
    }
    match rule.op {
        Op::Contains | Op::NotContains => {
            let Some(text) = got.as_text() else {
                return AssertOutcome::Unevaluable;
            };
            let hit = text.contains(rule.expected.trim());
            AssertOutcome::from_bool(hit == matches!(rule.op, Op::Contains))
        }
        Op::Eq | Op::Ne => {
            // Numbers compare as numbers; anything else as text. A rule written
            // `$.v == 1` against the string "1" is the same value to a device.
            let want_num = rule.expected.trim().parse::<f64>().ok();
            let eq = match (want_num, got.as_number()) {
                (Some(w), Some(g)) => (g - w).abs() < f64::EPSILON,
                _ => got.as_text().is_some_and(|t| t == rule.expected.trim()),
            };
            AssertOutcome::from_bool(eq == matches!(rule.op, Op::Eq))
        }
        Op::Lt | Op::Le | Op::Gt | Op::Ge => {
            let (Some(want), Some(got)) = (rule.expected.trim().parse::<f64>().ok(), got.as_number()) else {
                return AssertOutcome::Unevaluable;
            };
            let ok = match rule.op {
                Op::Lt => got < want,
                Op::Le => got <= want,
                Op::Gt => got > want,
                Op::Ge => got >= want,
                _ => false,
            };
            AssertOutcome::from_bool(ok)
        }
        Op::Present | Op::Absent => AssertOutcome::Unevaluable,
    }
}

impl AssertOutcome {
    fn from_bool(cond: bool) -> Self {
        if cond {
            AssertOutcome::Passed
        } else {
            AssertOutcome::Violated
        }
    }
}

fn rank(out: AssertOutcome) -> u8 {
    match out {
        AssertOutcome::Passed => 0,
        AssertOutcome::Unevaluable => 1,
        AssertOutcome::Violated => 2,
    }
}

/// Fold a rule set into one verdict for one message: the worst applicable outcome
/// wins, because a message that breaks two rules is one red row, not two.
/// `None` means no enabled rule claimed this topic.
pub fn judge(rules: &[AssertionRule], msg: &MqttGenericMessage) -> Option<AssertOutcome> {
    let mut worst: Option<AssertOutcome> = None;
    for rule in rules.iter().filter(|r| r.enabled) {
        if !crate::topic::wildcard_match(rule.filter.trim(), &msg.topic) {
            continue;
        }
        let out = evaluate(rule, msg);
        worst = Some(match worst {
            Some(prev) if rank(prev) >= rank(out) => prev,
            _ => out,
        });
    }
    worst
}

/// The verdict a whole rule set reached for one message, carried on the feed row
/// so the colour on screen can be traced back to the line that produced it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssertionVerdict {
    pub outcome: AssertOutcome,
    /// The rule that decided it (the worst outcome wins; ties go to the first).
    pub rule_id: String,
    #[serde(default)]
    pub label: String,
    /// What was actually compared, e.g. `$.tempC < 80`.
    pub expr: String,
    /// How many enabled rules claimed the message. More than one means the row
    /// summarises them instead of quoting a single rule.
    pub rules: usize,
}

pub fn verdict_for(rules: &[AssertionRule], msg: &MqttGenericMessage) -> Option<AssertionVerdict> {
    let mut best: Option<(u8, &AssertionRule, AssertOutcome)> = None;
    let mut claimed = 0usize;
    for rule in rules.iter().filter(|r| r.enabled) {
        if !crate::topic::wildcard_match(rule.filter.trim(), &msg.topic) {
            continue;
        }
        claimed += 1;
        let out = evaluate(rule, msg);
        let replace = match &best {
            Some((prev_rank, _, _)) => rank(out) > *prev_rank,
            None => true,
        };
        if replace {
            best = Some((rank(out), rule, out));
        }
    }
    best.map(|(_, rule, out)| AssertionVerdict {
        outcome: out,
        rule_id: rule.id.clone(),
        label: rule.label.clone(),
        expr: rule.display(),
        rules: claimed,
    })
}

/// One judged message worth showing in the panel's list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssertionViolation {
    pub msg_id: String,
    pub topic: String,
    pub rule_id: String,
    pub expr: String,
    pub outcome: AssertOutcome,
    pub ts_ms: i64,
}

/// Counters for the whole rule set. `matched` counts messages some enabled rule
/// claimed, so a panel can tell "no violations" apart from "nothing arrived".
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssertStats {
    pub matched: u64,
    pub passed: u64,
    pub violated: u64,
    pub unevaluable: u64,
}

/// Everything the panel shows except the rules themselves, which the frontend
/// owns: one call gets the tallies and the recent violations together.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssertionSnapshot {
    pub stats: AssertStats,
    pub rules: usize,
    pub recent: Vec<AssertionViolation>,
}

/// Rules plus the tallies the Ops panel reads, kept off the MQTT task's hot path:
/// with no rules armed `is_active` is a single relaxed load and the router does not
/// lock anything per message.
#[derive(Debug, Default)]
pub struct AssertionEngine {
    rules: Mutex<Vec<AssertionRule>>,
    active: AtomicBool,
    matched: AtomicU64,
    passed: AtomicU64,
    violated: AtomicU64,
    unevaluable: AtomicU64,
    recent: Mutex<VecDeque<AssertionViolation>>,
    last_event_sec: Mutex<HashMap<String, i64>>,
}

/// A violation list this long is a screen, not an archive; older rows fall off.
const RECENT_CAP: usize = 80;
/// At most one event per rule per this many seconds. A device that is broken
/// every 20 ms would otherwise emit one Tauri event per message.
const EVENT_COOLDOWN_SEC: i64 = 5;

impl AssertionEngine {
    /// Validate and replace the whole set: the frontend owns persistence, and the
    /// backend only ever sees a complete list (same lifecycle as bridge rules and
    /// the silence watchdog).
    pub fn sync_rules(&self, rules: Vec<AssertionRule>) -> Result<(), String> {
        if rules.len() > MAX_RULES {
            return Err(format!("at most {MAX_RULES} assertions are supported"));
        }
        let mut seen = HashSet::with_capacity(rules.len());
        for rule in rules.iter() {
            if let Some(err) = rule_error(rule) {
                return Err(match rule.label.trim().is_empty() {
                    true => err,
                    false => format!("{}: {err}", rule.label.trim()),
                });
            }
            if !seen.insert(rule.id.clone()) {
                return Err(format!("two assertions share the id {}", rule.id));
            }
        }
        let active = !rules.is_empty();
        *self.rules.lock().map_err(|_| "assertion state poisoned")? = rules;
        self.active.store(active, Ordering::Relaxed);
        // Clear the per-rule throttle so re-arming a rule can alert immediately.
        self.last_event_sec.lock().map_err(|_| "assertion state poisoned")?.clear();
        Ok(())
    }

    pub fn rule_count(&self) -> usize {
        self.rules.lock().map(|r| r.len()).unwrap_or(0)
    }

    /// Cheap gate for the router: with nothing armed the message path does not
    /// take a single lock.
    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }

    /// Judge one inbound message in place: attach the verdict, update tallies, and
    /// return a violation worth announcing if this rule has not spoken recently.
    pub fn apply(&self, msg: &mut MqttGenericMessage) -> Option<AssertionViolation> {
        if !self.is_active() {
            return None;
        }
        let verdict = {
            let rules = self.rules.lock().ok()?;
            verdict_for(&rules, msg)?
        };
        self.matched.fetch_add(1, Ordering::Relaxed);
        match verdict.outcome {
            AssertOutcome::Passed => self.passed.fetch_add(1, Ordering::Relaxed),
            AssertOutcome::Violated => self.violated.fetch_add(1, Ordering::Relaxed),
            AssertOutcome::Unevaluable => self.unevaluable.fetch_add(1, Ordering::Relaxed),
        };
        msg.assertion = Some(verdict.clone());
        if verdict.outcome != AssertOutcome::Violated {
            return None;
        }
        let now_sec = chrono::Utc::now().timestamp();
        {
            let Ok(mut last) = self.last_event_sec.lock() else { return None };
            if last.get(&verdict.rule_id).is_some_and(|t| now_sec - *t < EVENT_COOLDOWN_SEC) {
                return None;
            }
            last.insert(verdict.rule_id.clone(), now_sec);
        }
        let violation = AssertionViolation {
            msg_id: msg.id.clone(),
            topic: msg.topic.clone(),
            rule_id: verdict.rule_id,
            expr: verdict.expr,
            outcome: verdict.outcome,
            ts_ms: msg.timestamp_ms,
        };
        if let Ok(mut recent) = self.recent.lock() {
            recent.push_back(violation.clone());
            while recent.len() > RECENT_CAP {
                recent.pop_front();
            }
        }
        Some(violation)
    }

    pub fn stats(&self) -> AssertStats {
        AssertStats {
            matched: self.matched.load(Ordering::Relaxed),
            passed: self.passed.load(Ordering::Relaxed),
            violated: self.violated.load(Ordering::Relaxed),
            unevaluable: self.unevaluable.load(Ordering::Relaxed),
        }
    }

    /// Newest first, because the panel shows "what just went wrong".
    pub fn recent(&self) -> Vec<AssertionViolation> {
        self.recent
            .lock()
            .map(|v| v.iter().rev().cloned().collect())
            .unwrap_or_default()
    }

    /// Zero the tallies without touching the rules: "start judging from now".
    pub fn reset(&self) {
        self.matched.store(0, Ordering::Relaxed);
        self.passed.store(0, Ordering::Relaxed);
        self.violated.store(0, Ordering::Relaxed);
        self.unevaluable.store(0, Ordering::Relaxed);
        if let Ok(mut v) = self.recent.lock() {
            v.clear();
        }
    }

    pub fn snapshot(&self) -> AssertionSnapshot {
        AssertionSnapshot {
            stats: self.stats(),
            rules: self.rule_count(),
            recent: self.recent(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::MqttGenericMessage;

    fn msg(topic: &str, payload: &str) -> MqttGenericMessage {
        MqttGenericMessage {
            id: "m".to_string(),
            topic: topic.to_string(),
            payload: payload.to_string(),
            payload_len: payload.len(),
            payload_base64: String::new(),
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
            direction: "in".to_string(),
            assertion: None,
        }
    }

    fn rule(pred: &str) -> AssertionRule {
        parse_rule("r1", "sensors/#", pred).expect("valid rule")
    }

    #[test]
    fn numbers_compare_as_numbers() {
        let r = rule("$.tempC < 80");
        assert_eq!(evaluate(&r, &msg("sensors/a", r#"{"tempC":70}"#)), AssertOutcome::Passed);
        assert_eq!(evaluate(&r, &msg("sensors/a", r#"{"tempC":95}"#)), AssertOutcome::Violated);
        // Quoted numbers are what devices actually send; the value is the same.
        assert_eq!(evaluate(&r, &msg("sensors/a", r#"{"tempC":"70"}"#)), AssertOutcome::Passed);
    }

    #[test]
    fn a_message_the_rule_cannot_read_is_unevaluable_not_a_pass() {
        let r = rule("$.tempC < 80");
        // Not JSON at all.
        assert_eq!(evaluate(&r, &msg("sensors/a", "bolt\n")), AssertOutcome::Unevaluable);
        // JSON without that member.
        assert_eq!(evaluate(&r, &msg("sensors/a", r#"{"fan":true}"#)), AssertOutcome::Unevaluable);
        // Present but null is also not a judgement about the value.
        assert_eq!(
            evaluate(&r, &msg("sensors/a", r#"{"tempC":null}"#)),
            AssertOutcome::Unevaluable
        );
    }

    #[test]
    fn exists_and_missing_judge_presence_itself() {
        assert_eq!(
            evaluate(&rule("$.deviceId exists"), &msg("sensors/a", r#"{"deviceId":"x"}"#)),
            AssertOutcome::Passed
        );
        assert_eq!(
            evaluate(&rule("$.deviceId exists"), &msg("sensors/a", "{}")),
            AssertOutcome::Violated
        );
        // A bare path reads as "must be present".
        assert_eq!(
            evaluate(&rule("$.firmware"), &msg("sensors/a", r#"{"firmware":"2.1"}"#)),
            AssertOutcome::Passed
        );
    }

    #[test]
    fn nested_paths_and_list_subscripts_reach_the_value() {
        let r = rule("$.metrics[0].v <= 5");
        assert_eq!(
            evaluate(&r, &msg("sensors/a", r#"{"metrics":[{"n":"t","v":4.5}]}"#)),
            AssertOutcome::Passed
        );
        assert_eq!(
            evaluate(&r, &msg("sensors/a", r#"{"metrics":[{"v":9}]}"#)),
            AssertOutcome::Violated
        );
        // Out of range is a missing value, so the rule cannot read it.
        assert_eq!(
            evaluate(&r, &msg("sensors/a", r#"{"metrics":[]}"#)),
            AssertOutcome::Unevaluable
        );
    }

    #[test]
    fn message_fields_are_judgeable_too() {
        let qos = rule("qos >= 1");
        assert_eq!(evaluate(&qos, &msg("sensors/a", "{}")), AssertOutcome::Passed);
        let size = rule("size < 4000");
        let mut big = msg("sensors/a", "{}");
        big.payload_len = 4_000;
        assert_eq!(evaluate(&size, &big), AssertOutcome::Violated);
        assert_eq!(evaluate(&size, &msg("sensors/a", "{}")), AssertOutcome::Passed);
        let contains = rule("payload contains panic");
        assert_eq!(
            evaluate(&contains, &msg("sensors/a", r#"{"m":"kernel panic"}"#)),
            AssertOutcome::Passed
        );
        assert_eq!(
            evaluate(&contains, &msg("sensors/a", r#"{"m":"fine"}"#)),
            AssertOutcome::Violated
        );
    }

    #[test]
    fn binary_payloads_are_unevaluable_for_text_rules_not_failures() {
        // A rule about text cannot judge a CBOR or image body; the row has to say
        // "cannot read" and not look like a broken device.
        let mut m = msg("sensors/a", "");
        m.payload_base64 = base64::engine::general_purpose::STANDARD.encode([0xff, 0xfe, 0x00]);
        assert_eq!(evaluate(&rule("payload contains ok"), &m), AssertOutcome::Unevaluable);
    }

    #[test]
    fn only_the_rules_whose_filter_matches_are_consulted() {
        let r = parse_rule("r", "other/topic", "$.v > 1").unwrap();
        assert_eq!(evaluate(&r, &msg("sensors/a", r#"{"v":9}"#)), AssertOutcome::Passed);
        assert!(judge(&[r], &msg("sensors/a", r#"{"v":9}"#)).is_none(), "no rule claimed it");
    }

    #[test]
    fn a_message_breaking_two_rules_is_one_red_row() {
        let rules = vec![rule("$.v > 100"), rule("$.name exists")];
        let verdict = judge(&rules, &msg("sensors/a", r#"{"v":1}"#)).unwrap();
        assert_eq!(verdict, AssertOutcome::Violated);
        // Violation outranks an unreadable sibling, and both outrank a pass.
        let mixed = vec![rule("$.v > 0"), rule("$.missing < 5")];
        assert_eq!(judge(&mixed, &msg("sensors/a", r#"{"v":1}"#)).unwrap(), AssertOutcome::Unevaluable);
    }

    #[test]
    fn bad_predicates_are_rejected_when_written_not_silently_never_firing() {
        for bad in [
            "$.tempC <> 80",
            "$.tempC > 1 &&",
            "$. == 1",
            "$.temp[abc] > 1",
            "$.temp[-2] > 1",
            "payload contains ",
        ] {
            let err = parse_rule("r", "sensors/#", bad);
            assert!(err.is_err(), "{bad:?} should not parse: {err:?}");
        }
        // Substring tests on a JSON node would stringify whole arrays, so they are
        // refused at add time instead of living on as a rule nobody can read.
        assert!(parse_rule("r", "sensors/#", "$.list contains x").is_err());
    }

    #[test]
    fn text_equality_keeps_the_spaces_a_message_literal_has() {
        // `==` compares text when either side is not a number, and the literal may
        // contain spaces - only the numeric operators are restricted.
        let r = rule("$.m == hello world");
        assert_eq!(evaluate(&r, &msg("sensors/a", r#"{"m":"hello world"}"#)), AssertOutcome::Passed);
        assert_eq!(evaluate(&r, &msg("sensors/a", r#"{"m":"hello"}"#)), AssertOutcome::Violated);
    }

    #[test]
    fn an_empty_filter_or_an_overlong_predicate_is_refused() {
        assert!(rule_error(&AssertionRule {
            id: "x".into(),
            filter: "  ".into(),
            field: Field::Qos,
            op: Op::Ge,
            expected: "1".into(),
            enabled: true,
            label: String::new(),
            text: String::new(),
        })
        .is_some());
        let mut long = rule("$.a == 1");
        long.expected = "z".repeat(MAX_EXPR_LEN);
        assert!(rule_error(&long).is_some());
    }

    #[test]
    fn a_negative_substring_rule_is_not_read_as_its_positive_form() {
        // `contains` is a substring of `!contains`; matching it first would leave the
        // bang on the wrong side and reject every negative rule.
        let r = rule("payload !contains panic");
        assert_eq!(r.op, Op::NotContains);
        assert_eq!(evaluate(&r, &msg("sensors/a", "kernel panic")), AssertOutcome::Violated);
        assert_eq!(evaluate(&r, &msg("sensors/a", "all good")), AssertOutcome::Passed);
        // The negative form on a JSON path is refused for the same reason as the
        // positive one - and the error has to say so, not blame the bang on the path.
        let err = parse_rule("r", "sensors/#", "$.name !contains x").unwrap_err();
        assert!(err.contains("contains"), "{err}");
    }

    #[test]
    fn a_saved_rule_shows_what_was_typed_not_a_canonical_reformat() {
        let r = parse_rule("r1", "sensors/#", "$.tempC  <  80 ").unwrap();
        assert_eq!(r.display(), "$.tempC  <  80");
        // A rule imported from an older file has no stored line; it still reads.
        let mut bare = r.clone();
        bare.text = String::new();
        assert!(bare.display().contains("tempC"), "{}", bare.display());
    }

    #[test]
    fn a_disabled_rule_says_nothing_at_all() {
        let mut r = rule("$.v > 10");
        r.enabled = false;
        assert!(judge(&[r], &msg("sensors/a", r#"{"v":1}"#)).is_none());
    }

    fn armed(predicates: &[&str]) -> AssertionEngine {
        let engine = AssertionEngine::default();
        let rules: Vec<AssertionRule> = predicates
            .iter()
            .enumerate()
            .map(|(i, p)| parse_rule(&format!("r{i}"), "sensors/#", p).expect("valid rule"))
            .collect();
        engine.sync_rules(rules).expect("sync");
        engine
    }

    #[test]
    fn the_engine_marks_the_row_it_judged() {
        let e = armed(&["$.tempC < 80"]);
        let mut m = msg("sensors/a", r#"{"tempC":95}"#);
        let violation = e.apply(&mut m).expect("a violation worth announcing");
        assert_eq!(m.assertion.as_ref().unwrap().outcome, AssertOutcome::Violated);
        assert_eq!(violation.topic, "sensors/a");
        assert_eq!(e.stats().violated, 1);
        // The row quotes the line that decided it, not just a colour.
        assert!(m.assertion.as_ref().unwrap().expr.contains("tempC"));
    }

    #[test]
    fn a_second_break_of_the_same_rule_is_counted_but_not_shouted_again() {
        // Only the event is throttled: the feed keeps every marked row, while the
        // app does not emit one IPC event per message at load-generator rates.
        let e = armed(&["$.tempC < 80"]);
        assert!(e.apply(&mut msg("sensors/a", r#"{"tempC":95}"#)).is_some());
        assert!(e.apply(&mut msg("sensors/b", r#"{"tempC":96}"#)).is_none());
        assert_eq!(e.stats().violated, 2);
        assert_eq!(e.recent().len(), 1);
    }

    #[test]
    fn an_unarmed_engine_touches_nothing() {
        let e = AssertionEngine::default();
        assert!(!e.is_active());
        let mut m = msg("sensors/a", "{}");
        assert!(e.apply(&mut m).is_none());
        assert!(m.assertion.is_none(), "no verdict on a row nobody asked about");
        assert_eq!(e.stats(), AssertStats::default());
    }

    #[test]
    fn a_pass_and_an_unreadable_message_are_counted_apart() {
        // "no violations" and "nothing arrived" have to stay distinguishable.
        let e = armed(&["$.tempC < 80"]);
        let _ = e.apply(&mut msg("sensors/a", r#"{"tempC":10}"#));
        let _ = e.apply(&mut msg("sensors/a", "bolt\n"));
        let s = e.stats();
        assert_eq!((s.matched, s.passed, s.violated, s.unevaluable), (2, 1, 0, 1));
    }

    #[test]
    fn a_bad_rule_set_is_rejected_whole_not_partly() {
        let e = AssertionEngine::default();
        let good = parse_rule("r1", "sensors/#", "$.v > 1").unwrap();
        let bad = AssertionRule {
            id: "r2".into(),
            filter: "sensors/#".into(),
            field: Field::Qos,
            op: Op::Ge,
            expected: "warm".into(),
            enabled: true,
            label: "fan".into(),
            text: "qos > warm".into(),
        };
        let err = e.sync_rules(vec![good, bad]).unwrap_err();
        assert!(err.contains("fan"), "{err}");
        assert!(!e.is_active(), "a rejected set must not half-apply");
    }

    #[test]
    fn two_rules_sharing_an_id_are_refused_not_last_one_wins() {
        let a = parse_rule("same", "sensors/#", "$.v > 1").unwrap();
        let b = parse_rule("same", "sensors/#", "$.v > 999").unwrap();
        let e = AssertionEngine::default();
        assert!(e.sync_rules(vec![a, b]).is_err());
    }

    #[test]
    fn reset_clears_the_tally_but_keeps_the_rules() {
        let e = armed(&["$.tempC < 80"]);
        let _ = e.apply(&mut msg("sensors/a", r#"{"tempC":95}"#));
        e.reset();
        assert_eq!(e.stats(), AssertStats::default());
        assert!(e.recent().is_empty());
        assert!(e.is_active(), "the rules are still armed");
        assert_eq!(e.rule_count(), 1);
    }

    #[test]
    fn a_row_claimed_by_two_rules_quotes_the_one_that_decided_it() {
        let e = armed(&["$.v > 100", "$.name exists"]);
        let mut m = msg("sensors/a", r#"{"v":1}"#);
        let verdict = e.apply(&mut m).unwrap();
        let owned = m.assertion.unwrap();
        assert_eq!(owned.outcome, AssertOutcome::Violated);
        assert_eq!(owned.rules, 2, "both rules claimed it");
        assert_eq!(verdict.rule_id, owned.rule_id);
    }
}
