//! The acceptance scenario file, and the judgement it ends in.
//!
//! A `.dqscn` is five existing rule sets in one envelope, and the point of the whole
//! thing is the last line it prints: did this rig behave -- yes, no, or not proven.
//! That judgement used to exist only in `src/utils/scenario.ts`, which meant the
//! desktop app could grade a rig that `dropqtt-cli` could not read at all, and the two
//! would have disagreed the moment anyone tried. This module is that judgement, moved
//! to where both halves share one copy:
//!
//! - **The file model**, parsed as strictly as the app parses it: a wrong `format` is
//!   an error naming what it found, entries without their identifying strings are
//!   dropped rather than half-applied, and a file that survives parsing with nothing
//!   left in it is rejected instead of accepted.
//! - **The claims**, assembled from numbers the engines already produce. The bench bars
//!   come from `BenchSpec::evaluate`, the assertion state from `verdict::tally`. This
//!   module decides nothing on its own -- it arranges what was measured, which is why
//!   there is exactly one place to change when a rule changes.
//! - **The reports**, through the one JUnit writer in the project.
//!
//! Claim *labels* stay out on purpose. A claim carries an id (`minRate`, `assertions`)
//! and its numbers, so the app can phrase it in any of four languages and the CLI can
//! print the id, without either asking the other for a sentence.
//!
//! Redaction is inherited from the format rather than enforced twice: the app writes a
//! scenario with webhook targets already removed, and nothing here reads or prints them.

use serde::{Deserialize, Serialize};

use crate::assertions::{AssertionRule, AssertStats};
use crate::bench::{BenchExpect, BenchVerdict};
use crate::protocol::SubOptions;
use crate::verdict::{junit, overall, tally, Claim, Case, Outcome, Suite};

pub const SCENARIO_FORMAT: &str = "dropqtt-scenario/1";
pub const SCENARIO_EXTENSION: &str = "dqscn";

/// Claim ids. They end up as `<testcase name>` in someone's CI, so they are stable
/// strings rather than anything derived from a label.
pub mod claim {
    pub const MIN_RATE: &str = "minRate";
    pub const MAX_P99: &str = "maxP99Ms";
    pub const MAX_LOST: &str = "maxLost";
    pub const ASSERTIONS: &str = "assertions";
    pub const REFUSED: &str = "refusedSubscriptions";
    /// The scenario asked for nothing measurable: not a failure, and not a pass.
    pub const NO_BAR: &str = "noBarSet";
    /// The scenario asked for something this run never looked at.
    pub const NOT_RUN: &str = "notRun";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioSubscription {
    pub topic: String,
    #[serde(default)]
    pub qos: u8,
    #[serde(default)]
    pub options: SubOptions,
}

/// The bench spec minus what belongs to a live run. The bar is what a verdict needs;
/// the traffic parameters stay the app's to act on.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioBench {
    #[serde(default)]
    pub topics: Vec<String>,
    #[serde(default)]
    pub expect: Option<BenchExpect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub kind: String,
    pub format: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default)]
    pub subscriptions: Vec<ScenarioSubscription>,
    /// Counted, never applied: a headless run has no responder engine to install them
    /// into, and `notes()` says so instead of letting the rig look complete.
    #[serde(default)]
    pub responders: Vec<serde_json::Value>,
    #[serde(default)]
    pub assertions: Vec<AssertionRule>,
    #[serde(default)]
    pub silence: Vec<serde_json::Value>,
    #[serde(default)]
    pub bench: Option<ScenarioBench>,
}

/// A rule object is only usable if the strings that make it fire are present; anything
/// else is a half-written entry that would silently never match.
fn named(value: &serde_json::Value, keys: &[&str]) -> bool {
    keys.iter().all(|key| {
        value
            .get(*key)
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty())
    })
}

