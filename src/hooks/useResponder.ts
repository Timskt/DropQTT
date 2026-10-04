import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ResponderRule, ResponderStats } from '../types';
import { usePersistentState } from './usePersistentState';

/**
 * Scripted responder rules. Persistence stays in the frontend and the whole set is
 * pushed on every change, as with bridges, silence, assertions and faults; Rust owns
 * the matching, the templating and the rate ceilings. A reply that could not be
 * published arrives back as an event, because a simulated device that goes quiet is
 * the exact failure this feature would otherwise hide.
 */
export function useResponder(visible: boolean) {
  const [rules, setRules] = usePersistentState<ResponderRule[]>('dropqtt_responder_rules', []);
  const [stats, setStats] = useState<ResponderStats[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    invoke<ResponderStats[]>('responder_sync_rules', { rules })
      .then((s) => {
        setStats(s);
        setLastError(null);
      })
      .catch((e) => setLastError(String(e)));
  }, [rules]);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const unlisten = listen<string>('responder-error', (e) => {
      if (disposed) return;
      setLastError(String(e.payload));
    });
    const poll = () =>
      invoke<ResponderStats[]>('responder_stats')
        .then((s) => {
          if (!disposed) setStats(s);
        })
        .catch((e) => {
          if (!disposed) setLastError(String(e));
        });
    const id = window.setInterval(poll, 1000);
    return () => {
      disposed = true;
      window.clearInterval(id);
      unlisten.then((fn) => fn());
    };
  }, [visible]);

  const addRule = useCallback(
    (rule: ResponderRule) => setRules((prev) => [...prev, rule]),
    [setRules],
  );

  const updateRule = useCallback(
    (rule: ResponderRule) => setRules((prev) => prev.map((r) => (r.id === rule.id ? rule : r))),
    [setRules],
  );

  const removeRule = useCallback(
    (id: string) => setRules((prev) => prev.filter((r) => r.id !== id)),
    [setRules],
  );

  const toggleRule = useCallback(
    (id: string) => setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))),
    [setRules],
  );

  /** Whole-set swap, used when a scenario is applied. The effect below pushes the
   *  new set to Rust, which still owns the grammar and the ceilings. */
  const replaceRules = useCallback(
    (next: ResponderRule[]) => setRules(next),
    [setRules],
  );

  const reset = useCallback(() => {
    invoke<ResponderStats[]>('responder_reset')
      .then(setStats)
      .catch((e) => setLastError(String(e)));
  }, []);

  return { rules, stats, lastError, addRule, updateRule, removeRule, toggleRule, replaceRules, reset };
}
