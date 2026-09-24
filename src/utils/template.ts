/**
 * Payload template variables. `${token}` placeholders are substituted at
 * publish time so a saved payload can emit fresh values every send — useful
 * for simulating device telemetry (timestamps, counters, random readings).
 */
export const TEMPLATE_TOKENS = [
  { token: '${timestamp}', desc: 'Unix ms' },
  { token: '${iso}', desc: 'ISO-8601' },
  { token: '${uuid}', desc: 'UUID v4' },
  { token: '${random}', desc: '0–999999' },
  { token: '${counter}', desc: 'auto-increment' },
] as const;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Replace `${...}` tokens; `counter` is the caller-supplied sequence number. */
export function renderTemplate(text: string, counter: number): string {
  return text.replace(/\$\{(timestamp|ts|iso|uuid|random|counter|seq)\}/g, (_m, key: string) => {
    switch (key) {
      case 'timestamp':
      case 'ts':
        return String(Date.now());
      case 'iso':
        return new Date().toISOString();
      case 'uuid':
        return uuid();
      case 'random':
        return String(Math.floor(Math.random() * 1_000_000));
      case 'counter':
      case 'seq':
        return String(counter);
      default:
        return _m;
    }
  });
}
