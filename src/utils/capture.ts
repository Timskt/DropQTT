import { HistoryRow } from '../types';

/**
 * Session capture: a replayable recording of real traffic.
 *
 * The field problem this exists for is "the gateway misbehaved for one minute at the
 * customer site". History already stores every field needed to reproduce that —
 * topic, payload bytes, QoS, retain, direction, the v5 properties and a timestamp per
 * row — so a capture is an export of those rows in a form the app can also read back
 * and publish again, with the gaps between events preserved.
 *
 * Deliberately **not** stored: the broker address or anything about credentials. A
 * capture file gets attached to tickets and pasted into chat; the topics and timings
 * are what reproduces the bug, and the address is what gets someone's production host
 * into a file that leaves the building.
 *
 * The container is JSON Lines — a header object then one event per line — so a long
 * recording stays parseable, diffs readably, and a truncated tail is still a valid
 * prefix rather than a corrupt file.
 */

export const CAPTURE_FORMAT = 'dropqtt-capture/1';
export const CAPTURE_EXTENSION = 'dqrec';

export interface CaptureProperties {
  contentType?: string | null;
  responseTopic?: string | null;
  /** Text form, when the bytes were valid UTF-8. */
  correlationData?: string | null;
  /** Hex of the raw bytes, when they were not. Both are kept so a replay is byte-exact. */
  correlationHex?: string | null;
  payloadFormat?: number | null;
  messageExpiry?: number | null;
  userProperties?: Array<[string, string]>;
}

export interface CaptureEvent {
  /** Milliseconds since the first event — what a paced replay waits on. */
  t: number;
  /** Absolute wall clock, so two captures can be lined up against a log. */
  ts: number;
  topic: string;
  payloadBase64: string;
  payloadLen: number;
  qos: number;
  retain: boolean;
  direction: 'in' | 'out';
  props?: CaptureProperties;
}

export interface CaptureHeader {
  kind: 'header';
  format: string;
  createdAt: string;
  /** What the recorder was looking at, e.g. the topic filter of the window. */
  filter?: string;
  /** Free text the user types. Never generated from the broker address. */
  note?: string;
  count: number;
  spanMs: number;
  inbound: number;
  outbound: number;
  topics: string[];
}

export interface CaptureFile {
  header: CaptureHeader;
  events: CaptureEvent[];
}

export interface BuildCaptureOptions {
  filter?: string;
  note?: string;
  /** ISO timestamp; injected so the unit test can pin the whole file's bytes. */
  createdAt?: string;
}

const hasProps = (p: CaptureProperties): boolean =>
  Boolean(
    p.contentType ||
      p.responseTopic ||
      p.correlationData ||
      p.correlationHex ||
      p.payloadFormat !== null && p.payloadFormat !== undefined ||
      p.messageExpiry !== null && p.messageExpiry !== undefined ||
      (p.userProperties && p.userProperties.length > 0),
  );

const propsOf = (row: HistoryRow): CaptureProperties | undefined => {
  const p = row.properties ?? {};
  const out: CaptureProperties = {
    contentType: p.contentType ?? null,
    responseTopic: p.responseTopic ?? null,
    correlationData: p.correlationData ?? null,
    correlationHex: p.correlationHex ?? null,
    payloadFormat: p.payloadFormat ?? null,
    messageExpiry: p.messageExpiry ?? null,
    userProperties: p.userProperties ?? [],
  };
  return hasProps(out) ? out : undefined;
};

/**
 * Rows in, file out. The caller passes what the current search returned, so a capture
 * is "what I was looking at" rather than "everything in the database".
 */
export function buildCapture(rows: HistoryRow[], opts: BuildCaptureOptions = {}): string {
  const ordered = [...rows].sort((a, b) => a.ts - b.ts);
  const first = ordered[0]?.ts ?? 0;
  const events: CaptureEvent[] = ordered.map((row) => ({
    t: Math.max(0, row.ts - first),
    ts: row.ts,
    topic: row.topic,
    payloadBase64: row.payloadBase64,
    payloadLen: row.payloadLen,
    qos: row.qos,
    retain: row.retain,
    direction: row.direction === 'out' ? 'out' : 'in',
    ...(propsOf(row) ? { props: propsOf(row) } : {}),
  }));
  const header: CaptureHeader = {
    kind: 'header',
    format: CAPTURE_FORMAT,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    ...(opts.filter ? { filter: opts.filter } : {}),
    ...(opts.note ? { note: opts.note } : {}),
    count: events.length,
    spanMs: events.length ? events[events.length - 1].t : 0,
    inbound: events.filter((e) => e.direction === 'in').length,
    outbound: events.filter((e) => e.direction === 'out').length,
    topics: [...new Set(events.map((e) => e.topic))].sort(),
  };
  return [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))].join('\n') + '\n';
}

