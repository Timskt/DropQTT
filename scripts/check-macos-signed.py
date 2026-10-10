#!/usr/bin/env python3
"""Fail a release whose macOS artifact is not signed the way a release must be.

This exists because of a user-visible bug that no test could see: the shipped `.app` is
built with an ad-hoc / linker signature, and macOS keys the login keychain's per-item ACL
to the signature's *designated requirement*. For an ad-hoc binary that requirement is the
CDHash, which changes on every build — so "Always Allow" on the broker password dies with
the next release, and the prompt comes back. An unsigned build is otherwise silent: the
workflow goes green, the assets upload, and the only symptom is a dialog on the user's
screen.

Usage:
    scripts/check-macos-signed.py <path-to-.app> [--require-developer-id]
    scripts/check-macos-signed.py --self-test

`--require-developer-id` is what CI passes: a plain non-ad-hoc signature is not enough,
because "Apple Development" and self-signed identities rotate the same way. The self-test
proves the checker can actually say no — a check that cannot fail is a check that passes.
"""
from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass

@dataclass
class Signature:
    """What `codesign -dvvv` said about a bundle, reduced to the facts we gate on."""

    identifier: str
    flags: str
    team: str
    signature_kind: str
    authorities: tuple[str, ...]

    @property
    def ad_hoc(self) -> bool:
        # Three independent ways codesign says it, because the fields appear together on
        # some builds and not others: the CodeDirectory flag word, the standalone
        # `Signature=` line, and the absence of any authority chain with no team.
        blob = f"{self.flags} {self.signature_kind}".lower()
        return "adhoc" in blob or (not self.authorities and self.team in ("", "not set"))

    @property
    def developer_id(self) -> bool:
        return any(a.startswith("Developer ID Application:") for a in self.authorities)


def describe(sig: Signature) -> str:
    chain = " -> ".join(sig.authorities) if sig.authorities else "(no authority chain)"
    return (
        f"identifier={sig.identifier or '(none)'} flags={sig.flags or '(none)'} "
        f"Signature={sig.signature_kind or '(none)'} TeamIdentifier={sig.team or '(none)'} "
        f"authorities={chain}"
    )


#: A real `codesign -dvvv` report from an ad-hoc, linker-signed Tauri bundle. The parser is
#: pinned against this text rather than against hand-built values: the first version of this
#: script had two wrong regexes and reported a genuinely ad-hoc app as merely "not Developer
#: ID", which the hand-built self-test could not see because it never parsed anything.
ADHOC_FIXTURE = """\
Executable=/Applications/DropQTT.app/Contents/MacOS/dropqtt
Identifier=dropqtt-f3b7d9a453c4a740
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=236472 flags=0x20002(adhoc,linker-signed) hashes=7386+0 location=embedded
Hash type=sha256 size=32
CDHash=bf8cbd01674f0b19eae99712a44e6029d5134b80
Signature=adhoc
Info.plist=not bound
TeamIdentifier=not set
Sealed Resources=none
Internal requirements=none
"""

#: The same report for a bundle signed by a real Developer ID certificate.
DEVELOPER_ID_FIXTURE = """\
Identifier=com.dropqtt.desktop
CodeDirectory v=20400 size=236472 flags=0x10000(runtime) hashes=7386+0 location=embedded
Signature size=9031
Authority=Developer ID Application: Example Owner (TEAM123456)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=TEAM123456
"""


def parse(text: str) -> Signature:
    """Read the fields out of a codesign report."""
    authorities = tuple(re.findall(r"^Authority=(.+)$", text, re.M))
    flags = (re.search(r"flags=(\S*\([^)]*\))", text) or _NoMatch()).group(1) or ""
    team = (re.search(r"^TeamIdentifier=(.*)$", text, re.M) or _NoMatch()).group(1) or ""
    kind = (re.search(r"^Signature=(\S+)", text, re.M) or _NoMatch()).group(1) or ""
    ident = (re.search(r"^Identifier=(\S+)", text, re.M) or _NoMatch()).group(1) or ""
    if not authorities and "code object is not signed at all" in text:
        kind = kind or "unsigned"
    return Signature(
        identifier=ident.strip(), flags=flags.strip(), team=team.strip(),
        signature_kind=kind.strip(), authorities=authorities,
    )


