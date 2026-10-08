import { describe, expect, it } from 'vitest';
import { diffMessages, diffMetadata, DiffableRow } from '../../src/utils/messageDiff';

const row = (over: Partial<DiffableRow> = {}): DiffableRow => ({
  topic: 'dev/1/telemetry',
  payload: '',
  payloadBase64: '',
  payloadLen: 0,
  qos: 1,
  retain: false,
  direction: 'in',
  contentType: null,
  truncated: false,
  ts: 1_000,
  ...over,
});

const json = (o: unknown): DiffableRow => row({ payload: JSON.stringify(o), payloadLen: JSON.stringify(o).length });

describe('diffMessages / json', () => {
  it('names the changed leaf by its path instead of the whole document', () => {
    const d = diffMessages(json({ temp: { c: 21, f: 70 }, id: 'a' }), json({ temp: { c: 25, f: 70 }, id: 'a' }));
    expect(d.kind).toBe('json');
    expect(d.identical).toBe(false);
    expect(d.fields).toEqual([{ path: 'temp.c', type: 'changed', before: '21', after: '25' }]);
  });

  it('separates an added key from a removed one', () => {
    const d = diffMessages(json({ a: 1, gone: true }), json({ a: 1, fresh: 2 }));
    expect(d.fields).toEqual([
      { path: 'fresh', type: 'added', before: '', after: '2' },
      { path: 'gone', type: 'removed', before: 'true', after: '' },
    ]);
    expect(d.counts).toEqual({ added: 1, removed: 1, changed: 0 });
  });

  it('differs arrays by index so a shifted element is visible', () => {
    const d = diffMessages(json({ v: [1, 2, 3] }), json({ v: [1, 9] }));
    expect(d.fields).toEqual([
      { path: 'v[1]', type: 'changed', before: '2', after: '9' },
      { path: 'v[2]', type: 'removed', before: '3', after: '' },
    ]);
  });

  it('reports a shape change once rather than descending into nothing', () => {
    const d = diffMessages(json({ x: { a: 1 } }), json({ x: 5 }));
    expect(d.fields.map((f) => f.path)).toEqual(['x']);
    expect(d.fields[0].type).toBe('changed');
  });

  it('two byte-identical documents produce no difference at all', () => {
    const d = diffMessages(json({ a: [1, { b: 2 }] }), json({ a: [1, { b: 2 }] }));
    expect(d.identical).toBe(true);
    expect(d.fields).toEqual([]);
    expect(d.notes).toEqual([]);
  });

  it('says so when it stops descending, instead of pretending the subtree matched', () => {
    const deep = (n: number): Record<string, unknown> => {
      let v: Record<string, unknown> = { leaf: n };
      for (let i = 0; i < n; i++) v = { level: v };
      return v;
    };
    const d = diffMessages(json(deep(9)), json(deep(10)));
    expect(d.notes.some((x) => x.code === 'depth')).toBe(true);
    expect(d.kind).toBe('json');
  });

  it('caps the change list and admits the cap', () => {
    const many = (tag: string): Record<string, number> => {
      const o: Record<string, number> = {};
      for (let i = 0; i < 260; i++) o[`k${String(i).padStart(3, '0')}`] = i + (tag === 'b' ? 1 : 0);
      return o;
    };
    const d = diffMessages(json(many('a')), json(many('b')));
    expect(d.fields).toHaveLength(200);
    expect(d.notes).toEqual([{ code: 'cap' }]);
  });

  it('falls back to text for a payload that only looks like JSON', () => {
    const d = diffMessages(row({ payload: '{ not json at all' }), row({ payload: '{ not json either' }));
    expect(d.kind).toBe('text');
    expect(d.lines.some((l) => l.type === 'removed')).toBe(true);
  });
});

describe('diffMessages / text and binary', () => {
  it('keeps common prefix and suffix out of the change count', () => {
    const a = row({ payload: 'header\nvalue=1\nfooter' });
    const b = row({ payload: 'header\nvalue=2\nfooter' });
    const d = diffMessages(a, b);
    expect(d.kind).toBe('text');
    expect(d.counts).toEqual({ added: 1, removed: 1, changed: 0 });
    expect(d.lines).toEqual([
      { type: 'same', text: 'header' },
      { type: 'removed', text: 'value=1' },
      { type: 'added', text: 'value=2' },
      { type: 'same', text: 'footer' },
    ]);
  });

  it('refuses to compute a quadratic diff and labels the gap', () => {
    const big = (ch: string): string => Array.from({ length: 900 }, (_, i) => `${ch}${i}`).join('\n');
    const d = diffMessages(row({ payload: big('a') }), row({ payload: big('b') }));
    expect(d.notes.some((x) => x.code === 'wide')).toBe(true);
    expect(d.lines.some((l) => l.type === 'uncompared')).toBe(true);
    expect(d.identical).toBe(false);
  });

  it('treats a binary-only row as bytes, not as an empty string', () => {
    const a = row({ payload: '', payloadBase64: 'aaEC', payloadLen: 3 });
    const b = row({ payload: '', payloadBase64: 'aaQD', payloadLen: 4 });
    const d = diffMessages(a, b);
    expect(d.kind).toBe('binary');
    expect(d.fields).toEqual([{ path: '(bytes)', type: 'changed', before: 'binary:3', after: 'binary:4' }]);
    const same = diffMessages(a, row({ payload: '', payloadBase64: 'aaEC', payloadLen: 3 }));
    expect(same.identical).toBe(true);
    expect(same.fields).toEqual([]);
  });

  it('marks the result unreliable when either row was stored truncated', () => {
    const d = diffMessages(row({ payload: 'abc', truncated: true }), row({ payload: 'abc' }));
    expect(d.unreliable).toBe(true);
    expect(d.identical).toBe(true);
  });
});

describe('diffMetadata', () => {
  it('lists only the carrier fields that actually differ', () => {
    const d = diffMetadata(
      row({ topic: 'dev/1/telemetry', qos: 1, retain: false, ts: 5_000 }),
      row({ topic: 'dev/2/telemetry', qos: 0, retain: true, ts: 2_000 }),
    );
    expect(d.fields.map((f) => f.path)).toEqual(['topic', 'qos', 'retain']);
    expect(d.gapMs).toBe(3_000);
  });

  it('is silent when the two rows were carried the same way', () => {
    const d = diffMetadata(row({ payload: 'x', payloadLen: 1 }), row({ payload: 'y', payloadLen: 1 }));
    expect(d.fields).toEqual([]);
    expect(d.gapMs).toBe(0);
  });
});