/// Parse a scenario exactly as strictly as the app does. Every rejection names what it
/// found, because these files usually arrive attached to a ticket.
pub fn parse(text: &str) -> Result<Scenario, String> {
    let raw: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("the file is not valid JSON ({e})"))?;
    if !raw.is_object() {
        return Err("the file holds no scenario object".to_string());
    }
    let doc = raw.as_object().expect("checked above");
    match doc.get("kind").and_then(|v| v.as_str()) {
        Some("scenario") => {}
        other => {
            let found = other.unwrap_or("none");
            return Err(format!("no scenario marker — is this a .{SCENARIO_EXTENSION} file? (kind: {found})"));
        }
    }
    let format = doc.get("format").and_then(|v| v.as_str()).unwrap_or("none");
    if format != SCENARIO_FORMAT {
        return Err(format!(
            "written by another format (\"{format}\"); this build reads {SCENARIO_FORMAT}"
        ));
    }
    let mut scenario: Scenario =
        serde_json::from_value(raw).map_err(|e| format!("the scenario could not be read: {e}"))?;

    scenario.subscriptions.retain(|s| !s.topic.trim().is_empty());
    scenario.assertions.retain(|a| !a.id.is_empty() && !a.filter.is_empty());
    scenario.responders.retain(|r| named(r, &["id", "trigger"]));
    scenario.silence.retain(|s| named(s, &["id", "topicFilter"]));
    if scenario.subscriptions.is_empty()
        && scenario.assertions.is_empty()
        && scenario.responders.is_empty()
        && scenario.silence.is_empty()
        && scenario.bench.is_none()
    {
        return Err("the scenario parsed fine but holds nothing to apply".to_string());
    }
    Ok(scenario)
}

/// What a bench run measured, beside the verdict those numbers produced. The verdict
/// decides pass or fail; the numbers are here so a passing bar can still show what it
/// passed at.
#[derive(Debug, Clone)]
pub struct BenchRun {
    pub verdict: BenchVerdict,
    pub rate: u64,
    /// `None` when nothing looped back, which is a different statement from "0 ms".
    pub p99_ms: Option<u64>,
    pub lost: u64,
}

impl BenchRun {
    fn measured(&self, id: &str) -> Option<u64> {
        match id {
            claim::MIN_RATE => Some(self.rate),
            claim::MAX_P99 => self.p99_ms,
            claim::MAX_LOST => Some(self.lost),
            _ => None,
        }
    }
}

/// What this run observed. `None` on a field means that part of the rig was never
/// exercised, which is a different answer from being exercised and producing zeroes.
#[derive(Debug, Clone, Default)]
pub struct Evidence {
    /// The bar the scenario asked for, if it set one.
    pub expect: Option<BenchExpect>,
    pub bench: Option<BenchRun>,
    /// Assertion tallies, if any rules were armed.
    pub assertions: Option<AssertStats>,
    /// Subscriptions the broker refused.
    pub refused: u64,
}

/// The bars this scenario actually asked for, in the order a report should read them.
fn asked_for(expect: &BenchExpect) -> Vec<&'static str> {
    let mut ids = Vec::new();
    if expect.min_rate.is_some() {
        ids.push(claim::MIN_RATE);
    }
    if expect.max_p99_ms.is_some() {
        ids.push(claim::MAX_P99);
    }
    if expect.max_lost.is_some() {
        ids.push(claim::MAX_LOST);
    }
    ids
}

fn limit_of(expect: &BenchExpect, id: &str) -> Option<u64> {
    match id {
        claim::MIN_RATE => expect.min_rate.map(u64::from),
        claim::MAX_P99 => expect.max_p99_ms,
        claim::MAX_LOST => expect.max_lost,
        _ => None,
    }
}

