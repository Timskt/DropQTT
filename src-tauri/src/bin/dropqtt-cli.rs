//! `dropqtt-cli` — the desktop app's protocol engine, without the window.
//!
//! The reason this binary exists is the reason it is written against
//! `transport`/`assertions` rather than against an MQTT library of its own: a CI gate
//! that speaks a slightly different dialect from the GUI is worse than no gate,
//! because the first disagreement gets resolved by whoever is on call trusting the
//! wrong one. Every verdict here comes from the same Rust code the console uses.
//!
//! Output discipline: human-readable lines on stdout, and the exit code is the
//! machine-readable answer (see `cli::EXIT_*`). With `--json` or `--junit` the report
//! replaces the prose, so it can be piped straight to a file.

use std::time::{Duration, Instant};

use bytes::Bytes;
use tokio::sync::mpsc;

use dropqtt_lib::assertions::{self, AssertionRule, AssertOutcome, AssertStats};
use dropqtt_lib::cli::{
    self, Command, VerifyReport, EXIT_FAIL, EXIT_PASS, EXIT_UNAVAILABLE, EXIT_UNKNOWN, EXIT_USAGE,
};
use dropqtt_lib::protocol::{MqttGenericMessage, PubProperties, SubOptions};
use dropqtt_lib::scenario::{self, Scenario};
use dropqtt_lib::transport::{build_connection, ConnCapabilities, MqttClient, NetEvent};
use dropqtt_lib::verdict::Outcome;

/// How long to wait for a SUBACK/PUBACK verdict before calling the link dead.
const ACK_WAIT: Duration = Duration::from_secs(5);

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let code = match cli::parse_args(&argv) {
        Err(err) => {
            eprintln!("dropqtt-cli: {err}");
            eprintln!("{}", cli::usage());
            EXIT_USAGE
        }
        Ok(Command::Help) => {
            println!("{}", cli::usage());
            EXIT_PASS
        }
        Ok(Command::Version) => {
            println!("dropqtt-cli {}", env!("CARGO_PKG_VERSION"));
            EXIT_PASS
        }
        Ok(command) => dispatch(command).await,
    };
    std::process::ExitCode::from(code as u8)
}

async fn dispatch(command: Command) -> i32 {
    match command {
        Command::Help | Command::Version => EXIT_PASS,
        Command::Connect(cmd) => {
            let mut session = match Session::open(&cmd.broker, cmd.timeout_ms).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("dropqtt-cli: {e}");
                    return EXIT_UNAVAILABLE;
                }
            };
            println!("connected to {}", cmd.broker.describe());
            print_capabilities(&session.caps);
            // Anything the broker refused to tell us is worth a line, because the
            // forms disable fields based on exactly these numbers.
            if let Some(keep) = session.caps.server_keep_alive {
                println!("  server keep-alive      {keep} s (overrode ours)");
            }
            if let Some(id) = &session.caps.assigned_client_id {
                println!("  assigned client id     {id}");
            }
            let _ = session.rx.try_recv();
            session.close().await;
            EXIT_PASS
        }
        Command::Sub(cmd) => run_sub(cmd).await,
        Command::Pub(cmd) => run_pub(cmd).await,
        Command::Rpc(cmd) => run_rpc(cmd).await,
        Command::Verify(cmd) => run_verify(cmd).await,
    }
}

fn print_capabilities(caps: &ConnCapabilities) {
    println!("  maximum QoS          {}", caps.max_qos);
    println!("  receive maximum      {}", caps.receive_max);
    println!(
        "  retain               {}",
        if caps.retain_available { "available" } else { "NOT available" }
    );
    println!(
        "  wildcard subscriptions {}",
        if caps.wildcard_available { "yes" } else { "NO" }
    );
    println!(
        "  shared subscriptions   {}",
        if caps.shared_available { "yes" } else { "NO" }
    );
    println!(
        "  subscription ids       {}",
        if caps.subscription_ids_available { "yes" } else { "NO" }
    );
    println!("  topic alias maximum  {}", caps.topic_alias_max);
    match caps.max_packet_size {
        Some(limit) => println!("  maximum packet size  {limit} bytes"),
        None => println!("  maximum packet size  unbounded"),
    }
    if let Some(info) = &caps.response_information {
        println!("  response information {info}");
    }
}

