import { describe, expect, it } from 'vitest';
import {
  buildTraceExport,
  canReplayHistory,
  fillHistorySeries,
  historyMessage,
  historyPayload,
  listTruncation,
} from '../../src/utils/history';
import { messagesToJson } from '../../src/utils/exportMessages';
import type { HistoryRow, TraceResult } from '../../src/types';

const row: HistoryRow = {
  id: '1', topic: 'rpc/request', payload: 'hello', payloadBase64: 'aGVsbG8=', payloadLen: 5,
  qos: 1, retain: false, direction: 'in', ts: 1700000000123, truncated: false,
  properties: { userProperties: [['device', 'edge-1']], responseTopic: 'rpc/reply', correlationData: '42' },
};

describe('history replay and inspection', () => {
  it('accepts complete and empty payloads, refuses corrupt or incomplete captures', () => {
    expect(canReplayHistory(row)).toBe(true);
    expect(canReplayHistory({ ...row, payloadBase64: '', payloadLen: 0 })).toBe(true);
    expect(canReplayHistory({ ...row, payloadLen: 100000 })).toBe(false);
    expect(canReplayHistory({ ...row, truncated: true })).toBe(false);
    expect(canReplayHistory({ ...row, payloadBase64: '%' })).toBe(false);
  });

  it('exports original bytes, timestamps and request/response properties', () => {
    const exported = JSON.parse(messagesToJson([historyMessage(row)])).messages[0];
    expect(exported).toMatchObject({ payloadBase64: 'aGVsbG8=', timestampMs: row.ts, responseTopic: 'rpc/reply', correlationData: '42', userProperties: [['device', 'edge-1']] });
    expect(exported.timestamp).toBe('2023-11-14T22:13:20.123Z');
  });

  it('renders binary as hex and reports invalid JSON rather than silently rewriting', () => {
    expect(historyPayload({ ...row, payloadBase64: '/wAB' }, 'hex')).toContain('ff 00 01');
    expect(historyPayload(row, 'text')).toBe('hello');
    expect(() => historyPayload(row, 'json')).toThrow();
  });

  it('fills idle time without changing totals or extending the selected range', () => {
    expect(fillHistorySeries([{ bucket: 1000, count: 2 }, { bucket: 4000, count: 1 }], 1500, 4500, 1000)).toEqual([
      { bucket: 1000, count: 2 }, { bucket: 2000, count: 0 }, { bucket: 3000, count: 0 }, { bucket: 4000, count: 1 },
    ]);
    expect(fillHistorySeries([], 2000, 1000, 1000)).toEqual([]);
  });
});

const trace: TraceResult = {
  hits: [
    { ...row, id: 'a', direction: 'out', ts: 1_000, matchedBy: 'correlation' },
    { ...row, id: 'b', topic: 'devices/edge-1/state', payload: '', payloadBase64: '/wAB', payloadLen: 3, ts: 2_500, matchedBy: 'topic' },
  ],
  summary: {
    count: 2, topics: ['rpc/request', 'devices/edge-1/state'], firstMs: 1_000, lastMs: 2_500,
    inbound: 1, outbound: 1, correlations: ['3432'], truncated: false,
  },
};

describe('buildTraceExport', () => {
  it('carries the token, the window and both renderings of every payload', () => {
    const parsed = JSON.parse(buildTraceExport('42', '24h', { sinceMs: 100, untilMs: 9_000 }, trace, '2026-10-04T02:00:00.000Z'));
    expect(parsed).toMatchObject({
      kind: 'dropqtt-trace', version: 1, token: '42',
      window: { label: '24h', sinceMs: 100, untilMs: 9_000 },
      exportedAt: '2026-10-04T02:00:00.000Z',
    });
    expect(parsed.summary.correlations).toEqual(['3432']);
    // Base64 is the truth for a binary hop; the text form is only what it says.
    expect(parsed.hops[1]).toMatchObject({ payloadBase64: '/wAB', payload: '', iso: '1970-01-01T00:00:02.500Z' });
    expect(parsed.hops[0].correlationData).toBe('42');
    expect(parsed.hops[1].userProperties).toEqual([['device', 'edge-1']]);
  });

  it('keeps the reason a hop is in the list attached to the hop', () => {
    const parsed = JSON.parse(buildTraceExport('edge', 'all', { sinceMs: 0, untilMs: 1 }, trace, 'x'));
    expect(parsed.hops.map((h: { topic: string; matchedBy: string }) => [h.topic, h.matchedBy])).toEqual([
      ['rpc/request', 'correlation'],
      ['devices/edge-1/state', 'topic'],
    ]);
  });
});

describe('a file built from the result list discloses the row cap', () => {
  it('reports truncation as a fact about the window, not about the page being full', () => {
    // 200 of 48,120: the list is a page and the export inherited its cap.
    expect(listTruncation(200, 48_120)).toEqual({ shown: 200, windowTotal: 48_120 });
    // A page that is exactly the whole window was not cut, even though it is
    // exactly as full as a page that was.
    expect(listTruncation(200, 200)).toBeNull();
    expect(listTruncation(3, 3)).toBeNull();
  });

  it('refuses to claim a truncation it cannot support', () => {
    // Nothing exported: there is no file to warn about.
    expect(listTruncation(0, 500)).toBeNull();
    // The window total is unknown or smaller than what is on screen. Naming a
    // total here would put an unsupportable number in the user's receipt.
    expect(listTruncation(200, 0)).toBeNull();
    expect(listTruncation(200, 150)).toBeNull();
  });
});
