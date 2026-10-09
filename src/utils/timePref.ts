import { utcOffsetLabel } from './format';

/**
 * Module-level time-zone preference, shared by every formatting call site.
 *
 * The alternative — threading a `pref` prop through every panel that prints a
 * timestamp — would touch dozens of components for a single boolean. Instead the
 * hook (`useTimePref`) writes this module state on change and every `fmt*`
 * helper reads it, so a toggle in Settings re-renders every surface without a
 * prop change.
 *
 * Row-level timestamps stay *bare*: which zone they are in is stated once per
 * panel (the zone note), not repeated on every line — a table where each cell
 * carries `UTC+08:00` makes the offset drown the clock.
 *
 * `pref` is `'local'` by default and only ever set from the persisted hook, so a
 * fresh module (tests, a cold browser) starts in the viewer's own zone.
 */

export type TimePref = 'local' | 'utc';

let pref: TimePref = 'local';

export function setTimePref(next: TimePref): void {
  pref = next;
}

export function getTimePref(): TimePref {
  return pref;
}

/** The zone a bare timestamp is in, e.g. `local (UTC+08:00)` or `UTC`. */
export function zoneLabel(): string {
  if (pref === 'utc') return 'UTC';
  return `local (${utcOffsetLabel(new Date().getTimezoneOffset())})`;
}

/** `HH:MM:SS` in the chosen zone, no suffix — the panel says which zone once. */
export function fmtClock(ms: number): string {
  const d = new Date(ms);
  if (pref === 'utc') return d.toISOString().slice(11, 19);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** `YYYY-MM-DD HH:MM:SS` in the chosen zone, no suffix. */
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  if (pref === 'utc') return d.toISOString().slice(0, 19).replace('T', ' ');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
