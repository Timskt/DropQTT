#!/usr/bin/env python3
r"""Audit a *published* release: does every platform the updater promises actually exist?

v0.11.2 went out with three of four targets. One release leg died in its test gate after the
others had already published, and because `releaseDraft: false` each leg publishes as it
finishes, the release became public and *stayed* public with no Apple Silicon build at all --
while `latest.json` still listed the other platforms. A user on an M-series Mac sees a
finished release and no update, and nothing in CI says so: the workflow's own conclusion was
the only signal, and it was green for three legs.

So this checks the artefacts, not the job status:
  1. the release exists and `latest.json` is among its assets
  2. every updater platform the app can ask for is present, and points at an asset that
     actually exists (a dangling URL means "update available", then a 404)
  3. every artefact the updater downloads is signed -- no `.sig`, and the client refuses it
  4. `latest.json` carries the version this tag claims
  5. no asset is empty

A check this tool cannot perform is a failure, never a skip: the whole incident was "a green
pipeline that had not actually looked at the artefacts".

Usage: python3 scripts/check-release-shipped.py v0.11.2
"""
import json
import shutil
import subprocess
import sys

# What each installed app asks `latest.json` for, per platform. Keyed exactly as Tauri's
# updater names them; a missing key here is a platform shipping without an auto-update path.
UPDATER_PLATFORMS = {
    'darwin-aarch64': 'Apple Silicon macOS',
    'darwin-x86_64': 'Intel macOS',
    'linux-x86_64': 'x86_64 Linux',
    'windows-x86_64': 'x86_64 Windows',
}


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def need(problems, cmd, what):
    """Run something external; if it cannot run, that is the finding."""
    exe = cmd[0]
    if shutil.which(exe) is None:
        problems.append(f"{what} NOT checked: {exe!r} is not installed")
        return None
    code, out, err = run(cmd)
    if code != 0:
        problems.append(f"{what} NOT checked: `{' '.join(cmd)}` exited {code}: {err.strip()[:200]}")
        return None
    return out


def main(argv):
    if not argv:
        print(__doc__.strip().splitlines()[-1])
        return 2
    tag = argv[0]
    problems = []

    raw = need(problems, ['gh', 'release', 'view', tag, '--json', 'assets,tagName'], f'release {tag}')
    if raw is None:
        for p in problems:
            print(p)
        print("release-shipped: NO")
        return 1
    try:
        rel = json.loads(raw)
    except Exception as exc:
        print(f"release {tag}: `gh` output is not JSON -> {exc}\nrelease-shipped: NO")
        return 1

    assets = rel.get('assets') or []
    by_name = {a['name']: a for a in assets}
    if not by_name:
        problems.append(f"{tag}: release exists but has zero assets -- nothing was published")

    for a in assets:
        if a.get('state') != 'uploaded':
            problems.append(f"{a['name']}: asset state is {a.get('state')!r}, not 'uploaded'")
        if not a.get('size'):
            problems.append(f"{a['name']}: asset size is 0")

    if rel.get('tagName') != tag:
        problems.append(f"asked for {tag}, got {rel.get('tagName')!r}")

    manifest = by_name.get('latest.json')
    if manifest is None:
        problems.append(f"{tag}: no latest.json -- the updater has nothing to serve for this release")
        for p in problems:
            print(p)
        print("release-shipped: NO")
        return 1

    body = need(problems, ['curl', '-sfL', manifest['url']], 'latest.json download')
    if body is None:
        for p in problems:
            print(p)
        print("release-shipped: NO")
        return 1
    try:
        upd = json.loads(body)
    except Exception as exc:
        print(f"latest.json is not JSON -> {exc}\nrelease-shipped: NO")
        return 1

    platforms = upd.get('platforms') or {}
    for key, label in UPDATER_PLATFORMS.items():
        entry = platforms.get(key)
        if entry is None:
            problems.append(
                f"latest.json has no {key!r}: {label} users get no auto-update for {tag} "
                f"(present: {sorted(platforms)})"
            )
            continue
        url = entry.get('url') or ''
        name = url.rsplit('/', 1)[-1]
        if name not in by_name:
            problems.append(f"{key}: latest.json points at {name!r} which is not an asset -- the update advertises, then 404s")
            continue
        if not by_name[name].get('digest'):
            problems.append(f"{key}: asset {name!r} carries no digest in latest.json")
        sig = f'{name}.sig'
        if sig not in by_name:
            problems.append(f"{key}: {name!r} has no {sig!r} -- the client cannot verify the update and will refuse it")

    claimed = tag[1:] if tag.startswith('v') else tag
    if upd.get('version') != claimed:
        problems.append(f"latest.json says version {upd.get('version')!r}, tag says {claimed!r}")

    # Both installers too: the updater path is not how a first-time user installs.
    for needle, label in (('_aarch64.dmg', 'Apple Silicon installer image'),
                          ('_x64.dmg', 'Intel installer image')):
        if not any(n.endswith(needle) for n in by_name):
            problems.append(f"no *{needle} asset: no {label} for a fresh install of {tag}")

    checked = len(by_name)
    if problems:
        for p in problems:
            print(p)
        print(f"release-shipped: NO ({checked} assets inspected)")
        return 1
    print(f"release-shipped: YES -- {checked} assets, {len(platforms)} updater platforms, "
          f"every advertised file present and signed")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