/// One connection plus its event pump.
///
/// The loop runs in its own task and forwards events over a channel on purpose:
/// `EventLoop::poll` loops internally and is not documented as cancel-safe, so
/// `timeout(dur, poll())` could drop a packet that arrived as the timer fired.
/// Cancelling a channel receive cannot.
struct Session {
    client: MqttClient,
    rx: mpsc::UnboundedReceiver<NetEvent>,
    caps: ConnCapabilities,
}

impl Session {
    async fn open(broker: &cli::BrokerOpts, timeout_ms: u64) -> Result<Self, String> {
        let config = broker.to_config()?;
        let (client, mut event_loop) = build_connection(&config)?;
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            loop {
                let event = event_loop.poll().await;
                if tx.send(event).is_err() {
                    return;
                }
            }
        });
        let mut rx = rx;
        let caps = match tokio::time::timeout(Duration::from_millis(timeout_ms), rx.recv()).await {
            Ok(Some(NetEvent::Connected(caps))) => caps,
            Ok(Some(NetEvent::ConnectionError(text))) => {
                return Err(format!("{}: {text}", broker.describe()))
            }
            Ok(Some(_)) => return Err("unexpected first packet before CONNACK".into()),
            Ok(None) => return Err("the connection task ended".into()),
            Err(_) => return Err(format!("no CONNACK within {timeout_ms} ms")),
        };
        Ok(Self { client, rx, caps })
    }

    async fn close(self) {
        self.client.disconnect().await;
    }

    /// The next event, or `None` if the budget ran out.
    async fn next(&mut self, within: Duration) -> Option<NetEvent> {
        if within.is_zero() {
            return None;
        }
        // `unwrap_or` rather than `unwrap_or_default` so the elapsed case reads as
        // "no event", which is what the caller is asking about.
        tokio::time::timeout(within, self.rx.recv()).await.unwrap_or(None)
    }

    /// Subscribe one filter and return the broker's own verdict byte. `None` means no
    /// SUBACK arrived, which is reported as a failure rather than assumed granted.
    async fn subscribe_and_wait(
        &mut self,
        filter: &str,
        options: &SubOptions,
    ) -> Result<Option<u8>, String> {
        if let Some(err) = dropqtt_lib::transport::subscribe_capability_error(filter, &self.caps) {
            return Err(err);
        }
        // One SUBSCRIBE per filter, so the next SUBACK belongs to this one and the
        // answer is the broker's, not our guess about its matching rules.
        self.client.subscribe(filter, options).await?;
        let deadline = Instant::now() + ACK_WAIT;
        loop {
            let budget = deadline.saturating_duration_since(Instant::now());
            if budget.is_zero() {
                return Ok(None);
            }
            match self.next(budget).await {
                Some(NetEvent::SubAck { codes, .. }) => return Ok(codes.first().copied()),
                // A refusal never reaches us as a SUBACK: rumqttc turns it into a
                // fatal state error, which is the only way to learn the code at all.
                Some(NetEvent::AckRejected { code, .. }) => return Ok(Some(code)),
                Some(NetEvent::ConnectionError(text)) => return Err(text),
                Some(_) => continue,
                None => return Ok(None),
            }
        }
    }
}

fn hex_to_bytes(raw: &str) -> Result<Vec<u8>, String> {
    hex::decode(raw).map_err(|e| format!("--correlation-hex {raw:?} is not hex: {e}"))
}

