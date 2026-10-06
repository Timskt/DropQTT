"""Syntax-check every `run:` block in the CI workflows.

GitHub Actions hands each block to bash, and a heredoc whose indentation survived the
YAML block-scalar dedent wrong is a failure you only discover in the browser. This
catches it locally. Windows paths are rewritten to the form Git Bash understands,
because handing it C:/... fails with an empty stderr and looks like a broken script.
"""
import io
import os
import re
import subprocess
import sys

import yaml

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
        )
        if os.path.exists(p)
    ),
    'bash',
)


def posix(path):
    path = path.replace(BS, '/')
    return re.sub(r'^([A-Za-z]):', lambda m: '/' + m.group(1).lower(), path)


def check(workflow):
    doc = yaml.safe_load(io.open(workflow, encoding='utf-8'))
    bad = total = 0
    for job, spec in doc['jobs'].items():
        for index, step in enumerate(spec.get('steps', [])):
            script = step.get('run')
            if not script:
                continue
            total += 1
            # A relative path, because Python's "/tmp" is C:\tmp on Windows while Git
            # Bash's "/tmp" is the user Temp directory: hand it an absolute /tmp path
            # and bash opens a file that is not the one that was written, then reports
            # nothing at all. That mistake showed up as "every block is broken".
            name = f'.ci-syntax-{os.getpid()}-{job}-{index}.sh'
            io.open(name, 'w', encoding='utf-8', newline='\n').write(script)
            proc = subprocess.run([BASH, '-n', name], capture_output=True)
            detail = proc.stderr.decode('utf-8', 'replace').strip()
            os.unlink(name)
            if proc.returncode != 0:
                bad += 1
                print(f"FAIL {job} #{index} {step.get('name')}: {detail[:300]}")
    print(f"{workflow}: {total} run blocks, {bad} syntax failures")
    return bad


if __name__ == '__main__':
    files = sys.argv[1:] or ['.github/workflows/ci.yml', '.github/workflows/release.yml']
    failures = sum(check(f) for f in files)
    sys.exit(1 if failures else 0)
