import { describe, expect, it } from 'vitest';
import { canReplayHistory, fillHistorySeries, historyMessage, historyPayload } from '../../src/utils/history';
import { messagesToJson } from '../../src/utils/exportMessages';
import type { HistoryRow } from '../../src/types';

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
