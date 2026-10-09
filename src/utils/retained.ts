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

export type AgeUnit = 'now' | 'seconds' | 'minutes' | 'hours' | 'days';

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

/**
 * How long ago we last saw this topic's retained value change.
 *
 * Deliberately coarse. The question is "from this week or from last year", and a
 * reading like "3.2 days" would imply a precision the data does not carry: we know
 * when we *saw* it, not when the publisher set it.
 */
export const ageUnit = (ageMs: number): { unit: AgeUnit; n: number } => {
  const secs = Math.max(0, Math.floor(ageMs / 1000));
  if (secs < 5) return { unit: 'now', n: 0 };
  if (secs < 60) return { unit: 'seconds', n: secs };
  if (secs < 3_600) return { unit: 'minutes', n: Math.floor(secs / 60) };
  if (secs < 86_400) return { unit: 'hours', n: Math.floor(secs / 3_600) };
  return { unit: 'days', n: Math.floor(secs / 86_400) };
};
