//! Embedded JavaScript payload transformer for bridge rules.
//!
//! Each rule may carry a small JS snippet defining
//! `function transform(topic, payload, qos, retain)`. The function's return
//! value drives the forward:
//!   * string / number / object  -> the returned value becomes the new payload
//!     (objects are JSON-serialized, numbers stringified)
//!   * null / undefined          -> the message is silently dropped (business
//!     conditional filtering that no static rule can express)
//!   * exception / timeout       -> counted as an error, message not forwarded
//!
//! Hardening: QuickJS runs with a memory cap, a wall-clock interrupt after
//! ~100 ms (kills accidental `while(true)`), and zero host APIs exposed to the
//! script — it is a pure data function sandbox.

use std::time::{Duration, Instant};

use bytes::Bytes;
use rquickjs::{Context, Runtime, Value};

const MEMORY_LIMIT: usize = 4 * 1024 * 1024;
const TIME_BUDGET: Duration = Duration::from_millis(100);
pub const SCRIPT_SIZE_LIMIT: usize = 16 * 1024;

/// Outcome of running a transform script for one message.
#[derive(Debug, PartialEq)]
pub enum TransformOutcome {
    /// Forward with this (possibly rewritten) payload
    Send(Bytes),
    /// Script explicitly returned null/undefined — drop the message
    Drop,
}

/// Compile + run the user script against one publish. Errors are strings
/// suitable for surfacing in the UI event log.
pub fn apply_transform(
    script: &str,
    topic: &str,
    payload: &Bytes,
    qos: u8,
    retain: bool,
) -> Result<TransformOutcome, String> {
    if script.len() > SCRIPT_SIZE_LIMIT {
        return Err(format!("transform script exceeds {} B limit", SCRIPT_SIZE_LIMIT));
    }

    let rt = Runtime::new().map_err(|e| format!("js runtime: {}", e))?;
    rt.set_memory_limit(MEMORY_LIMIT);
    // Each runtime owns its deadline: another bridge or a dry-run must never
    // extend a runaway script's budget. Instant also ignores wall-clock changes.
    let deadline = Instant::now() + TIME_BUDGET;
    rt.set_interrupt_handler(Some(Box::new(move || {
        Instant::now() >= deadline
    })));

    let ctx = Context::full(&rt).map_err(|e| format!("js context: {}", e))?;
    let payload_text = String::from_utf8_lossy(payload).to_string();

    ctx.with(|ctx| {
        let globals = ctx.globals();
        globals.set("__topic", topic).map_err(|e| e.to_string())?;
        globals.set("__payload", payload_text.as_str()).map_err(|e| e.to_string())?;
        globals.set("__qos", qos).map_err(|e| e.to_string())?;
        globals.set("__retain", retain).map_err(|e| e.to_string())?;

        // The user script must define `transform`; evaluate it then invoke.
        let source = format!(
            "{}\nglobalThis.__result = transform(__topic, __payload, __qos, __retain);",
            script
        );
        let result: Value = ctx
            .eval(source.as_str())
            .map_err(|e| format!("script error: {}", e))?;
        let _ = result;

        let out: Value = globals.get("__result").map_err(|e| e.to_string())?;
        if out.is_null() || out.is_undefined() {
            return Ok(TransformOutcome::Drop);
        }
        if let Some(s) = out.as_string() {
            let s: String = s.to_string().map_err(|e| e.to_string())?;
            return Ok(TransformOutcome::Send(Bytes::from(s)));
        }
        if let Some(n) = out.as_number() {
            // Integral floats render without a trailing .0
            let s = if n.fract() == 0.0 && n.abs() < 1e15 {
                format!("{}", n as i64)
            } else {
                format!("{}", n)
            };
            return Ok(TransformOutcome::Send(Bytes::from(s)));
        }
        if let Some(b) = out.as_bool() {
            return Ok(TransformOutcome::Send(Bytes::from_static(
                if b { b"true" } else { b"false" },
            )));
        }
        // Objects / arrays: JSON-serialize the returned structure
        let js = ctx
            .json_stringify(out)
            .map_err(|e| format!("json stringify: {}", e))?
            .ok_or_else(|| "transform returned non-serializable value".to_string())?;
        let s: String = js.to_string().map_err(|e| e.to_string())?;
        Ok(TransformOutcome::Send(Bytes::from(s)))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(script: &str, payload: &[u8]) -> Result<TransformOutcome, String> {
        apply_transform(script, "s/t", &Bytes::copy_from_slice(payload), 1, false)
    }

    #[test]
    fn string_rewrite() {
        let out = run(
            "function transform(topic, payload) { return '[via ' + topic + '] ' + payload; }",
            b"hi",
        )
        .unwrap();
        assert_eq!(out, TransformOutcome::Send(Bytes::from_static(b"[via s/t] hi")));
    }

    #[test]
    fn business_numeric_conversion() {
        // decidel -> °C string
        let out = run(
            "function transform(t, p) { return (parseFloat(p) / 10).toFixed(1); }",
            b"235",
        )
        .unwrap();
        assert_eq!(out, TransformOutcome::Send(Bytes::from_static(b"23.5")));
    }

    #[test]
    fn null_return_drops_message() {
        let out = run("function transform(t, p) { if (p === 'secret') return null; return p; }", b"secret").unwrap();
        assert_eq!(out, TransformOutcome::Drop);
        let out = run("function transform(t, p) { if (p === 'secret') return null; return p; }", b"ok").unwrap();
        assert_eq!(out, TransformOutcome::Send(Bytes::from_static(b"ok")));
    }

    #[test]
    fn object_return_is_json() {
        let out = run("function transform(t, p) { return { v: Number(p) * 2, src: t }; }", b"21").unwrap();
        match out {
            TransformOutcome::Send(b) => {
                let v: serde_json::Value = serde_json::from_slice(&b).unwrap();
                assert_eq!(v["v"], 42);
                assert_eq!(v["src"], "s/t");
            }
            _ => panic!("expected send"),
        }
    }

    #[test]
    fn runtime_error_is_reported() {
        let err = run("function transform(t, p) { throw new Error('nope'); }", b"x").unwrap_err();
        assert!(err.contains("script error"), "{}", err);
    }

    #[test]
    fn missing_transform_function_errors() {
        let err = run("const x = 1;", b"x").unwrap_err();
        assert!(err.contains("script error"), "{}", err);
    }

    #[test]
    fn infinite_loop_is_killed_by_deadline() {
        // The interrupt handler must abort a runaway loop rather than hang.
        let err = run("function transform() { while (true) {} }", b"x");
        assert!(err.is_err(), "expected timeout/termination error");
    }

    #[test]
    fn runaway_loop_dies_even_while_other_scripts_keep_starting() {
        // Regression: the deadline used to live in a shared static, so every new
        // transform pushed the runaway script's budget further out and it never
        // stopped. Each runtime must own its own deadline.
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let stop = Arc::new(AtomicBool::new(false));
        let chatter = stop.clone();
        std::thread::spawn(move || {
            while !chatter.load(Ordering::SeqCst) {
                let _ = run("function transform(t, p) { return p; }", b"ping");
                std::thread::sleep(Duration::from_millis(5));
            }
        });

        let started = Instant::now();
        let err = run("function transform() { while (true) {} }", b"x");
        stop.store(true, Ordering::SeqCst);

        assert!(err.is_err(), "runaway script must be terminated");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "runaway script outlived its budget: {:?}",
            started.elapsed()
        );
    }
}
