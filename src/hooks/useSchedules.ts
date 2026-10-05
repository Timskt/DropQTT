import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { RunInfo, ScheduleSpec } from '../types';

/** Poll cadence for the run registry. Progress is the only thing that needs it —
 *  terminal transitions arrive as events, so this can stay relaxed. */
const POLL_MS = 700;

/**
 * View over the backend publisher scheduler. The runs live in Rust, so closing
 * this panel (or the whole workspace) does not stop them; this hook only reads
 * their state and issues start/stop commands.
 */
export function useSchedules(active: boolean) {
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<RunInfo[]>('schedule_list');
      if (aliveRef.current) {
        setRuns(next);
        setLastError(null);
      }
    } catch (e) {
      if (aliveRef.current) setLastError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const unlisten = listen<RunInfo>('schedule-event', () => {
      void refresh();
    });
    return () => {
      clearInterval(timer);
      unlisten.then((fn) => fn());
    };
  }, [active, refresh]);

  const start = useCallback(
    async (spec: ScheduleSpec) => {
      await invoke('schedule_start', { spec });
      await refresh();
    },
    [refresh],
  );

  const stop = useCallback(
    async (id: string) => {
      await invoke('schedule_stop', { id });
      await refresh();
    },
    [refresh],
  );

  const stopAll = useCallback(async () => {
    const activeIds = runs.filter((r) => r.status === 'running').map((r) => r.id);
    await Promise.all(activeIds.map((id) => invoke('schedule_stop', { id })));
    await refresh();
  }, [runs, refresh]);

  const clearFinished = useCallback(async () => {
    await invoke('schedule_clear_finished');
    await refresh();
  }, [refresh]);

  return { runs, lastError, start, stop, stopAll, clearFinished, refresh };
}
