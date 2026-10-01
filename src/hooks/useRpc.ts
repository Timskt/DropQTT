import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { RpcCall, RpcEvent, RpcSpec } from '../types';

/** Calls are kept in Rust, so a panel unmount must not lose them. Events carry
 *  every transition; this poll only re-syncs after a reload or a disconnect. */
const POLL_MS = 1000;

export function useRpc(active: boolean, connected: boolean) {
  const [calls, setCalls] = useState<RpcCall[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<RpcCall[]>('rpc_list');
      if (aliveRef.current) {
        setCalls(next);
        setLastError(null);
      }
    } catch (e) {
      if (aliveRef.current) setLastError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const unlisten = listen<RpcEvent>('rpc-event', (event) => {
      const { call } = event.payload;
      if (!aliveRef.current) return;
      setCalls((prev) => {
        const idx = prev.findIndex((c) => c.id === call.id);
        if (idx === -1) return [call, ...prev];
        const next = prev.slice();
        next[idx] = call;
        return next;
      });
    });
    return () => {
      clearInterval(timer);
      unlisten.then((fn) => fn());
    };
  }, [active, refresh]);

  // A link that went away turns every open call into a timeout in the backend;
  // pick that up on the edge instead of waiting for the next poll tick.
  useEffect(() => {
    if (active) refresh();
  }, [active, connected, refresh]);

  const request = useCallback(
    async (spec: RpcSpec): Promise<RpcCall> => {
      const call = await invoke<RpcCall>('rpc_request', { spec });
      if (aliveRef.current) {
        setCalls((prev) => [call, ...prev.filter((c) => c.id !== call.id)]);
      }
      return call;
    },
    [],
  );

  const clearFinished = useCallback(async () => {
    await invoke('rpc_clear_finished');
    await refresh();
  }, [refresh]);

  return { calls, lastError, request, clearFinished, refresh };
}