/// The claims this evidence supports. Absence is reported as `unknown` rather than
/// folded into either verdict; that distinction is the whole reason the CLI has a
/// fourth exit code.
pub fn claims(evidence: &Evidence) -> Vec<Claim> {
    let mut out = Vec::new();
    match (&evidence.expect, &evidence.bench) {
        (None, _) => out.push(Claim::bare(claim::NO_BAR, Outcome::Unknown)),
        // A bar with no run behind it is the case most easily mistaken for a pass:
        // the scenario asked for something and this run never looked.
        (Some(_), None) => out.push(Claim::bare(claim::NOT_RUN, Outcome::Unknown)),
        (Some(expect), Some(run)) => {
            let state = |id: &str| {
                if !run.verdict.settled {
                    // A rate measured over 200 ms is a sample, not a verdict.
                    Outcome::Unknown
                } else if run.verdict.failures.iter().any(|f| f.kind == id) {
                    Outcome::Fail
                } else {
                    Outcome::Pass
                }
            };
            for id in asked_for(expect) {
                out.push(Claim::bar(id, state(id), run.measured(id), limit_of(expect, id)));
            }
        }
    }

    if let Some(stats) = &evidence.assertions {
        out.push(Claim {
            id: claim::ASSERTIONS.to_string(),
            state: tally(stats.matched, stats.violated, stats.unevaluable),
            actual: Some(stats.violated),
            limit: Some(stats.matched),
            counts: Some([stats.matched, stats.violated, stats.unevaluable]),
        });
    }
    if evidence.refused > 0 {
        out.push(Claim::bar(claim::REFUSED, Outcome::Fail, Some(evidence.refused), Some(0)));
    }
    out
}

pub fn verdict_of(claims: &[Claim]) -> Outcome {
    overall(&claims.iter().map(|c| c.state).collect::<Vec<_>>())
}

/// What a run measured, as the panel sees it. `settled` is false while a bench is
/// still going, because a rate taken over 200 ms is a sample rather than a verdict.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Measurement {
    pub sent: u64,
    pub acked: u64,
    pub rate: u64,
    #[serde(default)]
    pub p99_ms: Option<u64>,
    #[serde(default)]
    pub settled: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerdictRequest {
    /// The bar the scenario asked for.
    #[serde(default)]
    pub expect: Option<BenchExpect>,
    #[serde(default)]
    pub measurement: Option<Measurement>,
    #[serde(default)]
    pub assertions: Option<AssertStats>,
    #[serde(default)]
    pub refused: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    pub claims: Vec<Claim>,
    /// Derived here rather than recomputed by whoever renders it: a panel that rolled
    /// the claims up its own way is a second verdict waiting to disagree.
    pub overall: Outcome,
}

/// The judgement the desktop panel displays and the CLI prints, from the same call.
pub fn judge(request: VerdictRequest) -> Verdict {
    let evidence = match &request.measurement {
        Some(m) => {
            let verdict = request
                .expect
                .as_ref()
                .map(|expect| {
                    crate::bench::evaluate_expect(
                        expect,
                        m.sent,
                        m.acked,
                        m.rate,
                        m.p99_ms,
                        m.settled,
                    )
                })
                .map(|verdict| BenchRun {
                    rate: m.rate,
                    p99_ms: m.p99_ms,
                    lost: m.sent.saturating_sub(m.acked),
                    verdict,
                });
            Evidence {
                expect: request.expect.clone(),
                bench: verdict,
                assertions: request.assertions,
                refused: request.refused,
            }
        }
        None => Evidence {
            expect: request.expect.clone(),
            bench: None,
            assertions: request.assertions,
            refused: request.refused,
        },
    };
    let claims = claims(&evidence);
    Verdict { overall: verdict_of(&claims), claims }
}

/// A report request. The claims are *not* accepted from the caller: the same evidence
/// is judged again here, so a report cannot be talked into saying something the
/// verdict would not.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRequest {
    #[serde(flatten)]
    pub evidence: VerdictRequest,
    pub name: String,
    #[serde(default)]
    pub note: Option<String>,
    pub generated_at: String,
    /// One label per claim, in the reader's language, same order as the verdict.
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub words: ReportWords,
    /// "json" or "junit".
    pub format: String,
}

pub fn report(request: ReportRequest) -> String {
    let verdict = judge(request.evidence);
    match request.format.as_str() {
        "junit" => report_junit(
            &request.name,
            &request.generated_at,
            &verdict.claims,
            &request.words,
            &request.labels,
        ),
        _ => report_json(
            &request.name,
            request.note.as_deref(),
            &request.generated_at,
            &verdict.claims,
        ),
    }
}

