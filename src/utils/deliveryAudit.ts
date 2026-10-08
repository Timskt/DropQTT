/**
 * Delivery audit over stored messages.
 *
 * Answers "did everything arrive, in order, exactly once, and how long did it take" for a
 * topic whose publisher stamps a sequence number into the payload. This is the question
 * behind "the dashboard looks fine but the plant says it sent 4,000 packets".
 *
 * The attribution rule matters more than the arithmetic. A hole in the sequence proves the
 * stored history is missing a message. It does not prove the broker dropped it: our own
 * retention prune, an overload drop, or the device never having sent it all look identical
 * from here. So the report says "not in what we have" and names what would be needed to
 * say more -- which is exactly the discipline this project holds itself to elsewhere.
 */

export interface SeqSample {
  ts: number;
  topic: string;
  seq: number;
  /** Send timestamp carried in the payload, when a time path was given. */
  sentAt?: number;
  latencyMs?: number;
}

export interface DuplicateGroup {
  seq: number;
  count: number;
  firstTs: number;
  lastTs: number;
}

export interface DeliveryAudit {
  topic: string;
  rowsScanned: number;
  /** Samples that yielded a usable integer sequence number. */
  usable: number;
  unusable: number;
  truncated: number;
  /**
   * Unusable rows that fall inside the observed time span. A hole in the sequence next to
   * one of these is not evidence the message never arrived -- it may well be the row whose
   * payload we could not read. Surfacing the count is what keeps "missing" from becoming an
   * accusation the data cannot support.
   */
  unusableInSpan: number;
  firstSeq: number | null;
  lastSeq: number | null;
  /** Sequence numbers inside the observed span that are not in what we have. */
  missing: number[];
  missingCount: number;
  expectedCount: number | null;
  duplicates: DuplicateGroup[];
  /** Messages whose sequence was lower than one already seen on this topic. */
  outOfOrder: number;
  /** Largest forward jump in observed sequence numbers. */
  maxJump: number | null;
  latency: {
    measurable: boolean;
    /** Why measurement is impossible, when it is: no time path, or no usable values. */
    reason: 'noTimePath' | 'noSamples' | null;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
    /** Negative values mean the two clocks disagree, which is not a latency to average. */
    clockSkew: number;
    samples: number;
  };
}

export interface AuditOptions {
  /** Path to the integer sequence number, e.g. `seq` or `meta.n`. */
  seqPath: string;
  /** Optional path to the publisher's own send timestamp in epoch milliseconds. */
  timePath?: string;
  /** How many missing sequence numbers to enumerate before falling back to a count. */
  listCap?: number;
}

interface HistoryLike {
  ts: number;
  topic: string;
  payload: string;
  truncated: boolean;
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

/** Resolve a dotted/bracketed path. Returns undefined for anything that is not there. */
const atPath = (doc: unknown, path: string): unknown => {
  let cur = doc;
  for (const part of path.split('.')) {
    if (!part) return undefined;
    const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!m) return undefined;
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[m[1]];
    const idx = m[2] ? Array.from(m[2].matchAll(/\[(\d+)\]/g)) : [];
    for (const i of idx) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(i[1])];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
};

const percentile = (sorted: number[], q: number): number | null => {
  if (!sorted.length) return null;
  const pos = Math.min(sorted.length - 1, Math.max(0, Math.round((q / 100) * (sorted.length - 1))));
  return sorted[pos];
};

