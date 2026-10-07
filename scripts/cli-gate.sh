#!/usr/bin/env bash
# The exit-code contract of dropqtt-cli, asserted against a live broker.
#
# This lives in a script rather than inline in workflow YAML on purpose: inline steps
# can only be proven by pushing a branch and watching CI, which makes every edit to the
# gate itself a round-trip. The same file runs locally against a throwaway broker and in
# CI against a service container, so the logic has one copy.
#
#   scripts/cli-gate.sh <path-to-dropqtt-cli> <host> <port>
#
# A gate is only worth having if it can fail, so the violated-rule case is asserted as
# carefully as the passing one: a verify that always exits 0 would let a pipeline go
# green on a broker nobody is talking to.
set -u

CLI="${1:-./target/debug/dropqtt-cli}"
HOST="${2:-127.0.0.1}"
PORT="${3:-1883}"
B=(--host "$HOST" --port "$PORT")
# A broker that requires a named user is the only one that can really refuse a publish:
# mosquitto's `pattern` ACL lines do not apply to anonymous clients, so against an
# anonymous broker the "denied topic" case comes back accepted. The password is taken
# from a variable name, never from the command line, like every other DropQTT credential.
if [ -n "${GATE_USER:-}" ]; then
  B+=(--username "$GATE_USER")
  if [ -n "${GATE_PASSWORD_ENV:-}" ]; then
    B+=(--password-env "$GATE_PASSWORD_ENV")
  fi
fi
# Unique per run so another client on a shared broker cannot move the counters.
T="cli-gate/$$"
WORK="$(mktemp -d)"
fails=0

note() { printf '%s\n' "$*"; }

assert_code() {
  # assert_code <want> <what> <got>
  if [ "$1" = "$3" ]; then
    note "  ok   $2 (exit $3)"
  else
    note "  FAIL $2: wanted exit $1, got $3"
    fails=$((fails + 1))
  fi
}

assert_has() {
  # assert_has <needle> <what> <file>
  if grep -qF -- "$1" "$3"; then
    note "  ok   $2"
  else
    note "  FAIL $2: no ${1:?} in the output"
    sed 's/^/         | /' "$3"
    fails=$((fails + 1))
  fi
}

# code_of <cmd...> — run to completion, print the exit status, keep the body in $OUT
code_of() {
  "$@" > "$WORK/out" 2>&1
  echo $?
}

note "dropqtt-cli gate against $HOST:$PORT"

note "usage contract (no broker needed)"
assert_code 2 "unknown command"            "$(code_of "$CLI" definitely-not-a-command)"
assert_code 2 "verify without --assert"    "$(code_of "$CLI" verify "${B[@]}" --topic "$T/#")"
assert_code 2 "--count 0 is unsatisfiable" "$(code_of "$CLI" verify "${B[@]}" --topic "$T/#" --assert 'qos >= 0' --count 0)"
assert_code 2 "a non-numeric port"         "$(code_of "$CLI" connect --port not-a-number)"
assert_code 2 "a flag from another verb"   "$(code_of "$CLI" sub --topic "$T/x" --payload-file /dev/null)"
assert_code 0 "--version"                  "$(code_of "$CLI" --version)"
assert_has "dropqtt-cli" "--version names the tool" "$WORK/out"

note "reachability"
assert_code 3 "connect to a closed port"   "$(code_of "$CLI" connect --host "$HOST" --port 1 --timeout 2s)"
assert_code 0 "connect"                    "$(code_of "$CLI" connect "${B[@]}" --timeout 10s)"
assert_has "maximum QoS" "connect prints the capability table" "$WORK/out"

note "publish and subscribe"
"$CLI" sub "${B[@]}" --topic "$T/watch" --count 1 --for 15s --payload > "$WORK/sub" 2>&1 &
SUB_PID=$!
sleep 3
assert_code 0 "pub while a subscriber exists" "$(code_of "$CLI" pub "${B[@]}" --topic "$T/watch" --payload '{"tempC":21}' --qos 1)"
assert_has "accepted" "pub reports the broker's yes" "$WORK/out"
wait $SUB_PID
assert_code 0 "sub ended on its count" "$?"
assert_has "$T/watch" "sub printed the received topic" "$WORK/sub"
assert_has "tempC" "sub printed the payload with --payload" "$WORK/sub"

