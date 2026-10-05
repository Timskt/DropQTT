import { AssertionField, AssertionRule, AssertOutcome } from '../types';
import { Translations, fill } from '../i18n';

/** Field names as the Rust enum spells them, for the fallback rendering below. */
const fieldText = (field: AssertionField): string =>
  typeof field === 'string' ? field : field.json;

/**
 * The predicate as written. A rule from a hand-edited save carries no `text`, so it
 * is rebuilt from its parsed parts — the list must never show a blank where the
 * judgement should be.
 */
export const assertionRuleText = (rule: AssertionRule): string => {
  if (rule.text) return rule.text;
  const field = fieldText(rule.field);
  return rule.op === 'present' || rule.op === 'absent'
    ? `${field} ${rule.op}`
    : `${field} ${rule.op} ${rule.expected}`;
};

/** The row glyph: the outcome word is always in the tooltip, so this is decoration
 * on top of a readable label, not the only signal. */
export const assertionOutcomeGlyph = (outcome: AssertOutcome): string =>
  outcome === 'violated' ? '✗' : outcome === 'unevaluable' ? '?' : '✓';

export const assertionOutcomeChip = (outcome: AssertOutcome): string =>
  outcome === 'violated' ? 'chip-bad' : outcome === 'unevaluable' ? 'chip-warn' : 'chip-ok';

/**
 * Colour alone cannot carry meaning, so the badge spells the outcome out and its
 * tooltip names the rule that decided it — plus how many other rules claimed the
 * same row, because a badge that summarises three rules quotes only one of them.
 */
export const assertionVerdictTitle = (
  t: Translations,
  expr: string,
  label: string,
  rules: number,
  outcome: AssertOutcome,
): string => {
  const word =
    outcome === 'violated' ? t.assertionsViolated
      : outcome === 'unevaluable' ? t.assertionsUnevaluable
        : t.assertionsPassed;
  const who = label ? `${word} · ${label} · ${expr}` : `${word} · ${expr}`;
  return rules > 1 ? `${who} ${fill(t.assertionsRulesAgree, { n: String(rules) })}` : who;
};
