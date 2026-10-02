/**
 * SenML (RFC 8428) reader — the telemetry format IoT devices actually ship,
 * and the one generic MQTT clients still render as undifferentiated JSON.
 *
 * Accepts both encodings: JSON with string labels, and CBOR whose labels are
 * the signed integers from RFC 8428 §3.1 (our CBOR decoder already stringifies
 * integer map keys, so both arrive as `{ "-2": … }` or `{ "bn": … }`).
 */

import { uint8ToBase64 } from './cbor';

export type SenmlValueKind = 'number' | 'string' | 'boolean' | 'binary' | 'sum';

export interface SenmlReading {
  /** Resolved full name: base name + record name. */
  name: string;
  unit?: string;
  kind: SenmlValueKind;
  /** Ready to render; binary is base64, numbers keep full precision. */
  display: string;
  numeric?: number;
  /** Integrated sum, when the record carries `s`. */
  sum?: number;
  /** Absolute epoch milliseconds, resolved from base time + record time. */
  timeMs: number;
  /** Max update interval in seconds, when the record declares `ut`. */
  updateIntervalSec?: number;
}

export interface SenmlResult {
  readings: SenmlReading[];
  /** Spec violations that did not prevent a best-effort decode. */
  warnings: string[];
}

const CBOR_LABELS: Record<string, string> = {
  '-1': 'bver', '-2': 'bn', '-3': 'bt', '-4': 'bu', '-5': 'bv', '-6': 'bs',
  '0': 'n', '1': 'u', '2': 'v', '3': 'vs', '4': 'vb', '5': 's', '6': 't', '7': 'ut', '8': 'vd',
};

const BASE_LABELS = ['bver', 'bn', 'bt', 'bu', 'bv', 'bs'];
const KNOWN = new Set([...BASE_LABELS, 'n', 'u', 'v', 'vs', 'vb', 'vd', 's', 't', 'ut']);

/** RFC 8428 §3: a time value at or above 2^28 is absolute POSIX epoch seconds. */
const ABSOLUTE_EPOCH_THRESHOLD = 2 ** 28;
/** Highest SenML version this reader understands. */
const SUPPORTED_VERSION = 2;

const isRecordLike = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Map CBOR integer labels back onto their RFC 8428 names. */
function normalizeRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[CBOR_LABELS[key] ?? key] = value;
  }
  return out;
}

export function looksLikeSenml(value: unknown): boolean {
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0 || items.length > 200) return false;
  let matched = 0;
  for (const item of items) {
    if (!isRecordLike(item)) return false;
    const rec = normalizeRecord(item);
    const keys = Object.keys(rec);
    if (keys.length === 0) return false;
    // Every key must be a SenML label (or an extension that does not end in '_').
    const recognised = keys.filter((k) => KNOWN.has(k) || BASE_LABELS.includes(k));
    if (recognised.length === 0) return false;
    const hasValue = ['v', 'vs', 'vb', 'vd', 's'].some((k) => k in rec);
    const hasIdentity = ['n', 'bn', 'u', 't', 'bt'].some((k) => k in rec);
    if (hasValue && hasIdentity) matched += 1;
  }
  return matched > 0;
}

function resolveTimeMs(baseTimeSec: number, recordTime: unknown): number {
  let offsetSec = 0;
  if (typeof recordTime === 'number') {
    // A record time above the threshold is itself absolute; convert to an offset.
    offsetSec = Math.abs(recordTime) >= ABSOLUTE_EPOCH_THRESHOLD ? recordTime - baseTimeSec : recordTime;
  }
  return Math.round((baseTimeSec + offsetSec) * 1000);
}

function joinName(base: string, local: unknown): string {
  const n = typeof local === 'string' ? local : '';
  if (!base) return n;
  if (!n) return base;
  // RFC 8428 §2: a base name ending in '/' concatenates directly.
  return base.endsWith('/') ? base + n : base + n;
}

const NAME_SAFE = /^[A-Za-z0-9][A-Za-z0-9\-:./_]*$/;

