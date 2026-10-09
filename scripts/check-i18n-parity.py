#!/usr/bin/env python3
"""Count translated keys per locale and report any drift between the four.

The old version compared four sets and called it done. That has three ways to
report "parity OK" while inspecting less than it claims, and all three are the
shape this project already fixed once in `check-ci-shell.py` (§4.84): a check
that silently extracted nothing reports the same nothing as a clean run.

What it now enforces, in addition to key-set drift:

  * a second, indentation-agnostic count of every `key: 'value'` line per file,
    which must agree with the strict parse -- so a formatter that re-indents the
    locale objects cannot quietly remove keys from the comparison
  * no duplicate definition of one key in one file (the last one wins at runtime,
    so a duplicate is a real bug the old script printed and then passed)
  * no empty-string translation, which renders as a blank in the UI
  * a missing or unreadable file is a named failure, never a traceback nobody
    reads and never a skip

Exit code 0 means every claim below was actually checked.
"""
from collections import Counter
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCALES = ["en", "zhCN", "zhTW", "ja"]
# The locale objects indent keys four spaces; the interface body indents two.
KEY = re.compile(r"^\s{4}([A-Za-z0-9_]+):\s", re.MULTILINE)
DECLARED = re.compile(r"^\s{2}([A-Za-z0-9_]+):\s", re.MULTILINE)
# The referee: any indentation, but only a line that really is a translated
# string entry (identifier, colon, quote), so nested objects and `key: string`
# declarations do not inflate it.
REFERE = re.compile(r"""^\s+([A-Za-z0-9_]+):\s*['"`]""", re.MULTILINE)
DECLARED_REFERE = re.compile(r"^\s+([A-Za-z0-9_]+):\s+string\b", re.MULTILINE)
EMPTY_VALUE = re.compile(r"""^\s{4}([A-Za-z0-9_]+):\s*('')\s*,?\s*$""", re.MULTILINE)


def read(path):
    """Return the text, or None *plus a printed failure* -- never an empty success."""
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError as exc:
        print(f"CANNOT CHECK: {os.path.relpath(path, ROOT)} is unreadable -> {exc}")
        return None


def entries(text, pattern, label, path):
    """Strict parse, cross-checked against the referee count."""
    keys = pattern.findall(text)
    referee = REFERE.findall(text) if label == "locale" else DECLARED_REFERE.findall(text)
    unseen = sorted(set(referee) - set(keys))
    if not keys:
        print(f"CANNOT CHECK: {path}: the parser found 0 {label} entries, so it can certify nothing")
        return None, None
    if unseen:
        # Indentation changed under us: the entries exist in the file but were
        # never compared. That is a broken checker, not a clean locale.
        print(
            f"CANNOT CHECK: {path}: parser saw {len(keys)}, but {len(unseen)} {label} entries "
            f"are present at an unexpected indentation: {unseen[:8]}"
        )
        return None, None
    return keys, referee


def main():
    os.chdir(ROOT)
    problems = []
    sets = {}

    for locale in LOCALES:
        path = f"src/i18n/locales/{locale}.ts"
        text = read(path)
        if text is None:
            problems.append(path)
            continue
        keys, _ = entries(text, KEY, "locale", path)
        if keys is None:
            problems.append(path)
            continue
        dupes = sorted(k for k, n in Counter(keys).items() if n > 1)
        if dupes:
            problems.append(f"{path}: {len(dupes)} key(s) defined more than once: {dupes[:8]}")
        blanks = [m.group(1) for m in EMPTY_VALUE.finditer(text)]
        if blanks:
            problems.append(f"{path}: {len(blanks)} key(s) translate to an empty string: {sorted(blanks)[:8]}")
        sets[locale] = set(keys)
        print(f"{locale}: {len(keys)} keys, {len(sets[locale])} unique")

    types_text = read("src/i18n/types.ts")
    if types_text is None:
        problems.append("src/i18n/types.ts")
        interface = set()
    else:
        interface, _ = entries(types_text, DECLARED, "interface", "src/i18n/types.ts")
        if interface is None:
            problems.append("src/i18n/types.ts")
            interface = set()
        else:
            interface = set(interface)
            print(f"types.ts: {len(interface)} declared members")

    if len(sets) != len(LOCALES):
        print(f"PARITY FAILED -- only {len(sets)}/{len(LOCALES)} locales were parsed, so no parity claim was made")
        return 1

    reference = sets["en"]
    for locale, keys in sets.items():
        missing, extra = reference - keys, keys - reference
        if missing or extra:
            problems.append(f"DRIFT {locale}: missing={sorted(missing)} extra={sorted(extra)}")

    # A key in a locale but not in the Translations type is invisible to the
    # compiler and unenforceable at the call site.
    if sets and interface:
        not_in_type = reference - interface
        absent_from_locales = interface - reference
        if not_in_type:
            problems.append(f"not declared in i18n/types.ts: {sorted(not_in_type)}")
        if absent_from_locales:
            problems.append(f"declared in types.ts but in no locale: {sorted(absent_from_locales)}")

    if problems:
        for p in problems:
            print(p)
        print(f"PARITY FAILED ({len(problems)} finding(s))")
        return 1
    print(f"parity OK -- {len(reference)} keys enforced across {len(LOCALES)} locales + types.ts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
