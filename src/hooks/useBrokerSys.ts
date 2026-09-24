import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SysRow } from '../types';

/**
 * Broker `$SYS` health metrics, polled from the backend while `active`
 * (console visible + connected). The backend subscribes `$SYS/#` out-of-band
 * so these never touch the console feed or per-topic traffic stats.
 */
export function useBrokerSys(active: boolean) {
  const [rows, setRows] = useState<SysRow[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await invoke<SysRow[]>('get_broker_sys');
      setRows(r);
    } catch {
      /* backend unavailable (browser dev) — keep last snapshot */
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    refresh();
    const id = setInterval(() => {
      if (alive) refresh();
    }, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active, refresh]);

  const clear = useCallback(async () => {
    try {
      await invoke('clear_broker_sys');
      setRows([]);
    } catch {
      /* ignore */
    }
  }, []);

  return { rows, refresh, clear };
}
