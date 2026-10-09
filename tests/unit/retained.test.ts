import { describe, expect, it } from 'vitest';
import { ageUnit, orderRetained, retainedState } from '../../src/utils/retained';
import type { RetainedLineage } from '../../src/types';

const row = (over: Partial<RetainedLineage>): RetainedLineage => ({
  topic: 'cfg/gw1/mode',
  versions: 1,
  firstTs: 0,
  lastTs: 0,
  payload: 'auto',
  payloadB64: 'YXV0bw==',
  payloadLen: 4,
  truncated: false,
  cleared: false,
  stale: false,
  ...over,
});

describe('the retained chip', () => {
  it('calls a deletion a deletion even when it is ancient', () => {
    // Ordering is the whole point: a cleared topic has no live value to go stale,
    // and telling someone it is stale sends them to clear something already gone.
    expect(retainedState(row({ cleared: true, stale: true }))).toBe('cleared');
    expect(retainedState(row({ cleared: true, stale: false }))).toBe('cleared');
    expect(retainedState(row({ cleared: false, stale: true }))).toBe('stale');
    expect(retainedState(row({ cleared: false, stale: false }))).toBe('live');
  });
});

describe('the retained age', () => {
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

  it('never reports a negative age as a countdown', () => {
    // A row stamped slightly in the future (clock skew, a device with a fast clock)
    // must read as "just now", not "-3s ago".
    expect(ageUnit(-3_000)).toEqual({ unit: 'now', n: 0 });
    expect(ageUnit(-999_999)).toEqual({ unit: 'now', n: 0 });
  });
});

describe('the retained order', () => {
  const a = row({ topic: 'cfg/a', stale: false, lastTs: 300 });
  const b = row({ topic: 'cfg/b', stale: true, lastTs: 100 });
  const c = row({ topic: 'cfg/c', stale: true, lastTs: 200 });

  it('puts the zombies first, because that is what the view is for', () => {
    expect(orderRetained([a, b, c]).map((r) => r.topic)).toEqual(['cfg/c', 'cfg/b', 'cfg/a']);
  });

  it('breaks a staleness tie by the newest change, then by topic', () => {
    const sameAge = [row({ topic: 'z', stale: true, lastTs: 100 }), row({ topic: 'y', stale: true, lastTs: 100 })];
    expect(orderRetained(sameAge).map((r) => r.topic)).toEqual(['y', 'z']);
  });

  it('leaves the caller array alone', () => {
    const input = [a, b, c];
    orderRetained(input);
    expect(input.map((r) => r.topic)).toEqual(['cfg/a', 'cfg/b', 'cfg/c']);
  });

  it('survives an empty ledger', () => {
    expect(orderRetained([])).toEqual([]);
  });
});
