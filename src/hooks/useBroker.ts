import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { BrokerConfig, BrokerProfile, ConnectionStatus, DEFAULT_BROKER_CONFIG } from '../types';
import { usePersistentState } from './usePersistentState';

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
  getTopicsToRegister: () => { topic: string; qos: number }[];
}

/**
 * Broker connection lifecycle: config/profiles, connect/disconnect,
 * latency probe, and live status from backend events.
 */
export function useBroker({ getTopicsToRegister }: UseBrokerOptions) {
  const [config, setConfig] = usePersistentState<BrokerConfig>('dropqtt_active_broker', DEFAULT_BROKER_CONFIG);
  const [profiles, setProfiles] = usePersistentState<BrokerProfile[]>('dropqtt_broker_profiles', DEFAULT_PROFILES);

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
  topicsRef.current = getTopicsToRegister;

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
        await invoke('connect_broker', { config: cfg });
        setConfig(cfg);

        // Register all desired topics (backend re-applies them on every CONNACK,
        // including auto-reconnects — no manual re-subscribe loop needed).
        for (const { topic, qos } of topicsRef.current()) {
          if (!topic.trim()) continue;
          await invoke('subscribe_topic', { topic: topic.trim(), qos }).catch(() => {});
        }

        testLatency(cfg);
      } catch (err) {
        setConnectionError(String(err));
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [setConfig, testLatency],
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

  const deleteProfile = useCallback(
    (id: string) => {
      setProfiles((prev) => prev.filter((p) => p.id !== id));
    },
    [setProfiles],
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
    deleteProfile,
    testLatency,
    registerTopic,
    unregisterTopic,
  };
}