def inspect(path: str) -> Signature:
    """Read the signature of an on-disk bundle.

    codesign writes its report to stderr and exits non-zero for an unsigned bundle, which is
    a verdict rather than a tool failure — so the exit code is not consulted here, and a
    report that parses to nothing is refused by `verdict` instead of passing quietly.
    """
    proc = subprocess.run(
        ["codesign", "-dvvv", "--verbose=4", path],
        capture_output=True, text=True,
    )
    return parse(proc.stderr + proc.stdout)


class _NoMatch:
    """So a missing line reads as empty rather than crashing the report."""

    group = staticmethod(lambda _n: "")


def verdict(sig: Signature, require_developer_id: bool) -> list[str]:
    """Every reason this artifact must not be published, or [] when it may."""
    problems: list[str] = []
    if "unsigned" in f"{sig.flags} {sig.signature_kind}".lower():
        problems.append("the bundle is not signed at all")
    elif "adhoc" in f"{sig.flags} {sig.signature_kind}".lower():
        problems.append(
            "ad-hoc / linker signature: the keychain ACL is keyed on the CDHash, so it "
            "changes on every build and 'Always Allow' cannot survive an update"
        )
    elif sig.ad_hoc:
        problems.append("no signature authority chain and no team — treated as ad-hoc")
    if require_developer_id and not sig.developer_id:
        problems.append(
            "not signed by a 'Developer ID Application:' certificate"
            + (f" (chain: {' -> '.join(sig.authorities)})" if sig.authorities else " (no chain at all)")
        )
    return problems


def _self_test() -> int:
    """Prove the checker distinguishes the shapes it must never confuse — by parsing the
    text `codesign` really emits, not by trusting hand-built values. The first version of
    this script had two wrong regexes and called a genuinely ad-hoc app merely "not
    Developer ID"; a self-test that never parsed anything could not see that."""
    ad_hoc = parse(ADHOC_FIXTURE)
    signed = parse(DEVELOPER_ID_FIXTURE)
    apple_dev = parse(
        DEVELOPER_ID_FIXTURE.replace("Developer ID Application:", "Apple Development:")
    )
    unsigned = parse("Identifier=whatever\ncode object is not signed at all\n")
    cases = [
        ("the ad-hoc fixture parses as ad-hoc", ad_hoc.ad_hoc, True),
        ("the ad-hoc fixture's flags word was parsed", "adhoc" in ad_hoc.flags.lower(), True),
        ("TeamIdentifier with a space is parsed whole", ad_hoc.team, "not set"),
        ("ad-hoc bundle must be refused", bool(verdict(ad_hoc, False)), True),
        ("Developer ID bundle must be accepted", verdict(signed, True), []),
        ("Developer ID chain parsed in order", len(signed.authorities), 3),
        ("Apple Development must fail the Developer ID gate", bool(verdict(apple_dev, True)), True),
        ("Apple Development passes without that gate", verdict(apple_dev, False), []),
        ("an unsigned bundle must not pass", bool(verdict(unsigned, False)), True),
        ("no report at all must not pass", bool(verdict(parse(""), False)), True),
    ]
    failed = [name for name, got, want in cases if got != want]
    for name, got, want in cases:
        print(f"  {'ok  ' if got == want else 'FAIL'} {name}" + ("" if got == want else f"  (got {got!r}, want {want!r})"))
    if failed:
        print(f"self-test: NO ({len(failed)} of {len(cases)} wrong)")
        return 1
    print(f"self-test: YES ({len(cases)} cases, including the ones that must fail)")
    return 0


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    if "--self-test" in argv:
        return _self_test()
    if not args:
        print("usage: check-macos-signed.py <path-to-.app> [--require-developer-id]", file=sys.stderr)
        return 2
    require_id = "--require-developer-id" in argv
    path = args[0]
    sig = inspect(path)
    print(f"macos-signature: {describe(sig)}")
    problems = verdict(sig, require_id)
    if problems:
        for p in problems:
            print(f"  PROBLEM {p}", file=sys.stderr)
        print(f"macos-signed: NO ({path})", file=sys.stderr)
        return 1
    print(f"macos-signed: YES ({path})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
