import { describe, expect, it } from 'vitest';
import { auditDelivery, coverageOf, AuditOptions } from '../../src/utils/deliveryAudit';

const row = (ts: number, seq: number, over: Record<string, unknown> = {}) => ({
  ts,
  topic: 'line/1/counts',
  payload: JSON.stringify({ seq, ...over }),
  truncated: false,
});

const OPTS: AuditOptions = { seqPath: 'seq' };

const first = (rows: any[], opts: AuditOptions = OPTS) => auditDelivery(rows, opts)[0];

describe('auditDelivery / sequence accounting', () => {
  it('finds nothing missing in a contiguous run', () => {
    const a = first([row(1, 1), row(2, 2), row(3, 3)]);
    expect([a.firstSeq, a.lastSeq, a.missingCount, a.duplicates, a.outOfOrder]).toEqual([1, 3, 0, [], 0]);
    expect(coverageOf(a)).toBe(1);
  });

  it('names the holes inside the observed span', () => {
    const a = first([row(1, 1), row(2, 4), row(3, 5)]);
    expect(a.missing).toEqual([2, 3]);
    expect(a.missingCount).toBe(2);
    expect(a.expectedCount).toBe(5);
    expect(a.maxJump).toBe(3);
    expect(coverageOf(a)).toBeCloseTo(0.6, 5);
  });

  it('counts a repeated sequence as a duplicate, not as a second delivery to average', () => {
    const a = first([row(1, 1), row(2, 2), row(9, 2), row(10, 2)]);
    expect(a.duplicates).toEqual([{ seq: 2, count: 3, firstTs: 2, lastTs: 10 }]);
    expect(a.missingCount).toBe(0);
  });

  it('spots reordering as arrival order that goes backwards against the high water mark', () => {
    const a = first([row(1, 10), row(2, 11), row(3, 9), row(4, 12), row(5, 8)]);
    expect(a.outOfOrder).toBe(2);
    expect(a.missingCount).toBe(0);
  });

  it('never calls a hole in stored history proof that the broker dropped it', () => {
    // seq 1 and 3 are readable, the row between them is truncated, so the arithmetic does
    // find a hole at 2 -- and unusableInSpan is the field that stops that hole being read
    // as a dropped packet. It may simply be the row whose payload we could not read.
    const a = first([row(1, 1), { ...row(2, 2), truncated: true }, row(3, 3)]);
    expect(a.usable).toBe(2);
    expect(a.unusable).toBe(1);
    expect(a.truncated).toBe(1);
    expect(a.rowsScanned).toBe(3);
    expect(a.missing).toEqual([2]);
    expect(a.unusableInSpan).toBe(1);
  });

  it('rejects string sequence numbers instead of conflating them with integers', () => {
    const a = first([row(1, 1), { ...row(2, 1), payload: '{"seq":"1"}' }, row(3, 3)]);
    expect(a.usable).toBe(2);
    expect(a.unusable).toBe(1);
    // The unreadable row sits between two readable ones, so it is inside the span and the
    // hole at 2 cannot be blamed on the sender without saying so.
    expect(a.missing).toEqual([2]);
    expect(a.unusableInSpan).toBe(1);
    expect(a.duplicates).toEqual([]);
  });

  it('leaves a degenerate span empty when the only sample is at one instant', () => {
    const a = first([row(1, 1), { ...row(2, 1), payload: '{"seq":"1"}' }]);
    expect(a.unusableInSpan).toBe(0);
  });

  it('does not count unusable rows outside the observed span against the hole', () => {
    const a = first([{ ts: 900, topic: 'line/1/counts', payload: 'not json', truncated: false }, row(1, 1), row(2, 2)]);
    expect(a.usable).toBe(2);
    expect(a.unusable).toBe(1);
    expect(a.unusableInSpan).toBe(0);
  });

  it('audits each topic on its own so a fleet does not average into one line', () => {
    const list = auditDelivery([row(1, 1), { ...row(2, 7), topic: 'line/2/counts' }], OPTS);
    expect(list.map((l) => l.topic).sort()).toEqual(['line/1/counts', 'line/2/counts']);
    expect(list.find((l) => l.topic === 'line/2/counts')!.firstSeq).toBe(7);
  });

  it('reads nested and array sequence paths', () => {
    const nested = first([{ ts: 1, topic: 'x', payload: '{"meta":{"n":4}}', truncated: false }], { seqPath: 'meta.n' });
    expect(nested).toMatchObject({ usable: 1, firstSeq: 4, lastSeq: 4 });
  });

  it('returns nothing when asked to audit without a sequence path', () => {
    expect(auditDelivery([row(1, 1)], { seqPath: '  ' })).toEqual([]);
  });
});

describe('auditDelivery / latency', () => {
  const timed = (ts: number, seq: number, sentAt: number) => ({
    ts,
    topic: 'line/1/counts',
    payload: JSON.stringify({ seq, sentAt }),
    truncated: false,
  });

  it('says it cannot measure latency instead of inventing a number', () => {
    const noPath = first([row(1, 1), row(2, 2)]);
    expect(noPath.latency).toMatchObject({ measurable: false, reason: 'noTimePath', p95Ms: null, samples: 0 });

    const noField = first([row(1, 1), row(2, 2)], { seqPath: 'seq', timePath: 'sentAt' });
    expect(noField.latency).toMatchObject({ measurable: false, reason: 'noSamples', p50Ms: null });
  });

  it('reports percentiles from the publisher send stamp', () => {
    const rows = [10, 20, 30, 40, 50].map((d, i) => timed(1_000 + d, i + 1, 1_000));
    const a = first(rows, { seqPath: 'seq', timePath: 'sentAt' });
    expect(a.latency).toMatchObject({ measurable: true, samples: 5, p50Ms: 30, maxMs: 50 });
    expect(a.latency.p95Ms).toBe(50);
  });

  it('separates clock skew from latency rather than averaging negatives away', () => {
    const a = first([timed(1_000, 1, 1_500), timed(2_000, 2, 1_500)], { seqPath: 'seq', timePath: 'sentAt' });
    expect(a.latency.clockSkew).toBe(1);
    expect(a.latency.samples).toBe(1);
    expect(a.latency.p50Ms).toBe(500);
  });
});
