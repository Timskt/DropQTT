import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TopicStatRow } from '../types';

/**
 * Live per-topic traffic table polled from the backend every second.
 * Only polls while `active` (console visible); rows arrive pre-sorted
 * hottest (msgs/sec) first.
 */
export function useTopicStats(active: boolean) {
  const [rows, setRows] = useState<TopicStatRow[]>([]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await invoke<TopicStatRow[]>('get_topic_stats');
        if (alive) setRows(r);
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
  }, [active]);

  const resetTopicStats = useCallback(async () => {
    try {
      await invoke('reset_topic_stats');
      setRows([]);
    } catch (e) {
      console.error('reset_topic_stats:', e);
    }
  }, []);

  return { rows, resetTopicStats };
}
