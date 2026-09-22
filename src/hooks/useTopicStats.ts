import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TopicStatRow } from '../types';
import { usePersistentState } from './usePersistentState';

/**
 * Live per-topic traffic table polled from the backend every second.
 * Only polls while `active` (console visible); rows arrive pre-sorted
 * hottest (msgs/sec) first. Tracking cap is user-configurable and persisted.
 */
export function useTopicStats(active: boolean) {
  const [rows, setRows] = useState<TopicStatRow[]>([]);
  const [cap, setCap] = usePersistentState<number>('dropqtt_topic_stats_cap', 5000);

  // Push the configured cap to the backend whenever it changes
  useEffect(() => {
    invoke('set_topic_stats_cap', { cap }).catch(() => {});
  }, [cap]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = invoke<TopicStatRow[]>('get_topic_stats');
        const c = invoke<number>('get_topic_stats_cap').catch(() => null);
        const [rowsNow, capNow] = await Promise.all([r, c]);
        if (!alive) return;
        setRows(rowsNow);
        if (capNow !== null && capNow !== cap) setCap(capNow);
      } catch {
        /* backend unavailable (browser dev) — keep last snapshot */
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const resetTopicStats = useCallback(async () => {
    try {
      await invoke('reset_topic_stats');
      setRows([]);
    } catch (e) {
      console.error('reset_topic_stats:', e);
    }
  }, []);

  return { rows, resetTopicStats, cap, setCap };
}
