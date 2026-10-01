import { useEffect, useState } from 'react';
import { codecGet, codecScriptUsable, runCodec } from '../utils/codec';

interface CodecResult {
  text: string | null;
  error: string | null;
  pending: boolean;
}

const IDLE: CodecResult = { text: null, error: null, pending: false };

/**
 * Applies the console codec to one message for display. Cached results resolve
 * synchronously so a scrolling feed does not flash "decoding…".
 */
export function useCodec(
  script: string | undefined,
  topic: string,
  payloadBase64: string,
): CodecResult {
  const usable = codecScriptUsable(script ?? '');
  const [state, setState] = useState<CodecResult>(IDLE);

  useEffect(() => {
    if (!usable) {
      setState(IDLE);
      return;
    }
    const hit = codecGet(script as string, topic, payloadBase64);
    if (hit !== undefined) {
      setState({ text: hit, error: null, pending: false });
      return;
    }
    let live = true;
    setState({ text: null, error: null, pending: true });
    runCodec(script as string, topic, payloadBase64)
      .then((text) => live && setState({ text, error: null, pending: false }))
      .catch((e) => live && setState({ text: null, error: String(e), pending: false }));
    return () => {
      live = false;
    };
  }, [usable, script, topic, payloadBase64]);

  return state;
}