function auditOne(topic: string, rows: HistoryLike[], opts: AuditOptions): DeliveryAudit {
  const listCap = opts.listCap ?? 200;
  const samples: SeqSample[] = [];
  const unusableTs: number[] = [];
  let unusable = 0;
  let truncated = 0;

  for (const r of rows) {
    if (r.truncated) {
      truncated += 1;
      unusable += 1;
      unusableTs.push(r.ts);
      continue;
    }
    const doc = parseJson(r.payload);
    if (doc === undefined) {
      unusable += 1;
      unusableTs.push(r.ts);
      continue;
    }
    const rawSeq = atPath(doc, opts.seqPath);
    // Strings are not sequence numbers: accepting "7" alongside 7 would make a publisher
    // that changed its encoding look like it had duplicated a packet.
    if (typeof rawSeq !== 'number' || !Number.isInteger(rawSeq)) {
      unusable += 1;
      unusableTs.push(r.ts);
      continue;
    }
    const s: SeqSample = { ts: r.ts, topic, seq: rawSeq };
    if (opts.timePath) {
      const rawTime = atPath(doc, opts.timePath);
      if (typeof rawTime === 'number' && Number.isFinite(rawTime)) {
        s.sentAt = rawTime;
        s.latencyMs = r.ts - rawTime;
      }
    }
    samples.push(s);
  }

  samples.sort((a, b) => a.ts - b.ts);

  const bySeq = new Map<number, SeqSample[]>();
  for (const s of samples) {
    const list = bySeq.get(s.seq);
    if (list) list.push(s);
    else bySeq.set(s.seq, [s]);
  }

  const uniq = Array.from(bySeq.keys()).sort((a, b) => a - b);
  const firstSeq = uniq.length ? uniq[0] : null;
  const lastSeq = uniq.length ? uniq[uniq.length - 1] : null;

  const missing: number[] = [];
  let missingCount = 0;
  if (firstSeq !== null && lastSeq !== null) {
    for (let n = firstSeq; n <= lastSeq; n++) {
      if (!bySeq.has(n)) {
        missingCount += 1;
        if (missing.length < listCap) missing.push(n);
      }
    }
  }
  const expectedCount = firstSeq !== null && lastSeq !== null ? lastSeq - firstSeq + 1 : null;

  const duplicates: DuplicateGroup[] = Array.from(bySeq.entries())
    .filter(([, list]) => list.length > 1)
    .map(([seq, list]) => ({ seq, count: list.length, firstTs: list[0].ts, lastTs: list[list.length - 1].ts }))
    .sort((a, b) => b.count - a.count);

  let outOfOrder = 0;
  let high = -Infinity;
  for (const s of samples) {
    if (s.seq < high) outOfOrder += 1;
    else high = s.seq;
  }

  let maxJump: number | null = null;
  for (let i = 1; i < uniq.length; i++) {
    const jump = uniq[i] - uniq[i - 1];
    if (maxJump === null || jump > maxJump) maxJump = jump;
  }

  const latencies: number[] = [];
  let clockSkew = 0;
  for (const s of samples) {
    if (s.latencyMs === undefined) continue;
    if (s.latencyMs < 0) {
      clockSkew += 1;
      continue;
    }
    latencies.push(s.latencyMs);
  }
  latencies.sort((a, b) => a - b);

  const reason: 'noTimePath' | 'noSamples' | null = !opts.timePath ? 'noTimePath' : latencies.length ? null : 'noSamples';

  const spanFrom = samples.length ? samples[0].ts : 0;
  const spanTo = samples.length ? samples[samples.length - 1].ts : 0;
  const unusableInSpan = unusableTs.filter((t) => t >= spanFrom && t <= spanTo).length;

  return {
    topic,
    rowsScanned: rows.length,
    usable: samples.length,
    unusable,
    truncated,
    unusableInSpan,
    firstSeq,
    lastSeq,
    missing,
    missingCount,
    expectedCount,
    duplicates,
    outOfOrder,
    maxJump,
    latency: {
      measurable: reason === null,
      reason,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      maxMs: latencies.length ? latencies[latencies.length - 1] : null,
      clockSkew,
      samples: latencies.length,
    },
  };
}

/** Audit every topic present in the rows, so a filtered search is audited per device. */
export function auditDelivery(rows: HistoryLike[], opts: AuditOptions): DeliveryAudit[] {
  if (!opts.seqPath.trim()) return [];
  const groups = new Map<string, HistoryLike[]>();
  for (const r of rows) {
    const list = groups.get(r.topic);
    if (list) list.push(r);
    else groups.set(r.topic, [r]);
  }
  return Array.from(groups.entries())
    .map(([topic, list]) => auditOne(topic, list, { ...opts, seqPath: opts.seqPath.trim(), timePath: opts.timePath?.trim() || undefined }))
    .sort((a, b) => b.usable - a.usable || a.topic.localeCompare(b.topic));
}

/** How much of the observed span we actually hold. Null when nothing usable was found. */
export function coverageOf(a: DeliveryAudit): number | null {
  return a.expectedCount === null || a.expectedCount === 0 ? null : a.usable / a.expectedCount;
}
