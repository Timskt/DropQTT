import React, { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Activity, GitBranch, Loader2 } from 'lucide-react';
import { TimelineEntity, TimelineResult } from '../../types';
import { fill, Translations } from '../../i18n';

/** The window the chart is drawn against, resolved the way the list resolves it. */
export interface TimelineWindow {
  sinceMs: number;
  untilMs: number;
}

interface TimelineCardProps {
  t: Translations;
  /** The panel's current topic filter, so the timeline and the list agree. */
  search: string;
  windowMs: number;
  oldestTs?: number | null;
  totalRows: number;
}

const DEPTHS = [1, 2, 3, 4];

/** Where a moment falls on the track, 0..100 percent of the window. */
export const pct = (ms: number, win: TimelineWindow): number => {
  const span = win.untilMs - win.sinceMs;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((ms - win.sinceMs) / span) * 100));
};

const clockOf = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const silenceOf = (ms: number, t: Translations): string => {
  if (ms <= 0) return t.timelineNeverSilent;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

const Row: React.FC<{ entity: TimelineEntity; t: Translations; win: TimelineWindow }> = ({ entity, t, win }) => {
  const unanswered = entity.marks.filter((m) => !m.answered).length;
  return (
    <div className="space-y-1" data-testid={`timeline-row-${entity.entity}`}>
      <div className="flex items-baseline gap-2 flex-wrap text-[10px] font-mono">
        <span className="truncate max-w-[45%]" style={{ color: 'var(--text-primary)' }} title={entity.entity}>
          {entity.entity}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          {fill(t.timelineRow, {
            messages: String(entity.messages),
            segments: String(entity.segments.length),
            longest: silenceOf(entity.longestGapMs, t),
          })}
        </span>
        {entity.marks.length > 0 && (
          <span style={{ color: unanswered > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {fill(t.timelineRpc, { answered: String(entity.marks.length - unanswered), total: String(entity.marks.length) })}
          </span>
        )}
      </div>
      <div
        className="relative h-4 rounded overflow-hidden"
        style={{ background: 'var(--bg-raised)' }}
        role="img"
        aria-label={fill(t.timelineRowAria, {
          entity: entity.entity,
          messages: String(entity.messages),
          segments: String(entity.segments.length),
        })}
      >
        {entity.segments.map((s, i) => {
          const left = pct(s.startMs, win);
          const width = Math.max(0.5, pct(s.endMs, win) - left);
          return (
            <div
              key={`${s.startMs}-${i}`}
              className="absolute top-0 bottom-0"
              style={{ left: `${left}%`, width: `${width}%`, background: 'var(--success)', opacity: 0.75 }}
              title={fill(t.timelineSegmentTitle, {
                from: clockOf(s.startMs),
                to: clockOf(s.endMs),
                messages: String(s.messages),
              })}
              data-testid="timeline-segment"
            />
          );
        })}
        {entity.marks.map((m, i) => (
          <div
            key={`${m.tsMs}-${i}`}
            className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
            style={{
              left: `calc(${pct(m.tsMs, win)}% - 3px)`,
              background: m.answered ? 'var(--accent)' : 'var(--danger)',
              boxShadow: '0 0 0 1px var(--bg-panel-solid)',
            }}
            title={
              m.answered
                ? fill(t.timelineMarkAnswered, { at: clockOf(m.tsMs), topic: m.topic, rtt: String(m.rttMs ?? 0) })
                : fill(t.timelineMarkUnanswered, { at: clockOf(m.tsMs), topic: m.topic })
            }
            data-testid={m.answered ? 'timeline-mark' : 'timeline-mark-lost'}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * Time on the horizontal axis, one row per topic prefix. The list answers "what
 * happened"; this answers "when did it stop happening", which is the question a
 * field engineer actually asks about a gateway that has been quiet since 3 am.
 *
 * Built on demand rather than on every search: it scans the window instead of
 * using the ts index, so it should cost what it costs only when asked.
 */
export const TimelineCard: React.FC<TimelineCardProps> = ({ t, search, windowMs, oldestTs, totalRows }) => {
  const [depth, setDepth] = useState(2);
  const [gapSec, setGapSec] = useState(30);
  const [result, setResult] = useState<TimelineResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tookMs, setTookMs] = useState<number | null>(null);

  const build = useCallback(async () => {
    setBusy(true);
    setError(null);
    const started = performance.now();
    // Resolved here rather than in render: the window is the moment the button was
    // pressed, and `Date.now()` has no business being called while rendering.
    const until = Date.now();
    const win: TimelineWindow = {
      sinceMs: windowMs > 0 ? until - windowMs : Math.min(oldestTs ?? until, until),
      untilMs: until,
    };
    try {
      const r = await invoke<TimelineResult>('history_timeline', {
        search,
        sinceMs: win.sinceMs,
        untilMs: win.untilMs,
        depth,
        gapMs: Math.max(1, gapSec) * 1000,
        maxEntities: null,
      });
      setResult(r);
      setTookMs(Math.round(performance.now() - started));
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [depth, gapSec, search, oldestTs, windowMs]);

  const thresholdInvalid = gapSec < 1;
  const nothingToPlace = totalRows === 0;

  return (
    <div className="inset-box mx-4 mt-4 px-3 py-2.5 space-y-2" data-testid="timeline-card">
      <div className="flex items-center gap-2 flex-wrap">
        <Activity className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t.timelineTitle}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {t.timelineHint}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          <GitBranch className="w-3 h-3" />
          {t.timelineDepth}
          <select
            className="field-input text-[10px] font-mono"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            data-testid="timeline-depth"
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {fill(t.timelineDepthLevels, { n: String(d) })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {t.timelineGap}
          <input
            type="number"
            min={1}
            className="field-input w-16 text-[10px] font-mono"
            value={gapSec}
            onChange={(e) => setGapSec(Number(e.target.value))}
            data-testid="timeline-gap"
          />
        </label>
        <button
          type="button"
          onClick={() => void build()}
          disabled={busy || thresholdInvalid || nothingToPlace}
          title={
            nothingToPlace
              ? t.timelineBuildDisabledEmpty
              : thresholdInvalid
                ? t.timelineBuildDisabledGap
                : undefined
          }
          className="btn-accent !px-2 !py-1 text-[10px] disabled:opacity-50"
          data-testid="timeline-build"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
          {t.timelineBuild}
        </button>
        {result && !busy && (
          <span className="text-[10px] font-mono ml-auto" style={{ color: 'var(--text-muted)' }}>
            {fill(t.timelineBuilt, { ms: String(tookMs ?? 0), rows: String(result.rowsScanned) })}
          </span>
        )}
      </div>

      {thresholdInvalid && (
        <p className="text-[10px]" style={{ color: 'var(--danger)' }} data-testid="timeline-gap-error">
          {t.timelineGapTooSmall}
        </p>
      )}
      {error && (
        <p className="text-[10px]" style={{ color: 'var(--danger)' }} data-testid="timeline-error">
          {error}
        </p>
      )}

      {result && result.entities.length === 0 && !error && (
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }} data-testid="timeline-empty">
          {t.timelineEmpty}
        </p>
      )}

      {result && result.entities.length > 0 && (
        <div className="space-y-2.5" data-testid="timeline-result">
          <div className="flex items-center gap-3 flex-wrap text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            <span data-testid="timeline-summary">
              {fill(t.timelineSummary, {
                entities: String(result.entities.length),
                gap: silenceOf(result.gapMs, t),
                window: clockOf(result.windowStartMs),
              })}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2 rounded-sm" style={{ background: 'var(--success)', opacity: 0.75 }} />
              {t.timelineLegendTraffic}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
              {t.timelineLegendAnswered}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--danger)' }} />
              {t.timelineLegendUnanswered}
            </span>
          </div>
          {result.entities.map((e) => (
            <Row key={e.entity} entity={e} t={t} win={{ sinceMs: result.windowStartMs, untilMs: result.windowEndMs }} />
          ))}
          {result.entitiesDropped > 0 && (
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }} data-testid="timeline-dropped">
              {fill(t.timelineDropped, { n: String(result.entitiesDropped) })}
            </p>
          )}
          {result.truncated && (
            <p className="text-[10px]" style={{ color: 'var(--warning)' }} data-testid="timeline-truncated">
              {fill(t.timelineTruncated, { rows: String(result.rowsScanned) })}
            </p>
          )}
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }} data-testid="timeline-caveat">
            {t.timelineInference}
          </p>
        </div>
      )}
    </div>
  );
};
