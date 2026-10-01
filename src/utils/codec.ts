import { invoke } from '@tauri-apps/api/core';

/**
 * Console-side payload codec.
 *
 * Deliberately display-only: the raw bytes stay authoritative so history,
 * export and replay keep the exact payload the broker delivered. A codec is a
 * lens on traffic, not a mutation of it.
 *
 * Reuses `bridge_test_transform`, which is the same sandboxed QuickJS path the
 * bridge uses (100 ms / 4 MB limits, no host APIs), so a device format can be
 * decoded in the console and transformed in a bridge rule with one script.
 */

export interface CodecState {
  enabled: boolean;
  script: string;
}

export const CODEC_DISABLED: CodecState = { enabled: false, script: '' };

/** Script must define transform(); the backend enforces this too. */
export const codecScriptUsable = (script: string): boolean =>
  script.trim().length > 0 && script.includes('function transform');

// Render passes repeat constantly while the feed scrolls; without this every
// row would re-invoke the sandbox on every parent re-render.
const CACHE_CAP = 200;
const cache = new Map<string, string>();

const keyOf = (script: string, topic: string, payloadBase64: string) =>
  `${script.length}\u0000${topic}\u0000${payloadBase64}`;

export function codecGet(script: string, topic: string, payloadBase64: string): string | undefined {
  return cache.get(keyOf(script, topic, payloadBase64));
}

function codecPut(key: string, value: string) {
  if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value as string);
  cache.set(key, value);
}

export function clearCodecCache() {
  cache.clear();
}

/** Resolves to the decoded text, or throws with the sandbox's message. */
export async function runCodec(
  script: string,
  topic: string,
  payloadBase64: string,
): Promise<string> {
  const key = keyOf(script, topic, payloadBase64);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const out = await invoke<{ action: string; payload?: string }>(
    'bridge_test_transform',
    { script, topic, payloadBase64 },
  );
  if (out?.action === 'drop') throw new Error('transform returned null');
  const text = out?.payload ?? '';
  codecPut(key, text);
  return text;
}
