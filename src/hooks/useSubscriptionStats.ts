import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Subscription hit statistics polled from the Rust routing core.
 * The backend counts, per registered topic filter, how many inbound
 * publishes matched it (wildcard-aware). Purely additive telemetry —
 * a failed poll simply keeps the previous snapshot.
 */
export function useSubscriptionStats(active: boolean) {
  const [stats, setStats] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!active) {
      setStats({});
      return;
    }
    let disposed = false;

    const poll = async () => {
      try {
        const next = await invoke<Record<string, number>>('get_subscription_stats');
        if (!disposed) setStats(next);
      } catch {
        // Backend not connected / command unavailable: keep stale snapshot
      }
    };
    poll();
    const timer = setInterval(poll, 1500);

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [active]);

  const resetStats = useCallback(async () => {
    await invoke('reset_subscription_stats').catch(() => undefined);
    setStats((prev) => {
      const cleared: Record<string, number> = {};
      for (const k of Object.keys(prev)) cleared[k] = 0;
      return cleared;
    });
  }, []);

  return { stats, resetStats };
}
