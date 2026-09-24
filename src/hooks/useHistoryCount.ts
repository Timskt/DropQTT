import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { HistoryStats } from '../types';

/**
 * Live row-count of the persisted message history, polled on an interval so the
 * sidebar "报文历史" badge visibly fills up as traffic flows. Cheap (one COUNT),
 * faster while connected, slow-tick otherwise to stay fresh after disconnect.
 */
export function useHistoryCount(connected: boolean): number {
  const [rows, setRows] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      invoke<HistoryStats>('history_stats')
        .then((s) => {
          if (alive) setRows(s.rows);
        })
        .catch(() => {
          /* history db unavailable — leave badge at last value */
        });
    tick();
    const id = setInterval(tick, connected ? 4000 : 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [connected]);

  return rows;
}
