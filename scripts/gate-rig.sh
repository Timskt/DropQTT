#!/usr/bin/env bash
# Run both CLI gates against a throwaway broker with the same shape as CI's `cli` job.
#
# This exists because every red this project has had in the cli job was a *rig* problem,
# not a code problem -- and the manual recipe (password file, allow_anonymous false, the
# repo ACL, a non-default port, SCENARIO_TOPIC inside the granted tree) is long enough
# that the cheap shortcut looked attractive: point the gate at a plain anonymous broker.
# That cannot prove the refusal path, so it goes green while proving nothing
# (ITERATION 4.77 / 4.78). One command, one shape, no way to forget a piece.
#
#   scripts/gate-rig.sh [path-to-dropqtt-cli]
#
# Override the port with GATE_RIG_PORT. The password is generated per run and only ever
# reaches the CLI through an environment variable, like every other DropQTT credential.
set -u

cd "$(dirname "$0")/.." || exit 1
CLI="${1:-src-tauri/target/debug/dropqtt-cli}"
PORT="${GATE_RIG_PORT:-18831}"
ACL=".github/ci/mosquitto.acl"
WORK="$(mktemp -d)"

die() { printf 'gate-rig: %s\n' "$*" >&2; rm -rf "$WORK"; exit 1; }

# AGENTS.md is blunt about this: the owner's own broker lives on 127.0.0.1:1883 and test
# traffic must never reach it. Refusing is better than a flag someone can forget.
[ "$PORT" = 1883 ] && die "refusing to use 1883: that is the owner's resident broker"
[ -x "$CLI" ] || die "no CLI at $CLI -- build it: cd src-tauri && cargo build --bin dropqtt-cli"
[ -f "$ACL" ] || die "missing $ACL"

MOSQUITTO="$(command -v mosquitto || true)"
if [ -z "$MOSQUITTO" ] && [ -x /usr/sbin/mosquitto ]; then
  MOSQUITTO=/usr/sbin/mosquitto   # Debian/Ubuntu keep it off PATH for non-root users
fi
[ -n "$MOSQUITTO" ] || die "mosquitto not found -- on macOS: brew install mosquitto"

# The CI lesson, applied locally: "is the port answered" is not "is it answered by the
# broker I am about to start". Something already holding it means the gates would measure
# a broker nobody configured.
if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  die "port $PORT is already answered by something else -- pick another GATE_RIG_PORT"
fi

PASS="$(openssl rand -hex 12)"
export MQTT_GATE_PASS="$PASS"
export GATE_DENY_TOPIC="secret/never-granted" GATE_USER="gateuser"
export GATE_PASSWORD_ENV="MQTT_GATE_PASS" SCENARIO_TOPIC="cli-gate/scenario/telemetry"

mosquitto_passwd -c -b "$WORK/gate.pass" gateuser "$PASS" 2>/dev/null \
  || die "mosquitto_passwd failed (needs mosquitto-clients)"
cat > "$WORK/gate.conf" <<EOF
listener $PORT 127.0.0.1
allow_anonymous false
persistence false
password_file $WORK/gate.pass
acl_file $PWD/$ACL
EOF

# No -d: it returns 0 even when the listener never bound, which is how a whole gate run
# ended up talking to somebody else's broker.
"$MOSQUITTO" -c "$WORK/gate.conf" -v > "$WORK/mosquitto.log" 2>&1 &
BROKER=$!
trap 'kill "$BROKER" 2>/dev/null; rm -rf "$WORK"' EXIT

ready=0
for _ in $(seq 1 40); do
  if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then ready=1; break; fi
  sleep 0.5
done
if [ "$ready" = 0 ]; then
  printf 'gate-rig: broker never came up on %s\n' "$PORT" >&2
  sed 's/^/         | /' "$WORK/mosquitto.log" >&2
  exit 1
fi

printf 'gate-rig: enforcing mosquitto on 127.0.0.1:%s (%s)\n' "$PORT" "$MOSQUITTO"
rc=0
for gate in cli-gate scenario-gate; do
  if bash "scripts/$gate.sh" "$CLI" 127.0.0.1 "$PORT"; then
    printf 'gate-rig: %s passed\n' "$gate"
  else
    printf 'gate-rig: %s FAILED\n' "$gate"
    rc=1
  fi
done
exit "$rc"
