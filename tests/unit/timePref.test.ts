import { afterEach, describe, expect, it } from 'vitest';
import { fmtClock, fmtDateTime, zoneLabel, setTimePref } from '../../src/utils/timePref';

/**
 * The timestamp preference is module state, so each test restores 'local' when
 * it is done: a leaked 'utc' would flip every later test's expectations in this
 * file, and the failure would point at the wrong test.
 */
describe('timePref formatting', () => {
  afterEach(() => {
    setTimePref('local');
  });

  it('renders a pinned instant in UTC when the preference is UTC', () => {
    const ms = Date.UTC(2026, 9, 9, 12, 34, 56);
    setTimePref('utc');
    expect(fmtClock(ms)).toBe('12:34:56');
    expect(fmtDateTime(ms)).toBe('2026-10-09 12:34:56');
  });

  it('renders a full clock and datetime in local mode', () => {
    const ms = Date.UTC(2026, 9, 9, 12, 34, 56);
    setTimePref('local');
    expect(fmtClock(ms)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(fmtDateTime(ms)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('labels the zone for each preference', () => {
    setTimePref('local');
    // The offset is the machine's own, so the assertion is about the label
    // carrying a zone at all, not about which zone.
    expect(zoneLabel()).toMatch(/^local \(UTC[+-]\d{2}:\d{2}\)$/);
    setTimePref('utc');
    expect(zoneLabel()).toBe('UTC');
  });
});
