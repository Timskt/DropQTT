import { describe, expect, it } from 'vitest';
import { buildTraceHtml } from '../../src/utils/traceHtml';
import type { TraceHit, TraceResult } from '../../src/types';

const hit = (over: Partial<TraceHit> = {}): TraceHit => ({
  id: 'h1',
  topic: 'devices/edge-1/telemetry',
  payload: '{"temp":21}',
  payloadBase64: 'eyJ0ZW1wIjoyMX0=',
  payloadLen: 11,
  qos: 1,
  retain: false,
  contentType: null,
  properties: { userProperties: [['trace', 'abc']], responseTopic: 'devices/edge-1/reply', correlationData: 'c-7' },
  truncated: false,
  direction: 'out',
  ts: 1_700_000_000_000,
  matchedBy: 'correlation',
  ...over,
});

const result = (hits: TraceHit[], over: Partial<TraceResult['summary']> = {}): TraceResult => ({
  hits,
  summary: {
    count: hits.length,
    topics: [...new Set(hits.map((h) => h.topic))],
    firstMs: hits[0]?.ts ?? null,
    lastMs: hits.at(-1)?.ts ?? null,
    inbound: hits.filter((h) => h.direction === 'in').length,
    outbound: hits.filter((h) => h.direction === 'out').length,
    correlations: ['632d37'],
    truncated: false,
    ...over,
  },
});

const base = {
  token: 'c-7',
  windowLabel: '24h',
  sinceMs: 1_699_000_000_000,
  untilMs: 1_700_000_999_000,
  generatedAt: '2026-10-04T04:00:00.000Z',
  brokerLabel: '127.0.0.1:1883',
};

describe('buildTraceHtml', () => {
  it('is one file with nothing to fetch', () => {
    const html = buildTraceHtml({ ...base, result: result([hit()]) });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/src\s*=/i);
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('escapes payload text instead of shipping someone a live element', () => {
    const html = buildTraceHtml({
      ...base,
      result: result([hit({ payload: '<img src=x onerror=alert(1)>', payloadLen: 28 })]),
    });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
  });

  it('drops the broker address it was told to hide', () => {
    const html = buildTraceHtml({ ...base, result: result([hit()]) });
    expect(html).not.toContain('1883');
    expect(html).toContain('Removed before saving: the broker address');
    const kept = buildTraceHtml({ ...base, brokerLabel: undefined, result: result([hit()]) });
    expect(kept).not.toContain('Removed before saving');
    // The address also goes when it is inside the evidence itself.
    const embedded = buildTraceHtml({
      ...base,
      result: result([hit({ payload: 'upload to 127.0.0.1:1883 failed', payloadLen: 31 })]),
    });
    expect(embedded).not.toContain('127.0.0.1');
    expect(embedded).toContain('upload to &lt;broker&gt; failed');
  });

  it('keeps the bytes honest when the payload is not text', () => {
    const html = buildTraceHtml({
      ...base,
      result: result([hit({ payload: '', payloadBase64: '/wAB', payloadLen: 3 })]),
    });
    expect(html).toContain('not valid UTF-8 · base64:');
    expect(html).toContain('/wAB');
  });

  it('carries the claims the view makes: match reason, properties, truncation', () => {
    const html = buildTraceHtml({
      ...base,
      result: result([
        hit(),
        hit({ id: 'h2', topic: 'archive/log', matchedBy: 'payload', direction: 'in', truncated: true }),
      ]),
    });
    expect(html).toContain('same message');
    expect(html).toContain('payload match');
    expect(html).toContain('response-topic devices/edge-1/reply');
    expect(html).toContain('correlation c-7');
    expect(html).toContain('trace: abc');
    expect(html).toContain('payload truncated in history');
    expect(html).toContain('2 hops · 2 topics · 1 in / 1 out');
  });

  it('says when one token is really several conversations, and when the list was cut', () => {
    const single = buildTraceHtml({ ...base, result: result([hit()]) });
    expect(single).not.toContain('different correlation keys');
    const many = buildTraceHtml({
      ...base,
      result: result([hit()], { correlations: ['632d37', '632d38'], truncated: true }),
    });
    expect(many).toContain('2 different correlation keys are in this window');
    expect(many).toContain('The trace was capped');
  });
});