/// The JSON a CI log reads. `overall` is derived here rather than stored, so it cannot
/// disagree with the claims printed beside it.
pub fn report_json(name: &str, note: Option<&str>, generated_at: &str, claims: &[Claim]) -> String {
    let doc = serde_json::json!({
        "format": "dropqtt-scenario-report/1",
        "generatedAt": generated_at,
        "scenario": { "name": name, "note": note },
        "overall": verdict_of(claims).word(),
        "claims": claims,
    });
    let mut text = serde_json::to_string_pretty(&doc).unwrap_or_else(|_| "{}".to_string());
    text.push('\n');
    text
}

/// The words a report wraps around the two non-pass states. The CLI gets English; the
/// app passes its own locale in, which is why this is data and not a constant.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReportWords {
    pub fail: String,
    pub unknown: String,
}

impl Default for ReportWords {
    fn default() -> Self {
        Self {
            fail: "not met".to_string(),
            unknown: "not proven".to_string(),
        }
    }
}

/// JUnit: a missed bar is a `<failure>`, an ungradeable claim is a `<skipped>` that
/// says why, and a pass is a bare `<testcase>`. `labels` is positional -- one name per
/// claim, in the reader's language -- and a missing entry falls back to the claim id.
pub fn report_junit(
    name: &str,
    generated_at: &str,
    claims: &[Claim],
    words: &ReportWords,
    labels: &[String],
) -> String {
    let cases = claims
        .iter()
        .enumerate()
        .map(|(index, claim)| {
            let shown = labels
                .get(index)
                .cloned()
                .unwrap_or_else(|| claim.id.clone());
            Case {
                classname: "dropqtt.scenario".into(),
                name: shown.clone(),
                outcome: claim.state,
                message: match claim.state {
                    Outcome::Pass => None,
                    Outcome::Fail => Some(words.fail.clone()),
                    Outcome::Unknown => Some(words.unknown.clone()),
                },
                body: Some(format!("{}: {}", shown, describe(claim))),
            }
        })
        .collect::<Vec<_>>();
    junit(&Suite { name, cases: &cases, timestamp: Some(generated_at) })
}

/// The `actual / limit` text both surfaces show. Numbers only, so it needs no
/// translation and cannot disagree about what was measured.
pub fn describe(claim: &Claim) -> String {
    if let Some([matched, violated, unevaluable]) = claim.counts {
        return format!("{violated} violated, {unevaluable} unevaluable of {matched} matched");
    }
    match (claim.actual, claim.limit) {
        (Some(actual), Some(limit)) => format!("{actual} / {limit}"),
        (Some(actual), None) => actual.to_string(),
        (None, Some(limit)) => format!("no measurement, bar was {limit}"),
        (None, None) => claim.state.word().to_string(),
    }
}

/// What a headless run leaves out of this rig, in plain language. The app's apply plan
/// has the same idea for the same reason: a rig that is quietly missing half its
/// watchdogs must not be reported as the rig.
pub fn notes(scenario: &Scenario, is_v5: bool) -> Vec<String> {
    let mut out = Vec::new();
    if !scenario.responders.is_empty() {
        out.push(if is_v5 {
            format!(
                "{} responder rule(s) were not armed: a headless run has no responder engine",
                scenario.responders.len()
            )
        } else {
            format!(
                "{} responder rule(s) need an MQTT v5 connection and were not armed",
                scenario.responders.len()
            )
        });
    }
    if !scenario.silence.is_empty() {
        out.push(format!(
            "{} watchdog rule(s) were not armed: they alert on elapsed silence, and this run ends when its window does",
            scenario.silence.len()
        ));
    }
    if scenario.bench.as_ref().and_then(|b| b.expect.as_ref()).is_none() {
        out.push("the scenario sets no performance bar, so rate claims cannot be judged".to_string());
    }
    out
}

