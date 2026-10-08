/**
 * Payload and metadata comparison for two history rows.
 *
 * The question this exists to answer is the one the history panel cannot currently:
 * "this device at 10:02 and the same device at 10:09 — what actually changed?" A raw
 * string compare answers nothing, because the interesting delta is usually one field
 * inside a JSON document or one line of a text payload.
 *
 * Three honest constraints, in the project's style of not hiding a limitation behind a
 * green light: nested JSON is walked to a fixed depth, a change list is capped, and a
 * line diff that would be quadratic is stopped and reported as un-compared rather than
 * silently summarized. Each limitation comes out as a machine-readable note code -- the
 * sentences themselves belong to the i18n files, so this stays language-free.
 */

export type ChangeType = 'added' | 'removed' | 'changed';

export interface FieldChange {
  /** `temp.max` for JSON, `(line)` for text, `(bytes)` for binary, `topic` for metadata */
  path: string;
  type: ChangeType;
  /** Empty string means that side did not exist (an added or removed field). */
  before: string;
  after: string;
}

export interface LineOp {
  type: 'same' | 'added' | 'removed' | 'uncompared';
  text: string;
}

export type DiffKind = 'identical' | 'json' | 'text' | 'binary';

/** Why the diff is not the whole truth. Rendered through i18n by the caller. */
export type DiffNote =
  | { code: 'depth'; path: string }
  | { code: 'cap' }
  | { code: 'wide'; before: number; after: number };

export interface MessageDiff {
  kind: DiffKind;
  /** Both rows carry the same bytes; nothing below should be read as a difference. */
  identical: boolean;
  fields: FieldChange[];
  lines: LineOp[];
  notes: DiffNote[];
  /** At least one row was stored truncated, so equal bytes do not prove equal messages. */
  unreliable: boolean;
  counts: { added: number; removed: number; changed: number };
}

const MAX_DEPTH = 6;
const MAX_CHANGES = 200;
/** Line diff is O(n*m); past this many pairs of lines it stops instead of stalling. */
const MAX_LINE_PRODUCT = 200_000;
const MAX_VALUE_LEN = 160;

const show = (v: unknown): string => {
  if (v === undefined) return '';
  if (typeof v === 'string') return v.length > MAX_VALUE_LEN ? `${v.slice(0, MAX_VALUE_LEN)}…` : v;
  const s = JSON.stringify(v);
  return s !== undefined && s.length > MAX_VALUE_LEN ? `${s.slice(0, MAX_VALUE_LEN)}…` : s ?? String(v);
};

type Shape = 'array' | 'object' | 'scalar';
const shapeOf = (v: unknown): Shape =>
  Array.isArray(v) ? 'array' : v !== null && typeof v === 'object' ? 'object' : 'scalar';

/** Only documents that start as an object or array count as JSON; a bare number does not. */
const parseDoc = (raw: string): { ok: true; value: unknown } | { ok: false } => {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false };
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
};

class ChangeSink {
  fields: FieldChange[] = [];
  notes: DiffNote[] = [];

  push(path: string, type: ChangeType, before: unknown, after: unknown): void {
    if (this.fields.length >= MAX_CHANGES) {
      this.markCap();
      return;
    }
    this.fields.push({ path, type, before: show(before), after: show(after) });
  }

  markCap(): void {
    if (!this.notes.some((n) => n.code === 'cap')) this.notes.push({ code: 'cap' });
  }

  get full(): boolean {
    return this.fields.length >= MAX_CHANGES;
  }
}

function walk(a: unknown, b: unknown, path: string, sink: ChangeSink, depth: number): void {
  const sa = shapeOf(a);
  const sb = shapeOf(b);
  if (sa === 'scalar' && sb === 'scalar') {
    if (a !== b) sink.push(path, 'changed', a, b);
    return;
  }
  if (sa !== sb) {
    sink.push(path, 'changed', a, b);
    return;
  }
  if (depth >= MAX_DEPTH) {
    sink.notes.push({ code: 'depth', path });
    return;
  }
  if (sa === 'array') {
    const av = a as unknown[];
    const bv = b as unknown[];
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      if (sink.full) {
        sink.markCap();
        break;
      }
      const p = `${path}[${i}]`;
      if (i >= av.length) sink.push(p, 'added', undefined, bv[i]);
      else if (i >= bv.length) sink.push(p, 'removed', av[i], undefined);
      else walk(av[i], bv[i], p, sink, depth + 1);
    }
    return;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(ao), ...Object.keys(bo)])).sort();
  for (const k of keys) {
    if (sink.full) {
      sink.markCap();
      break;
    }
    const p = path ? `${path}.${k}` : k;
    const hasA = Object.prototype.hasOwnProperty.call(ao, k);
    const hasB = Object.prototype.hasOwnProperty.call(bo, k);
    if (!hasA) sink.push(p, 'added', undefined, bo[k]);
    else if (!hasB) sink.push(p, 'removed', ao[k], undefined);
    else walk(ao[k], bo[k], p, sink, depth + 1);
  }
}

