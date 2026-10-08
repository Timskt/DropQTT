/**
 * Per-field value history over stored messages.
 *
 * The comparison card answers "what differs between these two rows". This answers the
 * other half of the same question, the one nobody's tool ships: "when did this field
 * change, what was it before, and how long has it been like that?" -- which for an
 * operator debugging a fleet is the actual question behind the diff.
 *
 * Paths use the notation the diff prints (`temp.c`, `v[2]`), so one can be copied out of
 * a comparison straight into here.
 *
 * The rules that make this trustworthy rather than decorative:
 * - A row whose payload is not a JSON document, or that lacks the path, is *counted*, not
 *   skipped silently. "The value held steady for an hour" is only meaningful if the
 *   messages that hour existed and carried the field.
 * - Rows stored truncated never enter the series: their JSON is incomplete, so an absent
 *   field there is our storage limit talking, not the device.
 * - The numeric series breaks at a silence gap instead of interpolating through it. A flat
 *   line across an hour in which nothing was received reads as "constant" and is a lie.
 */

export interface FieldSample {
  ts: number;
  topic: string;
  direction: string;
  state: 'value' | 'missing' | 'notJson' | 'truncated';
  /** Only set when state is `value`. */
  value?: unknown;
}

export interface FieldChange {
  ts: number;
  topic: string;
  direction: string;
  from: string;
  to: string;
}

export interface SeriesPoint {
  ts: number;
  value: number;
}

export interface SeriesGap {
  fromTs: number;
  toTs: number;
  gapMs: number;
}

export interface ValueCount {
  value: string;
  count: number;
  firstTs: number;
  lastTs: number;
}

export interface FieldReport {
  path: string;
  samples: FieldSample[];
  counts: { value: number; missing: number; notJson: number; truncated: number };
  changes: FieldChange[];
  /** Stable serialized form of the most recent value seen, or null when there is none. */
  lastValue: string | null;
  lastTs: number | null;
  numeric: { points: SeriesPoint[]; gaps: SeriesGap[]; nonNumeric: number };
  values: ValueCount[];
}

interface Segment {
  key: string;
  index?: number;
}

/** `a.b[2].c` -> [{key:a},{key:b,index:2},{key:c}] */
export function parseFieldPath(path: string): Segment[] | null {
  const parts = path.split('.');
  const out: Segment[] = [];
  for (const part of parts) {
    if (!part) return null;
    const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!m) return null;
    const seg: Segment = { key: m[1] };
    const idxs = m[2] ? Array.from(m[2].matchAll(/\[(\d+)\]/g)) : [];
    if (idxs.length) seg.index = Number(idxs[idxs.length - 1][1]);
    out.push(seg);
    // Intermediate indices collapse: a[0][1] is not something a JSON object path can mean
    // here, so only the last one survives and the caller sees the miss rather than a guess.
    for (let i = 0; i < idxs.length - 1; i++) out.push({ key: `${m[1]}[${idxs[i][1]}]`, index: Number(idxs[i][1]) });
  }
  return out.length ? out : null;
}

/**
 * Type-honest rendering. A number 1 and a string "1" must not print identically, or a
 * device that switched the field's type reads as "value held steady" -- the one thing this
 * view exists to detect. So strings keep their quotes.
 */
const render = (v: unknown): string => {
  if (v === undefined) return '—';
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s;
};

/** Follow the path, reporting *why* it did not land rather than a bare undefined. */
function pick(doc: unknown, segs: Segment[]): { found: boolean; value?: unknown } {
  let cur = doc;
  for (const seg of segs) {
    if (cur === null || typeof cur !== 'object') return { found: false };
    const next = (cur as Record<string, unknown>)[seg.key];
    if (next === undefined) return { found: false };
    if (seg.index !== undefined) {
      if (!Array.isArray(next)) return { found: false };
      const el = next[seg.index];
      if (el === undefined) return { found: false };
      cur = el;
    } else {
      cur = next;
    }
  }
  return { found: true, value: cur };
}

const parseJson = (raw: string): unknown | undefined => {
  const t = raw.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
};

export interface HistoryLike {
  ts: number;
  topic: string;
  payload: string;
  direction: string;
  truncated: boolean;
}