/// Reject a publish the broker has already told us it cannot take, rather than
/// sending it and interpreting whatever comes back.
fn check_publishable(
    caps: &ConnCapabilities,
    topic: &str,
    qos: u8,
    retain: bool,
    payload_len: usize,
) -> Result<(), String> {
    if let Some(err) = dropqtt_lib::transport::qos_rejection(qos, caps.max_qos) {
        return Err(err);
    }
    if let Some(err) = dropqtt_lib::transport::retain_rejection(retain, caps.retain_available) {
        return Err(err);
    }
    if let Some(err) = dropqtt_lib::transport::packet_size_rejection(
        payload_len,
        topic.len(),
        caps.max_packet_size,
    ) {
        return Err(err);
    }
    Ok(())
}

async fn run_sub(cmd: cli::SubCmd) -> i32 {
    let mut session = match Session::open(&cmd.broker, 5_000).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("dropqtt-cli: {e}");
            return EXIT_UNAVAILABLE;
        }
    };
    let mut refused = Vec::new();
    for filter in &cmd.filters {
        match session.subscribe_and_wait(filter, &cmd.options).await {
            Ok(Some(code)) if code < 0x80 => println!("subscribed {filter} (granted qos{code})"),
            Ok(Some(code)) => {
                println!("subscribed {filter} (REFUSED 0x{code:02x})");
                refused.push(filter.clone());
            }
            Ok(None) => {
                eprintln!("dropqtt-cli: no SUBACK for {filter:?}");
                refused.push(filter.clone());
            }
            Err(e) => {
                eprintln!("dropqtt-cli: {e}");
                return if e.contains("not allowed") || e.contains("exceeds") {
                    EXIT_USAGE
                } else {
                    EXIT_UNAVAILABLE
                };
            }
        }
    }

    let deadline = cmd.duration_ms.map(|ms| Instant::now() + Duration::from_millis(ms));
    let mut seen = 0u64;
    loop {
        if cmd.count.is_some_and(|target| seen >= target) {
            break;
        }
        let budget = match deadline {
            Some(at) => at.saturating_duration_since(Instant::now()),
            // No --count and no --for means "until interrupted"; a made-up default
            // deadline would end a watch that the user did not ask to end.
            None => Duration::from_secs(3600),
        };
        if budget.is_zero() {
            break;
        }
        match session.next(budget).await {
            Some(NetEvent::Publish(publish)) => {
                let msg = cli::message_of(&publish, &format!("cli-{seen}"));
                println!("{}", cli::render_received(&msg, cmd.print_payload));
                seen += 1;
            }
            Some(NetEvent::ConnectionError(text)) => {
                eprintln!("dropqtt-cli: link error: {text}");
                return EXIT_UNAVAILABLE;
            }
            Some(_) | None => continue,
        }
    }
    session.close().await;
    if !refused.is_empty() {
        // A green "subscribed" that receives nothing is the exact failure this line of
        // work exists to kill.
        eprintln!("dropqtt-cli: {} filter(s) refused by the broker", refused.len());
        return EXIT_FAIL;
    }
    match cmd.count {
        Some(target) if seen < target => {
            eprintln!("dropqtt-cli: wanted {target} message(s), saw {seen}");
            EXIT_UNKNOWN
        }
        _ => EXIT_PASS,
    }
}