interface TextDiff {
  ops: LineOp[];
  wide: { before: number; after: number } | null;
}

/** Strip the lines both sides already agree on so the quadratic part stays small. */
function diffText(aText: string, bText: string): TextDiff {
  const a = aText.split('\n');
  const b = bText.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const same = (arr: string[]): LineOp[] => arr.map((text) => ({ type: 'same' as const, text }));
  const ops: LineOp[] = same(a.slice(0, head));

  if (midA.length * midB.length > MAX_LINE_PRODUCT) {
    return { ops: [...ops, { type: 'uncompared', text: '' }, ...same(b.slice(b.length - tail))], wide: { before: midA.length, after: midB.length } };
  }

  // Longest common subsequence over the differing middle, classic DP table.
  const n = midA.length;
  const m = midB.length;
  const table: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) table.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      ops.push({ type: 'same', text: midA[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: 'removed', text: midA[i] });
      i++;
    } else {
      ops.push({ type: 'added', text: midB[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'removed', text: midA[i++] });
  while (j < m) ops.push({ type: 'added', text: midB[j++] });
  ops.push(...same(b.slice(b.length - tail)));
  return { ops, wide: null };
}

export interface DiffableRow {
  topic: string;
  payload: string;
  payloadBase64: string;
  payloadLen: number;
  qos: number;
  retain: boolean;
  direction: string;
  contentType?: string | null;
  truncated: boolean;
  ts: number;
}

export function diffMessages(a: DiffableRow, b: DiffableRow): MessageDiff {
  const aBinary = !a.payload && !!a.payloadBase64;
  const bBinary = !b.payload && !!b.payloadBase64;
  const identical = a.payload === b.payload && a.payloadBase64 === b.payloadBase64;
  const unreliable = a.truncated || b.truncated;
  const sink = new ChangeSink();

  if (aBinary || bBinary) {
    if (!identical) sink.push('(bytes)', 'changed', `binary:${a.payloadLen}`, `binary:${b.payloadLen}`);
    return finish('binary', identical, sink, [], unreliable);
  }

  const da = parseDoc(a.payload);
  const db = parseDoc(b.payload);
  if (da.ok && db.ok) {
    walk(da.value, db.value, '', sink, 0);
    return finish('json', identical, sink, [], unreliable);
  }

  const res = diffText(a.payload, b.payload);
  const lines = res.ops;
  if (res.wide) sink.notes.push({ code: 'wide', before: res.wide.before, after: res.wide.after });
  if (!identical) {
    // Text keeps its detail in the line list, but the summary counts still come from the
    // field list so one rendering path can report "3 added, 1 removed" for either kind.
    for (const op of lines) {
      if (op.type === 'added') sink.push('(line)', 'added', undefined, op.text);
      else if (op.type === 'removed') sink.push('(line)', 'removed', op.text, undefined);
    }
  }
  return finish('text', identical, sink, lines, unreliable);
}

function finish(kind: DiffKind, identical: boolean, sink: ChangeSink, lines: LineOp[], unreliable: boolean): MessageDiff {
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const f of sink.fields) counts[f.type] += 1;
  return { kind, identical, fields: sink.fields, lines, notes: sink.notes, unreliable, counts };
}

/** Differences in how the two messages were carried, kept apart from payload deltas. */
export function diffMetadata(a: DiffableRow, b: DiffableRow): { fields: FieldChange[]; gapMs: number } {
  const sink = new ChangeSink();
  const cmp = (label: string, av: unknown, bv: unknown): void => {
    if (av !== bv) sink.push(label, 'changed', av ?? '', bv ?? '');
  };
  cmp('topic', a.topic, b.topic);
  cmp('direction', a.direction, b.direction);
  cmp('qos', `Q${a.qos}`, `Q${b.qos}`);
  cmp('retain', a.retain, b.retain);
  cmp('contentType', a.contentType ?? '', b.contentType ?? '');
  cmp('payloadLen', a.payloadLen, b.payloadLen);
  return { fields: sink.fields, gapMs: Math.abs(a.ts - b.ts) };
}
