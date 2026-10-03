import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  AssertionRule,
  AssertionSnapshot,
  AssertionViolation,
  emptyAssertStats,
} from '../types';
import { usePersistentState } from './usePersistentState';

const EMPTY: AssertionSnapshot = { stats: emptyAssertStats, rules: 0, recent: [] };

/**
 * Message assertions. The frontend owns persistence and pushes the whole rule set
 * on every change (same lifecycle as bridge rules and the silence watchdog); Rust
 * owns the grammar and the judging, so a predicate that could never fire cannot be
 * saved. Tallies are polled only while the panel is visible, because they change on
 * the broker's schedule rather than ours.
 */
export function useAssertions(visible: boolean) {
  const [rules, setRules] = usePersistentState<AssertionRule[]>('dropqtt_assertion_rules', []);
  const [snapshot, setSnapshot] = useState<AssertionSnapshot>(EMPTY);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    invoke<AssertionSnapshot>('assertions_sync_rules', { rules })
      .then((s) => {
        setSnapshot(s);
        setLastError(null);
      })
      .catch((e) => setLastError(String(e)));
  }, [rules]);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const poll = () =>
      invoke<AssertionSnapshot>('assertions_state')
        .then((s) => {
          if (!disposed) setSnapshot(s);
        })
        .catch((e) => {
          if (!disposed) setLastError(String(e));
        });
    const id = window.setInterval(poll, 1000);
    return () => {
      disposed = true;
      window.clearInterval(id);
    };
  }, [visible]);

  // A violation makes the tallies current right away instead of waiting for the
  // next tick of the poll; the throttle that keeps this from storming is in Rust.
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const unlisten = listen<AssertionViolation>('assertion-violation', () => {
      if (disposed) return;
      invoke<AssertionSnapshot>('assertions_state')
        .then((s) => setSnapshot(s))
        .catch((e) => setLastError(String(e)));
    });
    return () => {
      disposed = true;
      unlisten.then((fn) => fn());
    };
  }, [visible]);

  const addRule = useCallback(
    (rule: AssertionRule) => setRules((prev) => [...prev, rule]),
    [setRules],
  );

  const updateRule = useCallback(
    (rule: AssertionRule) => setRules((prev) => prev.map((r) => (r.id === rule.id ? rule : r))),
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

  const reset = useCallback(() => {
    invoke<AssertionSnapshot>('assertions_reset')
      .then((s) => setSnapshot(s))
      .catch((e) => setLastError(String(e)));
  }, []);

  return {
    rules,
    stats: snapshot.stats,
    armed: snapshot.rules,
    recent: snapshot.recent,
    lastError,
    addRule,
    updateRule,
    removeRule,
    toggleRule,
    reset,
  };
}