/** Parse a SenML pack into flat readings, or throw on unusable input. */
export function parseSenmlPack(value: unknown, nowMs = Date.now()): SenmlResult {
  const items = Array.isArray(value) ? value : [value];
  if (!isRecordLike(items[0])) throw new Error('SenML: pack is not an object or array of records');

  const warnings: string[] = [];
  let baseName = '';
  let baseUnit: string | undefined;
  let baseTimeSec = nowMs / 1000;
  let baseValue = 0;
  let packVersion: number | undefined;

  const readings: SenmlReading[] = [];

  for (const [index, raw] of items.entries()) {
    if (!isRecordLike(raw)) {
      warnings.push(`record ${index}: not an object, skipped`);
      continue;
    }
    const rec = normalizeRecord(raw);

    // Unknown labels are ignored, except ones ending in '_': those mean the
    // sender used a critical extension we do not implement.
    for (const key of Object.keys(rec)) {
      if (!KNOWN.has(key)) {
        if (key.endsWith('_')) throw new Error(`SenML: unsupported critical label "${key}"`);
        warnings.push(`record ${index}: ignored unknown label "${key}"`);
      }
    }

    if (typeof rec.bver === 'number') {
      if (packVersion === undefined) packVersion = rec.bver;
      else if (packVersion !== rec.bver) throw new Error('SenML: mixed bver in one pack');
      if (rec.bver > SUPPORTED_VERSION) {
        throw new Error(`SenML: pack version ${rec.bver} exceeds supported ${SUPPORTED_VERSION}`);
      }
    }

    // Base fields apply to this record and every one after it.
    if (typeof rec.bn === 'string') baseName = rec.bn;
    if (typeof rec.bu === 'string') baseUnit = rec.bu;
    if (typeof rec.bv === 'number') baseValue = rec.bv;
    if (typeof rec.bt === 'number') {
      baseTimeSec = Math.abs(rec.bt) >= ABSOLUTE_EPOCH_THRESHOLD ? rec.bt : nowMs / 1000 + rec.bt;
    }

    const primaries = (['v', 'vs', 'vb', 'vd'] as const).filter((k) => k in rec);
    const hasSum = typeof rec.s === 'number';
    if (primaries.length === 0 && !hasSum) {
      // A record that only redefines base values is legal; one with nothing is not.
      const onlyBase = Object.keys(rec).every((k) => BASE_LABELS.includes(k));
      if (!onlyBase) {
        warnings.push(`record ${index}: no value and no sum, skipped`);
        continue;
      }
    }
    if (primaries.length > 1) warnings.push(`record ${index}: more than one primary value`);

    const name = joinName(baseName, rec.n);
    if (name && !NAME_SAFE.test(name)) warnings.push(`record ${index}: name "${name}" is not URI-safe`);

    const timeMs = resolveTimeMs(baseTimeSec, rec.t);
    const unit = typeof rec.u === 'string' ? rec.u : baseUnit;
    const updateIntervalSec = typeof rec.ut === 'number' ? rec.ut : undefined;

    if (hasSum) readings.push({ name, unit, kind: 'sum', display: String(rec.s), sum: rec.s as number, timeMs, updateIntervalSec });

    for (const key of primaries) {
      const rawValue = rec[key];
      if (key === 'v' && typeof rawValue === 'number') {
        const value = baseValue + rawValue;
        readings.push({ name, unit, kind: 'number', display: String(value), numeric: value, timeMs, updateIntervalSec });
      } else if (key === 'vs' && typeof rawValue === 'string') {
        readings.push({ name, unit, kind: 'string', display: rawValue, timeMs, updateIntervalSec });
      } else if (key === 'vb') {
        readings.push({ name, unit, kind: 'boolean', display: String(Boolean(rawValue)), timeMs, updateIntervalSec });
      } else if (key === 'vd' && rawValue instanceof Uint8Array) {
        readings.push({ name, unit, kind: 'binary', display: uint8ToBase64(rawValue), timeMs, updateIntervalSec });
      } else if (key === 'vd') {
        warnings.push(`record ${index}: vd is not a byte string`);
      }
    }
  }

  return { readings, warnings };
}

/** Render readings as a fixed-width table so units line up while scanning. */
export function senmlToTable(result: SenmlResult): string {
  const lines: string[] = [];
  if (result.readings.length === 0) return '(no SenML readings)';
  const nameWidth = Math.min(48, Math.max(...result.readings.map((r) => r.name.length), 4));
  for (const r of result.readings) {
    const name = (r.name || '(unnamed)').padEnd(nameWidth);
    // RFC 8428 §4: a unit describes a measurement, so it is only meaningful on
    // numeric readings. `bu` is inherited by every later record, which would
    // otherwise print "Cel" next to a boolean and mislead the reader.
    const unit = r.kind === 'number' || r.kind === 'sum' ? (r.unit ?? '').padEnd(6) : ''.padEnd(6);
    const value = r.kind === 'number' ? r.display : `${r.display}`;
    const when = new Date(r.timeMs).toISOString().replace('T', ' ').slice(0, 23);
    const tag = r.kind === 'sum' ? 'sum' : r.kind === 'number' ? '' : r.kind;
    lines.push(`${name} ${unit}${value}${tag ? ` <${tag}>` : ''}  ${when}`);
  }
  if (result.warnings.length) lines.push('', `warnings: ${result.warnings.join('; ')}`);
  return lines.join('\n');
}

/** Convenience: unwrap a CBOR SenML pack, which our decoder tags as `__tag`. */
export function senmlFromDecoded(decoded: unknown): SenmlResult {
  const inner = decoded && typeof decoded === 'object' && '__tag' in decoded
    ? (decoded as unknown as { value: unknown }).value
    : decoded;
  return parseSenmlPack(inner);
}