async fn run_pub(cmd: cli::PubCmd) -> i32 {
    let correlation = match &cmd.correlation_hex {
        Some(raw) => match hex_to_bytes(raw) {
            Ok(bytes) => Some(bytes),
            Err(e) => {
                eprintln!("dropqtt-cli: {e}");
                return EXIT_USAGE;
            }
        },
        None => None,
    };
    let has_props = cmd.content_type.is_some()
        || !cmd.user_properties.is_empty()
        || cmd.response_topic.is_some()
        || correlation.is_some();
    let properties = has_props.then(|| PubProperties {
        content_type: cmd.content_type.clone(),
        user_properties: cmd.user_properties.clone(),
        response_topic: cmd.response_topic.clone(),
        correlation_hex: cmd.correlation_hex.clone(),
        ..Default::default()
    });
    let mut session = match Session::open(&cmd.broker, 5_000).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("dropqtt-cli: {e}");
            return EXIT_UNAVAILABLE;
        }
    };
    if let Err(err) = check_publishable(&session.caps, &cmd.topic, cmd.qos, cmd.retain, cmd.payload.len())
    {
        eprintln!("dropqtt-cli: {err}");
        return EXIT_USAGE;
    }
    if let Err(e) = session
        .client
        .publish(
            &cmd.topic,
            cmd.qos,
            cmd.retain,
            Bytes::from(cmd.payload.clone()),
            properties.as_ref(),
        )
        .await
    {
        eprintln!("dropqtt-cli: publish failed: {e}");
        return EXIT_UNAVAILABLE;
    }
    if cmd.qos == 0 {
        // QoS 0 has no acknowledgement to wait for. Hanging on a PUBACK that can never
        // arrive would make the tool look broken and the broker look slow.
        println!(
            "published {} bytes to {} (QoS 0: the broker acknowledges nothing)",
            cmd.payload.len(),
            cmd.topic
        );
        session.close().await;
        return EXIT_PASS;
    }
    let deadline = Instant::now() + Duration::from_millis(cmd.ack_timeout_ms);
    let mut code = None;
    while let Some(budget) = Some(deadline.saturating_duration_since(Instant::now())) {
        if budget.is_zero() {
            break;
        }
        match session.next(budget).await {
            Some(NetEvent::PublishAcked { code: c, .. }) => {
                code = Some(c);
                break;
            }
            Some(NetEvent::AckRejected { code: c, .. }) => {
                code = Some(c);
                break;
            }
            Some(_) => continue,
            None => break,
        }
    }
    session.close().await;
    match code {
        None => {
            eprintln!("dropqtt-cli: no PUBACK within {} ms", cmd.ack_timeout_ms);
            EXIT_UNAVAILABLE
        }
        Some(0x00) => {
            println!("published to {} (accepted)", cmd.topic);
            EXIT_PASS
        }
        Some(0x10) => {
            println!("published to {} (accepted, but no subscriber matched — 0x10)", cmd.topic);
            EXIT_UNKNOWN
        }
        Some(other) => {
            eprintln!("dropqtt-cli: the broker refused the publish (0x{other:02x})");
            EXIT_FAIL
        }
    }
}

