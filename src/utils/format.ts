/**
 * Byte sizes had six local implementations with six rounding rules, so the same
 * file could read `1.5 MB` in the transfer queue and `1.50 MB` in the history
 * panel -- and one of them never reached MB at all, printing `1536.00 KB`.
 * There is now one rule: bytes are integers, KB takes one decimal, MB and above
 * take two.
 */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value.toFixed(unit === 1 ? 1 : 2)} ${UNITS[unit]}`;
}

/**
 * Uptime in the two coarsest units. An operator reading this is asking one of two
 * questions — "did it just restart?" or "how long has it been up?" — and both are
 * answered by the leading pair; a seconds-precision tail would only add noise.
 */
export function formatUptime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return '0s';
  const s = Math.floor(totalSec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${String(h % 24).padStart(2, '0')}h`;
}

/**
 * "How long ago" for a unix-seconds stamp, in the coarsest unit that still reads
 * as recent. The caller passes `nowSec` so a whole list shares one clock instead
 * of each row rendering a different instant.
 */
export function relativeFromNow(unixSec: number, nowSec: number): string {
  const d = Math.max(0, nowSec - unixSec);
  if (d < 2) return 'now';
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  return `${Math.floor(d / 3600)}h`;
}

export type AgeUnit = 'now' | 'seconds' | 'minutes' | 'hours' | 'days';

/**
 * The same stepping `relativeFromNow` renders literally, returned as unit plus
 * count so each caller can put it into its own words. A view that localises
 * needs the number separated from the unit; one that fills a status column does not.
 *
 * Coarse on purpose: these ages answer "from this minute or from last year", and
 * a reading like "3.2 days" implies a precision we do not have — we know when we
 * saw something, not when it was set. Negative input is an age of zero, because a
 * device with a fast clock must not read as a countdown.
 */
export function ageUnit(ageMs: number): { unit: AgeUnit; n: number } {
  const secs = Math.max(0, Math.floor(ageMs / 1000));
  if (secs < 5) return { unit: 'now', n: 0 };
  if (secs < 60) return { unit: 'seconds', n: secs };
  if (secs < 3_600) return { unit: 'minutes', n: Math.floor(secs / 60) };
  if (secs < 86_400) return { unit: 'hours', n: Math.floor(secs / 3_600) };
  return { unit: 'days', n: Math.floor(secs / 86_400) };
}

/**
 * One timestamp for every file this app writes out.
 *
 * The four export paths used to build their own — a sliced ISO here, a full ISO
 * with punctuation stripped there, a bare `Date.now()` millisecond count that no
 * human can read — which meant two artifacts from the same session sorted apart
 * and named differently. UTC with an explicit `Z`, because a filename nobody is
 * standing in front of a screen cannot carry the viewer's zone.
 */
export function exportStamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace(/[:.]/g, '-') + 'Z';
}

/**
 * `UTC+08:00` / `UTC-03:30` / `UTC+05:30`.
 *
 * Takes the value of `Date#getTimezoneOffset`, which is **inverted** — minutes to
 * add to local time to reach UTC, so Beijing reports -480 and Newfoundland +210.
 * Naming the parameter after that method is the guard: reading a raw number into
 * it the other way round would print a zone that is the mirror of the real one.
 * Half-hour and three-quarter-hour offsets exist, so minutes are printed, not
 * assumed to be zero.
 */
export function utcOffsetLabel(getTimezoneOffsetMinutes: number): string {
  const sign = getTimezoneOffsetMinutes <= 0 ? '+' : '-';
  const total = Math.abs(Math.round(getTimezoneOffsetMinutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `UTC${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
