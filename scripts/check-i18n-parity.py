"""Count translated keys per locale and report any drift between the four."""
import re
import sys

LOCALES = ["en", "zhCN", "zhTW", "ja"]
KEY = re.compile(r"^\s{4}([A-Za-z0-9_]+):\s", re.MULTILINE)
# The interface body is two-space indented, the locale objects four.
DECLARED = re.compile(r"^\s{2}([A-Za-z0-9_]+):\s", re.MULTILINE)


def keys_of(locale: str) -> list:
    text = open(f"src/i18n/locales/{locale}.ts", encoding="utf-8").read()
    return KEY.findall(text)


sets = {locale: keys_of(locale) for locale in LOCALES}
for locale, keys in sets.items():
    print(f"{locale}: {len(keys)} keys, {len(set(keys))} unique")

reference = set(sets["en"])
drift = False
for locale, keys in sets.items():
    missing = reference - set(keys)
    extra = set(keys) - reference
    if missing or extra:
        drift = True
        print(f"DRIFT {locale}: missing={sorted(missing)} extra={sorted(extra)}")

# The declared interface is the third opinion: a key in a locale but not in the
# Translations type is invisible to the compiler and unenforceable at the call site.
interface = set(DECLARED.findall(open("src/i18n/types.ts", encoding="utf-8").read()))
not_in_type = reference - interface
if not_in_type:
    drift = True
    print(f"not declared in i18n/types.ts: {sorted(not_in_type)}")
print("parity OK" if not drift else "PARITY FAILED")
sys.exit(1 if drift else 0)
