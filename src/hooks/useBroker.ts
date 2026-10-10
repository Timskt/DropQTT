import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { BrokerConfig, BrokerProfile, ConnectionStatus, DEFAULT_BROKER_CONFIG, SubOptions } from '../types';
import { usePersistentState } from './usePersistentState';
import { dropSecret, withoutStoredSecrets } from '../utils/secrets';
import { toast } from '../utils/toast';
import { currentTranslations, fill } from '../i18n';

const DEFAULT_PROFILES: BrokerProfile[] = [
  {
    id: 'emqx-default',
    name: 'EMQX Public',
    config: { ...DEFAULT_BROKER_CONFIG, host: 'broker.emqx.io' },
  },
  {
    id: 'local-mosquitto',
    name: 'Localhost (1883)',
    config: { ...DEFAULT_BROKER_CONFIG, host: '127.0.0.1', clientId: `DropQTT_${Math.random().toString(36).substring(2, 8)}` },
  },
];

interface UseBrokerOptions {
  /** Topic registrations to (re-)apply whenever we connect */
  getTopicsToRegister: () => { topic: string; qos: number; options?: SubOptions }[];
}

/**
 * Broker connection lifecycle: config/profiles, connect/disconnect,
 * latency probe, and live status from backend events.
 */
export function useBroker({ getTopicsToRegister }: UseBrokerOptions) {
  const [config, setConfig] = usePersistentState<BrokerConfig>('dropqtt_active_broker', DEFAULT_BROKER_CONFIG, withoutStoredSecrets);
  const [profiles, setProfiles] = usePersistentState<BrokerProfile[]>('dropqtt_broker_profiles', DEFAULT_PROFILES, withoutStoredSecrets);

  const [status, setStatus] = useState<ConnectionStatus>({
    connected: false,
    brokerHost: config.host,
    brokerPort: config.port,
    clientId: config.clientId,
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [isTestingLatency, setIsTestingLatency] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const topicsRef = useRef(getTopicsToRegister);
  useEffect(() => { topicsRef.current = getTopicsToRegister; }, [getTopicsToRegister]);

  // Live status events
  useEffect(() => {
    let disposed = false;
    const unlistens: (() => void)[] = [];

    const setup = async () => {
      unlistens.push(
        await listen<ConnectionStatus>('broker-status', (e) => {
          if (!disposed) setStatus(e.payload);
        }),
        await listen<string>('broker-disconnected', (e) => {
          if (!disposed) {
            setStatus((prev) => ({ ...prev, connected: false }));
            setConnectionError(String(e.payload));
          }
        }),
        await listen('broker-connected', () => {
          if (!disposed) setConnectionError(null);
        }),
      );
      try {
        const cur = await invoke<ConnectionStatus>('get_connection_status');
        if (!disposed) setStatus(cur);
      } catch (e) {
        console.error('Status init error:', e);
      }
    };
    setup();

    return () => {
      disposed = true;
      unlistens.forEach((fn) => fn());
    };
  }, []);

  const testLatency = useCallback(async (cfg: BrokerConfig) => {
    setIsTestingLatency(true);
    try {
      const ms = await invoke<number>('test_broker_connection', { config: cfg });
      setLatency(ms);
    } catch (e) {
      console.error('Ping error:', e);
      setLatency(null);
    } finally {
      setIsTestingLatency(false);
    }
  }, []);

  const connect = useCallback(
    async (cfg: BrokerConfig) => {
      setIsConnecting(true);
      setConnectionError(null);
      try {
        // The number the badge shows is this handshake. It used to come from opening a
        // *second* connection right after this one, which on macOS meant a second read
        // of the same keychain secret — so one click on Connect asked for the login
        // keychain password twice. The backend now waits for the CONNACK and reports its
        // reason, which also means the chip cannot go green over a broker that refused it.
        const ms = await invoke<number>('connect_broker', { config: cfg });
        setLatency(ms);
        setConfig(cfg);

        // Register all desired topics (backend re-applies them on every CONNACK,
        // including auto-reconnects — no manual re-subscribe loop needed).
        // A rejection here is not transient: an ACL refusal or a malformed filter
        // stays refused on every retry, so the user has to hear about it now.
        const rejected: string[] = [];
        for (const { topic, qos, options } of topicsRef.current()) {
          if (!topic.trim()) continue;
          await invoke('subscribe_topic', { topic: topic.trim(), qos, options }).catch((e) => {
            rejected.push(`${topic.trim()}: ${e}`);
          });
        }
        if (rejected.length > 0) {
          const rt = currentTranslations();
          toast.error(
            fill(rt.subscribeFailedAtConnect, { count: String(rejected.length), detail: rejected[0] }),
          );
        }
      } catch (err) {
        setConnectionError(String(err));
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [setConfig],
  );

  const disconnect = useCallback(async () => {
    try {
      await invoke('disconnect_broker');
      setStatus((prev) => ({ ...prev, connected: false }));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const toggleConnect = useCallback(() => {
    if (status.connected) {
      disconnect();
    } else {
      connect(config).catch((err) => console.error('Connection failed:', err));
    }
  }, [status.connected, config, connect, disconnect]);

  const selectProfile = useCallback(
    (profile: BrokerProfile) => {
      connect(profile.config).catch((err) => console.error('Connection failed:', err));
    },
    [connect],
  );

  const saveProfile = useCallback(
    (name: string, pConfig: BrokerConfig) => {
      setProfiles((prev) => [...prev, { id: `prof_${Date.now()}`, name, config: pConfig }]);
    },
    [setProfiles],
  );

  /**
   * Replace a saved profile in place. Without this the only way to change one was to
   * save it again under another name, which left the stale one on the list and taught
   * people that "保存预设" accumulates rather than maintains.
   */
  const updateProfile = useCallback(
    (id: string, name: string, pConfig: BrokerConfig) => {
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, name, config: pConfig } : p)));
    },
    [setProfiles],
  );

  const deleteProfile = useCallback(
    (id: string) => {
      const victim = profiles.find((p) => p.id === id);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      const reference = victim?.config.secretRef;
      if (!reference) return;
      // "Save current as profile" copies the reference along with everything else, so
      // two profiles and the live config can share one stored password. Deleting a
      // profile must not quietly blindside the ones still pointing at it.
      const stillReferenced =
        config.secretRef === reference ||
        profiles.some((p) => p.id !== id && p.config.secretRef === reference);
      if (stillReferenced) return;
      void dropSecret(reference).then((error) => {
        if (error) console.warn(`credential left behind for ${reference}: ${error}`);
      });
    },
    [profiles, config, setProfiles],
  );

  /** Re-register one topic filter live (subscription list changed) */
  const registerTopic = useCallback(async (topic: string, qos: number) => {
    if (!topic.trim()) return;
    await invoke('subscribe_topic', { topic: topic.trim(), qos });
  }, []);

  const unregisterTopic = useCallback(async (topic: string) => {
    await invoke('unsubscribe_topic', { topic });
  }, []);

  return {
    config,
    setConfig,
    profiles,
    status,
    isConnected: status.connected,
    isConnecting,
    connectionError,
    latency,
    isTestingLatency,
    connect,
    disconnect,
    toggleConnect,
    selectProfile,
    saveProfile,
    updateProfile,
    deleteProfile,
    testLatency,
    registerTopic,
    unregisterTopic,
  };
}
