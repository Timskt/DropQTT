import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DiagnosticsSnapshot } from '../types';

/** Poll a sanitized diagnostics snapshot while the operations workspace is visible. */
export function useDiagnostics(active: boolean) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async (silent = false) => {
    const requestId = ++requestRef.current;
    if (!silent) setLoading(true);
    try {
      const next = await invoke<DiagnosticsSnapshot>('get_diagnostics_snapshot');
      if (requestId !== requestRef.current) return;
      setSnapshot(next);
      setError(null);
    } catch (e) {
      if (requestId !== requestRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent && requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => void refresh(true), 15_000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  return { snapshot, loading, error, refresh };
}
