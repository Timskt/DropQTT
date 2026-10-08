import { SubRejection } from '../types';

/**
 * Whether a broker verdict deserves a toast right now.
 *
 * A refused SUBACK drops the session in rumqttc, so every automatic reconnect re-subscribes
 * and gets refused again: without this, one ACL problem becomes one toast per second until
 * the user intervenes. The verdict itself stays on screen (the red chip is state, not a
 * toast) -- only the repeated interruption is suppressed.
 *
 * Keyed by filter *and* reason code, so a broker that changes its mind -- different reason,
 * or refusal after an earlier grant -- still speaks up.
 */
export const verdictKey = (r: SubRejection): string => `${r.filter}\u0000${r.code}`;

/**
 * `seen` is mutated in place and holds the keys already announced. Pass a fresh map to
 * announce everything again (an explicit reconnect after the user changed something).
 */
export function isNewVerdict(seen: Set<string>, r: SubRejection): boolean {
  return isNewKey(seen, verdictKey(r));
}

/** The general form: any broker verdict that can arrive again on every reconnect. */
export function isNewKey(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

/** Drop remembered verdicts for filters that are no longer refused, so a later refusal can notify again. */
export function pruneVerdicts(seen: Set<string>, stillRejected: string[]): void {
  const live = new Set(stillRejected);
  for (const key of Array.from(seen)) {
    const filter = key.split('\u0000')[0];
    if (!live.has(filter)) seen.delete(key);
  }
}
