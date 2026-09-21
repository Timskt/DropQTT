import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  BrokerConfig,
  BridgeConnInfo,
  BridgeEvent,
  BridgeRule,
  BridgeRuleStats,
} from '../types';
import { usePersistentState } from './usePersistentState';

const EVENT_LOG_CAP = 150;
type BridgeRole = 'src' | 'dst';

/** What each bridge role last connected to, for quick reconnect / autostart */
export interface BridgeRemember {
  src?: BrokerConfig;
  dst?: BrokerConfig;
}

/** A logged forward with a stable list key (backend timestamps can collide) */
export interface BridgeEventEntry {
  key: number;
  ev: BridgeEvent;
}

/**
 * Bridge session state: two independent broker connections ("src"/"dst"),
 * forwarding rules (persisted here; pushed to the backend on every change),
 * per-rule stats and a capped live event log.
 */
export function useBridge(visible: boolean) {
  const [conns, setConns] = useState<BridgeConnInfo[]>([]);
  const [rules, setRules] = usePersistentState<BridgeRule[]>('dropqtt_bridge_rules', []);
  const [stats, setStats] = useState<Record<string, BridgeRuleStats>>({});
  const [events, setEvents] = useState<BridgeEventEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Last endpoints per role + autostart switch (survives restarts) 
  const [remember, setRemember] = usePersistentState<BridgeRemember>('dropqtt_bridge_remember', {});
  const [autoReconnect, setAutoReconnect] = usePersistentState<boolean>('dropqtt_bridge_auto', false);
  const bootRef = useRef(false);

  const seqRef = useRef(0);

  // ---- Backend event wiring (mounted once) ----
  useEffect(() => {
    let disposed = false;
    const unlistens: (() => void)[] = [];

    (async () => {
      unlistens.push(
        await listen<BridgeConnInfo[]>('bridge-status', (e) => {
          if (!disposed) setConns(e.payload);
        }),
        await listen<BridgeEvent>('bridge-event', (e) => {
          if (disposed) return;
          setEvents((prev) => {
            const next = [...prev, { key: ++seqRef.current, ev: e.payload }];
            return next.length > EVENT_LOG_CAP ? next.slice(next.length - EVENT_LOG_CAP) : next;
          });
        }),
      );
      try {
        const cur = await invoke<BridgeConnInfo[]>('bridge_status');
        if (!disposed) setConns(cur);
      } catch {
        /* browser dev without tauri backend */
      }
    })();

    return () => {
      disposed = true;
      unlistens.forEach((fn) => fn());
    };
  }, []);

  // ---- Push rule set to the backend whenever it changes ----
  useEffect(() => {
    invoke('bridge_sync_rules', { rules })
      .catch((e) => console.warn('bridge sync rules:', e));
  }, [rules]);

  // ---- Stats polling while the page is visible and something is connected ----
  const anyConnected = conns.some((c) => c.connected);
  useEffect(() => {
    if (!visible || !anyConnected) return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await invoke<Record<string, BridgeRuleStats>>('bridge_stats');
        if (alive) setStats(s);
      } catch {
        /* ignore transient */
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [visible, anyConnected]);

  // ---- Connection actions ----
  const connect = useCallback(async (id: string, config: BrokerConfig) => {
    setBusy(true);
    setLastError(null);
    try {
      await invoke('bridge_connect', { id, config });
      setRemember((prev) => ({ ...prev, [id]: config }));
    } catch (e) {
      setLastError(String(e));
    } finally {
      setBusy(false);
    }
  }, [setRemember]);

  const disconnect = useCallback(async (id: string) => {
    try {
      await invoke('bridge_disconnect', { id });
      setConns((prev) => prev.filter((c) => c.id !== id));
      setRemember((prev) => ({ ...prev, [id]: undefined }));
    } catch (e) {
      setLastError(String(e));
    }
  }, [setRemember]);

  // ---- Autostart: restore remembered endpoints once per app launch ----
  useEffect(() => {
    if (bootRef.current || !autoReconnect) return;
    bootRef.current = true;
    (['src', 'dst'] as BridgeRole[]).forEach((role) => {
      const cfg = remember[role];
      if (cfg) connect(role, cfg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReconnect]);

  // ---- Rule CRUD (frontend owns persistence; effect syncs to backend) ----
  const addRule = useCallback(
    (rule: BridgeRule) => setRules((prev) => [...prev, rule]),
    [setRules],
  );

  const updateRule = useCallback(
    (rule: BridgeRule) => setRules((prev) => prev.map((r) => (r.id === rule.id ? rule : r))),
    [setRules],
  );

  const removeRule = useCallback(
    (id: string) => setRules((prev) => prev.filter((r) => r.id !== id)),
    [setRules],
  );

  const toggleRule = useCallback(
    (id: string) =>
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))),
    [setRules],
  );

  const resetStats = useCallback(async () => {
    try {
      await invoke('bridge_reset_stats');
      setStats({});
      setEvents([]);
    } catch (e) {
      setLastError(String(e));
    }
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  return {
    conns,
    rules,
    stats,
    events,
    busy,
    lastError,
    anyConnected,
    remember,
    autoReconnect,
    setAutoReconnect,
    connect,
    disconnect,
    addRule,
    updateRule,
    removeRule,
    toggleRule,
    resetStats,
    clearEvents,
  };
}
