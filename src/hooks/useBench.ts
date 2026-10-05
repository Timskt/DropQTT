import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { BenchProgress, BenchSpec } from '../types';

/**
 * View over the backend publish stress lab. The runs live in Rust; this polls
 * their counters while the panel is mounted and takes the throttled
 * `bench-progress` push whenever the backend has something fresher.
 */
export function useBench(active: boolean) {
  const [runs, setRuns] = useState<BenchProgress[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const apply = useCallback((next: BenchProgress[]) => {
    if (!aliveRef.current) return;
    setRuns(next);
    setLastError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await invoke<BenchProgress[]>('bench_progress'));
    } catch (e) {
      if (aliveRef.current) setLastError(String(e));
    }
  }, [apply]);

  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = setInterval(refresh, 1000);
    const unlisten = listen<BenchProgress[]>('bench-progress', (e) => apply(e.payload));
    return () => {
      clearInterval(timer);
      unlisten.then((fn) => fn());
    };
  }, [active, refresh, apply]);

  const start = useCallback(
    async (spec: BenchSpec) => {
      try {
        await invoke('bench_start', { spec });
        await refresh();
      } catch (e) {
        // Validation rejections (rate over the cap, wildcard topic, no client)
        // are the interesting output of this call, so they surface in the panel.
        if (aliveRef.current) setLastError(String(e));
      }
    },
    [refresh],
  );

  const stop = useCallback(
    async (id: string) => {
      try {
        await invoke('bench_stop', { id });
      } catch (e) {
        if (aliveRef.current) setLastError(String(e));
      }
      await refresh();
    },
    [refresh],
  );

  const clearFinished = useCallback(async () => {
    await invoke('bench_clear_finished');
    await refresh();
  }, [refresh]);

  return { runs, lastError, start, stop, clearFinished };
}
