#!/usr/bin/env bash
# Install DropQTT on macOS without Gatekeeper blocking it — and without buying a certificate.
#
# Measured on 2026-10-11 (macOS 26, Apple Silicon) against this repo's own release artifacts:
#
#   same .app, signed by "DropQTT Code Signing"
#     without com.apple.quarantine  -> launches (the process appears within ~2 s)
#     with    com.apple.quarantine  -> refused (no process at all)
#   `spctl --assess` says "rejected" in BOTH cases, so spctl is not the test — whether the
#     process starts is. (Apple's own ad-hoc/Developer-ID distinction is not what decides this.)
#   a browser download sets that bit, and it survives dragging the app out of the mounted .dmg
#   `xattr -d com.apple.quarantine` on a bundle now fails with EPERM unless the shell has Full
#     Disk Access, so the advice in every forum thread is not a reliable fix on current macOS
#   `curl` does not set the bit, and `tar` does not propagate it
#
# So the free fresh-install path is the release's `.app.tar.gz` (the same file the auto-updater
# uses — which is why *updating* was never blocked), installed with this script instead of the
# DMG. The bundle is verified after extraction, and the verification asserts the property this
# whole signing effort exists for: a designated requirement anchored to our certificate, not to
# a CDHash. A sha256 fetched from the same server we just downloaded from would prove less.
#
#   bash scripts/install-macos.sh                     # latest release
#   bash scripts/install-macos.sh --tag v0.12.6       # a specific one
#   bash scripts/install-macos.sh --from-file f.tar.gz --dest ./out   # offline / CI rehearsal
set -euo pipefail

REPO="Timskt/DropQTT"
# The leaf hash of the certificate that must sign the bundle. Rotating this means rotating the
# identity in scripts/macos-selfsigned-identity.sh, which invalidates every keychain "Always
# Allow" grant — a release-scale decision, not a script edit. A Developer ID certificate would
# have a different value here and would additionally be notarized.
EXPECTED_LEAF="d483c414b23ad0e92e6b1745efef8a6e656ba508"

tag=""
tarball=""
dest=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) tag="${2:?--tag needs a value like v0.12.6}"; shift 2 ;;
    --from-file) tarball="${2:?--from-file needs a path}"; shift 2 ;;
    --dest) dest="${2:?--dest needs a directory}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || { echo "this installer is macOS-only" >&2; exit 1; }

case "$(uname -m)" in
  arm64) asset="DropQTT_aarch64.app.tar.gz" ;;
  x86_64) asset="DropQTT_x64.app.tar.gz" ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [ -z "$dest" ]; then
  if [ -w /Applications ]; then dest=/Applications
  else dest="$HOME/Applications"; mkdir -p "$dest"
  fi
fi
mkdir -p "$dest"
[ -d "$dest" ] || { echo "no such directory: $dest" >&2; exit 1; }

work=$(mktemp -d "${TMPDIR:-/tmp}/dropqtt-install.XXXXXX")
target=""
backup=""
cleanup() {
  # The previous copy is parked inside $work while the new one moves in. If this script dies in
  # between - disk full, permission on /Applications, interrupted - deleting $work would delete
  # the only copy of the app the user had. Restore it, then clean up.
  if [ -n "$backup" ] && [ -e "$backup" ] && [ ! -e "$target" ]; then
    mv "$backup" "$target" 2>/dev/null \
      && echo "install did not complete; the previous copy is back at $target" >&2 \
      || echo "install did not complete AND the previous copy could not be restored: $backup" >&2
  fi
  rm -rf "$work"
}
trap cleanup EXIT

# A running app would be replaced under its own feet, and the replacement would not be the
# process in memory — the update would silently not take effect until the next launch.
if pgrep -f "DropQTT.app/Contents/MacOS/dropqtt$" >/dev/null 2>&1; then
  echo "DropQTT is running. Quit it first (Cmd-Q), then re-run this." >&2
  exit 1
fi

# When a fetch of github.com fails, the most common cause on the networks this project is used
# on is not GitHub: Clash-family proxy clients answer DNS for these hosts out of a fake-ip pool,
# and their rule engine then produces the 403 that looks like a dead download link. Naming the
# cause is the difference between "your install command is broken" and "my client blocks it".
diagnose_fetch_failure() {
  python3 - "${1:-github.com}" <<'PY'
import ipaddress, socket, sys
host = sys.argv[1]
try:
    ips = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, 0, socket.SOCK_STREAM)})
