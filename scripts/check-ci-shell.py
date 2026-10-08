r"""Syntax-check every `run:` block in the CI workflows, with no third-party imports.

GitHub Actions hands each block to bash, and a heredoc whose indentation survived the
YAML block-scalar dedent wrong is a failure you only discover in the browser. This catches
it locally. Windows paths are rewritten to the form Git Bash understands, because handing
it C:/... fails with an empty stderr and looks like a broken script.

Why this file no longer imports PyYAML: it claimed to be a local check while dying on
`import yaml` on any machine without the module -- and a check that cannot run reports
nothing, which reads exactly like a check that passed. The extractor below is stdlib-only.

The extractor is the risky part (hand-rolled YAML), so it is not trusted: when PyYAML
happens to be importable, both results are compared and any disagreement is an error.
Zero extracted blocks in a workflow that has steps is also an error, so the tool cannot
quietly become a no-op.
"""
import io
import os
import re
import subprocess
import sys

BS = chr(92)

# Python's PATH on this machine resolves `bash` to the WSL stub in
# C:\Windows\System32\bash.exe, which exits 1 and prints nothing when no Linux distro
# is installed. Every block then looks broken, including a one-line `cargo test`.
# The real shell is named here so the checker cannot quietly become the bug.
BASH = next(
    (
        p for p in (
            r'C:\Program Files\Git\bin\bash.exe',
            r'C:\Program Files\Git\usr\bin\bash.exe',
            '/usr/bin/bash',
            '/bin/bash',
        )
        if os.path.exists(p)
    ),
    'bash',
)

BLOCK_START = re.compile(r'^(\s*)run:(\s*)([|>][+-]?\d*)?\s*(.*)$')


def posix(path):
    path = path.replace(BS, '/')
    return re.sub(r'^([A-Za-z]):', lambda m: '/' + m.group(1).lower(), path)


def extract_run_blocks(text):
    """The `run:` scripts in document order, dedented the way YAML block scalars are."""
    lines = text.split('\n')
    blocks = []
    i = 0
    while i < len(lines):
        m = BLOCK_START.match(lines[i])
        if not m:
            i += 1
            continue
        key_indent, style, inline = len(m.group(1)), m.group(3) or '', m.group(4).rstrip()
        if style:
            # Block scalar: content is everything more indented than the `run:` key,
            # dedented by the first content line's own indentation.
            body, base = [], None
            j = i + 1
            while j < len(lines):
                line = lines[j]
                if line.strip() == '':
                    body.append(line)
                    j += 1
                    continue
                indent = len(line) - len(line.lstrip())
                if indent <= key_indent:
                    break
                if base is None:
                    base = indent
                body.append(line[base:] if len(line) >= base else line.lstrip())
                j += 1
            while body and body[-1].strip() == '':
                body.pop()
            blocks.append('\n'.join(body))
            i = j
        elif inline and not inline.startswith('|') and not inline.startswith('>'):
            # Plain or quoted single-line scalar: `run: bash scripts/x.sh a b`.
            val = inline
            if val[0] in ('"', "'") and val[-1] == val[0]:
                val = val[1:-1]
            blocks.append(val)
            i += 1
        else:
            i += 1
    return blocks


def cross_check_with_pyyaml(text, blocks, workflow):
    """If PyYAML is available, prove the hand extractor agrees with it. Returns errors."""
    try:
        import yaml
    except ImportError:
        return []
    doc = yaml.safe_load(io.open(workflow, encoding='utf-8'))
    authoritative = []
    for _job, spec in (doc.get('jobs') or {}).items():
        for step in spec.get('steps') or []:
            script = step.get('run')
            if isinstance(script, str) and script.strip():
                authoritative.append(script.rstrip('\n'))
    mine = [b.rstrip('\n') for b in blocks]
    if mine == authoritative:
        return []
    errs = [f"{workflow}: extractor found {len(mine)} blocks, PyYAML found {len(authoritative)}"]
    for n, (a, b) in enumerate(zip(mine, authoritative)):
        if a != b:
            errs.append(f"  block #{n} differs\n    got: {a[:120]!r}\n    yaml: {b[:120]!r}")
    return errs


def count_steps(text):
    """Steps of any kind, so "no run blocks at all" can be told apart from an empty file."""
    return sum(1 for l in text.split('\n') if re.match(r'^\s*-\s+(uses|run):', l))


def count_run_keys(text):
    """Every `run:` key in the file, counted textually.

    This is the invariant that makes the extractor self-certifying without PyYAML: one
    extracted block per `run:` key, or the extractor missed something. Without it the tool
    silently reported "3 run blocks, 0 syntax failures" for a workflow with 17 -- which
    reads exactly like a pass. A mutation that dropped the single-line `run:` branch is how
    that was found.
    """
    return sum(1 for l in text.split('\n') if re.match(r'^\s*run:', l))


def check(workflow):
    text = io.open(workflow, encoding='utf-8').read()
    blocks = extract_run_blocks(text)
    expected = count_run_keys(text)
    if len(blocks) != expected:
        print(
            f"{workflow}: FAIL -- {expected} `run:` keys in the file but {len(blocks)} blocks "
            "extracted; the checker cannot vouch for what it did not read"
        )
        return 1
    problems = cross_check_with_pyyaml(text, blocks, workflow)
    if problems:
        for p in problems:
            print(p)
        print(f"{workflow}: the extractor itself is wrong -- fix it, do not trust its verdict")
        return len(problems)
    if not blocks:
        steps = count_steps(text)
        print(f"{workflow}: FAIL -- 0 run blocks extracted but the file has {steps} steps")
        return 1

    bad = 0
    for index, script in enumerate(blocks):
        # A relative path, because Python's "/tmp" is C:\tmp on Windows while Git
        # Bash's "/tmp" is the user Temp directory: hand it an absolute /tmp path
        # and bash opens a file that is not the one that was written, then reports
        # nothing at all. That mistake showed up as "every block is broken".
        name = f'.ci-syntax-{os.getpid()}-{index}.sh'
        io.open(name, 'w', encoding='utf-8', newline='\n').write(script)
        try:
            proc = subprocess.run([BASH, '-n', name], capture_output=True)
            detail = proc.stderr.decode('utf-8', 'replace').strip()
        finally:
            os.unlink(name)
        if proc.returncode != 0:
            bad += 1
            first = script.split('\n')[0][:80]
            print(f"FAIL {workflow} block #{index} (`{first}`): {detail[:300]}")
    print(f"{workflow}: {len(blocks)} run blocks, {bad} syntax failures")
    return bad


if __name__ == '__main__':
    files = sys.argv[1:] or [
        os.path.join('.github', 'workflows', n) for n in ('ci.yml', 'release.yml')
    ]
    missing = [f for f in files if not os.path.exists(f)]
    if missing:
        # Missing input is a failure, not a zero: a glob that stopped matching would
        # otherwise report success while checking nothing.
        print(f"FAIL: workflow file(s) not found: {', '.join(missing)}")
        sys.exit(1)
    sys.exit(1 if sum(check(f) for f in files) else 0)
