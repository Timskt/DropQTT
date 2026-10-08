//! The headless CLI's decisions, kept free of I/O so they can be tested like any
//! other pure module.
//!
//! Why this lives in the library rather than in the binary: the whole point of a CLI
//! here is that it verifies the *same* protocol behaviour the desktop app shows. So it
//! reuses `transport`, `assertions` and `topic` directly instead of reimplementing a
//! second MQTT client in another language — which is exactly how the tool we compare
//! against ended up with a CLI that disagrees with its own GUI.
//!
//! Two rules this module holds to:
//! - **Exit codes are a contract.** A CI step must be able to tell "the broker refused"
//!   from "the assertion did not hold" from "we never got to look". Those are different
//!   numbers, and changing one later breaks someone's pipeline.
//! - **No secret ever comes from the command line.** Arguments are visible in the
//!   process list and in shell history, so credentials are read from an environment
//!   variable and the resolved value is never printed.

use base64::Engine;
use serde::Serialize;

use crate::protocol::{BrokerConfig, MqttGenericMessage, SubOptions};
use crate::transport::NormalizedPublish;
use crate::verdict::{junit, overall, tally, Case, Outcome, Suite};

/// The verdict held.
pub const EXIT_PASS: i32 = 0;
/// A broker refusal, or an assertion that demonstrably did not hold.
pub const EXIT_FAIL: i32 = 1;
/// The command line itself was wrong; nothing was attempted.
pub const EXIT_USAGE: i32 = 2;
/// Could not reach or stay connected to the broker, so nothing was measured.
pub const EXIT_UNAVAILABLE: i32 = 3;
/// Ran, but proved nothing: nothing matched, or a predicate could not be evaluated.
/// Distinct from a failure on purpose — "not proven" must never read as "passed".
pub const EXIT_UNKNOWN: i32 = 4;

/// `--count` without `--for` still has to end: a CI step that waits forever on
/// traffic that never comes is worse than one that fails, because it holds the
/// runner instead of reporting.
pub const COUNT_WAIT_MS: u64 = 30_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verb {
    Connect,
    Sub,
    Pub,
    Rpc,
    Verify,
}

