import type { HistoryRow, HistorySeriesPoint, MqttGenericMessage, TraceResult } from '../types';import { base64ToUint8, cborToDisplayJson, decodeCbor, uint8ToHexDump, uint8ToUtf8 } from './cbor';
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

/**
 * A trace as one portable file. Whoever receives it has to be able to read the
 * story without this app open, so each hop keeps the reason it is in the list
 * alongside both renderings of its payload: `payload` is what the bytes say as
 * text, `payloadBase64` is what they actually were.
 */
export function buildTraceExport(
  token: string,
  windowLabel: string,
  window: { sinceMs: number; untilMs: number },
  result: TraceResult,
  exportedAt: string,
): string {
  return JSON.stringify(
    {
      kind: 'dropqtt-trace',
      version: 1,
      token,
      window: { label: windowLabel, sinceMs: window.sinceMs, untilMs: window.untilMs },
      exportedAt,
      summary: result.summary,
      hops: result.hits.map((hit) => ({
        ts: hit.ts,
        iso: new Date(hit.ts).toISOString(),
        direction: hit.direction,
        topic: hit.topic,
        qos: hit.qos,
        retain: hit.retain,
        matchedBy: hit.matchedBy,
        truncated: hit.truncated,
        payloadLen: hit.payloadLen,
        payload: hit.payload,
        payloadBase64: hit.payloadBase64,
        contentType: hit.contentType ?? hit.properties?.contentType ?? null,
        responseTopic: hit.properties?.responseTopic ?? null,
        correlationData: hit.properties?.correlationData ?? null,
        correlationHex: hit.properties?.correlationHex ?? null,
        userProperties: hit.properties?.userProperties ?? [],
      })),
    },
    null,
    2,
  );
}

/**
 * The token a trace should follow for one message: its correlation as text when
 * it has one, otherwise the hex of the correlation bytes, otherwise its topic.
 *
 * Correlation first because it answers "this exchange"; the topic answers "this
 * device", and the two are different questions that a trace must not conflate.
 */
export function traceTokenFor(msg: MqttGenericMessage): string {
  return msg.correlationData?.trim() || msg.correlationHex?.trim() || msg.topic;
}