async fn run_rpc(cmd: cli::RpcCmd) -> i32 {
    let mut session = match Session::open(&cmd.broker, 5_000).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("dropqtt-cli: {e}");
            return EXIT_UNAVAILABLE;
        }
    };
    // Either we name the reply topic, or the broker told us where replies go. With
    // neither there is nothing to listen on, and the honest answer is "cannot".
    let response_topic = cmd.response_topic.clone().or_else(|| {
        session
            .caps
            .response_information
            .as_ref()
            .map(|prefix| format!("{}{}", prefix, uuid::Uuid::new_v4()))
    });
    let Some(response_topic) = response_topic else {
        eprintln!("dropqtt-cli: no --response-topic, and the broker announced no response-information");
        return EXIT_USAGE;
    };
    let correlation = match &cmd.correlation_hex {
        Some(raw) => match hex_to_bytes(raw) {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("dropqtt-cli: {e}");
                return EXIT_USAGE;
            }
        },
        None => uuid::Uuid::new_v4().as_bytes().to_vec(),
    };
    let options = SubOptions {
        qos: cmd.qos,
        ..Default::default()
    };
    match session.subscribe_and_wait(&response_topic, &options).await {
        Ok(Some(code)) if code < 0x80 => {}
        Ok(Some(code)) => {
            eprintln!("dropqtt-cli: the broker refused {response_topic:?} (0x{code:02x})");
            return EXIT_FAIL;
        }
        Ok(None) => {
            eprintln!("dropqtt-cli: no SUBACK for the response topic {response_topic:?}");
            return EXIT_UNAVAILABLE;
        }
        Err(e) => {
            eprintln!("dropqtt-cli: {e}");
            return EXIT_UNAVAILABLE;
        }
    }
    if let Err(err) = check_publishable(&session.caps, &cmd.topic, cmd.qos, false, cmd.payload.len())
    {
        eprintln!("dropqtt-cli: {err}");
        return EXIT_USAGE;
    }
    let properties = PubProperties {
        response_topic: Some(response_topic.clone()),
        correlation_hex: Some(hex::encode(&correlation)),
        ..Default::default()
    };
    let started = Instant::now();
    if let Err(e) = session
        .client
        .publish(
            &cmd.topic,
            cmd.qos,
            false,
            Bytes::from(cmd.payload.clone()),
            Some(&properties),
        )
        .await
    {
        eprintln!("dropqtt-cli: request publish failed: {e}");
        return EXIT_UNAVAILABLE;
    }
    let mut code = EXIT_UNKNOWN;
    let deadline = Instant::now() + Duration::from_millis(cmd.timeout_ms);
    while let Some(budget) = Some(deadline.saturating_duration_since(Instant::now())) {
        if budget.is_zero() {
            break;
        }
        match session.next(budget).await {
            Some(NetEvent::Publish(publish)) => {
                if publish.topic != response_topic {
                    continue;
                }
                // Correlation is compared as bytes: the reply address is the one thing
                // a mismatched pair cannot be recovered from.
                if publish.correlation_data.as_deref() != Some(correlation.as_slice()) {
                    continue;
                }
                let msg = cli::message_of(&publish, "rpc-reply");
                println!(
                    "answered in {} ms on {} ({} bytes)",
                    started.elapsed().as_millis(),
                    msg.topic,
                    msg.payload_len
                );
                println!("{}", msg.payload.replace('\n', "\\n"));
                code = EXIT_PASS;
                break;
            }
            Some(NetEvent::ConnectionError(text)) => {
                eprintln!("dropqtt-cli: link error: {text}");
                return EXIT_UNAVAILABLE;
            }
            Some(_) => continue,
            None => break,
        }
    }
    session.close().await;
    if code == EXIT_UNKNOWN {
        eprintln!(
            "dropqtt-cli: no answer within {} ms on {response_topic} — is a responder subscribed to the request topic?",
            cmd.timeout_ms
        );
    }
    code
}

