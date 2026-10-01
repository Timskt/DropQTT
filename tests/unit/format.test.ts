import { describe, expect, it } from 'vitest';
import { formatBytes } from '../../src/utils/format';

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
