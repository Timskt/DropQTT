import { MqttGenericMessage } from '../types';
import { base64ToUint8, uint8ToUtf8 } from './cbor';

/**
 * Export the console message feed as JSON or CSV.
 * In Tauri the file goes through the native save dialog (plugin-dialog +
 * plugin-fs); in a plain browser dev session it falls back to a blob download.
 */

export type ExportFormat = 'json' | 'csv';

const csvEscape = (v: string): string =>
  /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

function payloadToText(msg: MqttGenericMessage): string {
  // payloadBase64 is the wire truth; the plain field may be lossy-converted
  return msg.payloadBase64 ? uint8ToUtf8(base64ToUint8(msg.payloadBase64)) : msg.payload;
}

export function messagesToJson(messages: MqttGenericMessage[]): string {
  const rows = [...messages].reverse().map((m) => ({
    timestamp: m.timestamp,
    direction: m.direction,
    topic: m.topic,
    qos: m.qos,
    retain: m.retain,
    contentType: m.contentType ?? null,
    userProperties: m.userProperties ?? {},
    payloadLen: m.payloadLen,
    truncated: m.truncated,
    payload: payloadToText(m),
    payloadBase64: m.payloadBase64,
  }));
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, messages: rows }, null, 2);
}

export function messagesToCsv(messages: MqttGenericMessage[]): string {
  const header = 'timestamp,direction,topic,qos,retain,contentType,payloadLen,truncated,payload';
  const lines = [...messages].reverse().map((m) =>
    [
      m.timestamp,
      m.direction,
      m.topic,
      String(m.qos),
      String(m.retain),
      m.contentType ?? '',
      String(m.payloadLen),
      String(m.truncated),
      payloadToText(m),
    ]
      .map(csvEscape)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

/** Persist via native dialog when under Tauri, else browser download. Returns file name used. */
export async function saveTextFile(defaultName: string, content: string): Promise<string | null> {
  const inTauri = '__TAURI_INTERNALS__' in window;
  if (inTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const ext = defaultName.split('.').pop() ?? '';
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return null;
    await writeTextFile(path, content);
    return path;
  }
  // Browser fallback
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return defaultName;
}

export async function exportMessages(
  messages: MqttGenericMessage[],
  format: ExportFormat,
): Promise<string | null> {
  if (messages.length === 0) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const content = format === 'json' ? messagesToJson(messages) : messagesToCsv(messages);
  return saveTextFile(`dropqtt-messages-${stamp}.${format}`, content);
}
