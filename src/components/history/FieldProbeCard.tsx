import React, { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { HistoryRow } from '../../types';
import { Translations, fill } from '../../i18n';
import { fieldReport, isNumericSeries, SeriesGap, SeriesPoint } from '../../utils/fieldSeries';

const fmtClock = (ts: number): string => new Date(ts).toLocaleTimeString();

/**
 * A numeric series drawn with real breaks. The line is split wherever the samples went
 * silent, so "we received nothing for forty minutes" cannot be read as "the value did not
 * move" -- the single most misleading thing a history chart can do.
 */
const SeriesChart: React.FC<{ points: SeriesPoint[]; gaps: SeriesGap[]; t: Translations }> = ({ points, gaps, t }) => {
  const W = 600;
  const H = 110;
  const pad = 8;
  if (points.length < 2) return null;
  const t0 = points[0].ts;
  const t1 = points[points.length - 1].ts;
  const span = Math.max(1, t1 - t0);
  const lo = Math.min(...points.map((p) => p.value));
  const hi = Math.max(...points.map((p) => p.value));
  const ySpan = hi - lo || 1;
  const x = (ts: number): number => ((ts - t0) / span) * (W - pad * 2) + pad;
  const y = (v: number): number => H - pad - ((v - lo) / ySpan) * (H - pad * 2);

  // Cut the run at each gap so every segment is drawn between two real samples.
  const cuts = gaps.map((g) => g.fromTs);
  const segments: SeriesPoint[][] = [];
  let run: SeriesPoint[] = [];
  for (const p of points) {
    if (run.length && cuts.includes(run[run.length - 1].ts)) {
      segments.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) segments.push(run);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: '110px' }} data-testid="field-chart">
        {gaps.map((g, i) => (
          <rect key={`g${i}`} x={x(g.fromTs)} y={0} width={Math.max(2, x(g.toTs) - x(g.fromTs))} height={H} fill="var(--warn)" opacity={0.08} />
        ))}
        {segments.map((seg, i) => (
          <polyline
            key={`s${i}`}
            points={seg.map((p) => `${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {points.map((p, i) => (
          <circle key={`p${i}`} cx={x(p.ts)} cy={y(p.value)} r={2} fill="var(--accent)" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
        <span>{fmtClock(t0)}</span>
        {gaps.length > 0 && (
          <span data-testid="field-gap" style={{ color: 'var(--warn)' }}>
            {fill(t.fieldProbeGap, { seconds: Math.round(Math.max(...gaps.map((g) => g.gapMs)) / 1000) })}
          </span>
        )}
        <span>{fmtClock(t1)}</span>
      </div>
    </div>
  );
};

interface Props {
  rows: HistoryRow[];
  t: Translations;
  /** Paths the comparison just surfaced, so one can be followed up without retyping it. */
  suggested?: string[];
}

export const FieldProbeCard: React.FC<Props> = ({ rows, t, suggested }) => {
  const [draft, setDraft] = useState('');
  const [path, setPath] = useState('');

  const report = useMemo(() => (path ? fieldReport(rows, path) : null), [rows, path]);
  const chartable = report ? isNumericSeries(report.numeric) : false;

  const run = (p: string): void => {
    const clean = p.trim();
    if (!clean) return;
    setPath(clean);
    setDraft(clean);
  };

  return (
    <div className="inset-box" data-testid="field-probe">
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--border-inset)' }}>
        <Activity className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <span className="text-[11px] font-medium shrink-0">{t.fieldProbeTitle}</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run(draft)}
          placeholder={t.fieldProbePlaceholder}
          data-testid="field-probe-path"
          className="flex-1 min-w-0 bg-transparent text-[11px] font-mono outline-none"
          style={{ color: 'var(--text-primary)' }}
        />
        <button onClick={() => run(draft)} className="btn-ghost !px-2 !py-0.5 text-[10px]" data-testid="field-probe-run">
          {t.fieldProbeRun}
        </button>
      </div>

      {suggested && suggested.length > 0 && (
        <div className="px-3 py-1.5 flex items-center gap-1.5 flex-wrap text-[10px]" style={{ borderBottom: '1px solid var(--border-inset)', color: 'var(--text-muted)' }}>
          <span className="ui-label">{t.fieldProbeFromDiff}:</span>
          {suggested.slice(0, 8).map((p) => (
            <button key={p} onClick={() => run(p)} className="chip chip-neutral font-mono" data-testid="field-probe-suggest">
              {p}
            </button>
          ))}
        </div>
      )}

      {!report && <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.fieldProbeEmpty}</div>}

      {report && (
        <div className="px-3 py-2 flex flex-col gap-2">
          {/* Coverage always shows: "0 with field · 4 without" is the sentence that turns
              an empty chart from a mystery into an answer. */}
          <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }} data-testid="field-probe-coverage">
            {fill(t.fieldProbeCoverage, {
              value: report.counts.value,
              missing: report.counts.missing,
              notJson: report.counts.notJson,
              truncated: report.counts.truncated,
            })}
          </div>

          {report.counts.value === 0 ? (
            <div className="text-[11px]" style={{ color: 'var(--warn)' }} data-testid="field-probe-never">
              {t.fieldProbeNever}
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2 text-[11px] flex-wrap">
                <span className="ui-label">{t.fieldProbeLast}</span>
                <span className="font-mono font-semibold" style={{ color: 'var(--accent)' }} data-testid="field-probe-last">
                  {report.lastValue}
                </span>
                <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {report.lastTs !== null ? fmtClock(report.lastTs) : '—'}
                </span>
              </div>

              {chartable ? (
                <SeriesChart points={report.numeric.points} gaps={report.numeric.gaps} t={t} />
              ) : (
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {t.fieldProbeNotNumeric}
                </div>
              )}

              {report.values.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="ui-label text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {t.fieldProbeValues} ({report.values.length})
                  </span>
                  <div className="flex gap-1.5 flex-wrap">
                    {report.values.slice(0, 12).map((v) => (
                      <span key={v.value} className="chip chip-neutral font-mono text-[10px]" title={`${v.count} · ${fmtClock(v.firstTs)} → ${fmtClock(v.lastTs)}`}>
                        {v.value} ×{v.count}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-0.5">
                <span className="ui-label text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.fieldProbeChanges}</span>
                {report.changes.length === 0 ? (
                  <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }} data-testid="field-probe-nochange">
                    {fill(t.fieldProbeNoChange, { count: report.counts.value })}
                  </div>
                ) : (
                  <div className="max-h-[18vh] overflow-y-auto">
                    {report.changes.map((c, i) => (
                      <div key={i} className="grid grid-cols-[70px_1fr_auto_auto] gap-2 text-[10px] font-mono py-0.5" style={{ borderTop: '1px solid var(--border-inset)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{fmtClock(c.ts)}</span>
                        <span className="truncate" title={c.topic}>{c.topic}</span>
                        <span style={{ color: 'var(--warn)' }}>{c.from}</span>
                        <span style={{ color: 'var(--ok)' }}>{c.to}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
