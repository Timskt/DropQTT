import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ConsolePublishParams, FeedBatch, MqttGenericMessage, TopicSubscription } from '../types';
import { usePersistentState } from './usePersistentState';
import { toast } from '../utils/toast';
import { observeTopic } from '../utils/topicStore';

const MAX_MESSAGES = 500;

const DEFAULT_SUBS: TopicSubscription[] = [
  { topic: 'dropqtt/#', qos: 1, color: '#06b6d4' },
  { topic: 'test/topic', qos: 0, color: '#10b981' },
];

/**
 * MQTT console state: subscription registry (persisted + backend-registered),
 * live message feed, and binary-capable publishing.
 */
export function useMqttMessages(isConnected: boolean) {
  const [subscriptions, setSubscriptions] = usePersistentState<TopicSubscription[]>(
    'dropqtt_subscriptions',
    DEFAULT_SUBS,
  );
  const [messages, setMessages] = useState<MqttGenericMessage[]>([]);
  const [paused, setPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  // Cumulative backend feed drops under overload (stats stay exact)
  const [feedDropped, setFeedDropped] = useState(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const pendingRef = useRef<MqttGenericMessage[]>([]);
  const connectedRef = useRef(isConnected);
  connectedRef.current = isConnected;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      // Backend batches the feed at ~10 Hz — one IPC event per batch, so
      // thousands of msgs/sec no longer flood the webview.
      unlisten = await listen<FeedBatch>('mqtt-messages', (event) => {
        if (disposed) return;
        setFeedDropped(event.payload.dropped);
        // Backend sends oldest-first; the feed renders newest on top
        const incoming = event.payload.messages.slice().reverse();
        // Feed the autocomplete registry with this batch's distinct topics
        for (const topic of new Set(event.payload.messages.map((m) => m.topic))) {
          observeTopic(topic);
        }
        if (pausedRef.current) {
          // Buffer while the feed is frozen; flush on resume (capped)
          pendingRef.current = [...incoming, ...pendingRef.current].slice(0, MAX_MESSAGES);
          setPendingCount(pendingRef.current.length);
          return;
        }
        setMessages((prev) => [...incoming, ...prev].slice(0, MAX_MESSAGES));
      });
    };
    setup();

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  const pauseFeed = useCallback(() => setPaused(true), []);

  const resumeFeed = useCallback(() => {
    const buffered = pendingRef.current;
    pendingRef.current = [];
    setPendingCount(0);
    setPaused(false);
    if (buffered.length > 0) {
      setMessages((prev) => [...buffered, ...prev].slice(0, MAX_MESSAGES));
    }
  }, []);

  const togglePaused = useCallback(() => {
    if (pausedRef.current) resumeFeed();
    else setPaused(true);
  }, [resumeFeed]);

  /** Current subscription list snapshot (for connect-time registration) */
  const subscriptionsRef = useRef(subscriptions);
  subscriptionsRef.current = subscriptions;

  const addSubscription = useCallback(
    async (topic: string, qos: number, color?: string) => {
      const trimmed = topic.trim();
      if (!trimmed || subscriptionsRef.current.some((s) => s.topic === trimmed)) return;
      setSubscriptions((prev) =>
        prev.some((s) => s.topic === trimmed)
          ? prev
          : [...prev, { topic: trimmed, qos, color, createdAt: new Date().toLocaleTimeString() }],
      );
      if (connectedRef.current) {
        await invoke('subscribe_topic', { topic: trimmed, qos }).catch((e) => {
          toast.error(`订阅失败 ${trimmed}: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    },
    [setSubscriptions],
  );

  const removeSubscription = useCallback(
    async (topic: string) => {
      setSubscriptions((prev) => prev.filter((s) => s.topic !== topic));
      if (connectedRef.current) {
        await invoke('unsubscribe_topic', { topic }).catch((e) => {
          console.error('Unsubscribe error:', e);
        });
      }
    },
    [setSubscriptions],
  );

  /** Publish raw bytes encoded as base64; echoes into the feed via backend event */
  const publish = useCallback(async (params: ConsolePublishParams) => {
    await invoke('publish_console', { params });
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  const getTopicsToRegister = useCallback(
    () => subscriptionsRef.current.map((s) => ({ topic: s.topic, qos: s.qos })),
    [],
  );

  return {
    subscriptions,
    addSubscription,
    removeSubscription,
    messages,
    clearMessages,
    publish,
    getTopicsToRegister,
    paused,
    pendingCount,
    feedDropped,
    pauseFeed,
    resumeFeed,
    togglePaused,
  };
}
