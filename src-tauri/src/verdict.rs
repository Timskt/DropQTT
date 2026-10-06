//! The verdict vocabulary shared by the CLI's `verify` and by acceptance scenarios.
//!
//! Both answer the same question -- "did what we watched meet the bar" -- and both are
//! read by a CI that has no way to notice when the two disagree. Two things follow:
//! the three states live here once, and there is one JUnit writer.
//!
//! The states are not a boolean. `Unknown` is the one that matters: a rule that no
//! message matched, or a performance bar that was never set, proved nothing, and a
//! pipeline that reports that as green is worse than one that reports nothing at all.

use serde::Serialize;

/// Exit code for "ran, but proved nothing" lives with the rest of the contract, in
/// `cli`, because that is where it is documented and printed.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Pass,
    Fail,
    Unknown,
}

impl Outcome {
    pub fn word(self) -> &'static str {
        match self {
            Outcome::Pass => "pass",
            Outcome::Fail => "fail",
            Outcome::Unknown => "unknown",
        }
    }

    pub fn exit_code(self) -> i32 {
        match self {
            Outcome::Pass => crate::cli::EXIT_PASS,
            Outcome::Fail => crate::cli::EXIT_FAIL,
            Outcome::Unknown => crate::cli::EXIT_UNKNOWN,
        }
    }
}

/// Roll several claims up: any failure fails the run, anything unjudgeable withholds
/// the pass, and an empty set is not a pass either.
pub fn overall(cases: &[Outcome]) -> Outcome {
    if cases.contains(&Outcome::Fail) {
        return Outcome::Fail;
    }
    if cases.contains(&Outcome::Unknown) || cases.is_empty() {
        return Outcome::Unknown;
    }
    Outcome::Pass
}

/// The three-state rule for a set of message assertions: a violation fails, and
/// either "nothing matched this filter" or "nothing that matched could be judged"
/// withholds the verdict. Shared by `verify --assert` and by a scenario's assertion
/// claim, because the two used to state it separately and only agreed by luck.
pub fn tally(matched: u64, violated: u64, unevaluable: u64) -> Outcome {
    if violated > 0 {
        Outcome::Fail
    } else if matched == 0 || unevaluable > 0 {
        Outcome::Unknown
    } else {
        Outcome::Pass
    }
}

/// One judged claim. `id` names it in a language-independent way -- the desktop app
/// renders a localized label from it, the CLI prints the id -- and the numbers are
/// what was measured against what was required.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    pub id: String,
    pub state: Outcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    /// Only for the assertion claim: `[matched, violated, unevaluable]`, which is three
    /// numbers and does not fit the `actual / limit` shape the bars use.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counts: Option<[u64; 3]>,
}

impl Claim {
    pub fn bar(id: &str, state: Outcome, actual: Option<u64>, limit: Option<u64>) -> Self {
        Self { id: id.to_string(), state, actual, limit, counts: None }
    }

    pub fn bare(id: &str, state: Outcome) -> Self {
        Self { id: id.to_string(), state, actual: None, limit: None, counts: None }
    }
}

/// One rendered claim. `message` becomes the attribute a CI lists in its summary;
/// `body` is the longer sentence inside a `<failure>` element.
#[derive(Debug, Clone)]
pub struct Case {
    pub classname: String,
    pub name: String,
    pub outcome: Outcome,
    pub message: Option<String>,
    pub body: Option<String>,
}

impl Case {
    pub fn pass(classname: &str, name: String) -> Self {
        Self { classname: classname.to_string(), name, outcome: Outcome::Pass, message: None, body: None }
    }
}

/// A suite as JUnit knows it: a name, its cases, and optionally when it ran.
pub struct Suite<'a> {
    pub name: &'a str,
    pub cases: &'a [Case],
    pub timestamp: Option<&'a str>,
}

/// JUnit XML, so any CI can ingest a verdict without knowing this tool exists.
///
/// A pass is a bare `<testcase>`; an unjudgeable claim is `<skipped>` rather than a
/// quiet pass, because "the bar was never set" is exactly what the format's
/// skipped-with-reason element is for, and a green suite would lie about it.
pub fn junit(suite: &Suite) -> String {
    let failures = suite.cases.iter().filter(|c| c.outcome == Outcome::Fail).count();
    let skipped = suite.cases.iter().filter(|c| c.outcome == Outcome::Unknown).count();
    let counts = format!(
        "tests=\"{}\" failures=\"{failures}\" skipped=\"{skipped}\"",
        suite.cases.len()
    );
    let stamp = suite
        .timestamp
        .map(|at| format!(" timestamp=\"{}\"", escape_xml(at)))
        .unwrap_or_default();
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str(&format!(
        "<testsuites name=\"{}\" {counts}>\n",
        escape_xml(suite.name)
    ));
    out.push_str(&format!(
        "  <testsuite name=\"{}\" {counts}{stamp}>\n",
        escape_xml(suite.name)
    ));
    for case in suite.cases {
        let open = format!(
            "    <testcase classname=\"{}\" name=\"{}\" time=\"0\"",
            escape_xml(&case.classname),
            escape_xml(&case.name)
        );
        match case.outcome {
            Outcome::Pass => out.push_str(&format!("{open}/>\n")),
            Outcome::Fail => {
                let message = case.message.as_deref().unwrap_or("not met");
                let body = case.body.clone().unwrap_or_else(|| message.to_string());
                out.push_str(&format!("{open}>\n"));
                out.push_str(&format!(
                    "      <failure message=\"{}\" type=\"verdict\">{}</failure>\n",
                    escape_xml(message),
                    escape_xml(&body)
                ));
                out.push_str("    </testcase>\n");
            }
            Outcome::Unknown => {
                let message = case.message.as_deref().unwrap_or("not proven");
                out.push_str(&format!("{open}>\n"));
                out.push_str(&format!(
                    "      <skipped message=\"{}\"/>\n",
                    escape_xml(message)
                ));
                out.push_str("    </testcase>\n");
            }
        }
    }
    out.push_str("  </testsuite>\n</testsuites>\n");
    out
}