/// A file-name-safe form of a scenario name, matching what the app suggests so a
/// report written by either half sorts beside the other.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            out.push(ch);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed: String = out.trim_matches('-').chars().take(48).collect();
    let trimmed = trimmed.trim_matches('-');
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bench::BenchFailure;

    const HEAD: &str = r#"{ "kind": "scenario", "format": "dropqtt-scenario/1", "name": "rig""#;

    fn scenario(text: &str) -> Scenario {
        parse(text).expect("parses")
    }

    fn run(settled: bool, rate: u64, p99: Option<u64>, lost: u64, failures: Vec<BenchFailure>) -> BenchRun {
        BenchRun {
            verdict: BenchVerdict { settled, failures },
            rate,
            p99_ms: p99,
            lost,
        }
    }

    #[test]
    fn a_scenario_needs_its_marker_and_its_format() {
        assert!(parse(r#"{ "name": "x" }"#).unwrap_err().contains("scenario marker"));
        let wrong = r#"{ "kind": "scenario", "format": "dropqtt-scenario/2", "name": "x" }"#;
        let err = parse(wrong).unwrap_err();
        assert!(err.contains("dropqtt-scenario/2"), "{err}");
        assert!(err.contains(SCENARIO_FORMAT), "{err}");
        assert!(parse("[]").unwrap_err().contains("no scenario object"));
    }

    #[test]
    fn an_empty_scenario_is_rejected_rather_than_applied_as_nothing() {
        let empty = format!("{HEAD}, \"subscriptions\": [], \"responders\": [], \"assertions\": [], \"silence\": [] }}");
        assert!(parse(&empty).unwrap_err().contains("nothing to apply"));
    }

    #[test]
    fn junk_entries_are_dropped_and_the_good_ones_survive() {
        let mixed = format!(
            "{HEAD}, \"subscriptions\": [{{ \"topic\": \"  \" }}, {{ \"topic\": \"a/b\", \"qos\": 1 }}],
             \"assertions\": [{{ \"id\": \"\", \"filter\": \"f\", \"field\": \"qos\", \"op\": \"ge\" }},
                              {{ \"id\": \"r2\", \"filter\": \"a/b\", \"field\": \"qos\", \"op\": \"ge\" }}],
             \"responders\": [{{ \"id\": \"x\" }}],
             \"silence\": [{{ \"id\": \"s\", \"topicFilter\": \"a/b\" }}] }}"
        );
        let parsed = scenario(&mixed);
        assert_eq!(parsed.subscriptions.len(), 1);
        assert_eq!(parsed.subscriptions[0].topic, "a/b");
        assert_eq!(parsed.subscriptions[0].options.qos, 1);
        assert_eq!(parsed.assertions.len(), 1);
        assert!(parsed.responders.is_empty(), "a responder with no trigger cannot fire");
        assert_eq!(parsed.silence.len(), 1);
    }

    #[test]
    fn an_assertion_entry_missing_what_the_engine_needs_is_refused_not_dropped() {
        // Silently dropping a rule would make the run greener, so this one is loud.
        let broken = format!(
            "{HEAD}, \"assertions\": [{{ \"id\": \"r\", \"filter\": \"a/b\" }}] }}"
        );
        let err = parse(&broken).unwrap_err();
        assert!(err.contains("field"), "{err}");
    }

    #[test]
    fn a_file_whose_only_content_is_junk_still_counts_as_empty() {
        let junk = format!("{HEAD}, \"subscriptions\": [{{ \"topic\": \"\" }}] }}");
        assert!(parse(&junk).unwrap_err().contains("nothing to apply"));
    }

    #[test]
    fn a_bar_that_was_never_set_withholds_the_verdict() {
        let claims = claims(&Evidence::default());
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].id, claim::NO_BAR);
        assert_eq!(verdict_of(&claims), Outcome::Unknown);
    }

    #[test]
    fn a_bar_with_no_run_behind_it_is_not_a_pass() {
        let evidence = Evidence {
            expect: Some(BenchExpect { min_rate: Some(100), max_p99_ms: None, max_lost: None }),
            ..Evidence::default()
        };
        let claims = claims(&evidence);
        assert_eq!(claims.len(), 1, "one unlooked-at claim, not one per bar");
        assert_eq!(claims[0].id, claim::NOT_RUN);
        assert_eq!(verdict_of(&claims), Outcome::Unknown);
    }

    #[test]
    fn an_unsettled_run_reports_every_bar_as_unproven() {
        let evidence = Evidence {
            expect: Some(BenchExpect { min_rate: Some(100), max_p99_ms: Some(250), max_lost: None }),
            bench: Some(run(false, 1200, Some(40), 0, vec![])),
            ..Evidence::default()
        };
        let claims = claims(&evidence);
        assert_eq!(claims.len(), 2);
        assert!(claims.iter().all(|c| c.state == Outcome::Unknown));
        assert_eq!(verdict_of(&claims), Outcome::Unknown);
    }

    #[test]
    fn a_settled_run_judges_each_bar_from_the_failures_it_was_given() {
        let evidence = Evidence {
            expect: Some(BenchExpect { min_rate: Some(100), max_p99_ms: Some(250), max_lost: None }),
            bench: Some(run(
                true,
                1200,
                Some(412),
                0,
                vec![BenchFailure { kind: claim::MAX_P99.to_string(), limit: 250, actual: Some(412) }],
            )),
            ..Evidence::default()
        };
        let claims = claims(&evidence);
        let rate = claims.iter().find(|c| c.id == claim::MIN_RATE).unwrap();
        let p99 = claims.iter().find(|c| c.id == claim::MAX_P99).unwrap();
        assert_eq!(rate.state, Outcome::Pass);
        assert_eq!(rate.actual, Some(1200), "a pass still says what it was passed at");
        assert_eq!(rate.limit, Some(100));
        assert_eq!(p99.state, Outcome::Fail);
        assert_eq!(describe(p99), "412 / 250");
        assert_eq!(verdict_of(&claims), Outcome::Fail);
    }

    #[test]
    fn a_missing_latency_sample_says_so_instead_of_claiming_a_number() {
        let evidence = Evidence {
            expect: Some(BenchExpect { min_rate: None, max_p99_ms: Some(250), max_lost: None }),
            bench: Some(run(
                true,
                0,
                None,
                0,
                vec![BenchFailure { kind: claim::MAX_P99.to_string(), limit: 250, actual: None }],
            )),
            ..Evidence::default()
        };
        let claims = claims(&evidence);
        assert_eq!(claims[0].state, Outcome::Fail);
        assert_eq!(describe(&claims[0]), "no measurement, bar was 250");
    }

    #[test]
    fn assertion_counts_carry_the_three_numbers_that_explain_them() {
        let evidence = Evidence {
            assertions: Some(AssertStats { matched: 12, passed: 9, violated: 3, unevaluable: 0 }),
            ..Evidence::default()
        };
        let claims = claims(&evidence);
        let assertion = claims.iter().find(|c| c.id == claim::ASSERTIONS).unwrap();
        assert_eq!(assertion.state, Outcome::Fail);
        assert_eq!(describe(assertion), "3 violated, 0 unevaluable of 12 matched");
        assert_eq!(verdict_of(&claims), Outcome::Fail, "a violation outranks an unset bar");
    }

    #[test]
    fn a_scenario_with_no_bar_cannot_be_graded_even_when_every_assertion_passes() {
        let evidence = Evidence {
            assertions: Some(AssertStats { matched: 5, passed: 5, violated: 0, unevaluable: 0 }),
            ..Evidence::default()
        };
        let claims = claims(&evidence);
        assert_eq!(claims[0].id, claim::NO_BAR);
        assert_eq!(verdict_of(&claims), Outcome::Unknown, "which is the same answer the panel gives");
    }

    #[test]
    fn a_refused_subscription_fails_even_when_everything_else_looks_healthy() {
        let evidence = Evidence {
            assertions: Some(AssertStats { matched: 5, passed: 5, violated: 0, unevaluable: 0 }),
            refused: 1,
            ..Evidence::default()
        };
        let claims = claims(&evidence);
        assert!(claims.iter().any(|c| c.id == claim::REFUSED && c.state == Outcome::Fail));
        assert_eq!(verdict_of(&claims), Outcome::Fail);
    }

    #[test]
    fn a_clean_run_of_everything_is_the_only_green() {
        let evidence = Evidence {
            expect: Some(BenchExpect { min_rate: Some(100), max_p99_ms: None, max_lost: Some(0) }),
            bench: Some(run(true, 1200, None, 0, vec![])),
            assertions: Some(AssertStats { matched: 5, passed: 5, violated: 0, unevaluable: 0 }),
            refused: 0,
        };
        let claims = claims(&evidence);
        assert_eq!(claims.len(), 3);
        assert_eq!(verdict_of(&claims), Outcome::Pass);
    }

    #[test]
    fn the_json_report_derives_its_overall_from_the_claims_it_prints() {
        let claims = claims(&Evidence {
            assertions: Some(AssertStats::default()),
            ..Evidence::default()
        });
        let text = report_json("rig", None, "2026-10-07T00:00:00Z", &claims);
        let doc: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(doc["overall"], "unknown");
        assert_eq!(doc["format"], "dropqtt-scenario-report/1");
        let assertion = doc["claims"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == claim::ASSERTIONS)
            .expect("the assertion claim is present");
        assert_eq!(assertion["state"], "unknown");
        assert_eq!(assertion["counts"], serde_json::json!([0, 0, 0]));
    }

    #[test]
    fn the_junit_report_skips_what_it_could_not_judge() {
        let claims = vec![
            Claim::bar(claim::MIN_RATE, Outcome::Pass, Some(120), Some(100)),
            Claim::bar(claim::MAX_P99, Outcome::Fail, Some(412), Some(250)),
            Claim::bare(claim::NOT_RUN, Outcome::Unknown),
        ];
        let xml = report_junit("rig", "2026-10-07T00:00:00Z", &claims, &ReportWords::default(), &[]);
        assert!(xml.starts_with("<?xml version=\"1.0\""), "{xml}");
        assert!(xml.contains("tests=\"3\" failures=\"1\" skipped=\"1\""), "{xml}");
        assert!(xml.contains("<skipped message=\"not proven\"/>"), "{xml}");
        assert!(xml.contains("412 / 250"), "{xml}");
        assert!(xml.contains("timestamp=\"2026-10-07T00:00:00Z\""));
        assert!(!xml.contains("minRate: 120 / 100\">"), "a pass has no body to open");
    }

    #[test]
    fn a_scenario_name_cannot_write_a_path_into_a_file_name() {
        for hostile in ["../../etc/passwd", "..\\..\\windows", "  ", "", "a/b\\c"] {
            let out = slug(hostile);
            assert!(!out.is_empty(), "{hostile:?} slugged to nothing");
            assert!(!out.contains('/') && !out.contains('\\'), "{hostile:?} -> {out}");
            assert!(out.len() <= 48, "{out}");
        }
        assert_eq!(slug("  "), "untitled");
        assert_eq!(slug("Fleet A / Q3"), "fleet-a-q3");
    }

    #[test]
    fn a_headless_run_says_which_parts_of_the_rig_it_left_out() {
        let parsed = scenario(
            r#"{ "kind": "scenario", "format": "dropqtt-scenario/1", "name": "rig",
                "subscriptions": [{ "topic": "a/b" }],
                "responders": [{ "id": "r", "trigger": "a/b" }],
                "silence": [{ "id": "s", "topicFilter": "a/b" }] }"#,
        );
        let v5 = notes(&parsed, true);
        assert!(v5.iter().any(|n| n.contains("responder") && n.contains("no responder engine")), "{v5:?}");
        assert!(v5.iter().any(|n| n.contains("watchdog")), "{v5:?}");
        assert!(v5.iter().any(|n| n.contains("no performance bar")), "{v5:?}");
        let v3 = notes(&parsed, false);
        assert!(v3[0].contains("v5 connection"), "{v3:?}");
    }

    #[test]
    fn xml_metacharacters_in_a_name_cannot_open_a_new_element() {
        let claims = vec![Claim::bare(r#"x" onload="alert(1)"#, Outcome::Pass)];
        let xml = report_junit(
            r#"<name onload="x">"#,
            "2026-10-07T00:00:00Z",
            &claims,
            &ReportWords::default(),
            &[],
        );
        assert!(!xml.contains("<name onload"), "{xml}");
        assert!(xml.contains("&lt;name onload"), "{xml}");
        assert!(xml.contains("&quot; onload=&quot;"), "{xml}");
    }

    fn request(
        expect: Option<BenchExpect>,
        measurement: Option<Measurement>,
        assertions: Option<AssertStats>,
        refused: u64,
    ) -> VerdictRequest {
        VerdictRequest { expect, measurement, assertions, refused }
    }

    #[test]
    fn judging_a_measured_run_is_the_same_code_path_as_printing_its_report() {
        let expect = BenchExpect { min_rate: Some(1000), max_p99_ms: None, max_lost: None };
        let measured = Measurement { sent: 100, acked: 100, rate: 1200, p99_ms: None, settled: true };
        let verdict = judge(request(Some(expect), Some(measured), None, 0));
        assert_eq!(verdict.claims.len(), 1);
        assert_eq!(verdict.claims[0].state, Outcome::Pass);
        assert_eq!(verdict.overall, Outcome::Pass);
    }

    #[test]
    fn a_measured_run_below_its_bar_fails_with_the_number_that_missed() {
        let expect = BenchExpect { min_rate: Some(5000), max_p99_ms: None, max_lost: None };
        let measured = Measurement { sent: 100, acked: 100, rate: 1200, p99_ms: None, settled: true };
        let verdict = judge(request(Some(expect), Some(measured), None, 0));
        assert_eq!(verdict.claims[0].state, Outcome::Fail);
        assert_eq!(describe(&verdict.claims[0]), "1200 / 5000");
        assert_eq!(verdict.overall, Outcome::Fail);
    }

    #[test]
    fn lost_is_unanswered_publishes_and_a_run_still_going_is_not_a_verdict() {
        let expect = BenchExpect { min_rate: None, max_p99_ms: None, max_lost: Some(0) };
        let running = Measurement { sent: 100, acked: 90, rate: 10, p99_ms: None, settled: false };
        let verdict = judge(request(Some(expect.clone()), Some(running), None, 0));
        assert_eq!(verdict.claims[0].state, Outcome::Unknown, "still measuring");
        let settled = Measurement { sent: 100, acked: 90, rate: 10, p99_ms: None, settled: true };
        let verdict = judge(request(Some(expect), Some(settled), None, 0));
        assert_eq!(verdict.claims[0].state, Outcome::Fail);
        assert_eq!(verdict.claims[0].actual, Some(10), "10 of 100 never answered");
    }

    #[test]
    fn a_report_re_judges_the_evidence_rather_than_trusting_claims_it_was_handed() {
        let evidence = request(
            None,
            None,
            Some(AssertStats { matched: 4, passed: 4, violated: 0, unevaluable: 0 }),
            0,
        );
        let text = report(ReportRequest {
            evidence,
            name: "rig".into(),
            note: None,
            generated_at: "2026-10-07T00:00:00Z".into(),
            labels: vec!["报文断言".into(), "结论".into()],
            words: ReportWords::default(),
            format: "json".into(),
        });
        let doc: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(doc["overall"], "unknown", "an unmeasured bar keeps the run honest");
        assert_eq!(doc["claims"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn localized_labels_land_where_the_reader_needs_them() {
        let evidence = request(
            None,
            None,
            Some(AssertStats { matched: 4, passed: 3, violated: 1, unevaluable: 0 }),
            0,
        );
        let xml = report(ReportRequest {
            evidence,
            name: "rig".into(),
            note: None,
            generated_at: "2026-10-07T00:00:00Z".into(),
            labels: vec!["结论".into(), "报文断言".into()],
            words: ReportWords { fail: "未达标".into(), unknown: "未证明".into() },
            format: "junit".into(),
        });
        assert!(xml.contains("name=\"报文断言\""), "{xml}");
        assert!(xml.contains("<failure message=\"未达标\""), "{xml}");
        assert!(xml.contains("报文断言: 1 violated"), "{xml}");
    }
}
