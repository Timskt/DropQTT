import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { BrokerCapabilities } from '../types';

/**
 * The broker's own account of what it supports, from the CONNACK.
 *
 * `null` means "nothing announced yet" and every consumer must treat that as
 * "do not restrict anything" — inventing defaults here would let the form promise
 * a QoS or a retain flag the broker then refuses, which is the failure this whole
 * path exists to remove.
 */
export function useBrokerCapabilities(connected: boolean): BrokerCapabilities | null {
  const [caps, setCaps] = useState<BrokerCapabilities | null>(null);

  useEffect(() => {
    if (!connected) return;
    let disposed = false;
    const fetch = () =>
      invoke<BrokerCapabilities>('get_broker_capabilities')
        .then((c) => {
          if (!disposed) setCaps(c);
        })
        .catch(() => {
          /* keep the previous announcement; a failed read proves nothing */
        });
    fetch();
    // Every (re)connect re-announces, and the session may land on a different broker.
    const unlisten = listen('broker-status', fetch);

    return () => {
      disposed = true;
      void unlisten.then((fn) => fn());
    };
  }, [connected]);

  // Derived rather than cleared in the effect: a session that is not up has no
  // announced limits, and the last broker's answer must not outlive it.
  return connected ? caps : null;
}