pub fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn case(name: &str, outcome: Outcome, message: Option<&str>, body: Option<&str>) -> Case {
        Case {
            classname: "dropqtt.test".into(),
            name: name.into(),
            outcome,
            message: message.map(str::to_string),
            body: body.map(str::to_string),
        }
    }

    #[test]
    fn an_empty_claim_set_is_not_a_pass() {
        assert_eq!(overall(&[]), Outcome::Unknown);
        assert_eq!(overall(&[Outcome::Pass, Outcome::Unknown]), Outcome::Unknown);
        assert_eq!(overall(&[Outcome::Unknown, Outcome::Fail]), Outcome::Fail);
        assert_eq!(overall(&[Outcome::Pass]), Outcome::Pass);
    }

    #[test]
    fn the_counts_on_both_elements_agree_with_the_cases() {
        let cases = vec![
            case("a", Outcome::Pass, None, None),
            case("b", Outcome::Fail, Some("3 violated"), Some("b: 3 of 12")),
            case("c", Outcome::Unknown, Some("no traffic"), None),
        ];
        let xml = junit(&Suite { name: "demo", cases: &cases, timestamp: None });
        assert_eq!(xml.matches("tests=\"3\"").count(), 2, "{xml}");
        assert_eq!(xml.matches("failures=\"1\"").count(), 2);
        assert_eq!(xml.matches("skipped=\"1\"").count(), 2);
        assert!(xml.contains("<testsuite "), "a bare testcase under <testsuites> is not what readers expect");
    }

    #[test]
    fn a_pass_is_bare_and_an_unproven_claim_explains_itself() {
        let cases = vec![
            case("ok", Outcome::Pass, None, None),
            case("none", Outcome::Unknown, Some("nothing matched"), None),
        ];
        let xml = junit(&Suite { name: "x", cases: &cases, timestamp: None });
        assert!(xml.contains("<testcase classname=\"dropqtt.test\" name=\"ok\" time=\"0\"/>"), "{xml}");
        assert!(xml.contains("<skipped message=\"nothing matched\"/>"));
        assert!(!xml.contains("<passed/>"), "JUnit has no passed element; a bare case is the pass");
    }

    #[test]
    fn a_failure_carries_both_a_summary_and_a_sentence() {
        let cases = vec![case("p99", Outcome::Fail, Some("not met"), Some("p99: 412 ms / 250 ms"))];
        let xml = junit(&Suite { name: "x", cases: &cases, timestamp: None });
        assert!(xml.contains("<failure message=\"not met\" type=\"verdict\">p99: 412 ms / 250 ms</failure>"), "{xml}");
    }

    #[test]
    fn markup_in_a_claim_name_cannot_escape_its_attribute() {
        let cases = vec![case(
            r#"><inject x=""#,
            Outcome::Fail,
            Some("<script>alert(1)</script>"),
            None,
        )];
        let xml = junit(&Suite { name: r#""quoted" & <name>"#, cases: &cases, timestamp: Some("2026-10-07T00:00:00Z") });
        assert!(!xml.contains(r#""inject"#), "{xml}");
        assert!(!xml.contains("<script>"), "{xml}");
        // The attribute delimiter stays a real quote; everything inside it is escaped.
        assert!(xml.contains(r#"name="&gt;&lt;inject x=&quot;"#), "{xml}");
        assert!(xml.contains("timestamp=\"2026-10-07T00:00:00Z\""));
    }

    #[test]
    fn the_three_state_rule_fails_on_a_violation_and_withholds_on_absence() {
        assert_eq!(tally(12, 3, 0), Outcome::Fail);
        assert_eq!(tally(0, 0, 0), Outcome::Unknown, "nothing matched proves nothing");
        assert_eq!(tally(4, 0, 1), Outcome::Unknown, "an unjudgeable message is not a pass");
        assert_eq!(tally(4, 0, 0), Outcome::Pass);
        // A violation outranks an unjudgeable message: the bad news is the reportable one.
        assert_eq!(tally(4, 1, 1), Outcome::Fail);
    }

    #[test]
    fn the_word_used_in_text_is_the_one_the_exit_code_agrees_with() {
        assert_eq!(Outcome::Unknown.word(), "unknown");
        assert_eq!(Outcome::Unknown.exit_code(), crate::cli::EXIT_UNKNOWN);
        assert_eq!(Outcome::Fail.exit_code(), crate::cli::EXIT_FAIL);
    }
}
