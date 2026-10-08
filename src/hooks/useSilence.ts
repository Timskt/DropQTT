import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SilenceAlertEvent, SilenceRule } from '../types';
import { usePersistentState } from './usePersistentState';
import { useReleasedHeaderSecrets } from './useReleasedHeaderSecrets';

const ALERT_LOG_CAP = 80;

export interface SilenceAlertEntry {
  key: number;
  ev: SilenceAlertEvent;
}

/**
 * Silence-watchdog rules. Persistence lives here and the whole set is pushed to
 * the backend on every change, mirroring the bridge so validation errors from
 * the Rust side surface in one place.
 */
export function useSilence(visible: boolean) {
  const [rules, setRules] = usePersistentState<SilenceRule[]>('dropqtt_silence_rules', []);
  const [alerts, setAlerts] = useState<SilenceAlertEntry[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const seqRef = useRef(0);
  useReleasedHeaderSecrets(rules);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const unlisten = listen<SilenceAlertEvent>('silence-alert', (e) => {
      if (disposed) return;
      setAlerts((prev) => {
        const next = [...prev, { key: ++seqRef.current, ev: e.payload }];
        return next.length > ALERT_LOG_CAP ? next.slice(next.length - ALERT_LOG_CAP) : next;
      });
    });
    return () => {
      disposed = true;
      unlisten.then((fn) => fn());
    };
  }, [visible]);

  useEffect(() => {
    invoke('silence_sync_rules', { rules })
      .then(() => setLastError(null))
      .catch((e) => setLastError(String(e)));
  }, [rules]);

  const addRule = useCallback((rule: SilenceRule) => {
    setRules((prev) => [...prev, rule]);
  }, [setRules]);

  const updateRule = useCallback((rule: SilenceRule) => {
    setRules((prev) => prev.map((r) => (r.id === rule.id ? rule : r)));
  }, [setRules]);

  const removeRule = useCallback((id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, [setRules]);

  const toggleRule = useCallback((id: string) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  }, [setRules]);

  /** Whole-set swap when a scenario is applied. The endpoints come back stripped —
   *  a scenario file never carries them — so the panel has to say so out loud. */
  const replaceRules = useCallback((next: SilenceRule[]) => setRules(next), [setRules]);

  const clearAlerts = useCallback(() => setAlerts([]), []);

  return { rules, alerts, lastError, addRule, updateRule, removeRule, toggleRule, replaceRules, clearAlerts };
}