async fn run_verify(cmd: cli::VerifyCmd) -> i32 {
    // A scenario is read before anything else, and a broken one stops the run: the
    // alternative is subscribing to half a rig and reporting the rest as a verdict.
    let scenario = match cmd.scenario.as_deref() {
        Some(path) => match std::fs::read_to_string(path) {
            Ok(text) => match scenario::parse(&text) {
                Ok(loaded) => Some(loaded),
                Err(err) => {
                    eprintln!("dropqtt-cli: {path}: {err}");
                    return EXIT_USAGE;
                }
            },
            Err(err) => {
                eprintln!("dropqtt-cli: cannot read {path}: {err}");
                return EXIT_USAGE;
            }
        },
        None => None,
    };
    if let Some(loaded) = &scenario {
        for note in scenario::notes(loaded, cmd.broker.protocol_version == 5) {
            eprintln!("dropqtt-cli: note: {note}");
        }
    }

    // Validate every rule before touching the network: a typo in a predicate should
    // fail in milliseconds, not after a wait that produced nothing.
    let mut rules: Vec<AssertionRule> = Vec::new();
    for (id, filter, predicate) in &cmd.asserts {
        match assertions::parse_rule(id, filter, predicate) {
            Ok(rule) => {
                if let Some(err) = assertions::rule_error(&rule) {
                    eprintln!("dropqtt-cli: {id}: {err}");
                    return EXIT_USAGE;
                }
                rules.push(rule);
            }
            Err(err) => {
                eprintln!("dropqtt-cli: {id}: {err}");
                return EXIT_USAGE;
            }
        }
    }
    if let Some(loaded) = &scenario {
        for rule in &loaded.assertions {
            if let Some(err) = assertions::rule_error(rule) {
                eprintln!("dropqtt-cli: {}: {err}", rule.id);
                return EXIT_USAGE;
            }
            rules.push(rule.clone());
        }
    }
    let mut session = match Session::open(&cmd.broker, 5_000).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("dropqtt-cli: {e}");
            return EXIT_UNAVAILABLE;
        }
    };
    let options = SubOptions {
        qos: cmd.qos,
        ..Default::default()
    };
    // The scenario's own subscribe options carry over unchanged: a rule written against
    // a `noLocal` subscription is not the same experiment as one written against a
    // plain one, and quietly flattening them would be the second source of truth again.
    let mut subs: Vec<(String, SubOptions)> = cmd
        .filters
        .iter()
        .map(|filter| (filter.clone(), options))
        .collect();
    if let Some(loaded) = &scenario {
        subs.extend(loaded.subscriptions.iter().map(|sub| (sub.topic.clone(), sub.options)));
    }
    let mut refused = Vec::new();
    for (filter, sub_options) in &subs {
        match session.subscribe_and_wait(filter, sub_options).await {
            Ok(Some(code)) if code < 0x80 => {}
            Ok(Some(code)) => {
                eprintln!("dropqtt-cli: {filter:?} refused by the broker (0x{code:02x})");
                refused.push(filter.clone());
            }
            Ok(None) => {
                eprintln!("dropqtt-cli: no SUBACK for {filter:?}");
                refused.push(filter.clone());
            }
            Err(e) => {
                eprintln!("dropqtt-cli: {e}");
                return EXIT_UNAVAILABLE;
            }
        }
    }
    let mut tallies: Vec<cli::RuleTally> = rules
        .iter()
        .map(|rule| cli::RuleTally {
            id: rule.id.clone(),
            filter: rule.filter.clone(),
            // `text` is the predicate as written; `expr()` is the canonicalised
            // re-format. A CI report that says `Json("$.tempC") Lt 80` makes someone
            // hunt for the rule, so the report quotes what they typed.
            expr: if rule.text.is_empty() { rule.expr() } else { rule.text.clone() },
            ..Default::default()
        })
        .collect();

    let started = Instant::now();
    let deadline = cmd.duration_ms.map(|ms| started + Duration::from_millis(ms));
    let mut observed = 0u64;
    loop {
        if cmd.count.is_some_and(|target| observed >= target) {
            break;
        }
        let budget = match deadline {
            Some(at) => at.saturating_duration_since(Instant::now()),
            None => Duration::from_secs(3600),
        };
        if budget.is_zero() {
            break;
        }
        match session.next(budget).await {
            Some(NetEvent::Publish(publish)) => {
                observed += 1;
                let msg = cli::message_of(&publish, &format!("v{observed}"));
                judge_into(&mut tallies, &rules, &msg);
            }
            Some(NetEvent::ConnectionError(text)) => {
                eprintln!("dropqtt-cli: link error: {text}");
                return EXIT_UNAVAILABLE;
            }
            Some(_) | None => continue,
        }
    }
    session.close().await;

    let report = VerifyReport {
        tool: format!("dropqtt-cli {}", env!("CARGO_PKG_VERSION")),
        broker: cmd.broker.describe(),
        observed,
        rules: tallies,
    };
    if let Some(loaded) = &scenario {
        return report_scenario(loaded, &report, cmd.json, cmd.junit, started.elapsed(), refused.len() as u64);
    }
    if cmd.junit {
        print!("{}", report.to_junit());
    } else if cmd.json {
        println!("{}", report.to_json());
    } else {
        for rule in &report.rules {
            println!(
                "{:<8} {:<28} matched {} · passed {} · violated {} · unevaluable {}",
                rule.outcome().word(),
                rule.expr,
                rule.matched,
                rule.passed,
                rule.violated,
                rule.unevaluable
            );
        }
        println!(
            "{}: {} rule(s), {} message(s) in {} s",
            report.outcome().word(),
            report.rules.len(),
            report.observed,
            started.elapsed().as_secs_f32()
        );
    }
    let outcome = report.outcome();
    if !refused.is_empty() && outcome != Outcome::Fail {
        // A refused filter means the rules were judged against traffic that never
        // arrived. That is a broken fixture, not a passed gate.
        eprintln!("dropqtt-cli: {} filter(s) refused by the broker", refused.len());
        return EXIT_FAIL;
    }
    outcome.exit_code()
}