export class CaptureError extends Error {}

/**
 * Parse with a reason for every rejection. A capture arrives from a ticket, and
 * "invalid file" is not enough to tell the sender what to resend.
 */
export function parseCapture(text: string): CaptureFile {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new CaptureError('the file is empty');
  let header: CaptureHeader;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    throw new CaptureError('the first line is not a capture header — is this a .dqrec file?');
  }
  if (header?.kind !== 'header') throw new CaptureError('no capture header on the first line');
  if (header.format !== CAPTURE_FORMAT) {
    throw new CaptureError(`written by another format ("${String(header.format ?? 'none')}"); this build reads ${CAPTURE_FORMAT}`);
  }
  const events: CaptureEvent[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    let raw: unknown;
    try {
      raw = JSON.parse(lines[i]);
    } catch {
      // A cut-off tail is the common case: the file was copied while still growing.
      throw new CaptureError(`event on line ${i + 1} is not complete JSON`);
    }
    const e = raw as Partial<CaptureEvent>;
    if (typeof e?.topic !== 'string' || e.topic.length === 0) {
      throw new CaptureError(`event on line ${i + 1} has no topic`);
    }
    if (typeof e.payloadBase64 !== 'string') {
      throw new CaptureError(`event on line ${i + 1} (${e.topic}) has no payload`);
    }
    events.push({
      t: Number.isFinite(e.t) ? Math.max(0, Number(e.t)) : 0,
      ts: Number.isFinite(e.ts) ? Number(e.ts) : 0,
      topic: e.topic,
      payloadBase64: e.payloadBase64,
      payloadLen: Number.isFinite(e.payloadLen) ? Number(e.payloadLen) : 0,
      qos: Math.min(2, Math.max(0, Number(e.qos) || 0)),
      retain: Boolean(e.retain),
      direction: e.direction === 'out' ? 'out' : 'in',
      props: e.props,
    });
  }
  if (events.length === 0) throw new CaptureError('the header is fine but the capture holds no events');
  return { header, events };
}

export interface CaptureSummary {
  count: number;
  spanMs: number;
  inbound: number;
  outbound: number;
  topics: number;
  /** Events whose gap exceeds this — the difference between a replay and a flood. */
  maxGapMs: number;
  withResponseTopic: number;
  withCorrelation: number;
}

export function summarizeCapture(events: CaptureEvent[]): CaptureSummary {
  let inbound = 0;
  let outbound = 0;
  let maxGapMs = 0;
  let withResponseTopic = 0;
  let withCorrelation = 0;
  const topics = new Set<string>();
  events.forEach((e, i) => {
    if (e.direction === 'in') inbound += 1;
    else outbound += 1;
    topics.add(e.topic);
    if (i > 0) maxGapMs = Math.max(maxGapMs, e.t - events[i - 1].t);
    if (e.props?.responseTopic) withResponseTopic += 1;
    if (e.props?.correlationData || e.props?.correlationHex) withCorrelation += 1;
  });
  return {
    count: events.length,
    spanMs: events.length ? events[events.length - 1].t : 0,
    inbound,
    outbound,
    topics: topics.size,
    maxGapMs,
    withResponseTopic,
    withCorrelation,
  };
}

/**
 * A replay that keeps the original gaps can stall for minutes on one quiet device, so
 * the ceiling matters as much as the multiplier.
 */
export const paceFor = (events: CaptureEvent[], speed: number, capMs: number): number[] => {
  const s = Math.max(0.1, speed);
  const cap = Math.max(0, capMs);
  return events.map((e, i) => {
    const gap = i === 0 ? 0 : Math.max(0, e.t - events[i - 1].t);
    const scaled = gap / s;
    return cap > 0 ? Math.min(scaled, cap) : scaled;
  });
};
