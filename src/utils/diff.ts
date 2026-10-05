import { MqttGenericMessage } from '../types';
import { uint8ToUtf8 } from './cbor';

/** One compared field. `same` is what the UI colours on. */
export interface DiffField {
  field: string;
  left: string;
  right: string;
  same: boolean;
}

export interface DiffLine {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

const textOf = (m: MqttGenericMessage): string => {
  try {
    const bytes = Uint8Array.from(atob(m.payloadBase64 ?? ''), (c) => c.charCodeAt(0));
    return uint8ToUtf8(bytes);
  } catch {
    return '';
  }
};

const shown = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '—';
  return String(v);
};

/** Field-level comparison of two feed rows, in the order a person reads them. */
export function diffFields(
  a: MqttGenericMessage,
  b: MqttGenericMessage,
  labels: {
    topic: string;
    direction: string;
    qos: string;
    retain: string;
    contentType: string;
    payloadFormat: string;
    responseTopic: string;
    correlation: string;
    userProperties: string;
    payload: string;
  },
): DiffField[] {
  const props = (m: MqttGenericMessage) =>
    (m.userProperties ?? []).map(([k, v]) => `${k}=${v}`).join(', ');
  // Labelled because the two forms are different claims: text "ff00" and the
  // bytes 0xFF 0x00 shown as hex must not compare equal here.
  const corr = (m: MqttGenericMessage) =>
    m.correlationData ?? (m.correlationHex ? `hex:${m.correlationHex}` : '');
  const rows: [string, unknown, unknown][] = [
    [labels.topic, a.topic, b.topic],
    [labels.direction, a.direction, b.direction],
    [labels.qos, a.qos, b.qos],
    [labels.retain, a.retain ? '1' : '0', b.retain ? '1' : '0'],
    [labels.contentType, a.contentType ?? '', b.contentType ?? ''],
    [labels.payloadFormat, a.payloadFormat ?? '', b.payloadFormat ?? ''],
    [labels.responseTopic, a.responseTopic ?? '', b.responseTopic ?? ''],
    [labels.correlation, corr(a), corr(b)],
    [labels.userProperties, props(a), props(b)],
  ];
  const out: DiffField[] = rows.map(([field, l, r]) => ({
    field,
    left: shown(l),
    right: shown(r),
    same: String(l) === String(r),
  }));
  const lt = textOf(a);
  const rt = textOf(b);
  out.push({ field: labels.payload, left: lt, right: rt, same: lt === rt });
  return out;
}

/** Cap on the line diff: beyond it we say the payloads differ without pretending
 *  to have aligned them. */
const MAX_DIFF_LINES = 300;

/**
 * Line diff by longest common subsequence, bounded by `MAX_DIFF_LINES`.
 *
 * The bound matters: two 64 KB truncated payloads would otherwise be an
 * 400x400 DP on the UI thread. When either side is longer than the cap we return
 * null and the caller shows the two blobs instead of a fabricated alignment.
 */
export function diffLines(left: string, right: string): DiffLine[] | null {
  const l = left.split('\n');
  const r = right.split('\n');
  if (l.length > MAX_DIFF_LINES || r.length > MAX_DIFF_LINES) return null;

  // DP table of suffix lengths; sizes are bounded above, so this stays cheap.
  const table: number[][] = Array.from({ length: l.length + 1 }, () =>
    new Array(r.length + 1).fill(0),
  );
  for (let i = l.length - 1; i >= 0; i -= 1) {
    for (let j = r.length - 1; j >= 0; j -= 1) {
      table[i][j] = l[i] === r[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < l.length && j < r.length) {
    if (l[i] === r[j]) {
      out.push({ kind: 'same', text: l[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ kind: 'removed', text: l[i] });
      i += 1;
    } else {
      out.push({ kind: 'added', text: r[j] });
      j += 1;
    }
  }
  while (i < l.length) out.push({ kind: 'removed', text: l[i++] });
  while (j < r.length) out.push({ kind: 'added', text: r[j++] });
  return out;
}
