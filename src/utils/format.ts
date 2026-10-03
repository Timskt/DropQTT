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