except Exception as error:
    print(f"  {host} does not resolve: {error}")
    raise SystemExit
print(f"  {host} resolves to: {', '.join(ips)}")
fake = [i for i in ips if ":" not in i and ipaddress.ip_address(i) in ipaddress.ip_network("198.18.0.0/15")]
if fake:
    print("  198.18.0.0/15 is the fake-ip range a Clash-family client hands out, so this")
    print("  machine's route to GitHub runs through that client — a 403 here is its answer,")
    print("  not GitHub's. It is often intermittent rather than a fixed rule: retry, or try")
    print("  this same command with --noproxy '*' (both transports have worked on one such")
    print("  machine, and neither worked every time).")
else:
    print("  If the fetch still fails, the block is somewhere between here and GitHub:")
    print("  try a browser download of the .app.tar.gz plus `--from-file`, or another network.")
PY
}

if [ -z "$tarball" ]; then
  if [ -z "$tag" ]; then
    # Plain curl against the public API: requiring `gh` or a token would make this unusable on
    # a stranger's Mac, which is exactly the audience this script exists for.
    tag=$(curl -fsSL --retry 4 --retry-all-errors --max-time 60 \
        "https://api.github.com/repos/$REPO/releases/latest" \
      | sed -n 's/.*"tag_name":[[:space:]]*"\(v[0-9][0-9.]*\)".*/\1/p' | head -1)
    [ -n "$tag" ] || { echo "could not read the latest release tag from $REPO" >&2; diagnose_fetch_failure api.github.com; exit 1; }
  fi
  url="https://github.com/$REPO/releases/download/$tag/$asset"
  echo "downloading $url"
  # --continue-at keeps a truncated 13 MB download from starting over; the connection to release
  # assets on this network does get cut mid-stream.
  if ! curl -fL --retry 6 --retry-all-errors --continue-at - --max-time 900 -o "$work/$asset" "$url"; then
    echo "download failed: $url" >&2
    diagnose_fetch_failure github.com
    exit 1
  fi
  tarball="$work/$asset"
fi

[ -f "$tarball" ] || { echo "no such file: $tarball" >&2; exit 1; }
tar -xzf "$tarball" -C "$work"
app="$work/DropQTT.app"
[ -d "$app" ] || { echo "the archive did not contain DropQTT.app: $tarball" >&2; exit 1; }

# The gate: refuse to install anything we cannot tie to the certificate.
codesign --verify --strict --verbose=2 "$app" 2>/dev/null || {
  echo "refusing to install: the bundle does not pass codesign --verify --strict" >&2
  exit 1
}
# `# ` prefix is not hypothetical: codesign emits it for signatures with no internal
# requirements, so anchoring on line-start would silently drop the very line we are gating on.
designated=$(codesign -d --verbose=4 -r- "$app" 2>&1 | sed -n 's/.*designated => //p' | head -1)
if ! printf '%s' "$designated" | grep -qF "certificate leaf = H\"$EXPECTED_LEAF\""; then
  echo "refusing to install: designated requirement is not our certificate" >&2
  echo "  got:      designated => $designated" >&2
  echo "  expected: certificate leaf = H\"$EXPECTED_LEAF\"" >&2
  echo "  an ad-hoc (cdhash) requirement is the thing that makes the keychain ask again after" >&2
  echo "  every update, so installing it would undo the reason this script verifies at all." >&2
  exit 1
fi
printf 'signature verified: designated => %s\n' "$designated"

# tar does not carry the quarantine bit, but say so out loud instead of assuming it: if this
# ever stops being true, the symptom is "won't open", and the check is one line away.
if xattr "$app" 2>/dev/null | grep -q 'com.apple.quarantine'; then
  echo "warning: the extracted bundle carries com.apple.quarantine; Gatekeeper will block it" >&2
fi

target="$dest/DropQTT.app"
if [ -e "$target" ]; then
  backup="$work/DropQTT.app.previous"
  mv "$target" "$backup"
  echo "moving the previous copy aside; if this run fails it goes back where it was"
fi
mv "$app" "$target"
if [ -n "$backup" ]; then
  rm -rf "$backup"
  backup=""
fi

echo "installed: $target"
echo
echo "Two things to expect, both by design:"
echo "  1. It opens without a Gatekeeper dialog, because nothing set the quarantine bit."
echo "  2. The first broker connection asks for the keychain password ONE more time - the"
echo "     bundle's designated requirement changed, so the old grant no longer matches. Click"
echo "     Always Allow and it stays allowed across future updates, which is the whole point."