/// The verdict of a scenario run, through the same `scenario::claims` the desktop
/// panel uses. The rule tallies are still printed in text mode -- which rule matched
/// what is the part an engineer reads first -- but the *answer* comes from the claims.
fn report_scenario(
    loaded: &Scenario,
    report: &VerifyReport,
    json: bool,
    junit: bool,
    elapsed: Duration,
    refused: u64,
) -> i32 {
    let summed = |pick: fn(&dropqtt_lib::cli::RuleTally) -> u64| {
        report.rules.iter().map(pick).sum::<u64>()
    };
    let stats = AssertStats {
        matched: summed(|t| t.matched),
        passed: summed(|t| t.passed),
        violated: summed(|t| t.violated),
        unevaluable: summed(|t| t.unevaluable),
    };
    let evidence = scenario::Evidence {
        expect: loaded.bench.as_ref().and_then(|b| b.expect.clone()),
        // verify generates no bench traffic, so there is nothing to grade the bar
        // against. `None` here is what makes the rate claim come out as not proven.
        bench: None,
        assertions: (!report.rules.is_empty()).then_some(stats),
        // A filter the broker refused is a hole in the rig, and a hole in the rig is
        // not a pass: the rules beside it were judged against traffic that never came.
        refused,
    };
    let claims = scenario::claims(&evidence);
    let outcome = scenario::verdict_of(&claims);
    let generated_at = chrono::Utc::now().to_rfc3339();
    if junit {
        print!(
            "{}",
            scenario::report_junit(&loaded.name, &generated_at, &claims, &scenario::ReportWords::default(), &[])
        );
    } else if json {
        print!(
            "{}",
            scenario::report_json(&loaded.name, loaded.note.as_deref(), &generated_at, &claims)
        );
    } else {
        for rule in &report.rules {
            println!(
                "{:<8} {:<28} matched {} · passed {} · violated {} · unevaluable {}",
                rule.outcome().word(),
                rule.expr,
                rule.matched,
                rule.passed,
                rule.violated,
                rule.unevaluable
            );
        }
        for claim in &claims {
            println!("{:<8} {:<22} {}", claim.state.word(), claim.id, scenario::describe(claim));
        }
        println!(
            "{}: {} rule(s), {} message(s) in {} s",
            outcome.word(),
            report.rules.len(),
            report.observed,
            elapsed.as_secs_f32()
        );
    }
    outcome.exit_code()
}

fn judge_into(tallies: &mut [cli::RuleTally], rules: &[AssertionRule], msg: &MqttGenericMessage) {    for (tally, rule) in tallies.iter_mut().zip(rules) {
        if !dropqtt_lib::topic::wildcard_match(rule.filter.trim(), &msg.topic) {
            continue;
        }
        tally.matched += 1;
        match assertions::evaluate(rule, msg) {
            AssertOutcome::Passed => tally.passed += 1,
            AssertOutcome::Violated => tally.violated += 1,
            AssertOutcome::Unevaluable => tally.unevaluable += 1,
        }
    }
}
