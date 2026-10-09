import { describe, expect, it } from 'vitest';
import { ageUnit, exportStamp, formatBytes, formatUptime, utcOffsetLabel } from '../../src/utils/format';

describe('formatBytes', () => {
  it('keeps whole bytes integral', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(14)).toBe('14 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('switches unit at each 1024 boundary', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
  });

  it('does not stall at KB for megabyte-sized files', () => {
    // The publisher used to render 1.5 MB as "1536.00 KB" because its local copy
    // had no MB branch at all.
    expect(formatBytes(30 * 1024 * 1024)).toBe('30.00 MB');
    expect(formatBytes(30 * 1024 * 1024)).not.toContain('KB');
  });

  it('survives nonsense input instead of printing NaN', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });
});

describe('formatUptime', () => {
  it('reads as the two coarsest units', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(-3)).toBe('0s');
    expect(formatUptime(59)).toBe('59s');
    expect(formatUptime(60)).toBe('1m 00s');
    expect(formatUptime(3_600)).toBe('1h 00m');
    expect(formatUptime(86_400)).toBe('1d 00h');
  });

  it('pads the trailing unit so a column of values does not jitter', () => {
    expect(formatUptime(65)).toBe('1m 05s');
    expect(formatUptime(3_660)).toBe('1h 01m');
    expect(formatUptime(90_000)).toBe('1d 01h');
  });

  it('never renders a fraction of a second or a negative duration', () => {
    expect(formatUptime(0.4)).toBe('0s');
    expect(formatUptime(Number.NaN)).toBe('0s');
    expect(formatUptime(Number.POSITIVE_INFINITY)).toBe('0s');
  });
});

describe('ageUnit', () => {
  it('changes unit at the boundary, not before it', () => {
    expect(ageUnit(0)).toEqual({ unit: 'now', n: 0 });
    expect(ageUnit(4_999)).toEqual({ unit: 'now', n: 0 });
    expect(ageUnit(5_000)).toEqual({ unit: 'seconds', n: 5 });
    expect(ageUnit(59_999)).toEqual({ unit: 'seconds', n: 59 });
    expect(ageUnit(60_000)).toEqual({ unit: 'minutes', n: 1 });
    expect(ageUnit(3_599_999)).toEqual({ unit: 'minutes', n: 59 });
    expect(ageUnit(3_600_000)).toEqual({ unit: 'hours', n: 1 });
    expect(ageUnit(86_399_999)).toEqual({ unit: 'hours', n: 23 });
    expect(ageUnit(86_400_000)).toEqual({ unit: 'days', n: 1 });
    expect(ageUnit(31 * 86_400_000)).toEqual({ unit: 'days', n: 31 });
  });

  it('never reads a clock ahead of ours as a countdown', () => {
    // A device with a fast clock stamps slightly in the future; "-3s ago" is nonsense.
    expect(ageUnit(-3_000)).toEqual({ unit: 'now', n: 0 });
    expect(ageUnit(-999_999)).toEqual({ unit: 'now', n: 0 });
  });
});

describe('exportStamp', () => {
  it('is UTC, sortable, and free of what a filename cannot carry', () => {
    expect(exportStamp(new Date('2026-03-09T04:05:06.007Z'))).toBe('2026-03-09T04-05-06Z');
    expect(exportStamp(new Date(0))).toBe('1970-01-01T00-00-00Z');
    expect(exportStamp(new Date('2026-12-31T23:59:59.999Z'))).toBe('2026-12-31T23-59-59Z');
  });

  it('carries no colon and no dot, which is what made three sites disagree', () => {
    expect(exportStamp(new Date('2026-03-09T04:05:06.007Z'))).not.toMatch(/[:.]/);
  });

  it('names its zone instead of leaving the reader to guess it', () => {
    expect(exportStamp(new Date()).endsWith('Z')).toBe(true);
  });
});

describe('utcOffsetLabel', () => {
  it('reads getTimezoneOffset, whose sign is inverted', () => {
    // Beijing: getTimezoneOffset() === -480. Passing +480 would print the mirror.
    expect(utcOffsetLabel(-480)).toBe('UTC+08:00');
    expect(utcOffsetLabel(180)).toBe('UTC-03:00');
    expect(utcOffsetLabel(0)).toBe('UTC+00:00');
  });

  it('keeps the minutes that half-hour zones actually use', () => {
    expect(utcOffsetLabel(-330)).toBe('UTC+05:30');
    expect(utcOffsetLabel(-525)).toBe('UTC+08:45');
  });
});
