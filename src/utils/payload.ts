/**
 * Console payload format conversions (MQTTX-style):
 * Text / JSON / Base64 / Hex editor views over raw bytes.
 */

import { base64ToUint8, encodeCbor, uint8ToBase64, uint8ToHex, utf8ToUint8 } from './cbor';

export type PayloadFormat = 'text' | 'json' | 'cbor' | 'base64' | 'hex' | 'markdown' | 'html';

export const PAYLOAD_FORMATS: { id: PayloadFormat; label: string; contentType?: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'json', label: 'JSON', contentType: 'application/json' },
  { id: 'markdown', label: 'Markdown', contentType: 'text/markdown' },
  { id: 'html', label: 'HTML', contentType: 'text/html' },
  { id: 'cbor', label: 'CBOR', contentType: 'application/cbor' },
  { id: 'base64', label: 'Base64' },
  { id: 'hex', label: 'Hex' },
];

export class PayloadError extends Error {}

/** Editor text → raw bytes to publish */
export function payloadToBytes(format: PayloadFormat, text: string): Uint8Array {
  try {
    switch (format) {
      case 'text':
      case 'json':
      case 'markdown':
      case 'html':
        if (format === 'json') {
          // validate JSON before sending
          JSON.parse(text);
        }
        return utf8ToUint8(text);
      case 'cbor': {
        const value = JSON.parse(text);
        return encodeCbor(value);
      }
      case 'base64':
        return base64ToUint8(text.replace(/\s+/g, ''));
      case 'hex': {
        const clean = text.replace(/[\s:]/g, '');
        if (!/^([0-9a-fA-F]{2})*$/.test(clean)) {
          throw new PayloadError('Hex payload must be an even number of hex digits');
        }
        const out = new Uint8Array(clean.length / 2);
        for (let i = 0; i < out.length; i++) {
          out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
      }
    }
  } catch (e) {
    if (e instanceof PayloadError) throw e;
    throw new PayloadError(`Invalid ${format} payload: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Raw bytes (base64 from backend) → editor text when switching formats */
export function bytesToPayloadText(format: PayloadFormat, bytes: Uint8Array): string {
  switch (format) {
    case 'text':
    case 'markdown':
    case 'html':
      return new TextDecoder().decode(bytes);
    case 'json': {
      const text = new TextDecoder().decode(bytes);
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        return text;
      }
    }
    case 'base64':
      return uint8ToBase64(bytes);
    case 'hex':
      return uint8ToHex(bytes);
    case 'cbor':
      return ''; // handled via decodeCbor for display
  }
}

export { uint8ToBase64, base64ToUint8 };
