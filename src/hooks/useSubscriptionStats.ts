import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { QosDowngradeEvent, SubRejection, SubscriptionAckState } from '../types';
import { currentTranslations } from '../i18n';
import { describeAck } from '../utils/ackReason';
import { toast } from '../utils/toast';

/**
 * Subscription hit statistics plus the broker's own verdicts on them.
 *
 * The hits are polled (cheap, and a lost tick only delays a number). The verdicts
 * are polled *and* pushed: a refused SUBACK has to be visible the moment it
 * arrives, because the alternative is a green chip over a subscription that will
 * never receive anything.
 */
export interface SubscriptionAck {
  /** filter -> the refusal the broker currently asserts */
  rejected: Record<string, SubRejection>;
  /** filter -> QoS the broker capped the grant at */
  capped: Record<string, number>;
  /** Unsubscribes the broker refused, newest last */
  refusedUnsubscribes: SubRejection[];
  /** Reason bytes that answered nothing we had asked about */
  unattributed: number;
}

const emptyAck: SubscriptionAck = {
  rejected: {},
  capped: {},
  refusedUnsubscribes: [],
  unattributed: 0,
};

const fromState = (s: SubscriptionAckState): SubscriptionAck => {
  const rejected: Record<string, SubRejection> = {};
  for (const r of s.rejected ?? []) rejected[r.filter] = r;
  const capped: Record<string, number> = {};
  for (const c of s.capped ?? []) capped[c.filter] = c.granted;
  return {
    rejected,
    capped,
    refusedUnsubscribes: s.refusedUnsubscribes ?? [],
    unattributed: s.unattributed ?? 0,
  };
};

export function useSubscriptionStats(active: boolean) {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [ack, setAck] = useState<SubscriptionAck>(emptyAck);
  // Refused publishes arrive as a stream; one toast per burst, not one per packet.
  const nackRef = useRef<{ count: number; code: number; timer: number | null }>({
    count: 0,
    code: 0x80,
    timer: null,
  });

  // Events are listened for for as long as the console is mounted, not only while
  // connected: a refused SUBACK is itself what drops the session in rumqttc, so a
  // listener gated on `isConnected` would swallow the one message that explains
  // the disconnect.
  useEffect(() => {
    let disposed = false;

    const flushNacks = () => {
      const t = currentTranslations();
      const { count, code } = nackRef.current;
      nackRef.current = { count: 0, code: 0x80, timer: null };
      if (count === 0) return;
      const reason = describeAck(code, 'pub', t);
      toast.error(
        count > 1
          ? t.publishRejectedManyToast.replace('{n}', String(count)).replace('{reason}', reason)
          : t.publishRejectedToast.replace('{reason}', reason),
      );
    };

    const unlistens: Promise<() => void>[] = [
      listen<SubRejection>('subscription-rejected', (e) => {
        if (disposed) return;
        const t = currentTranslations();
        const r = e.payload;
        setAck((prev) => ({ ...prev, rejected: { ...prev.rejected, [r.filter]: r } }));
        toast.error(
          t.subRejectedToast
            .replace('{topic}', r.filter)
            .replace('{reason}', describeAck(r.code, 'sub', t)),
        );
      }),
      listen<SubRejection>('unsubscribe-rejected', (e) => {
        if (disposed) return;
        const t = currentTranslations();
        const r = e.payload;
        setAck((prev) => ({
          ...prev,
          refusedUnsubscribes: [...prev.refusedUnsubscribes.filter((x) => x.filter !== r.filter), r],
        }));
        toast.error(
          t.unsubRejectedToast
            .replace('{topic}', r.filter)
            .replace('{reason}', describeAck(r.code, 'unsub', t)),
        );
      }),
      listen<QosDowngradeEvent>('subscription-downgraded', (e) => {
        if (disposed) return;
        const t = currentTranslations();
        const d = e.payload;
        setAck((prev) => ({ ...prev, capped: { ...prev.capped, [d.filter]: d.granted } }));
        toast.info(
          t.subDowngradedToast.replace('{topic}', d.filter).replace('{qos}', String(d.granted)),
        );
      }),
      listen<{ code: number }>('publish-rejected', (e) => {
        if (disposed) return;
        nackRef.current.count += 1;
        nackRef.current.code = e.payload.code;
        if (nackRef.current.timer === null) {
          nackRef.current.timer = window.setTimeout(flushNacks, 1500);
        }
      }),
    ];

    return () => {
      disposed = true;
      if (nackRef.current.timer !== null) {
        clearTimeout(nackRef.current.timer);
        nackRef.current = { count: 0, code: 0x80, timer: null };
      }
      unlistens.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  useEffect(() => {
    if (!active) {
      setStats({});
      setAck(emptyAck);
      return;
    }
    let disposed = false;

    const poll = async () => {
      try {
        const next = await invoke<Record<string, number>>('get_subscription_stats');
        if (!disposed) setStats(next);
      } catch {
        // Backend not connected / command unavailable: keep the previous snapshot
      }
      try {
        const state = await invoke<SubscriptionAckState>('get_subscription_ack_state');
        if (!disposed) setAck(fromState(state));
      } catch {
        // A failed poll keeps the last verdicts rather than clearing them, because
        // "no longer refused" is a claim a timeout cannot support.
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

  return { stats, ack, resetStats };
}
