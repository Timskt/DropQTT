import React, { useMemo } from 'react';
import { Archive } from 'lucide-react';
import { RetainedLineage } from '../../types';
import { Translations, fill } from '../../i18n';
import { ageUnit, orderRetained, retainedState } from '../../utils/retained';

interface Props {
  /** `null` when the backend did not answer, which is not the same as "none". */
  rows: RetainedLineage[] | null;
  t: Translations;
  /** Passed in rather than read here so one render agrees on a single instant. */
  nowMs: number;
  staleDays: number;
  onStaleDays: (days: number) => void;
}

const BARS = [1, 7, 30];

const agoText = (ageMs: number, t: Translations): string => {
  const { unit, n } = ageUnit(ageMs);
  if (unit === 'now') return t.retainedNow;
  if (unit === 'seconds') return fill(t.retainedSecondsAgo, { n });
  if (unit === 'minutes') return fill(t.retainedMinutesAgo, { n });
  if (unit === 'hours') return fill(t.retainedHoursAgo, { n });
  return fill(t.retainedDaysAgo, { n });
};

const Line: React.FC<{ row: RetainedLineage; t: Translations; nowMs: number }> = ({ row, t, nowMs }) => {
  const state = retainedState(row);
  const color = state === 'stale' ? 'var(--warning)' : state === 'cleared' ? 'var(--text-muted)' : 'var(--accent)';
  const label = state === 'stale' ? t.retainedStale : state === 'cleared' ? t.retainedCleared : t.retainedCurrent;
  return (
    <div
      className="px-3 py-1.5 text-[10px]"
      style={{ borderTop: '1px solid var(--border-inset)' }}
      data-testid="retained-row"
      data-state={state}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono truncate" style={{ color: 'var(--text-primary)' }} title={row.topic}>
          {row.topic}
        </span>
        <span className="font-mono" style={{ color }} data-testid="retained-state">
          {label}
        </span>
        <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
          {fill(t.retainedChangedAt, { ago: agoText(nowMs - row.lastTs, t) })}
        </span>
        <span className="font-mono" style={{ color: 'var(--text-muted)' }}>
          {fill(t.retainedVersions, { n: row.versions })}
        </span>
      </div>
      <div className="mt-1 font-mono truncate" style={{ color: 'var(--text-secondary)' }} title={row.payload}>
        {row.cleared ? '∅' : row.payload}
      </div>
      {row.truncated && !row.cleared && (
        <div className="mt-0.5" style={{ color: 'var(--warning)' }} data-testid="retained-truncated">
          {t.retainedTruncated}
        </div>
      )}
    </div>
  );
};

/**
 * The retained value of each topic, and its age.
 *
 * A broker answers a new subscriber with the retained value it holds and never
 * says how old it is, which is why a config pushed once and never cleared keeps
 * being delivered for years and nobody notices. The history store already holds
 * every retained publish that came through, so this is that ledger read back —
 * versions, the live value, whether it was deleted, and how long it has been
 * sitting.
 */
export const RetainedCard: React.FC<Props> = ({ rows, t, nowMs, staleDays, onStaleDays }) => {
  const ordered = useMemo(() => (rows ? orderRetained(rows) : []), [rows]);

  return (
    <div className="inset-box mt-2" data-testid="retained-card">
      <div
        className="flex items-center gap-2 px-3 py-2 flex-wrap"
        style={{ borderBottom: '1px solid var(--border-inset)' }}
      >
        <Archive className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <span className="text-[11px] font-medium shrink-0">{t.retainedTitle}</span>
        <select
          value={staleDays}
          onChange={(e) => onStaleDays(Number(e.target.value))}
          aria-label={fill(t.retainedBar, { days: staleDays })}
          data-testid="retained-bar"
          className="field-input"
        >
          {BARS.map((d) => (
            <option key={d} value={d}>
              {fill(t.retainedBar, { days: d })}
            </option>
          ))}
        </select>
      </div>

      {rows === null ? (
        <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--text-muted)' }} data-testid="retained-unavailable">
          {t.retainedNoBackend}
        </div>
      ) : ordered.length === 0 ? (
        <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--text-muted)' }} data-testid="retained-empty">
          {t.retainedNone}
        </div>
      ) : (
        ordered.map((row) => <Line key={row.topic} row={row} t={t} nowMs={nowMs} />)
      )}

      {/* The claim is bounded whether the list has rows in it or not: "nothing
          recorded" is a statement about what we saw, not about the broker. */}
      {rows !== null && (
        <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--text-muted)' }} data-testid="retained-caveat">
          {t.retainedCaveat}
        </div>
      )}
    </div>
  );
};
