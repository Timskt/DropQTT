import { describe, expect, it } from 'vitest';
import { pct, TimelineWindow } from '../../src/components/history/TimelineCard';

const win: TimelineWindow = { sinceMs: 1_000, untilMs: 11_000 };

describe('timeline track placement', () => {
  it('maps a moment onto the window as a percentage', () => {
    expect(pct(1_000, win)).toBe(0);
    expect(pct(6_000, win)).toBe(50);
    expect(pct(11_000, win)).toBe(100);
  });

  it('clamps to the track instead of drawing outside it', () => {
    // A row written a hair before the window opened, or after it closed, still has
    // to land on the bar — an overflowing segment looks like a longer stretch.
    expect(pct(-5_000, win)).toBe(0);
    expect(pct(90_000, win)).toBe(100);
  });

  it('survives a zero-length window rather than dividing by zero', () => {
    expect(pct(5_000, { sinceMs: 5_000, untilMs: 5_000 })).toBe(0);
    expect(pct(5_000, { sinceMs: 9_000, untilMs: 1_000 })).toBe(0);
  });
});
