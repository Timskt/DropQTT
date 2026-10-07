#!/usr/bin/env bash
# Live proof of `dropqtt-cli verify --scenario`, against a running broker.
#
#   scripts/scenario-gate.sh <path-to-dropqtt-cli> <host> <port>
#
# Same shape as cli-gate.sh, for the same reason: gate logic in a file can be run
# locally and in CI without a push to find out whether the gate itself is broken.
#
# The rig file is what the desktop app writes; it is generated here so the gate has no
# dependency on a window being open, and so a format change shows up as a refusal
# rather than as a silently empty run.
set -u
CLI="${1:-./src-tauri/target/debug/dropqtt-cli}"
HOST="${2:-127.0.0.1}"
PORT="${3:-18831}"
TOPIC="${SCENARIO_TOPIC:-dq-scenario/gate/telemetry}"
B=(--host "$HOST" --port "$PORT" --client-id "dqscngate$$")
# Same rule as cli-gate.sh: only a named user is subject to mosquitto's ACL file, so an
# authenticated broker is the one that can genuinely refuse.
if [ -n "${GATE_USER:-}" ]; then
  B+=(--username "$GATE_USER")
  if [ -n "${GATE_PASSWORD_ENV:-}" ]; then
    B+=(--password-env "$GATE_PASSWORD_ENV")
  fi
fi
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
fails=0

publish() {
  "$CLI" pub "${B[@]}" --client-id "dqscnpub$RANDOM" \
    --topic "$TOPIC" --payload "$1" >/dev/null 2>&1
}

ok()   { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; fails=$((fails + 1)); }

# run_rig <payload> <rig file> [extra cli args...] -- echoes the exit code, leaves the
# program's own output in $WORK/out and $WORK/err.
run_rig() {
  local payload="$1" rig="$2"
  shift 2
  ( sleep 1.2; for _ in 1 2 3 4; do publish "$payload"; sleep 0.4; done ) &
  local publisher=$!
  "$CLI" verify "${B[@]}" --scenario "$rig" --for 4s "$@" >"$WORK/out" 2>"$WORK/err"
  local code=$?
  wait "$publisher" 2>/dev/null
  echo "$code"
}

expect_code() { # want label code
  if [ "$3" = "$1" ]; then ok "$2 (exit $3)"; else bad "$2: wanted exit $1, got $3"; fi
}
expect_says() { # pattern label
  if grep -q -- "$1" "$WORK/out" "$WORK/err" 2>/dev/null; then ok "$2"; else bad "$2 (no '$1')"; fi
}

cat > "$WORK/rig.dqscn" <<EOF
{
  "kind": "scenario",
  "format": "dropqtt-scenario/1",
  "name": "Gate rig",
  "subscriptions": [
    { "topic": "$TOPIC", "qos": 1,
      "options": { "qos": 1, "noLocal": false, "retainAsPublished": false, "retainHandling": 0 } }
  ],
  "responders": [],
  "assertions": [
    { "id": "temp-under-boiling", "filter": "$TOPIC",
      "field": { "json": "\$.tempC" }, "op": "lt", "expected": "80",
      "enabled": true, "label": "", "text": "\$.tempC < 80" }
  ],
  "silence": [ { "id": "hb", "topicFilter": "$TOPIC" } ]
}
EOF

# The same rig, with a performance bar verify has no way to exercise.
cat > "$WORK/rig-bar.dqscn" <<EOF
{
  "kind": "scenario",
  "format": "dropqtt-scenario/1",
  "name": "Gate rig with a bar",
  "subscriptions": [ { "topic": "$TOPIC", "qos": 1,
    "options": { "qos": 1, "noLocal": false, "retainAsPublished": false, "retainHandling": 0 } } ],
  "responders": [],
  "assertions": [
    { "id": "temp-under-boiling", "filter": "$TOPIC",
      "field": { "json": "\$.tempC" }, "op": "lt", "expected": "80",
      "enabled": true, "label": "", "text": "\$.tempC < 80" }
  ],
  "bench": { "topics": ["$TOPIC"], "expect": { "minRate": 5000 } },
  "silence": []
}
EOF

echo "1. a rig whose rules hold, but which measured no traffic"
expect_code 4 "not proven rather than green" "$(run_rig '{"tempC":21}' "$WORK/rig.dqscn")"
expect_says 'pass     assertions' "the assertion claim itself reads pass"
expect_says 'noBarSet' "and the reason is named, not hidden"
expect_says 'watchdog rule(s) were not armed' "it says which parts of the rig it left out"

echo "2. a rig whose rule the traffic violates"
expect_code 1 "a violated scenario rule fails the run" "$(run_rig '{"tempC":95}' "$WORK/rig.dqscn")"
expect_says 'fail     assertions' "and the failing claim is the assertion"

echo "3. a rig that sets a bar"
expect_code 4 "a bar with no run behind it is not proven" "$(run_rig '{"tempC":21}' "$WORK/rig-bar.dqscn")"
expect_says 'notRun' "reported as not run, not as met"

echo "4. broken input is caught before the network"
echo '{ "kind": "scenario", "format": "dropqtt-scenario/9", "name": "future" }' > "$WORK/other.dqscn"
"$CLI" verify "${B[@]}" --scenario "$WORK/other.dqscn" --for 1s >"$WORK/out" 2>"$WORK/err"
expect_code 2 "a file from another format is refused" "$?"
expect_says 'dropqtt-scenario/9' "naming the format it found"

"$CLI" verify "${B[@]}" --scenario "$WORK/nope.dqscn" --for 1s >"$WORK/err" 2>&1
expect_code 2 "a missing file is a usage error" "$?"

echo '{ "kind": "scenario", "format": "dropqtt-scenario/1", "name": "hollow", "subscriptions": [] }' > "$WORK/hollow.dqscn"
"$CLI" verify "${B[@]}" --scenario "$WORK/hollow.dqscn" --for 1s >"$WORK/err" 2>&1
expect_code 2 "a rig with nothing in it is refused rather than run empty" "$?"

"$CLI" verify "${B[@]}" --for 1s >"$WORK/err" 2>&1
expect_code 2 "verify with neither rules nor a rig is a usage error" "$?"
expect_says -- '--scenario' "and the message points at the flag that would work"

echo "5. machine-readable output"
run_rig '{"tempC":21}' "$WORK/rig.dqscn" --json >/dev/null
expect_says '"overall"' "--json carries the verdict"
expect_says '"format": "dropqtt-scenario-report/1"' "and names its own format"
run_rig '{"tempC":21}' "$WORK/rig.dqscn" --junit >/dev/null
expect_says '<testsuites' "--junit opens with the element a CI looks for"
expect_says '<skipped message=' "and skips what it could not judge"

echo
if [ "$fails" -eq 0 ]; then
  echo "gate: all scenario checks passed"
else
  echo "gate: $fails scenario check(s) FAILED"
  exit 1
fi
