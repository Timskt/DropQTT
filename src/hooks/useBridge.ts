import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  BrokerConfig,
  BridgeConnInfo,
  BridgeEvent,
  BridgeOutboxState,
  BridgeRule,
  BridgeRuleStats,
  bridgeRuleDefaults,
  emptyBridgeOutboxState,
} from '../types';
import { usePersistentState } from './usePersistentState';
import { withoutStoredSecrets } from '../utils/secrets';
import { useReleasedHeaderSecrets } from './useReleasedHeaderSecrets';
import {
  BridgeConnection,
  DEFAULT_CONNECTIONS,
  nextConnId,
  rulesUsing,
} from '../utils/bridgeConns';

// The panel quotes this number in its own truncation notice, so it is
// exported rather than duplicated: a changed cap must not leave a message
// claiming a different length.
export const EVENT_LOG_CAP = 150;

/**
 * Last endpoint each connection used, keyed by its id. `BridgeRemember` kept that shape
 * while there were exactly two; the keys are the same ids, so storage written before this
 * reads unchanged.
 */
export type BridgeRemember = Record<string, BrokerConfig | undefined>;

/** A logged forward with a stable list key (backend timestamps can collide) */
export interface BridgeEventEntry {
  key: number;
  ev: BridgeEvent;
}

const dropReferences = <S extends { secretHeaders?: unknown }>({ secretHeaders: _gone, ...sink }: S): Omit<S, 'secretHeaders'> => sink;

/**
 * Bridge session state: any number of independent broker connections (the backend keyed
 * them by id all along), forwarding rules (persisted here; pushed to the backend on every
 * change), per-rule stats, the webhook outbox the backend keeps on disk, and a capped live
 * event log.
 */
export function useBridge(visible: boolean) {
  const [conns, setConns] = useState<BridgeConnInfo[]>([]);
  const [connections, setConnections] = usePersistentState<BridgeConnection[]>(
    'dropqtt_bridge_conns',
    DEFAULT_CONNECTIONS,
  );
  const [rules, setRules] = usePersistentState<BridgeRule[]>('dropqtt_bridge_rules', []);
  const [stats, setStats] = useState<Record<string, BridgeRuleStats>>({});
  const [events, setEvents] = useState<BridgeEventEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<BridgeOutboxState>(emptyBridgeOutboxState);

  // Last endpoints per role + autostart switch (survives restarts) 
  const [remember, setRemember] = usePersistentState<BridgeRemember>('dropqtt_bridge_remember', {}, withoutStoredSecrets);
  const [autoReconnect, setAutoReconnect] = usePersistentState<boolean>('dropqtt_bridge_auto', false);
  useReleasedHeaderSecrets(rules);
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
    invoke('bridge_sync_rules', { rules }).then(() => setLastError(null)).catch((e) => {
      // Surface validation failures (empty filter, src===dst, …) in the UI
      setLastError(String(e));
    });
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

  // ---- Outbox: the queue lives on disk, so it is read whether or not anything is
  // connected. A dead letter is most important to show exactly when the endpoint is
  // down, and a restart must not make the owed deliveries look like zero.
  const readOutbox = useCallback(async (): Promise<BridgeOutboxState | null> => {
    try {
      return await invoke<BridgeOutboxState>('bridge_outbox_state');
    } catch {
      // A transient failure keeps the last known counts on screen.
      return null;
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const tick = async () => {
      const s = await readOutbox();
      if (alive && s) setOutbox(s);
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [visible, readOutbox]);

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

  // ---- Connection registry (ids are generated and never edited; labels are free text) ----
  const addConnection = useCallback((): string => {
    const id = nextConnId(connections.map((c) => c.id));
    setConnections((prev) => [...prev, { id, label: '' }]);
    return id;
  }, [connections, setConnections]);

  const labelConnection = useCallback(
    (id: string, label: string) =>
      setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c))),
    [setConnections],
  );

  /**
   * Forget a connection. Returns the rules that still name it instead of removing
   * anything: a rule left pointing at a connection that no longer exists stays enabled,
   * keeps nothing subscribed, and forwards silently — the one outcome worse than an error.
   */
  const removeConnection = useCallback(
    (id: string): BridgeRule[] => {
      const users = rulesUsing(rules, id);
      if (users.length > 0) return users;
      setConnections((prev) => prev.filter((c) => c.id !== id));
      setRemember((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (conns.some((c) => c.id === id)) disconnect(id);
      return [];
    },
    [rules, conns, setConnections, setRemember, disconnect],
  );

  // ---- Autostart: restore every remembered endpoint once per app launch ----
  useEffect(() => {
    if (bootRef.current || !autoReconnect) return;
    bootRef.current = true;
    // The list, not the stored map: a connection whose rule set was removed but whose
    // endpoint is still remembered would otherwise come back on its own.
    connections.forEach(({ id }) => {
      const cfg = remember[id];
      if (cfg) connect(id, cfg);
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

  /** Replace all rules from an imported JSON file (ids regenerated on clash) */
  const importRules = useCallback(
    (incoming: BridgeRule[]) => {
      setRules((prev) => {
        const existing = new Set(prev.map((r) => r.id));
        return incoming.map((r) => {
          const base = r.id || `rule_${Date.now()}`;
          let id = base;
          let n = 0;
          while (existing.has(id)) id = `${base}_${++n}`;
          existing.add(id);
          // An imported file cannot point a sink at a credential already on this
          // machine: a reference from elsewhere is either dangling or borrowed.
          const sinks = r.webhook ? { webhook: dropReferences(r.webhook) } : {};
          const targets = r.targets ? { targets: r.targets.map(dropReferences) } : {};
          return { ...bridgeRuleDefaults, ...r, ...sinks, ...targets, id } as BridgeRule;
        });
      });
    },
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

  /** Skip the remaining backoff and try the queued webhooks now. */
  const flushOutbox = useCallback(
    async (ruleId?: string) => {
      try {
        await invoke('bridge_outbox_flush', { ruleId: ruleId ?? null });
      } catch (e) {
        setLastError(String(e));
        return;
      }
      const s = await readOutbox();
      if (s) setOutbox(s);
    },
    [readOutbox],
  );

  /** Discard the dead letters. Never automatic — they are the only proof an
   * endpoint was unreachable. */
  const dropDeadLetters = useCallback(
    async (ruleId?: string) => {
      try {
        await invoke('bridge_outbox_drop', { ruleId: ruleId ?? null });
      } catch (e) {
        setLastError(String(e));
        return;
      }
      const s = await readOutbox();
      if (s) setOutbox(s);
    },
    [readOutbox],
  );

  const totalSent = Object.values(stats).reduce((acc, s) => acc + s.forwarded, 0);

  return {
    conns,
    connections,
    rules,
    stats,
    events,
    busy,
    lastError,
    anyConnected,
    totalSent,
    outbox,
    remember,
    autoReconnect,
    setAutoReconnect,
    connect,
    disconnect,
    addConnection,
    labelConnection,
    removeConnection,
    addRule,
    updateRule,
    removeRule,
    toggleRule,
    importRules,
    resetStats,
    clearEvents,
    flushOutbox,
    dropDeadLetters,
  };
}
