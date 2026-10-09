import type { RetainedLineage } from '../types';

export type RetainedState = 'cleared' | 'stale' | 'live';

/**
 * Which chip a topic gets.
 *
 * A retained publish of zero bytes is how MQTT *deletes* a retained value, so a
 * cleared topic has no live value left to age. Ordering matters: calling a
 * deletion "stale" would send someone to clear a value that is already gone.
 */
export const retainedState = (r: Pick<RetainedLineage, 'cleared' | 'stale'>): RetainedState =>
  r.cleared ? 'cleared' : r.stale ? 'stale' : 'live';

/**
 * Stale ones first.
 *
 * The reason this view exists is the zombie: a retained config pushed once and
 * never cleared, still delivered to every new subscriber. Newest-change-first
 * would file that finding at the bottom of the list, so the ordering is a
 * judgement about what the reader came for, not a default.
 */
export const orderRetained = <T extends { topic: string; stale: boolean; lastTs: number }>(
  rows: readonly T[],
): T[] =>
  [...rows].sort(
    (a, b) => Number(b.stale) - Number(a.stale) || b.lastTs - a.lastTs || a.topic.localeCompare(b.topic),
  );
