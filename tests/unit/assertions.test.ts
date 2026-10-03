import { describe, expect, it } from 'vitest';
import { AssertionRule } from '../../src/types';
import { Translations } from '../../src/i18n';
import {
  assertionOutcomeChip,
  assertionOutcomeGlyph,
  assertionRuleText,
  assertionVerdictTitle,
} from '../../src/utils/assertions';

const t = {
  assertionsPassed: 'Passed',
  assertionsViolated: 'Violated',
  assertionsUnevaluable: 'Unreadable',
  assertionsRulesAgree: '({n} rules claimed this message)',
} as unknown as Translations;

const rule = (over: Partial<AssertionRule>): AssertionRule => ({
  id: 'as_1',
  filter: 'sensors/#',
  field: { json: '$.tempC' },
  op: 'lt',
  expected: '80',
  enabled: true,
  label: '',
  text: '',
  ...over,
});

describe('assertionRuleText', () => {
  it('shows the line as typed', () => {
    expect(assertionRuleText(rule({ text: '$.tempC  <  80' }))).toBe('$.tempC  <  80');
  });

  it('rebuilds a hand-written rule instead of showing a blank', () => {
    expect(assertionRuleText(rule({}))).toBe('$.tempC lt 80');
    expect(assertionRuleText(rule({ field: 'qos', op: 'ge', expected: '1' }))).toBe('qos ge 1');
    // Presence operators have no right side to print.
    expect(assertionRuleText(rule({ field: 'payload', op: 'present' }))).toBe('payload present');
  });
});

describe('assertionVerdictTitle', () => {
  it('names the outcome in words, because colour alone is not an answer', () => {
    expect(assertionVerdictTitle(t, '$.tempC < 80', '', 1, 'violated')).toBe('Violated · $.tempC < 80');
    expect(assertionVerdictTitle(t, '$.x', '', 1, 'unevaluable')).toContain('Unreadable');
  });

  it('quotes the rule label when there is one', () => {
    expect(assertionVerdictTitle(t, '$.tempC < 80', 'gateway heat', 1, 'passed')).toContain('gateway heat');
  });

  it('says how many rules claimed the row, since the badge quotes only one', () => {
    const title = assertionVerdictTitle(t, '$.tempC < 80', '', 3, 'violated');
    expect(title).toContain('(3 rules claimed this message)');
    // An unfilled placeholder would be the bug this pins down.
    expect(title).not.toContain('{n}');
  });
});

describe('outcome styling', () => {
  it('keeps unreadable apart from both a pass and a failure', () => {
    expect(assertionOutcomeChip('violated')).toBe('chip-bad');
    expect(assertionOutcomeChip('unevaluable')).toBe('chip-warn');
    expect(assertionOutcomeChip('passed')).toBe('chip-ok');
    expect(assertionOutcomeGlyph('unevaluable')).toBe('?');
    expect(assertionOutcomeGlyph('violated')).toBe('✗');
    expect(assertionOutcomeGlyph('passed')).toBe('✓');
  });
});
