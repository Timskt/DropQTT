import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FaultRule, FaultRuleStats } from '../types';
import { usePersistentState } from './usePersistentState';

/**
 * Fault-injection rules. The frontend owns persistence and pushes the whole set on
 * every change; Rust applies the faults on the wire path and reports what each rule
 * actually did. That split matters: the counters come from the side that performed
 * the action, so a rule that is armed but seeing nothing is visibly different from a
 * rule that is dropping traffic.
 */
export function useFaults(visible: boolean) {
  const [rules, setRules] = usePersistentState<FaultRule[]>('dropqtt_fault_rules', []);
  const [stats, setStats] = useState<FaultRuleStats[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    invoke<FaultRuleStats[]>('faults_sync_rules', { rules })
      .then((s) => {
        setStats(s);
        setLastError(null);
      })
      .catch((e) => setLastError(String(e)));
  }, [rules]);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const poll = () =>
      invoke<FaultRuleStats[]>('faults_stats')
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
    };
  }, [visible]);

  const addRule = useCallback(
    (rule: FaultRule) => setRules((prev) => [...prev, rule]),
    [setRules],
  );

  const updateRule = useCallback(
    (rule: FaultRule) => setRules((prev) => prev.map((r) => (r.id === rule.id ? rule : r))),
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
    invoke<FaultRuleStats[]>('faults_reset')
      .then(setStats)
      .catch((e) => setLastError(String(e)));
  }, []);

  return { rules, stats, lastError, addRule, updateRule, removeRule, toggleRule, reset };
}