assert_code 4 "pub with no subscriber is not proven" \
  "$(code_of "$CLI" pub "${B[@]}" --topic "$T/lonely$$" --payload nobody-listening --qos 1)"
assert_has "no subscriber matched" "the 0x10 case says why" "$WORK/out"

note "verify: pass, fail and unknown are three different answers"
"$CLI" verify "${B[@]}" --topic "$T/ok/#" --assert '$.tempC < 80' --for 12s > "$WORK/v-ok" 2>&1 &
P1=$!
sleep 3
"$CLI" pub "${B[@]}" --topic "$T/ok/a" --payload '{"tempC":21}' --qos 1 > /dev/null 2>&1
wait $P1
assert_code 0 "verify passes on good traffic" "$?"
assert_has "pass" "the report says pass" "$WORK/v-ok"

"$CLI" verify "${B[@]}" --topic "$T/bad/#" --assert '$.tempC < 80' --for 12s > "$WORK/v-bad" 2>&1 &
P2=$!
sleep 3
"$CLI" pub "${B[@]}" --topic "$T/bad/a" --payload '{"tempC":95}' --qos 1 > /dev/null 2>&1
wait $P2
assert_code 1 "verify fails on a violated rule" "$?"
assert_has "fail" "the report says fail" "$WORK/v-bad"

assert_code 4 "verify cannot prove an idle filter" \
  "$(code_of "$CLI" verify "${B[@]}" --topic "$T/never$$/#" --assert 'qos >= 0' --for 2s)"
assert_has "unknown" "an idle filter reports unknown, never pass" "$WORK/out"

# Both report formats are asserted against an idle filter, deliberately: the exit code
# has to stay 4 there. A --json or --junit run that reported 0 on no traffic would be
# the exact hole this contract exists to close.
assert_code 4 "--json still reports unknown on no traffic" \
  "$(code_of "$CLI" verify "${B[@]}" --topic "$T/json$$/#" --assert 'qos >= 0' --for 1s --json)"
assert_has '"outcome": "unknown"' "the JSON carries the verdict" "$WORK/out"

assert_code 4 "--junit still reports unknown on no traffic" \
  "$(code_of "$CLI" verify "${B[@]}" --topic "$T/junit$$/#" --assert 'qos >= 0' --for 1s --junit)"
assert_has "<testsuites" "the JUnit root element is present" "$WORK/out"
assert_has 'skipped="1"' "an unproven rule lands as skipped, never as a pass" "$WORK/out"

note "a bad rule is a usage error, not a wait that produced nothing"
assert_code 2 "an unparsable predicate" \
  "$(code_of "$CLI" verify "${B[@]}" --topic "$T/x/#" --assert 'not a rule at all' --for 1s)"

note "request/response"
assert_code 4 "rpc with no responder" \
  "$(code_of "$CLI" rpc "${B[@]}" --topic "$T/noresponder$$" --payload ping --response-topic "$T/reply$$" --timeout 2s)"
assert_has "responder" "the rpc failure names what to check" "$WORK/out"
assert_code 2 "rpc with no reply address" \
  "$(code_of "$CLI" rpc "${B[@]}" -V 3 --topic "$T/x" --payload ping --timeout 1s)"

note "QoS 0 has no acknowledgement to wait for"
assert_code 0 "pub --qos 0 returns at once" \
  "$(code_of "$CLI" pub "${B[@]}" --topic "$T/q0" --payload fast --qos 0)"
assert_has "acknowledges nothing" "and says so rather than implying delivery" "$WORK/out"

# Only checked when the broker is known to enforce an ACL (CI mounts one; a plain local
# broker does not). A refusal is the single most important thing this gate can catch:
# a publish the broker rejected but the tool called "sent" is a lie in a pipeline.
if [ -n "${GATE_DENY_TOPIC:-}" ]; then
  note "a real broker refusal"
  assert_code 1 "pub to a denied topic reports the refusal" \
    "$(code_of "$CLI" pub "${B[@]}" --topic "$GATE_DENY_TOPIC" --payload nope --qos 1)"
  assert_has "0x87" "and names the reason byte it got" "$WORK/out"
fi

rm -rf "$WORK"
if [ "$fails" = 0 ]; then
  note "gate: all checks passed"
  exit 0
fi
note "gate: $fails check(s) failed"
exit 1
