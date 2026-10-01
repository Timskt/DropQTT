import type { HistoryRow, HistorySeriesPoint, MqttGenericMessage } from '../types';
import { base64ToUint8, cborToDisplayJson, decodeCbor, uint8ToHexDump, uint8ToUtf8 } from './cbor';
import { parseSenmlPack, senmlFromDecoded, senmlToTable } from './senml';

export type HistoryView = 'text' | 'json' | 'senml' | 'hex' | 'base64' | 'cbor';

export function historyPayload(row: HistoryRow, view: HistoryView): string {
  if (view === 'base64') return row.payloadBase64;
  const bytes = base64ToUint8(row.payloadBase64);
  if (view === 'hex') return uint8ToHexDump(bytes);
  if (view === 'cbor') return cborToDisplayJson(decodeCbor(bytes));
  if (view === 'senml') {
    // The stored content type tells us which SenML encoding the device used.
    const ct = (row.contentType ?? row.properties?.contentType ?? '').toLowerCase();
    return senmlToTable(ct.includes('cbor') ? senmlFromDecoded(decodeCbor(bytes)) : parseSenmlPack(JSON.parse(uint8ToUtf8(bytes))));
  }
  const text = uint8ToUtf8(bytes);
  if (view === 'json') return JSON.stringify(JSON.parse(text), null, 2);
  return text;
}

/** Check the stored bytes as well as the flag, including captures from older versions. */
export function canReplayHistory(row: HistoryRow): boolean {
  if (row.truncated) return false;
  try {
    return base64ToUint8(row.payloadBase64).length === row.payloadLen;
  } catch {
    return false;
  }
}

export function historyMessage(row: HistoryRow): MqttGenericMessage {
  return {
    ...row,
    contentType: row.contentType ?? row.properties?.contentType,
    userProperties: row.properties?.userProperties ?? [],
    responseTopic: row.properties?.responseTopic,
    correlationData: row.properties?.correlationData,
    truncated: !canReplayHistory(row),
    timestamp: new Date(row.ts).toISOString(),
    timestampMs: row.ts,
    direction: row.direction === 'out' ? 'out' : 'in',
  };
}

/** Include quiet buckets so time gaps are not compressed into continuous traffic. */
export function fillHistorySeries(points: HistorySeriesPoint[], since: number, until: number, bucketMs: number): HistorySeriesPoint[] {
  if (until < since || bucketMs < 1000) return [];
  const counts = new Map(points.map((p) => [p.bucket, p.count]));
  const filled: HistorySeriesPoint[] = [];
  for (let bucket = Math.floor(since / bucketMs) * bucketMs; bucket <= until; bucket += bucketMs) {
    filled.push({ bucket, count: counts.get(bucket) ?? 0 });
  }
  return filled;
}