impl Verb {
    pub fn name(self) -> &'static str {
        match self {
            Verb::Connect => "connect",
            Verb::Sub => "sub",
            Verb::Pub => "pub",
            Verb::Rpc => "rpc",
            Verb::Verify => "verify",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BrokerOpts {
    pub host: String,
    pub port: u16,
    pub tls: bool,
    pub websocket: bool,
    pub client_id: String,
    pub username: Option<String>,
    /// Name of the environment variable holding the password, never the password.
    pub password_env: Option<String>,
    pub protocol_version: u8,
    pub keep_alive_secs: u64,
    pub clean_session: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectCmd {
    pub broker: BrokerOpts,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubCmd {
    pub broker: BrokerOpts,
    pub filters: Vec<String>,
    pub options: SubOptions,
    /// Stop after this many messages, or after `duration_ms`, whichever comes first.
    /// `None` on both means the command runs until interrupted.
    pub count: Option<u64>,
    pub duration_ms: Option<u64>,
    pub print_payload: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PubCmd {
    pub broker: BrokerOpts,
    pub topic: String,
    pub payload: Vec<u8>,
    pub qos: u8,
    pub retain: bool,
    pub content_type: Option<String>,
    pub response_topic: Option<String>,
    pub correlation_hex: Option<String>,
    pub user_properties: Vec<(String, String)>,
    pub ack_timeout_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RpcCmd {
    pub broker: BrokerOpts,
    pub topic: String,
    pub payload: Vec<u8>,
    pub qos: u8,
    /// An explicit response topic; otherwise the broker's `response-information`
    /// is used when it offers one.
    pub response_topic: Option<String>,
    pub correlation_hex: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifyCmd {
    pub broker: BrokerOpts,
    pub filters: Vec<String>,
    pub qos: u8,
    /// `(id, filter, predicate)` triples, in the order given. The predicate grammar
    /// is the desktop app's — `assertions::parse_rule` owns it, so a rule that is
    /// accepted here means the same thing in both places.
    pub asserts: Vec<(String, String, String)>,
    /// A `.dqscn` file whose subscriptions get armed and whose assertion rules join
    /// the ones passed on the command line. See `scenario`.
    pub scenario: Option<String>,
    pub count: Option<u64>,
    pub duration_ms: Option<u64>,
    pub json: bool,
    pub junit: bool,
    /// Generate the scenario's bench traffic, so its performance bar is measured
    /// rather than reported as not run.
    pub bench: Option<BenchDrive>,
}

/// How hard `verify --scenario` drives the scenario's bench topics. The rate is never
/// taken from the bar itself: driving at exactly `minRate` turns pacing jitter into a
/// coin flip, and choosing a margin is the rig author's call, not ours.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BenchDrive {
    pub rate: u32,
    pub size: u32,
    pub qos: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Help,
    Version,
    Connect(ConnectCmd),
    Sub(SubCmd),
    Pub(PubCmd),
    Rpc(RpcCmd),
    Verify(VerifyCmd),
}

/// A rejected command line. The text is user-facing, so it names the flag at fault
/// rather than reporting a position in an argument vector.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageError(pub String);

impl std::fmt::Display for UsageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

pub fn usage() -> String {
    [
        "dropqtt-cli — the DropQTT protocol engine without the window",
        "",
        "  dropqtt-cli --version",
        "USAGE:",
        "  dropqtt-cli connect [broker options] [--timeout 5s]",
        "  dropqtt-cli sub     [broker options] --topic <filter>... [--qos N] [--no-local]",
        "                      [--retain-handling 0|1|2] [--count N | --for 10s] [--payload]",
        "  dropqtt-cli pub     [broker options] --topic <t> (--payload <text> | --payload-file <path>)",
        "                      [--qos N] [--retain] [--content-type <mt>] [--response-topic <t>]",
        "                      [--correlation-hex <hex>] [--user-property <k=v>]... [--wait 5s]",
        "  dropqtt-cli rpc     [broker options] --topic <t> [--payload <text> | --payload-file <path>]",
        "                      [--response-topic <t>] [--correlation-hex <hex>] [--timeout 5s]",
        "  dropqtt-cli verify  [broker options] (--topic <filter>... --assert '<expr>'...",
        "                      | --scenario <file.dqscn>) [--count N | --for 10s] [--json] [--junit]",
        "                      [--bench-rate N [--bench-size B] [--bench-qos 0|1|2]]",
        "",
        "BROKER OPTIONS:",
        "  --host <h> --port <n> [--tls] [--ws] [--client-id <id>] [--username <u> | --username-env <VAR>]",
        "  [--password-env <VAR>] [-V 5|3] [--keepalive <secs>] [--no-clean]",
        "",
        "  A password is never taken from the command line: arguments are visible in the",
        "  process list and in shell history. Point --password-env at a variable instead.",
        "",
        "ASSERTIONS (verify):",
        "  The same grammar the desktop app uses, e.g.",
        "    '$.tempC < 80'          a JSON field comparison",
        "    'qos >= 1'              a packet-level field",
        "    '$.fw present'          existence",
        "  A rule that never matched any message is reported as unknown, not as a pass.",
        "",
        "SCENARIOS (verify --scenario):",
        "  A .dqscn written by the desktop app arms its subscriptions and assertion",
        "  rules, and the verdict is the app's own: same bars, same three states.",
        "  A performance bar is only measured when you drive the load: --bench-rate",
        "  publishes timed messages to the rig's bench topics for --for, then waits",
        "  up to 2 s for the last answers. Without it the bar is reported as not run",
        "  (exit 4) -- never a green it did not earn. --bench-size defaults to 64 bytes",
        "  and --bench-qos to 0, as in the desktop lab. Watchdog and responder rules",
        "  are listed as not armed; they need the window's timers.",
        "",
        "EXIT CODES:",
        "  0 pass   1 refused or violated   2 bad command line   3 broker unreachable   4 not proven",
    ]
    .join("\n")
}

/// Parse a duration like `10s`, `250ms`, `2m` into milliseconds.
pub fn parse_duration(raw: &str) -> Result<u64, UsageError> {
    let text = raw.trim();
    let (number, unit) = if let Some(rest) = text.strip_suffix("ms") {
        (rest, 1u64)
    } else if let Some(rest) = text.strip_suffix('s') {
        (rest, 1_000)
    } else if let Some(rest) = text.strip_suffix('m') {
        (rest, 60_000)
    } else {
        return Err(UsageError(format!(
            "duration {raw:?} needs a unit: ms, s or m"
        )));
    };
    let value: u64 = number.trim().parse().map_err(|_| {
        UsageError(format!("duration {raw:?} does not start with a number"))
    })?;
    if value == 0 {
        return Err(UsageError(format!("duration {raw:?} is zero")));
    }
    Ok(value * unit)
}

fn need(flags: &Flags, name: &str) -> Result<String, UsageError> {
    flags
        .values
        .get(name)
        .and_then(|v| v.last().cloned())
        .ok_or_else(|| UsageError(format!("--{name} is required")))
}

fn take_duration(flags: &Flags, name: &str) -> Result<Option<u64>, UsageError> {
    match flags.values.get(name).and_then(|v| v.last().cloned()) {
        Some(raw) => parse_duration(&raw).map(Some),
        None => Ok(None),
    }
}

#[derive(Debug, Default)]
struct Flags {
    values: std::collections::HashMap<String, Vec<String>>,
    switches: std::collections::HashSet<String>,
}

/// Which flags take a value, per verb. `None` means "not a flag of this verb at all",
/// which has to stay distinguishable from "a switch": answering `Some(false)` for an
/// unknown name would let `--frobnicate` through and leave its argument to be read as a
/// bare token instead.
fn flag_takes_value(verb: Verb, name: &str) -> Option<bool> {
    let (value_flags, switch_flags): (&[&str], &[&str]) = match name {
        // Broker options belong to every verb, so they are settled before the split.
        "host" | "port" | "client-id" | "username" | "username-env" | "password-env"
        | "V" | "keepalive" => return Some(true),
        "tls" | "ws" | "no-clean" | "help" => return Some(false),
        _ => match verb {
            Verb::Connect => (&["timeout"][..], &[][..]),
            Verb::Sub => (
                &["topic", "qos", "retain-handling", "count", "for"],
                &["no-local", "retain-as-published", "payload"],
            ),
            Verb::Pub => (
                &[
                    "topic",
                    "payload",
                    "payload-file",
                    "qos",
                    "content-type",
                    "response-topic",
                    "correlation-hex",
                    "user-property",
                    "wait",
                ],
                &["retain"][..],
            ),
            Verb::Rpc => (
                &[
                    "topic",
                    "payload",
                    "payload-file",
                    "qos",
                    "response-topic",
                    "correlation-hex",
                    "timeout",
                ],
                &[][..],
            ),
            Verb::Verify => (
                &[
                    "topic", "assert", "qos", "count", "for", "scenario", "bench-rate",
                    "bench-size", "bench-qos",
                ],
                &["json", "junit"][..],
            ),
        },
    };
    if value_flags.contains(&name) {
        Some(true)
    } else if switch_flags.contains(&name) {
        Some(false)
    } else {
        None
    }
}

/// Hand-rolled rather than pulling in an argument crate: this project has kept its
/// dependency surface deliberately small (the CBOR and SenML readers are written in
/// house for the same reason), and the parser is small enough to test exhaustively.
pub fn parse_args(argv: &[String]) -> Result<Command, UsageError> {
    if argv.is_empty() {
        return Err(UsageError("no command given".into()));
    }
    let first = argv[0].as_str();
    if first == "help" || first == "--help" || first == "-h" {
        return Ok(Command::Help);
    }
    // `--version` rather than `-V`, which already means protocol version here.
    if first == "version" || first == "--version" {
        return Ok(Command::Version);
    }
    let verb = match first {
        "connect" => Verb::Connect,
        "sub" => Verb::Sub,
        "pub" => Verb::Pub,
        "rpc" => Verb::Rpc,
        "verify" => Verb::Verify,
        other => {
            return Err(UsageError(format!(
                "unknown command {other:?}; try connect, sub, pub, rpc or verify"
            )))
        }
    };

    let mut flags = Flags::default();
    let mut index = 1usize;
    while index < argv.len() {
        let token = &argv[index];
        let Some(dashed) = token.strip_prefix('-') else {
            return Err(UsageError(format!(
                "unexpected argument {token:?}; every option is written --flag value"
            )));
        };
        let name = dashed.trim_start_matches('-');
        // `--user-property k=v` style flags may also arrive as `--name=value`.
        let (name, inline) = match name.split_once('=') {
            Some((n, v)) => (n, Some(v.to_string())),
            None => (name, None),
        };
        if name.is_empty() {
            return Err(UsageError("empty flag name".into()));
        }
        let takes_value = flag_takes_value(verb, name)
            .ok_or_else(|| UsageError(format!("--{name} is not a flag of `{}`", verb.name())))?;
        if takes_value {
            let value = match inline {
                Some(v) => v,
                None => {
                    index += 1;
                    argv.get(index).cloned().ok_or_else(|| {
                        UsageError(format!("--{name} needs a value"))
                    })?
                }
            };
            // The Vec keeps insertion order, which is what gives `--assert a --assert b`
            // its rule-1 / rule-2 numbering.
            flags.values.entry(name.to_string()).or_default().push(value);
        } else {
            if inline.is_some() {
                return Err(UsageError(format!(
                    "--{name} is a switch and takes no value"
                )));
            }
            flags.switches.insert(name.to_string());
        }
        index += 1;
    }

    if flags.switches.contains("help") {
        return Ok(Command::Help);
    }
    let broker = build_broker(&flags)?;
    let one = |name: &str| -> Option<u8> {
        flags
            .values
            .get(name)
            .and_then(|v| v.last().cloned())
            .map(|raw| raw.parse::<u8>())
            .transpose()
            .ok()
            .flatten()
    };
    let qos = || -> Result<u8, UsageError> {
        match one("qos") {
            Some(q @ (0..=2)) => Ok(q),
            Some(other) => Err(UsageError(format!("--qos {other} is not 0, 1 or 2"))),
            None => Ok(1),
        }
    };

    Ok(match verb {
        Verb::Connect => ConnectCmd {
            broker,
            timeout_ms: take_duration(&flags, "timeout")?.unwrap_or(5_000),
        }
        .into(),
        Verb::Sub => {
            let filters = repeated(&flags, "topic");
            if filters.is_empty() {
                return Err(UsageError("--topic is required".into()));
            }
            let retain_handling = match one("retain-handling") {
                Some(h @ (0..=2)) => h,
                Some(other) => {
                    return Err(UsageError(format!(
                        "--retain-handling {other} is not 0, 1 or 2"
                    )))
                }
                None => 0,
            };
            SubCmd {
                broker,
                filters,
                options: SubOptions {
                    qos: qos()?,
                    no_local: flags.switches.contains("no-local"),
                    retain_as_published: flags.switches.contains("retain-as-published"),
                    retain_handling,
                    ..Default::default()
                },
                count: parse_count(&flags)?,
                duration_ms: bound_wait(parse_count(&flags)?, take_duration(&flags, "for")?)?,
                print_payload: flags.switches.contains("payload"),
            }
            .into()
        }
        Verb::Pub => {
            let payload = read_payload(&flags)?;
            PubCmd {
                broker,
                topic: need(&flags, "topic")?,
                payload,
                qos: qos()?,
                retain: flags.switches.contains("retain"),
                content_type: flags.values.get("content-type").and_then(|v| v.last().cloned()),
                response_topic: flags
                    .values
                    .get("response-topic")
                    .and_then(|v| v.last().cloned()),
                correlation_hex: flags
                    .values
                    .get("correlation-hex")
                    .and_then(|v| v.last().cloned()),
                user_properties: repeated(&flags, "user-property")
                    .iter()
                    .filter_map(|pair| pair.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
                    .collect(),
                ack_timeout_ms: take_duration(&flags, "wait")?.unwrap_or(5_000),
            }
            .into()
        }
        Verb::Rpc => RpcCmd {
            broker,
            topic: need(&flags, "topic")?,
            payload: read_payload(&flags)?,
            qos: qos()?,
            response_topic: flags
                .values
                .get("response-topic")
                .and_then(|v| v.last().cloned()),
            correlation_hex: flags
                .values
                .get("correlation-hex")
                .and_then(|v| v.last().cloned()),
            timeout_ms: take_duration(&flags, "timeout")?.unwrap_or(5_000),
        }
        .into(),
        Verb::Verify => {
            let filters = repeated(&flags, "topic");
            let predicates = repeated(&flags, "assert");
            let scenario = flags
                .values
                .get("scenario")
                .and_then(|v| v.last().cloned());
            if scenario.is_none() {
                if filters.is_empty() {
                    return Err(UsageError(
                        "--topic is required (or point --scenario at a .dqscn file)".into(),
                    ));
                }
                if predicates.is_empty() {
                    return Err(UsageError(
                        "verify needs at least one --assert; otherwise there is nothing to prove"
                            .into(),
                    ));
                }
            }
            // Ids are positional: `--assert a --assert b` becomes rule-1, rule-2. A CI
            // report has to name the rule that failed, and the only handle available is
            // the order the user wrote them in.
            let asserts = predicates
                .into_iter()
                .enumerate()
                .map(|(i, predicate)| {
                    let filter = if filters.len() == 1 {
                        Ok(filters[0].clone())
                    } else {
                        filters.get(i).cloned().ok_or_else(|| {
                            UsageError(format!(
                                "rule-{} has no --topic: pass one filter per --assert, or exactly one",
                                i + 1
                            ))
                        })
                    }?;
                    Ok((format!("rule-{}", i + 1), filter, predicate))
                })
                .collect::<Result<Vec<_>, UsageError>>()?;
            VerifyCmd {
                broker,
                filters,
                qos: qos()?,
                asserts,
                scenario,
                count: parse_count(&flags)?,
                duration_ms: bound_wait(parse_count(&flags)?, take_duration(&flags, "for")?)?,
                json: flags.switches.contains("json"),
                junit: flags.switches.contains("junit"),
                bench: bench_drive(&flags)?,
            }
            .into()
        }
    })
}

fn strict_number<T: std::str::FromStr>(flags: &Flags, name: &str) -> Result<Option<T>, UsageError> {
    match flags.values.get(name).and_then(|v| v.last().cloned()) {
        Some(raw) => raw
            .parse::<T>()
            .map(Some)
            .map_err(|_| UsageError(format!("--{name} {raw:?} is not a number"))),
        None => Ok(None),
    }
}

/// The bench flags only make sense as a set, and each refusal names the flag that
/// would fix it. Ranges are checked later by `BenchSpec::validate`, the same check the
/// desktop lab runs, once the scenario has supplied the topics.
fn bench_drive(flags: &Flags) -> Result<Option<BenchDrive>, UsageError> {
    let rate = strict_number::<u32>(flags, "bench-rate")?;
    let size = strict_number::<u32>(flags, "bench-size")?;
    let qos = strict_number::<u8>(flags, "bench-qos")?;
    let Some(rate) = rate else {
        if size.is_some() || qos.is_some() {
            return Err(UsageError("--bench-size and --bench-qos only apply with --bench-rate".into()));
        }
        return Ok(None);
    };
    if !flags.values.contains_key("scenario") {
        return Err(UsageError(
            "--bench-rate drives a scenario's bench topics; point --scenario at a .dqscn file".into(),
        ));
    }
    if !flags.values.contains_key("for") {
        return Err(UsageError("--bench-rate needs --for: a rate is only a rate over a known time".into()));
    }
    if flags.values.contains_key("count") {
        return Err(UsageError(
            "--count would end the run before the bench does; with --bench-rate, --for sets the length".into(),
        ));
    }
    if let Some(q) = qos.filter(|q| *q > 2) {
        return Err(UsageError(format!("--bench-qos {q} is not 0, 1 or 2")));
    }
    // The desktop lab's defaults, so the same rig means the same load in both places.
    Ok(Some(BenchDrive { rate, size: size.unwrap_or(64), qos: qos.unwrap_or(0) }))
}

impl From<ConnectCmd> for Command {
    fn from(c: ConnectCmd) -> Self {
        Command::Connect(c)
    }
}
impl From<SubCmd> for Command {
    fn from(c: SubCmd) -> Self {
        Command::Sub(c)
    }
}
impl From<PubCmd> for Command {
    fn from(c: PubCmd) -> Self {
        Command::Pub(c)
    }
}
impl From<RpcCmd> for Command {
    fn from(c: RpcCmd) -> Self {
        Command::Rpc(c)
    }
}
impl From<VerifyCmd> for Command {
    fn from(c: VerifyCmd) -> Self {
        Command::Verify(c)
    }
}

/// A message count is a promise that the command ends, so it needs a deadline even
/// when the user did not ask for one. An explicit `--for` always wins.
fn bound_wait(count: Option<u64>, duration_ms: Option<u64>) -> Result<Option<u64>, UsageError> {
    match (count, duration_ms) {
        (Some(0), _) => Err(UsageError("--count 0 can never be satisfied".into())),
        (Some(_), None) => Ok(Some(COUNT_WAIT_MS)),
        _ => Ok(duration_ms),
    }
}

fn repeated(flags: &Flags, name: &str) -> Vec<String> {
    flags.values.get(name).cloned().unwrap_or_default()
}

fn parse_count(flags: &Flags) -> Result<Option<u64>, UsageError> {
    match flags.values.get("count").and_then(|v| v.last().cloned()) {
        Some(raw) => raw
            .parse::<u64>()
            .map(Some)
            .map_err(|_| UsageError(format!("--count {raw:?} is not a number"))),
        None => Ok(None),
    }
}

fn read_payload(flags: &Flags) -> Result<Vec<u8>, UsageError> {
    if let Some(path) = flags.values.get("payload-file").and_then(|v| v.last().cloned()) {
        return std::fs::read(&path)
            .map_err(|e| UsageError(format!("cannot read --payload-file {path:?}: {e}")));
    }
    match flags.values.get("payload").and_then(|v| v.last().cloned()) {
        Some(text) => Ok(text.into_bytes()),
        None => Err(UsageError(
            "give a payload with --payload <text> or --payload-file <path>".into(),
        )),
    }
}

fn build_broker(flags: &Flags) -> Result<BrokerOpts, UsageError> {
    let host = flags
        .values
        .get("host")
        .and_then(|v| v.last().cloned())
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let port_raw = flags
        .values
        .get("port")
        .and_then(|v| v.last().cloned())
        .unwrap_or_else(|| if flags.switches.contains("tls") { "8883".into() } else { "1883".into() });
    let port: u16 = port_raw
        .parse()
        .map_err(|_| UsageError(format!("--port {port_raw:?} is not a port number")))?;
    let version = match flags
        .values
        .get("V")
        .and_then(|v| v.last().cloned())
        .unwrap_or_else(|| "5".into())
        .as_str()
    {
        "5" | "mqtt5" | "5.0" => 5,
        "3" | "4" | "3.1.1" | "mqtt3" => 4,
        other => {
            return Err(UsageError(format!(
                "-V {other:?} is not supported; pass 5 or 3.1.1"
            )))
        }
    };
    let username = match flags.values.get("username-env").and_then(|v| v.last().cloned()) {
        Some(var) => read_env(&var),
        None => flags.values.get("username").and_then(|v| v.last().cloned()),
    };
    let keep_alive_raw = flags
        .values
        .get("keepalive")
        .and_then(|v| v.last().cloned())
        .unwrap_or_else(|| "30".into());
    let keep_alive_secs: u64 = keep_alive_raw.parse().map_err(|_| {
        UsageError(format!("--keepalive {keep_alive_raw:?} is not a number of seconds"))
    })?;
    Ok(BrokerOpts {
        host,
        port,
        tls: flags.switches.contains("tls"),
        websocket: flags.switches.contains("ws"),
        client_id: flags
            .values
            .get("client-id")
            .and_then(|v| v.last().cloned())
            // A fixed default would fight with another CI job using the same broker;
            // a session-unique one cannot.
            .unwrap_or_else(|| format!("dropqtt-cli-{}", std::process::id())),
        username,
        password_env: flags.values.get("password-env").and_then(|v| v.last().cloned()),
        protocol_version: version,
        keep_alive_secs: crate::transport::clamp_keep_alive(keep_alive_secs),
        clean_session: !flags.switches.contains("no-clean"),
    })
}

fn read_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

impl BrokerOpts {
    /// Resolve into the config the engine takes. The password is read here and only
    /// here, so no printing path in this crate ever has to know about it.
    pub fn to_config(&self) -> Result<BrokerConfig, String> {
        let password = match &self.password_env {
            Some(var) => Some(read_env(var).ok_or_else(|| {
                format!("--password-env {var} is set but the variable is empty or missing")
            })?),
            None => None,
        };
        Ok(BrokerConfig {
            host: self.host.clone(),
            port: self.port,
            use_tls: self.tls,
            use_websocket: self.websocket,
            client_id: self.client_id.clone(),
            username: self.username.clone(),
            password,
            keep_alive_secs: self.keep_alive_secs,
            default_qos: 1,
            base_topic: None,
            protocol_version: self.protocol_version,
            clean_session: self.clean_session,
            ..Default::default()
        })
    }

    /// What is safe to print: everything except what could authenticate.
    pub fn describe(&self) -> String {
        let transport = if self.websocket {
            if self.tls { "wss" } else { "ws" }
        } else if self.tls {
            "tls"
        } else {
            "tcp"
        };
        format!(
            "{}:{} ({}, MQTT {})",
            self.host,
            self.port,
            transport,
            if self.protocol_version == 5 { "5.0" } else { "3.1.1" }
        )
    }
}

/// Turn a received publish into the row type the assertion engine evaluates, so the
/// CLI judges exactly the structure the desktop console shows. The correlation is
/// decoded by the same helper the console uses, which is the difference between
/// "these are the bytes" and "we guessed at the text".
pub fn message_of(publish: &NormalizedPublish, id: &str) -> MqttGenericMessage {
    let bytes = publish.payload.to_vec();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let (correlation_data, correlation_hex) = match publish.correlation_data.as_deref() {
        Some(raw) => crate::protocol::correlation_forms(raw),
        None => (None, None),
    };
    MqttGenericMessage {
        id: id.to_string(),
        topic: publish.topic.clone(),
        payload: text,
        payload_len: bytes.len(),
        payload_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        truncated: false,
        content_type: publish.content_type.clone(),
        user_properties: publish.user_properties.clone(),
        response_topic: publish.response_topic.clone(),
        correlation_data,
        correlation_hex,
        payload_format: publish.payload_format,
        matched_filters: Vec::new(),
        subscription_ids: publish.subscription_ids.clone(),
        qos: publish.qos,
        retain: publish.retain,
        timestamp: chrono::Utc::now().to_rfc3339(),
        timestamp_ms: now_ms,
        direction: "in".into(),
        assertion: None,
    }
}

/// One assertion rule's tally.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuleTally {
    pub id: String,
    pub filter: String,
    pub expr: String,
    /// Messages that matched the filter at all — a rule that saw nothing is unproven,
    /// not satisfied.
    pub matched: u64,
    pub passed: u64,
    pub violated: u64,
    pub unevaluable: u64,
}

impl RuleTally {
    /// The shared three-state rule (see `verdict::tally`): nothing matched, or nothing
    /// could be judged, is `unknown`. Reporting either as a pass is how a CI gate goes
    /// green on a broker nobody was talking to.
    pub fn outcome(&self) -> Outcome {
        tally(self.matched, self.violated, self.unevaluable)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    pub tool: String,
    pub broker: String,
    pub observed: u64,
    pub rules: Vec<RuleTally>,
}

impl VerifyReport {
    pub fn outcome(&self) -> Outcome {
        overall(&self.rules.iter().map(RuleTally::outcome).collect::<Vec<_>>())
    }

    pub fn to_json(&self) -> String {
        // `outcome` is derived rather than stored, so serde cannot see it. A CI
        // consumer that re-derived it from the counters would have to re-decide the
        // "nothing matched" rule itself — and getting that wrong is how a gate turns
        // green quietly.
        let mut value = serde_json::to_value(self).unwrap_or(serde_json::Value::Null);
        if let Some(rules) = value.get_mut("rules").and_then(|r| r.as_array_mut()) {
            for (row, tally) in rules.iter_mut().zip(&self.rules) {
                row["outcome"] = serde_json::json!(tally.outcome().word());
            }
        }
        value["outcome"] = serde_json::json!(self.outcome().word());
        serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".into())
    }

    /// JUnit so any CI can ingest it without knowing this tool exists.
    pub fn to_junit(&self) -> String {
        let cases = self
            .rules
            .iter()
            .map(|rule| Case {
                classname: "dropqtt.verify".into(),
                name: format!("{} :: {}", rule.id, rule.expr),
                outcome: rule.outcome(),
                message: match rule.outcome() {
                    Outcome::Fail => Some(format!("{} violated", rule.violated)),
                    Outcome::Unknown => Some(if rule.matched == 0 {
                        "no message matched this filter".to_string()
                    } else {
                        format!(
                            "{} of {} matched message(s) could not be judged",
                            rule.unevaluable, rule.matched
                        )
                    }),
                    Outcome::Pass => None,
                },
                body: (rule.outcome() == Outcome::Fail).then(|| {
                    format!(
                        "{} of {} matched message(s) violated the rule",
                        rule.violated, rule.matched
                    )
                }),
            })
            .collect::<Vec<_>>();
        junit(&Suite { name: "dropqtt-cli verify", cases: &cases, timestamp: None })
    }
}

/// The line the CLI prints per received message. Kept as a pure function so its
/// shape is pinned by tests rather than by eyeballing a terminal.
pub fn render_received(msg: &MqttGenericMessage, print_payload: bool) -> String {
    let mut line = format!(
        "{} qos{}{}{}",
        msg.topic,
        msg.qos,
        if msg.retain { " retain" } else { "" },
        if print_payload {
            format!(" | {}", msg.payload.replace('\n', "\\n"))
        } else {
            String::new()
        },
    );
    if msg.truncated {
        line.push_str(" [truncated]");
    }
    line
}

/// What a `verify --bench-rate` run sent and got back, counted the way the desktop lab
/// counts: only a 0x00 ack is an ack, a refusal and "no subscribers" are their own
/// buckets, and latency comes from our own timed copies looping back.
#[derive(Default)]
pub struct LoadTally {
    pub sent: u64,
    pub acked: u64,
    pub nacked: u64,
    pub no_subscribers: u64,
    pub looped: u64,
    latency: crate::bench::LatencySamples,
}

impl LoadTally {
    pub fn record_ack(&mut self, code: u8) {
        match code {
            0x00 => self.acked += 1,
            0x10 => self.no_subscribers += 1,
            _ => self.nacked += 1,
        }
    }

    /// True when `payload` is our own load on a bench topic. It is counted here and
    /// kept away from the assertion rules: a rule about `$.tempC` judging 64 bytes of
    /// synthetic load reads as unevaluable and would sink a rig whose devices are fine.
    pub fn absorb(&mut self, topics: &[String], size: u32, topic: &str, payload: &[u8], now_ms: i64) -> bool {
        if !topics.iter().any(|t| t == topic) {
            return false;
        }
        if let Some((_, send_ms)) = crate::bench::parse_bench_payload(payload) {
            self.looped += 1;
            self.latency.record(u32::try_from((now_ms - send_ms).max(0)).unwrap_or(u32::MAX));
            return true;
        }
        // Below the header size the load is untimed filler; recognised by its exact
        // shape so a real device publishing to the same topic is still judged.
        (size as usize) < crate::bench::HEADER_LEN
            && payload.len() == size as usize
            && payload.iter().all(|b| *b == b'b')
    }

    /// Every publish has had its answer: an ack for QoS 1/2, and its timed copy back
    /// when the payload carries a timestamp. Waiting for less would report a p99 or a
    /// loss count that the next 50 ms would have changed.
    pub fn drained(&self, qos: u8, size: u32) -> bool {
        let answered = self.acked + self.nacked + self.no_subscribers;
        let acks_done = qos == 0 || answered >= self.sent;
        let loops_done = (size as usize) < crate::bench::HEADER_LEN || self.looped >= self.sent;
        acks_done && loops_done
    }

    /// The numbers `scenario::judge` grades, with the rate taken over the send phase
    /// only, as the desktop lab does: time spent waiting for the last acks is not
    /// time the sender was slow.
    pub fn measurement(&self, send_elapsed: std::time::Duration, settled: bool) -> crate::scenario::Measurement {
        let summary = self.latency.summary();
        crate::scenario::Measurement {
            sent: self.sent,
            acked: self.acked,
            rate: crate::bench::measured_rate(self.sent, send_elapsed.as_millis() as u64),
            p99_ms: (summary.samples > 0).then_some(u64::from(summary.p99_ms)),
            settled,
        }
    }

    pub fn summary_line(&self, measured: &crate::scenario::Measurement) -> String {
        let p99 = measured.p99_ms.map_or_else(|| "none timed".to_string(), |ms| format!("{ms} ms"));
        format!(
            "bench    sent {} · acked {} · refused {} · no subscribers {} · looped {} · {} msg/s · p99 {p99}",
            self.sent, self.acked, self.nacked, self.no_subscribers, self.looped, measured.rate
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bench_flags_come_as_a_set_and_name_the_flag_that_is_missing() {
        let ok = |list: &[&str]| match parse_args(&args(list)).unwrap() {
            Command::Verify(v) => v.bench,
            _ => panic!(),
        };
        let fails = |list: &[&str]| parse_args(&args(list)).unwrap_err().0;
        let base = ["verify", "--scenario", "rig.dqscn", "--for", "3s"];

        assert_eq!(ok(&base), None, "no --bench-rate, no load");
        let drive = ok(&[&base[..], &["--bench-rate", "500"]].concat()).unwrap();
        assert_eq!(drive, BenchDrive { rate: 500, size: 64, qos: 0 }, "the desktop lab's defaults");
        let drive = ok(&[&base[..], &["--bench-rate", "50", "--bench-size", "15", "--bench-qos", "1"]].concat());
        assert_eq!(drive, Some(BenchDrive { rate: 50, size: 15, qos: 1 }));

        assert!(fails(&["verify", "--scenario", "r", "--bench-rate", "5"]).contains("--for"));
        assert!(fails(&["verify", "--topic", "a", "--assert", "qos >= 1", "--for", "1s", "--bench-rate", "5"])
            .contains("--scenario"));
        assert!(fails(&[&base[..], &["--bench-size", "64"]].concat()).contains("--bench-rate"));
        assert!(fails(&[&base[..], &["--bench-rate", "5", "--count", "3"]].concat()).contains("--count"));
        assert!(fails(&[&base[..], &["--bench-rate", "fast"]].concat()).contains("not a number"));
        assert!(fails(&[&base[..], &["--bench-rate", "5", "--bench-qos", "3"]].concat()).contains("0, 1 or 2"));
    }

    #[test]
    fn a_load_tally_buckets_acks_and_keeps_its_own_traffic_from_the_rules() {
        let topics = vec!["load/a".to_string()];
        let mut load = LoadTally::default();
        for code in [0x00, 0x00, 0x10, 0x87] {
            load.record_ack(code);
        }
        assert_eq!((load.acked, load.no_subscribers, load.nacked), (2, 1, 1));

        let ours = crate::bench::bench_payload(64, 7, 1_000);
        assert!(load.absorb(&topics, 64, "load/a", &ours, 1_012));
        assert!(!load.absorb(&topics, 64, "load/a", br#"{"tempC":21}"#, 1_012), "a device on the topic is still judged");
        assert!(!load.absorb(&topics, 64, "other", &ours, 1_012), "only the bench topics");
        assert!(load.absorb(&topics, 4, "load/a", b"bbbb", 0), "untimed filler is ours too");
        assert!(!load.absorb(&topics, 4, "load/a", b"bbbbb", 0));
        assert_eq!(load.looped, 1, "filler carries no time and adds no sample");
    }

    #[test]
    fn a_load_is_drained_when_every_publish_has_its_answer() {
        let mut load = LoadTally { sent: 2, ..Default::default() };
        assert!(!load.drained(0, 64), "QoS 0 still waits for the timed copies");
        load.looped = 2;
        assert!(load.drained(0, 64));
        assert!(!load.drained(1, 64), "QoS 1 also waits for the acks");
        load.record_ack(0);
        load.record_ack(0x87);
        assert!(load.drained(1, 64), "a refusal is an answer");
        let untimed = LoadTally { sent: 3, acked: 3, ..Default::default() };
        assert!(untimed.drained(1, 4), "untimed load never loops back as a sample");
    }

    #[test]
    fn the_measured_rate_is_over_the_send_phase_and_no_sample_is_not_zero_ms() {
        let mut load = LoadTally { sent: 300, acked: 300, ..Default::default() };
        let m = load.measurement(std::time::Duration::from_secs(3), true);
        assert_eq!((m.sent, m.acked, m.rate, m.p99_ms, m.settled), (300, 300, 100, None, true));
        load.absorb(&["t".to_string()], 64, "t", &crate::bench::bench_payload(64, 0, 0), 9);
        assert_eq!(load.measurement(std::time::Duration::ZERO, false).p99_ms, Some(9));
        assert_eq!(load.measurement(std::time::Duration::ZERO, false).rate, 0, "no division by zero");
        assert!(load.summary_line(&m).contains("p99 none timed"));
    }

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn every_exit_code_is_distinct() {
        let codes = [
            EXIT_PASS,
            EXIT_FAIL,
            EXIT_USAGE,
            EXIT_UNAVAILABLE,
            EXIT_UNKNOWN,
        ];
        for (i, a) in codes.iter().enumerate() {
            for (j, b) in codes.iter().enumerate() {
                assert_eq!(i == j, a == b, "{a} and {b} collide");
            }
        }
    }

    #[test]
    fn an_empty_or_unknown_command_is_a_usage_error_not_a_panic() {
        assert_eq!(parse_args(&args(&[])).unwrap_err(), UsageError("no command given".into()));
        let err = parse_args(&args(&["bogus"])).unwrap_err();
        assert!(err.0.contains("unknown command"), "{err}");
        assert!(err.0.contains("connect"), "the error has to say what is available");
    }

    #[test]
    fn help_short_circuits_everything() {
        assert_eq!(parse_args(&args(&["help"])).unwrap(), Command::Help);
        assert_eq!(parse_args(&args(&["--help"])).unwrap(), Command::Help);
        assert_eq!(
            parse_args(&args(&["sub", "--help"])).unwrap(),
            Command::Help,
            "--help after a verb must still work"
        );
    }

    #[test]
    fn connect_defaults_are_a_local_plaintext_session() {
        let Command::Connect(c) = parse_args(&args(&["connect"])).unwrap() else {
            panic!("expected connect");
        };
        assert_eq!(c.broker.host, "127.0.0.1");
        assert_eq!(c.broker.port, 1883);
        assert_eq!(c.broker.protocol_version, 5);
        assert_eq!(c.timeout_ms, 5_000);
        assert!(c.broker.client_id.starts_with("dropqtt-cli-"));
    }

    #[test]
    fn tls_shifts_the_default_port_but_never_assumes_it() {
        let Command::Connect(c) = parse_args(&args(&["connect", "--tls"])).unwrap() else {
            panic!()
        };
        assert_eq!(c.broker.port, 8883);
        assert!(c.broker.tls);
        // An explicit port wins over the TLS default.
        let Command::Connect(explicit) =
            parse_args(&args(&["connect", "--tls", "--port", "18831"])).unwrap()
        else {
            panic!()
        };
        assert_eq!(explicit.broker.port, 18831);
    }

    #[test]
    fn durations_accept_the_three_units_and_reject_the_rest() {
        assert_eq!(parse_duration("250ms").unwrap(), 250);
        assert_eq!(parse_duration("10s").unwrap(), 10_000);
        assert_eq!(parse_duration("2m").unwrap(), 120_000);
        assert!(parse_duration("10").is_err());
        assert!(parse_duration("abc").is_err());
        assert!(parse_duration("0s").is_err(), "a zero wait is a hang wearing a flag");
    }

    #[test]
    fn a_flag_that_does_not_belong_to_the_verb_is_refused() {
        let err = parse_args(&args(&["sub", "--topic", "a/b", "--payload-file", "x"])).unwrap_err();
        assert!(err.0.contains("is not a flag of `sub`"), "{err}");
        // --payload means two different things: print bodies (sub) vs set one (pub).
        assert!(parse_args(&args(&["sub", "--topic", "a/b", "--payload"])).is_ok());
        assert!(parse_args(&args(&["pub", "--topic", "a/b", "--payload", "hi"])).is_ok());
    }

    #[test]
    fn unknown_flags_and_missing_values_are_named() {
        let err = parse_args(&args(&["connect", "--frobnicate"])).unwrap_err();
        assert!(err.0.contains("--frobnicate"), "{err}");
        let err = parse_args(&args(&["connect", "--port"])).unwrap_err();
        assert!(err.0.contains("needs a value"), "{err}");
        let err = parse_args(&args(&["connect", "0"])).unwrap_err();
        assert!(err.0.contains("unexpected argument"), "{err}");
        let err = parse_args(&args(&["connect", "--tls=1"])).unwrap_err();
        assert!(err.0.contains("is a switch"), "{err}");
    }

    #[test]
    fn values_can_be_written_with_an_equals_sign() {
        let Command::Connect(c) = parse_args(&args(&["connect", "--host=10.0.0.2", "--port=1884"])).unwrap()
        else {
            panic!()
        };
        assert_eq!(c.broker.host, "10.0.0.2");
        assert_eq!(c.broker.port, 1884);
    }

    #[test]
    fn protocol_versions_cover_both_dialects_and_reject_the_rest() {
        for (flag, expected) in [("5", 5u8), ("3.1.1", 4), ("3", 4), ("4", 4)] {
            let Command::Connect(c) = parse_args(&args(&["connect", "-V", flag])).unwrap() else {
                panic!()
            };
            assert_eq!(c.broker.protocol_version, expected, "{flag}");
        }
        let err = parse_args(&args(&["connect", "-V", "5.1"])).unwrap_err();
        assert!(err.0.contains("not supported"), "{err}");
    }

    #[test]
    fn qos_is_validated_rather_than_invented() {
        let Command::Sub(s) = parse_args(&args(&["sub", "--topic", "a", "--qos", "2"])).unwrap() else {
            panic!()
        };
        assert_eq!(s.options.qos, 2);
        let err = parse_args(&args(&["sub", "--topic", "a", "--qos", "7"])).unwrap_err();
        assert!(err.0.contains("not 0, 1 or 2"), "{err}");
    }

    #[test]
    fn sub_requires_a_filter_and_records_the_mqtt5_options() {
        assert!(parse_args(&args(&["sub"])).is_err());
        let Command::Sub(s) = parse_args(&args(&[
            "sub", "--topic", "a/#", "--topic", "b/c", "--no-local", "--retain-handling", "2",
            "--count", "5", "--for", "3s",
        ]))
        .unwrap()
        else {
            panic!()
        };
        assert_eq!(s.filters, vec!["a/#".to_string(), "b/c".to_string()]);
        assert!(s.options.no_local);
        assert_eq!(s.options.retain_handling, 2);
        assert_eq!(s.count, Some(5));
        assert_eq!(s.duration_ms, Some(3_000));
    }

    #[test]
    fn pub_needs_a_payload_from_one_of_the_two_sources() {
        let err = parse_args(&args(&["pub", "--topic", "a"])).unwrap_err();
        assert!(err.0.contains("--payload"), "{err}");
        let Command::Pub(p) = parse_args(&args(&[
            "pub", "--topic", "a", "--payload", "hi", "--retain", "--user-property", "k=v",
            "--user-property", "k2=v2", "--correlation-hex", "00ff",
        ]))
        .unwrap()
        else {
            panic!()
        };
        assert_eq!(p.payload, b"hi".to_vec());
        assert!(p.retain);
        assert_eq!(p.user_properties, vec![("k".into(), "v".into()), ("k2".into(), "v2".into())]);
        assert_eq!(p.correlation_hex.as_deref(), Some("00ff"));
    }

    #[test]
    fn a_malformed_user_property_is_dropped_not_guessed() {
        let Command::Pub(p) = parse_args(&args(&["pub", "--topic", "a", "--payload", "x", "--user-property", "novalue"]))
            .unwrap()
        else {
            panic!()
        };
        assert!(p.user_properties.is_empty());
    }

    #[test]
    fn verify_needs_both_a_filter_and_a_rule() {
        let err = parse_args(&args(&["verify", "--topic", "a", "--json"])).unwrap_err();
        assert!(err.0.contains("at least one --assert"), "{err}");
        let err = parse_args(&args(&["verify", "--assert", "qos >= 1"])).unwrap_err();
        assert!(err.0.contains("--topic"), "{err}");
        // The refusal says what would have been accepted, because the alternative is
        // someone reading the usage block for a flag that does exist.
        assert!(err.0.contains("--scenario"), "{err}");
    }

    #[test]
    fn a_scenario_file_supplies_the_filters_and_rules_that_verify_needs() {
        let Command::Verify(v) = parse_args(&args(&[
            "verify", "--scenario", "rig.dqscn", "--for", "5s",
        ]))
        .unwrap()
        else {
            panic!()
        };
        assert_eq!(v.scenario.as_deref(), Some("rig.dqscn"));
        assert!(v.asserts.is_empty());
        assert_eq!(v.duration_ms, Some(5_000));

        // Both at once is not a contradiction: the file's rig plus one more claim.
        let Command::Verify(mixed) = parse_args(&args(&[
            "verify", "--scenario", "rig.dqscn", "--topic", "extra/#", "--assert", "qos >= 1",
        ]))
        .unwrap()
        else {
            panic!()
        };
        assert!(mixed.scenario.is_some());
        assert_eq!(mixed.asserts.len(), 1);
    }

    #[test]
    fn rules_pair_with_filters_by_position_or_share_the_single_one() {
        let Command::Verify(v) = parse_args(&args(&[
            "verify", "--topic", "a/#", "--assert", "qos >= 1", "--assert", "$.fw present",
        ]))
        .unwrap()
        else {
            panic!()
        };
        assert_eq!(v.asserts.len(), 2);
        assert!(v.asserts.iter().all(|(_, f, _)| f == "a/#"));
        assert_eq!(v.asserts[0].0, "rule-1");
        assert_eq!(v.asserts[1].0, "rule-2");

        let Command::Verify(pair) = parse_args(&args(&[
            "verify", "--topic", "a/#", "--topic", "b/#", "--assert", "qos >= 1",
            "--assert", "$.fw present",
        ]))
        .unwrap()
        else {
            panic!()
        };
        assert_eq!(pair.asserts[0].1, "a/#");
        assert_eq!(pair.asserts[1].1, "b/#");

        let err = parse_args(&args(&[
            "verify", "--topic", "a/#", "--topic", "b/#", "--assert", "x", "--assert", "y",
            "--assert", "z",
        ]))
        .unwrap_err();
        assert!(err.0.contains("rule-3 has no --topic"), "{err}");
    }

    #[test]
    fn keepalive_is_clamped_by_the_same_rule_the_gui_uses() {
        let Command::Connect(c) = parse_args(&args(&["connect", "--keepalive", "99999"])).unwrap() else {
            panic!()
        };
        assert_eq!(c.broker.keep_alive_secs, crate::transport::clamp_keep_alive(99999));
        let err = parse_args(&args(&["connect", "--keepalive", "abc"])).unwrap_err();
        assert!(err.0.contains("--keepalive"), "{err}");
    }

    #[test]
    fn version_is_a_command_of_its_own() {
        assert_eq!(parse_args(&args(&["--version"])).unwrap(), Command::Version);
        assert_eq!(parse_args(&args(&["version"])).unwrap(), Command::Version);
    }

    #[test]
    fn a_message_count_always_ends() {
        let Command::Sub(s) = parse_args(&args(&["sub", "--topic", "a", "--count", "5"])).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            s.duration_ms,
            Some(COUNT_WAIT_MS),
            "--count without --for must still stop"
        );
        let Command::Sub(explicit) =
            parse_args(&args(&["sub", "--topic", "a", "--count", "5", "--for", "2s"])).unwrap()
        else {
            panic!()
        };
        assert_eq!(explicit.duration_ms, Some(2_000), "an explicit --for wins");
        let Command::Sub(watch) = parse_args(&args(&["sub", "--topic", "a"])).unwrap() else {
            panic!()
        };
        assert_eq!(
            watch.duration_ms, None,
            "a watch with no count is allowed to run until interrupted"
        );
        let err = parse_args(&args(&["verify", "--topic", "a", "--assert", "x", "--count", "0"])).unwrap_err();
        assert!(err.0.contains("can never be satisfied"), "{err}");
    }

    #[test]
    fn the_description_of_a_broker_never_contains_a_credential() {
        let Command::Connect(c) = parse_args(&args(&[
            "connect", "--host", "10.1.1.1", "--port", "1883", "--username-env", "MQ_USER",
            "--password-env", "MQ_PASS", "--ws",
        ]))
        .unwrap()
        else {
            panic!()
        };
        let text = c.broker.describe();
        assert!(text.contains("10.1.1.1:1883"), "{text}");
        assert!(text.contains("ws"), "{text}");
        assert!(!text.contains("PASS"), "{text}");
        assert!(!text.contains("MQ_PASS"), "the variable name is a hint about where secrets live");
    }

    #[test]
    fn a_missing_password_variable_fails_loudly_instead_of_connecting_anonymously() {
        let opts = BrokerOpts {
            password_env: Some("DROPQTT_TESTS_NO_SUCH_VARIABLE".into()),
            ..Default::default()
        };
        let err = opts.to_config().unwrap_err();
        assert!(err.contains("empty or missing"), "{err}");
    }

    #[test]
    fn a_rule_that_saw_nothing_is_unknown_never_a_pass() {
        let mut tally = RuleTally {
            id: "r".into(),
            filter: "a/#".into(),
            expr: "$.x present".into(),
            ..Default::default()
        };
        assert_eq!(tally.outcome(), Outcome::Unknown);
        tally.matched = 4;
        tally.passed = 4;
        assert_eq!(tally.outcome(), Outcome::Pass);
        tally.violated = 1;
        assert_eq!(tally.outcome(), Outcome::Fail, "a violation outranks everything");
        tally.violated = 0;
        tally.unevaluable = 1;
        assert_eq!(
            tally.outcome(),
            Outcome::Unknown,
            "a rule that could not be judged on some messages is not proven"
        );
    }

    #[test]
    fn one_unproven_rule_makes_the_whole_run_unproven() {
        let report = VerifyReport {
            tool: "dropqtt-cli".into(),
            broker: "x".into(),
            observed: 9,
            rules: vec![
                RuleTally { id: "a".into(), matched: 5, passed: 5, ..Default::default() },
                RuleTally { id: "b".into(), matched: 0, ..Default::default() },
            ],
        };
        assert_eq!(report.outcome(), Outcome::Unknown);
        assert_eq!(report.outcome().exit_code(), EXIT_UNKNOWN);

        let failing = VerifyReport {
            rules: vec![
                RuleTally { id: "a".into(), matched: 5, passed: 5, ..Default::default() },
                RuleTally { id: "b".into(), matched: 2, violated: 1, ..Default::default() },
            ],
            ..report.clone()
        };
        assert_eq!(failing.outcome(), Outcome::Fail);
    }

    #[test]
    fn the_json_report_is_machine_readable_and_names_each_rule() {
        let report = VerifyReport {
            tool: "dropqtt-cli".into(),
            broker: "127.0.0.1:18831 (tcp, MQTT 5.0)".into(),
            observed: 3,
            rules: vec![RuleTally {
                id: "rule-1".into(),
                filter: "dev/#".into(),
                expr: "$.tempC < 80".into(),
                matched: 3,
                passed: 3,
                ..Default::default()
            }],
        };
        let json: serde_json::Value = serde_json::from_str(&report.to_json()).unwrap();
        assert_eq!(json["observed"], 3);
        assert_eq!(json["rules"][0]["id"], "rule-1");
        assert_eq!(json["rules"][0]["expr"], "$.tempC < 80");
        assert_eq!(json["rules"][0]["outcome"], "pass");
    }

    #[test]
    fn the_junit_report_maps_the_three_states_onto_ci_words() {
        let report = VerifyReport {
            tool: "dropqtt-cli".into(),
            broker: "x".into(),
            observed: 1,
            rules: vec![
                RuleTally { id: "ok".into(), expr: "a".into(), matched: 1, passed: 1, ..Default::default() },
                RuleTally { id: "bad".into(), expr: "b".into(), matched: 2, violated: 1, ..Default::default() },
                RuleTally { id: "none".into(), expr: "c".into(), ..Default::default() },
            ],
        };
        let xml = report.to_junit();
        assert!(xml.starts_with("<?xml version=\"1.0\""), "{xml}");
        assert!(xml.contains("tests=\"3\""), "{xml}");
        assert!(xml.contains("failures=\"1\""), "{xml}");
        assert!(xml.contains("skipped=\"1\""), "{xml}");
        assert!(xml.contains("time=\"0\"/>\n"), "{xml}");
        assert!(xml.contains("<failure message=\"1 violated\" type=\"verdict\">"));
        assert!(xml.contains("no message matched this filter"));
    }

    #[test]
    fn xml_escapes_a_predicate_that_contains_markup() {
        let report = VerifyReport {
            tool: "dropqtt-cli".into(),
            broker: "x".into(),
            observed: 0,
            rules: vec![RuleTally {
                id: "r".into(),
                expr: "$.a < b && \"x\"".into(),
                ..Default::default()
            }],
        };
        let xml = report.to_junit();
        assert!(xml.contains("&lt;"), "{xml}");
        assert!(xml.contains("&amp;&amp;"), "{xml}");
        assert!(xml.contains("&quot;x&quot;"), "{xml}");
        assert!(!xml.contains("< b"), "raw markup must not survive into an attribute");
    }

    fn received_row(topic: &str, payload: &str) -> MqttGenericMessage {
        MqttGenericMessage {
            id: "1".into(),
            topic: topic.into(),
            payload: payload.into(),
            payload_len: payload.len(),
            payload_base64: String::new(),
            truncated: false,
            content_type: None,
            user_properties: vec![],
            response_topic: None,
            correlation_data: None,
            correlation_hex: None,
            payload_format: None,
            matched_filters: vec![],
            subscription_ids: vec![],
            qos: 1,
            retain: true,
            timestamp: String::new(),
            timestamp_ms: 0,
            direction: "in".into(),
            assertion: None,
        }
    }

    #[test]
    fn a_received_line_shows_the_flags_it_carries() {
        let msg = received_row("dev/a", "one\ntwo");
        assert_eq!(render_received(&msg, false), "dev/a qos1 retain");
        assert_eq!(render_received(&msg, true), "dev/a qos1 retain | one\\ntwo");
    }

    #[test]
    fn a_cli_message_row_keeps_the_bytes_the_console_needs() {
        let publish = NormalizedPublish {
            topic: "dev/a".into(),
            payload: bytes::Bytes::from_static(&[0x01, 0xff, b'h']),
            qos: 2,
            retain: false,
            content_type: Some("application/octet-stream".into()),
            user_properties: vec![("k".into(), "v".into())],
            response_topic: None,
            correlation_data: Some(vec![0xff, 0xfe]),
            payload_format: None,
            subscription_ids: vec![],
        };
        let msg = message_of(&publish, "m1");
        assert_eq!(msg.payload_len, 3);
        // Non-UTF-8 bytes survive as base64 and the text view is a lossy stand-in.
        assert!(!msg.payload_base64.is_empty());
        assert_eq!(msg.correlation_hex.as_deref(), Some("fffe"));
        assert_eq!(
            msg.correlation_data, None,
            "0xff 0xfe is not valid UTF-8, so no text form may be claimed"
        );
        assert_eq!(msg.qos, 2);
        assert!(!msg.truncated);
    }

    #[test]
    fn a_utf8_correlation_keeps_both_forms() {
        let publish = NormalizedPublish {
            topic: "dev/a".into(),
            payload: bytes::Bytes::from_static(b"x"),
            qos: 0,
            retain: false,
            content_type: None,
            user_properties: vec![],
            response_topic: None,
            correlation_data: Some(b"req-7".to_vec()),
            payload_format: None,
            subscription_ids: vec![],
        };
        let msg = message_of(&publish, "m2");
        assert_eq!(msg.correlation_data.as_deref(), Some("req-7"));
        assert_eq!(
            msg.correlation_hex.as_deref(),
            Some(hex::encode(b"req-7").as_str()),
            "the hex form is always the untouched bytes, even when text is available"
        );
    }

    #[test]
    fn an_empty_correlation_claims_nothing_at_all() {
        let publish = NormalizedPublish {
            topic: "dev/a".into(),
            payload: bytes::Bytes::from_static(b"x"),
            qos: 0,
            retain: false,
            content_type: None,
            user_properties: vec![],
            response_topic: None,
            correlation_data: Some(vec![]),
            payload_format: None,
            subscription_ids: vec![],
        };
        let msg = message_of(&publish, "m3");
        assert_eq!(msg.correlation_data, None);
        assert_eq!(msg.correlation_hex, None);
    }
}
