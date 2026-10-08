import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { QosDowngradeEvent, SubRejection, SubscriptionAckState } from '../types';
import { currentTranslations, fill } from '../i18n';
import { describeAck } from '../utils/ackReason';
import { isNewKey, isNewVerdict, pruneVerdicts } from '../utils/toastGuards';
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
  /** filter -> Subscription Identifier we asked the broker to label it with */
  const [ids, setIds] = useState<Record<string, number>>({});
  // A refused SUBACK drops the session, so the same refusal arrives again on every
  // automatic reconnect. One toast per distinct verdict, not one per reconnect cycle.
  const subSeen = useRef(new Set<string>());
  const unsubSeen = useRef(new Set<string>());
  // A capped grant repeats on every reconnect too, so it gets the same treatment.
  const capSeen = useRef(new Set<string>());
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
          ? fill(t.publishRejectedManyToast, { n: String(count), reason })
          : fill(t.publishRejectedToast, { reason }),
      );
    };

    const unlistens: Promise<() => void>[] = [
      listen<SubRejection>('subscription-rejected', (e) => {
        if (disposed) return;
        const t = currentTranslations();
        const r = e.payload;
        setAck((prev) => ({ ...prev, rejected: { ...prev.rejected, [r.filter]: r } }));
        if (isNewVerdict(subSeen.current, r)) {
          toast.error(
            fill(t.subRejectedToast, { topic: r.filter, reason: describeAck(r.code, 'sub', t) }),
          );
        }
      }),
      listen<SubRejection>('unsubscribe-rejected', (e) => {
        if (disposed) return;
        const t = currentTranslations();
        const r = e.payload;
        setAck((prev) => ({
          ...prev,
          refusedUnsubscribes: [...prev.refusedUnsubscribes.filter((x) => x.filter !== r.filter), r],
        }));
        if (isNewVerdict(unsubSeen.current, r)) {
          toast.error(
            fill(t.unsubRejectedToast, { topic: r.filter, reason: describeAck(r.code, 'unsub', t) }),
          );
        }
      }),
      listen<QosDowngradeEvent>('subscription-downgraded', (e) => {
        if (disposed) return;
        const t = currentTranslations();
        const d = e.payload;
        setAck((prev) => ({ ...prev, capped: { ...prev.capped, [d.filter]: d.granted } }));
        if (isNewKey(capSeen.current, `${d.filter}\u0000qos:${d.granted}`)) {
          toast.info(
            fill(t.subDowngradedToast, { topic: d.filter, qos: String(d.granted) }),
          );
        }
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
      setIds({});
      setAck(emptyAck);
      // The next deliberate connect should be able to tell us about a refusal again,
      // including one it repeats.
      subSeen.current.clear();
      unsubSeen.current.clear();
      capSeen.current.clear();
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
        const labelled = await invoke<Record<string, number>>('get_subscription_ids');
        if (!disposed) setIds(labelled);
      } catch {
        // Same reasoning: an unknown labelling stays as it was last known.
      }
      try {
        const state = await invoke<SubscriptionAckState>('get_subscription_ack_state');
        if (!disposed) {
          setAck(fromState(state));
          // A filter that stopped being refused must be able to announce a later refusal,
          // so its remembered verdict goes away with the verdict.
          pruneVerdicts(subSeen.current, (state.rejected ?? []).map((r) => r.filter));
          pruneVerdicts(unsubSeen.current, (state.refusedUnsubscribes ?? []).map((r) => r.filter));
          pruneVerdicts(capSeen.current, (state.capped ?? []).map((c) => c.filter));
        }
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

  return { stats, ids, ack, resetStats };
}