/** Newest-first rows are what the panel holds; sampling walks them oldest-first. */
export function sampleField(rows: HistoryLike[], path: string): FieldSample[] {
  const segs = parseFieldPath(path.trim());
  if (!segs) return [];
  const out = rows
    .map((r): FieldSample => {
      if (r.truncated) return { ts: r.ts, topic: r.topic, direction: r.direction, state: 'truncated' };
      const doc = parseJson(r.payload);
      if (doc === undefined) return { ts: r.ts, topic: r.topic, direction: r.direction, state: 'notJson' };
      const hit = pick(doc, segs);
      if (!hit.found) return { ts: r.ts, topic: r.topic, direction: r.direction, state: 'missing' };
      return { ts: r.ts, topic: r.topic, direction: r.direction, state: 'value', value: hit.value };
    })
    .sort((x, y) => x.ts - y.ts);
  return out;
}

/**
 * Transitions between consecutive valued samples.
 *
 * The first value in the window is the starting state, not a change -- there is no
 * predecessor to compare against. Callers must present it as "as of <time>" rather than
 * as an event, and an empty change list means "no change among the messages that carried
 * this field", which is not the same as "this field never changed".
 */
function buildChanges(samples: FieldSample[]): FieldChange[] {
  const changes: FieldChange[] = [];
  let prev: FieldSample | null = null;
  for (const s of samples) {
    if (s.state !== 'value') continue;
    if (prev && render(prev.value) !== render(s.value)) {
      changes.push({ ts: s.ts, topic: s.topic, direction: s.direction, from: render(prev.value), to: render(s.value) });
    }
    prev = s;
  }
  return changes;
}

/** Median interval between valued samples, used to decide what counts as silence. */
function medianDelta(samples: FieldSample[]): number | null {
  const ts = samples.filter((s) => s.state === 'value').map((s) => s.ts);
  if (ts.length < 3) return null;
  const deltas: number[] = [];
  for (let i = 1; i < ts.length; i++) deltas.push(ts[i] - ts[i - 1]);
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

function buildSeries(samples: FieldSample[], gapFloorMs: number): FieldReport['numeric'] {
  const pts: SeriesPoint[] = [];
  let nonNumeric = 0;
  for (const s of samples) {
    if (s.state !== 'value') continue;
    if (typeof s.value === 'number' && Number.isFinite(s.value)) pts.push({ ts: s.ts, value: s.value });
    else nonNumeric += 1;
  }
  const median = medianDelta(samples);
  const threshold = Math.max(gapFloorMs, median ? median * 3 : 0);
  const gaps: SeriesGap[] = [];
  for (let i = 1; i < pts.length; i++) {
    const gapMs = pts[i].ts - pts[i - 1].ts;
    if (median && gapMs >= threshold) gaps.push({ fromTs: pts[i - 1].ts, toTs: pts[i].ts, gapMs });
  }
  return { points: pts, gaps, nonNumeric };
}

function buildValueCounts(samples: FieldSample[]): ValueCount[] {
  const map = new Map<string, ValueCount>();
  for (const s of samples) {
    if (s.state !== 'value') continue;
    const key = render(s.value);
    const hit = map.get(key);
    if (hit) {
      hit.count += 1;
      hit.lastTs = s.ts;
    } else {
      map.set(key, { value: key, count: 1, firstTs: s.ts, lastTs: s.ts });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count || b.lastTs - a.lastTs);
}

/**
 * Everything the field view shows, in one pass. `gapFloorMs` is the smallest silence that
 * counts as a break in the series even when the stream is normally slower.
 */
export function fieldReport(rows: HistoryLike[], path: string, gapFloorMs = 60_000): FieldReport {
  const samples = sampleField(rows, path);
  const counts = { value: 0, missing: 0, notJson: 0, truncated: 0 };
  for (const s of samples) counts[s.state] += 1;
  const changes = buildChanges(samples);
  const lastValued = [...samples].reverse().find((s) => s.state === 'value');
  return {
    path: path.trim(),
    samples,
    counts,
    changes,
    lastValue: lastValued ? render(lastValued.value) : null,
    lastTs: lastValued ? lastValued.ts : null,
    numeric: buildSeries(samples, gapFloorMs),
    values: buildValueCounts(samples),
  };
}

/** Does this path point at numbers, so the chart is the right rendering at all? */
export function isNumericSeries(n: FieldReport['numeric']): boolean {
  return n.points.length >= 2 && n.nonNumeric === 0;
}
