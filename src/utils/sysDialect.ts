import { SysRow } from '../types';

/**
 * Broker `$SYS` layouts.
 *
 * The panel used to pick metrics by substring-guessing (`topic.includes('received')`),
 * which quietly matched the wrong row and matched nothing on a broker with a
 * different tree. A layout is now an explicit named table, and a broker we have no
 * verified table for is reported as such instead of rendering an empty panel.
 *
 * Mosquitto's entries were captured from a real 2.0.15 broker on this machine
 * (`mosquitto_sub -t '$SYS/#'`, 38 topics) rather than from documentation. The
 * other vendors are deliberately absent: without a broker to read, a guessed table
 * would be the same failure with more confidence on it.
 */
export type SysMetricId =
  | 'version'
  | 'uptime'
  | 'connections'
  | 'msgReceived'
  | 'msgSent'
  | 'load1min'
  | 'retained'
  | 'subscriptions'
  | 'bytesReceived'
  | 'bytesSent';

export interface SysDialect {
  name: string;
  /** Topics (normalized) whose presence claims this layout. */
  signature: string[];
  metrics: Record<SysMetricId, string>;
}

/** Normalize once: drop the `$SYS/` prefix and case, since brokers differ there. */
export const normalizeSysTopic = (topic: string): string =>
  topic
    .replace(/^\$SYS\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();

export const MOSQUITTO: SysDialect = {
  name: 'Mosquitto',
  signature: ['broker/version', 'broker/clients/connected', 'broker/load/connections/1min'],
  metrics: {
    version: 'broker/version',
    uptime: 'broker/uptime',
    connections: 'broker/clients/connected',
    msgReceived: 'broker/messages/received',
    msgSent: 'broker/messages/sent',
    load1min: 'broker/load/messages/received/1min',
    retained: 'broker/retained messages/count',
    subscriptions: 'broker/subscriptions/count',
    bytesReceived: 'broker/bytes/received',
    bytesSent: 'broker/bytes/sent',
  },
};

export const DIALECTS: SysDialect[] = [MOSQUITTO];

/**
 * Claim a layout only on real evidence: at least two signature topics must be
 * present, so a broker that happens to publish one `/version` row is not
 * mislabelled.
 */
export function detectDialect(rows: SysRow[]): SysDialect | null {
  const have = new Set(rows.map((r) => normalizeSysTopic(r.topic)));
  let best: { dialect: SysDialect; hits: number } | null = null;
  for (const dialect of DIALECTS) {
    const hits = dialect.signature.filter((s) => have.has(s)).length;
    if (hits >= 2 && (!best || hits > best.hits)) best = { dialect, hits };
  }
  return best?.dialect ?? null;
}

/** Metric rows in display order; anything the broker does not publish is skipped. */
export function pickMetrics(
  rows: SysRow[],
  dialect: SysDialect | null,
): { id: SysMetricId; row: SysRow }[] {
  if (!dialect) return [];
  const byTopic = new Map(rows.map((r) => [normalizeSysTopic(r.topic), r]));
  const out: { id: SysMetricId; row: SysRow }[] = [];
  const order: SysMetricId[] = [
    'version',
    'uptime',
    'connections',
    'msgReceived',
    'msgSent',
    'load1min',
    'retained',
    'subscriptions',
    'bytesReceived',
    'bytesSent',
  ];
  for (const id of order) {
    const row = byTopic.get(dialect.metrics[id]);
    if (row) out.push({ id, row });
  }
  return out;
}

/** Vendor name from the version row, or '' when nothing identifies it. */
const VENDORS: [RegExp, string][] = [
  [/mosquitto/i, 'Mosquitto'],
  [/emqx/i, 'EMQX'],
  [/hivemq/i, 'HiveMQ'],
  [/verne/i, 'VerneMQ'],
  [/nanomq|rsmb/i, 'NanoMQ'],
];

export function detectVendor(rows: SysRow[]): string {
  const version = (rows.find((r) => normalizeSysTopic(r.topic).endsWith('version'))?.value ?? '').trim();
  if (!version) return '';
  for (const [pattern, name] of VENDORS) {
    if (pattern.test(version)) return name;
  }
  // An unknown broker still gets the first word of what it said about itself,
  // rather than a name we invented.
  return version.split(/\s+/)[0];
}
