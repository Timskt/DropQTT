#!/usr/bin/env python3
r"""Check what only the release job would otherwise discover, from the command line.

v0.11.0 failed on all four targets at tauri-action with "Unterminated inline array at row
56": Cargo.toml held a multi-line inline table, which TOML 1.0 forbids. tauri-action parses
that file strictly, cargo does not, so every existing gate -- `cargo check`, `cargo test`,
clippy, all four CI jobs -- was green right up to the tag push. A defect that only a release
can surface is a defect that needs a local command.

Checks, all with stdlib only:
  1. `Cargo.toml` parses as strict TOML, which is what rejects the inline-table-across-lines
     shape that cost the release.
  2. `tauri.conf.json` and `package.json` parse as JSON.
  3. The four version fields agree with each other (the release workflow fails if they do
     not), and with the tag when one is passed.

If a check cannot be performed, that is a failure, never a skip: a readiness gate that
reports "ok" because it lacked the means to look is the exact thing this file exists to
prevent.
"""
import json
import os
import re
import subprocess
import sys

try:
    import tomllib
except ImportError:
    tomllib = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def rel(*parts):
    return os.path.join(ROOT, *parts)


def fail(problems, msg):
    problems.append(msg)


def check_toml(problems):
    path = rel('src-tauri', 'Cargo.toml')
    if tomllib is None:
        fail(problems, f"Cargo.toml NOT checked: this needs Python 3.11+ for tomllib (found {sys.version.split()[0]})")
        return
    with open(path, 'rb') as fh:
        try:
            data = tomllib.load(fh)
        except Exception as exc:
            # tauri-action's own wording is close to this; showing the row is what makes the
            # local failure recognisable as the one the release would hit.
            fail(problems, f"{path}: strict TOML parse failed -> {exc}")
            fail(problems, "  tauri-action reads this file with a strict parser; cargo is lenient, so CI can be green and the release still fail")
            return
    deps = data.get('dependencies') or {}
    targets = data.get('target') or {}
    if not deps:
        fail(problems, f"{path}: parsed but has no [dependencies] -- is this the right file?")
    # The per-target keyring blocks are the part tauri-action tripped over, so assert the
    # parse actually saw them rather than only that the file opened.
    if not targets:
        fail(problems, f"{path}: parsed but has no [target.*] sections, which the build expects")


def version_from_json(path, problems):
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh).get('version')
    except Exception as exc:
        fail(problems, f"{path}: unreadable as JSON -> {exc}")
        return None


def check_versions(problems, tag):
    files = {
        'package.json': version_from_json(rel('package.json'), problems),
        'tauri.conf.json': version_from_json(rel('src-tauri', 'tauri.conf.json'), problems),
    }
    cargo = rel('src-tauri', 'Cargo.toml')
    try:
        text = open(cargo, encoding='utf-8').read()
        # The package version is the first `version = ` under [package].
        m = re.search(r'^version\s*=\s*"([^"]+)"', text, re.M)
        files['Cargo.toml'] = m.group(1) if m else None
        if not m:
            fail(problems, f"{cargo}: no package version found")
    except Exception as exc:
        fail(problems, f"{cargo}: unreadable -> {exc}")

    lock = rel('src-tauri', 'Cargo.lock')
    try:
        block = re.search(r'name = "dropqtt"\nversion = "([^"]+)"', open(lock, encoding='utf-8').read())
        files['Cargo.lock'] = block.group(1) if block else None
        if not block:
            fail(problems, f"{lock}: no dropqtt entry found")
    except Exception as exc:
        fail(problems, f"{lock}: unreadable -> {exc}")

    found = ', '.join(f'{k}={v}' for k, v in files.items())
    distinct = {v for v in files.values() if v}
    if len(distinct) != 1:
        fail(problems, f"versions disagree (the release job fails here too): {found}")
        return
    version = distinct.pop()
    if tag and tag.lstrip('v') != version:
        fail(problems, f"tag {tag} does not match the application version {version}")
    print(f"versions agree at {version} across {len(files)} files; strict TOML and JSON parse OK")


def check_release_workflow_covers_this(problems):
    """The local command is only worth having if the job it mirrors still exists.

    If release.yml ever drops the version-consistency step, this script would be checking a
    contract nothing enforces, so it says so instead of passing quietly.
    """
    wf = rel('.github', 'workflows', 'release.yml')
    try:
        text = open(wf, encoding='utf-8').read()
    except Exception as exc:
        fail(problems, f"{wf}: unreadable -> {exc}")
        return
    for needle, label in (
        ('Verify tag matches application versions', 'the version-consistency step'),
        ('CARGO_VERSION', 'the cargo version read'),
    ):
        if needle not in text:
            fail(problems, f"{wf}: no longer contains {label} -- this checker is guarding a contract the job stopped enforcing")


def main(argv):
    tag = argv[0] if argv else None
    problems = []
    check_toml(problems)
    check_versions(problems, tag)
    check_release_workflow_covers_this(problems)
    if problems:
        for p in problems:
            print(p)
        print("release-ready: NO")
        return 1
    print("release-ready: YES")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
