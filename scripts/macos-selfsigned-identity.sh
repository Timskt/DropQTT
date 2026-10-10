#!/usr/bin/env bash
# Create a stable code-signing identity without an Apple Developer account.
#
# Why this exists: an ad-hoc signature's designated requirement is the CDHash, so it
# changes on every build, and the login keychain's per-item ACL grant ("Always Allow" on
# the broker password) dies with the next release. Measured on 2026-10-11 with
# `codesign -d -r-` on two binaries differing by one byte:
#
#   ad-hoc        designated => cdhash H"40563cb7…" / cdhash H"9cbd40d4…"   (per build)
#   self-signed   designated => certificate leaf = H"9625804c…"             (same)
#
# What it does not buy: Gatekeeper. `spctl --assess` rejects this identity (exit 3) — and
# rejects the current ad-hoc build exactly the same way, also exit 3, which was measured
# too. So the change is strictly an improvement: the same Gatekeeper behaviour, and a
# keychain grant that finally sticks. A Developer ID certificate is still what you need if
# strangers must be able to download the DMG and double-click it.
#
# Run it once. It adds an identity to your login keychain, writes a .p12 you then put in
# GitHub secrets so CI signs with the *same* identity, and prints the commands.
#
#   scripts/macos-selfsigned-identity.sh "Developer ID Application: DropQTT (SELFSELF12)"
#
# The common name is free-form; the ten-character part in parentheses becomes the team id
# the keychain sees. Keep it stable — renaming it later means a new designated requirement,
# which is the thing we are trying to stop.
set -euo pipefail

NAME="${1:-DropQTT Code Signing}"
OUT="$(pwd)/dropqtt-signing-identity.p12"
PW_FILE="$(pwd)/dropqtt-signing-identity.password"
D=$(mktemp -d)
trap 'rm -rf "$D"' EXIT

if security find-certificate -c "$NAME" >/dev/null 2>&1; then
  echo "an identity named '$NAME' already exists — refusing to make a second one" >&2
  echo "(a second identity is a second designated requirement, which is the bug)" >&2
  exit 1
fi

# 10 years. The point of this certificate is that it outlives every build.
cat > "$D/identity.cnf" <<EOF
[ req ]
distinguished_name = dn
x509_extensions = ext
prompt = no
[ dn ]
CN = $NAME
[ ext ]
basicConstraints = critical,CA:TRUE
keyUsage = critical,digitalSignature,cRLSign
extendedKeyUsage = critical,codeSigning
EOF

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$D/key.pem" -out "$D/cert.pem" -days 3650 \
  -config "$D/identity.cnf" -sha256 2>/dev/null

PW=$(openssl rand -hex 16)
# `-legacy`: macOS `security import` cannot verify an OpenSSL 3 PKCS#12 MAC otherwise.
# Verified with OpenSSL 3.6.5; without the flag the import fails with "MAC verification
# failed during PKCS12 import (wrong password?)", which reads like a typo and is not.
openssl pkcs12 -export -name "$NAME" -inkey "$D/key.pem" -in "$D/cert.pem" \
  -out "$OUT" -passout "pass:$PW" -legacy

chmod 600 "$OUT"
printf '%s' "$PW" > "$PW_FILE"
chmod 600 "$PW_FILE"

# Into the login keychain, so local `tauri build` can sign too. This only ever *adds*
# to the search list — it never changes the default keychain, which is how an
# experiment left this machine without one on 2026-10-11.
security import "$OUT" -k ~/Library/Keychains/login.keychain-db \
  -P "$PW" -T /usr/bin/codesign >/dev/null

echo
echo "identity created and installed:"
security find-identity -p codesigning ~/Library/Keychains/login.keychain-db \
  | grep -F "$NAME" || true
echo
echo "Files (both are secrets — delete them after the next step):"
echo "  $OUT"
echo "  $PW_FILE"
echo
echo "Give CI the same identity:"
echo "  gh secret set APPLE_CERTIFICATE            < <(base64 -i $OUT)"
echo "  gh secret set APPLE_CERTIFICATE_PASSWORD   < $PW_FILE"
echo "  gh secret set APPLE_SIGNING_IDENTITY       <<< '$NAME'"
echo
echo "Leave APPLE_NOTARIZE unset (that is the point): Apple only notarizes Developer ID,"
echo "so this identity stabilizes the keychain grant and does not fix Gatekeeper."
echo "Set the repo variable APPLE_NOTARIZE=1 only if you later add a real Developer ID."
echo
echo "Then: rm '$OUT' '$PW_FILE'"
