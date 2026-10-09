import { useEffect } from 'react';
import { usePersistentState } from './usePersistentState';
import { setTimePref, TimePref } from '../utils/timePref';

/**
 * Toggle between UTC and local time for every timestamp in the UI.
 *
 * A forensics tool that shows the same instant two different ways — the UI in
 * local time, the export in UTC — and labels neither is a trap: cross-timezone
 * collaboration, correlating with broker logs, or reading a device's own clock
 * all go wrong. This gives every surface one shared preference; the panels say
 * which zone is in play once, rather than stamping it on every row.
 *
 * Default is `'local'`, because the person staring at the screen is in that zone;
 * the toggle exists for when the artifact they are building is for someone else,
 * or for a log file that is already in UTC.
 *
 * Reacting to a change: the module store (what `fmtClock`/`fmtDateTime` read)
 * updates inside `useEffect`, and the *component that mounts this hook*
 * re-renders on the state change anyway — so the format functions see the new
 * value on that same re-render. Components that don't mount this hook keep the
 * last value they read at render time, which is correct because they only
 * re-render when something else changes them.
 */
export function useTimePref(): {
  pref: TimePref;
  setPref: (v: TimePref) => void;
} {
  const [pref, setPref] = usePersistentState<TimePref>('dropqtt_time_pref', 'local');

  useEffect(() => {
    setTimePref(pref);
  }, [pref]);

  return { pref, setPref };
}
