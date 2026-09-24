import { useSyncExternalStore } from 'react';

/**
 * Observed MQTT topics — a lightweight global registry fed by the live message
 * stream. Subscribed/published topic inputs use it for autocomplete, so real
 * broker traffic surfaces as suggestions (complements the manual "recent" list).
 * Bounded + change-gated to avoid re-render storms under high message rates.
 */
const MAX_TOPICS = 200;

let topics: string[] = []; // newest-first, unique
let snapshot: string[] = topics;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Record a topic as observed (no-op for empty / already-newest / $SYS lines). */
export function observeTopic(topic: string): void {
  const t = topic.trim();
  if (!t || t.startsWith('$') || topics[0] === t) return;
  const idx = topics.indexOf(t);
  if (idx === 0) return;
  if (idx > 0) topics.splice(idx, 1);
  topics.unshift(t);
  if (topics.length > MAX_TOPICS) topics.length = MAX_TOPICS;
  snapshot = topics.slice();
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reactive newest-first list of observed topics for autocomplete. */
export function useObservedTopics(): string[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
