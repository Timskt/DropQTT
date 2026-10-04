import { describe, expect, it } from 'vitest';
import {
  buildCapture,
  CAPTURE_FORMAT,
  paceFor,
  parseCapture,
  CaptureError,
  summarizeCapture,
} from '../../src/utils/capture';
import type { HistoryRow, PubProperties } from '../../src/types';

const props = (over: Partial<PubProperties> = {}): PubProperties => ({ userProperties: [], ...over });

const row = (id: string, topic: string, payload: string, over: Partial<HistoryRow> = {}): HistoryRow => ({
  id,
  topic,
  payload,
  payloadBase64: Buffer.from(payload, 'utf8').toString('base64'),
  payloadLen: Buffer.byteLength(payload, 'utf8'),
  qos: 1,
  retain: false,
  properties: props(),
  truncated: false,
  direction: 'in',
  ts: 1_000,
  ...over,
});

describe('buildCapture', () => {
  it('orders by time and offsets every event from the first', () => {
    const text = buildCapture(
      [row('b', 'sensors/t', '{"r":2}', { ts: 3_500 }), row('a', 'sensors/t', '{"r":1}', { ts: 500 })],
      { createdAt: '2026-10-04T00:00:00.000Z' },
    );
    const { header, events } = parseCapture(text);
    expect(events.map((e) => e.topic + ':' + e.t)).toEqual(['sensors/t:0', 'sensors/t:3000']);
    expect(header.count).toBe(2);
    expect(header.spanMs).toBe(3_000);
    expect(header.inbound).toBe(2);
    expect(header.topics).toEqual(['sensors/t']);
    expect(header.createdAt).toBe('2026-10-04T00:00:00.000Z');
  });

  it('keeps the v5 properties that make a replay faithful, including binary correlation', () => {
    const text = buildCapture([
      row('a', 'lab/rpc/ping', '{"cmd":"ping"}', {
        direction: 'out',
        qos: 2,
        retain: true,
        properties: props({
          contentType: 'application/json',
          responseTopic: 'lab/rpc/ping/reply',
          correlationHex: '00ff10',
          userProperties: [['trace', 'abc']],
        }),
      }),
    ]);
    const { events } = parseCapture(text);
    expect(events[0]).toMatchObject({
      direction: 'out',
      qos: 2,
      retain: true,
      props: { responseTopic: 'lab/rpc/ping/reply', correlationHex: '00ff10', contentType: 'application/json' },
    });
    expect(events[0].props?.userProperties).toEqual([['trace', 'abc']]);
  });

  it('writes no broker address and no credential, whatever the rows say', () => {
    // The recorder's context (host:port) is deliberately not a parameter: a capture
    // leaves the building in a ticket, and the topics are what reproduce the bug.
    const text = buildCapture([row('a', 'devices/10.0.0.5/state', 'secret-token-value')], { filter: 'devices/#' });
    expect(text).not.toContain('127.0.0.1');
    expect(text).not.toMatch(/"broker"/);
    expect(text).not.toMatch(/password|username|token":/i);
    // Payloads stay verbatim — that is the whole point of recording them.
    expect(text).toContain(Buffer.from('secret-token-value', 'utf8').toString('base64'));
  });

  it('drops the props object entirely when a message carried none', () => {
    const { events } = parseCapture(buildCapture([row('a', 'x/y', 'hi')]));
    expect(events[0].props).toBeUndefined();
  });
});

describe('parseCapture', () => {
  it('names the reason for every way a file can be wrong', () => {
    expect(() => parseCapture('')).toThrowError(CaptureError);
    expect(() => parseCapture('')).toThrow(/empty/);
    expect(() => parseCapture('not json\n')).toThrow(/is this a \.dqrec file/);
    expect(() => parseCapture(JSON.stringify({ kind: 'other' }))).toThrow(/no capture header/);
    expect(() => parseCapture(JSON.stringify({ kind: 'header', format: 'dropqtt-capture/2' }))).toThrow(
      new RegExp(`this build reads ${CAPTURE_FORMAT}`),
    );
    expect(() => parseCapture(`${JSON.stringify({ kind: 'header', format: CAPTURE_FORMAT })}\n{oops`)).toThrow(
      /line 2 is not complete JSON/,
    );
    expect(() =>
      parseCapture(`${JSON.stringify({ kind: 'header', format: CAPTURE_FORMAT })}\n{"payloadBase64":""}`),
    ).toThrow(/line 2 has no topic/);
    expect(() =>
      parseCapture(`${JSON.stringify({ kind: 'header', format: CAPTURE_FORMAT })}\n{"topic":"a/b"}`),
    ).toThrow(/a\/b\) has no payload/);
  });

  it('survives a truncated tail as a valid prefix rather than a corrupt file', () => {
    const full = buildCapture([row('a', 'x', 'one'), row('b', 'x', 'two'), row('c', 'x', 'three')]);
    const lines = full.trimEnd().split('\n');
    const { events } = parseCapture(lines.slice(0, 3).join('\n') + '\n');
    expect(events).toHaveLength(2);
  });

  it('clamps a hand-edited qos and rejects a missing one rather than inventing 5', () => {
    const header = JSON.stringify({ kind: 'header', format: CAPTURE_FORMAT });
    const { events } = parseCapture(`${header}\n{"topic":"a","payloadBase64":"","qos":9,"t":-5}`);
    expect(events[0].qos).toBe(2);
    expect(events[0].t).toBe(0);
  });
});

describe('capture pacing', () => {
  const events = [
    { t: 0, ts: 0, topic: 'a', payloadBase64: '', payloadLen: 0, qos: 0, retain: false, direction: 'in' as const },
    { t: 1_000, ts: 0, topic: 'a', payloadBase64: '', payloadLen: 0, qos: 0, retain: false, direction: 'in' as const },
    { t: 61_000, ts: 0, topic: 'a', payloadBase64: '', payloadLen: 0, qos: 0, retain: false, direction: 'in' as const },
  ];

  it('summarizes what a replay will actually do', () => {
    const s = summarizeCapture(events);
    expect(s).toMatchObject({ count: 3, spanMs: 61_000, inbound: 3, outbound: 0, topics: 1, maxGapMs: 60_000 });
  });

  it('scales gaps, and caps them so one quiet device cannot stall a replay for minutes', () => {
    expect(paceFor(events, 1, 0)).toEqual([0, 1_000, 60_000]);
    expect(paceFor(events, 10, 0)).toEqual([0, 100, 6_000]);
    expect(paceFor(events, 1, 2_000)).toEqual([0, 1_000, 2_000]);
  });
});
