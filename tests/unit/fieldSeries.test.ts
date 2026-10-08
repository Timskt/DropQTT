import { describe, expect, it } from 'vitest';
import { fieldReport, isNumericSeries, parseFieldPath, sampleField, HistoryLike } from '../../src/utils/fieldSeries';

const row = (over: Partial<HistoryLike> = {}): HistoryLike => ({
  ts: 1_000,
  topic: 'dev/1/telemetry',
  payload: '{"temp":{"c":21}}',
  direction: 'in',
  truncated: false,
  ...over,
});

const jsonRow = (ts: number, value: unknown, over: Partial<HistoryLike> = {}): HistoryLike =>
  row({ ts, payload: JSON.stringify(value === undefined ? {} : value), ...over });

describe('parseFieldPath', () => {
  it('accepts the notation the diff prints', () => {
    expect(parseFieldPath('temp.c')).toEqual([{ key: 'temp' }, { key: 'c' }]);
    expect(parseFieldPath('v[2]')).toEqual([{ key: 'v', index: 2 }]);
    expect(parseFieldPath('a.b[0].c')).toEqual([{ key: 'a' }, { key: 'b', index: 0 }, { key: 'c' }]);
  });

  it('rejects paths that cannot resolve rather than guessing at them', () => {
    expect(parseFieldPath('')).toBeNull();
    expect(parseFieldPath('a..b')).toBeNull();
    expect(parseFieldPath('a[1]x')).toBeNull();
  });
});

describe('sampleField', () => {
  it('separates "field absent" from "not a JSON document" from "we truncated it"', () => {
    const samples = sampleField(
      [
        row({ ts: 4_000 }),
        row({ ts: 3_000, payload: '{"temp":{"f":70}}' }),
        row({ ts: 2_000, payload: 'plain text' }),
        row({ ts: 1_000, payload: '{"temp":{"c":', truncated: true }),
      ],
      'temp.c',
    );
    expect(samples.map((s) => s.ts)).toEqual([1_000, 2_000, 3_000, 4_000]);
    expect(samples.map((s) => s.state)).toEqual(['truncated', 'notJson', 'missing', 'value']);
    expect(samples[3].value).toBe(21);
  });

  it('treats a JSON null at the path as a value, not as an absence', () => {
    const s = sampleField([row({ payload: '{"temp":{"c":null}}' })], 'temp.c');
    expect(s[0].state).toBe('value');
    expect(s[0].value).toBeNull();
  });

  it('reads array elements', () => {
    const s = sampleField([row({ payload: '{"v":[1,2,3]}' })], 'v[1]');
    expect(s[0]).toMatchObject({ state: 'value', value: 2 });
  });

  it('returns nothing for a malformed path instead of sampling everything', () => {
    expect(sampleField([row()], 'a..b')).toEqual([]);
  });
});

describe('fieldReport / change detection', () => {
  it('reports a transition with the value it came from and the row that carried it', () => {
    const r = fieldReport(
      [jsonRow(3_000, { temp: { c: 25 } }), jsonRow(2_000, { temp: { c: 21 } }), jsonRow(1_000, { temp: { c: 21 } })],
      'temp.c',
    );
    expect(r.changes).toEqual([{ ts: 3_000, topic: 'dev/1/telemetry', direction: 'in', from: '21', to: '25' }]);
    expect(r.lastValue).toBe('25');
    expect(r.lastTs).toBe(3_000);
  });

  it('does not invent a change for the first value in the window', () => {
    const r = fieldReport([jsonRow(1_000, { temp: { c: 21 } }), jsonRow(2_000, { temp: { c: 21 } })], 'temp.c');
    expect(r.changes).toEqual([]);
    expect(r.lastValue).toBe('21');
  });

  it('counts a string that looks like a number as a distinct value, not as that number', () => {
    const r = fieldReport([jsonRow(2_000, { s: '1' }), jsonRow(1_000, { s: 1 })], 's');
    expect(r.changes).toEqual([
      { ts: 2_000, topic: 'dev/1/telemetry', direction: 'in', from: '1', to: '"1"' },
    ]);
    // The number still belongs to the series; the string does not. Refusing to chart the
    // mixed pair is what keeps a type flip from being drawn as a value that never moved.
    expect(r.numeric.points).toEqual([{ ts: 1_000, value: 1 }]);
    expect(r.numeric.nonNumeric).toBe(1);
    expect(isNumericSeries(r.numeric)).toBe(false);
  });

  it('summarises why the window is thinner than it looks', () => {
    const r = fieldReport(
      [jsonRow(1, { temp: { c: 1 } }), row({ ts: 2, payload: 'text' }), row({ ts: 3, payload: '{"x":1}' }), row({ ts: 4, payload: '{', truncated: true })],
      'temp.c',
    );
    expect(r.counts).toEqual({ value: 1, missing: 1, notJson: 1, truncated: 1 });
  });
});

describe('fieldReport / numeric series and silence', () => {
  it('breaks the series at a silence gap instead of drawing a flat line through it', () => {
    const r = fieldReport(
      [
        jsonRow(1_000, { c: 1 }),
        jsonRow(11_000, { c: 2 }),
        jsonRow(21_000, { c: 3 }),
        jsonRow(501_000, { c: 4 }),
      ],
      'c',
      30_000,
    );
    expect(r.numeric.points.map((p) => p.value)).toEqual([1, 2, 3, 4]);
    expect(r.numeric.gaps).toEqual([{ fromTs: 21_000, toTs: 501_000, gapMs: 480_000 }]);
  });

  it('does not call a steady fast stream a gap', () => {
    const r = fieldReport(
      [jsonRow(1_000, { c: 1 }), jsonRow(2_000, { c: 1 }), jsonRow(3_000, { c: 1 }), jsonRow(4_000, { c: 1 })],
      'c',
      30_000,
    );
    expect(r.numeric.gaps).toEqual([]);
  });

  it('needs two numeric samples before it claims to be a series', () => {
    const single = fieldReport([jsonRow(1_000, { c: 1 })], 'c');
    expect(isNumericSeries(single.numeric)).toBe(false);
    const mixed = fieldReport([jsonRow(1_000, { c: 1 }), jsonRow(2_000, { c: 'x' }), jsonRow(3_000, { c: 3 })], 'c');
    expect(isNumericSeries(mixed.numeric)).toBe(false);
  });
});

describe('fieldReport / categorical values', () => {
  it('ranks distinct values by how often they were seen, most recent first on a tie', () => {
    const r = fieldReport(
      [jsonRow(1_000, { st: 'up' }), jsonRow(2_000, { st: 'down' }), jsonRow(3_000, { st: 'up' }), jsonRow(4_000, { st: 'up' })],
      'st',
    );
    expect(r.values).toEqual([
      { value: '"up"', count: 3, firstTs: 1_000, lastTs: 4_000 },
      { value: '"down"', count: 1, firstTs: 2_000, lastTs: 2_000 },
    ]);
  });

  it('renders objects and arrays so a nested value is still readable', () => {
    const r = fieldReport([jsonRow(1, { mode: { auto: true } })], 'mode');
    expect(r.lastValue).toBe('{"auto":true}');
  });
});
