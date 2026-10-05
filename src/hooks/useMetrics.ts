import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MetricsStatus } from '../types';

/**
 * The Prometheus scrape endpoint: off until enabled, and never persisted, so a restart
 * always closes the port.
 *
 * Read once on mount rather than polled — the value only ever changes when this hook's
 * own `setEndpoint` returns, and a poll would suggest the switch can be flipped
 * somewhere else.
 */
export function useMetrics(active: boolean) {
  const [status, setStatus] = useState<MetricsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!active) return;
    const request = ++generation.current;
    void invoke<MetricsStatus>('get_metrics_status')
      .then((next) => {
        // A non-Tauri host (the Playwright mocks) resolves with undefined; treating
        // that as an error would paint a red line over a panel that simply has no
        // backend to ask.
        if (request === generation.current && next) setStatus(next);
      })
      .catch((e: unknown) => {
        if (request !== generation.current) return;
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [active]);

  const setEndpoint = useCallback(async (enabled: boolean, port: number) => {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<MetricsStatus>('set_metrics_endpoint', { enabled, port });
      if (next) setStatus(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, setEndpoint };
}
