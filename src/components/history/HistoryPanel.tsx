import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Archive, RefreshCw, Search, Trash2, ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react';
import { HistoryRow, HistorySeriesPoint, HistoryStats } from '../../types';
import { Translations } from '../../i18n';
import { copyToClipboard } from '../../utils/clipboard';
import { Check } from 'lucide-react';

interface HistoryPanelProps {
  t: Translations;
}

const WINDOWS = [
  { id: '5m', ms: 5 * 60_000, label: '5m' },
  { id: '15m', ms: 15 * 60_000, label: '15m' },
  { id: '1h', ms: 60 * 60_000, label: '1h' },
  { id: '24h', ms: 24 * 60 * 60_000, label: '24h' },
];

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();
const fmtDateTime = (ms: number) => new Date(ms).toLocaleString();

/** Minimal dependency-free SVG bar chart over time buckets. */
const TrendChart: React.FC<{ points: HistorySeriesPoint[]; color: string }> = ({ points, color }) => {
  const max = Math.max(1, ...points.map((p) => p.count));
  const W = 600;
  const H = 90;
  const n = Math.max(1, points.length);
  const bw = W / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: '90px' }}>
      {points.map((p, i) => {
        const h = (p.count / max) * (H - 6);
        return (
          <rect
            key={p.bucket}
            x={i * bw + 0.5}
            y={H - h}
            width={Math.max(1, bw - 1)}
            height={h}
            rx={1}
            fill={color}
            opacity={0.85}
          >
            <title>{`${new Date(p.bucket).toLocaleTimeString()}: ${p.count}`}</title>
          </rect>
        );
      })}
    </svg>
  );
};

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ t }) => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const [limit, setLimit] = useState<number>(200);
  const [windowId, setWindowId] = useState('15m');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [series, setSeries] = useState<HistorySeriesPoint[]>([]);
  const [stats, setStats] = useState<HistoryStats>({ rows: 0 });
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Debounce the free-text search so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const win = WINDOWS.find((w) => w.id === windowId) ?? WINDOWS[1];
      const since = Date.now() - win.ms;
      const bucket = Math.max(1000, Math.floor(win.ms / 60));
      const [r, s, st] = await Promise.all([
        invoke<HistoryRow[]>('query_history', { search: debouncedSearch, direction, limit }),
        invoke<HistorySeriesPoint[]>('history_series', { topic: debouncedSearch, bucketMs: bucket, sinceMs: since }),
        invoke<HistoryStats>('history_stats'),
      ]);
      setRows(r);
      setSeries(s);
      setStats(st);
    } catch (e) {
      console.error('history load:', e);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, direction, limit, windowId]);

  // Re-query whenever any control changes (window / direction / limit / search).
  useEffect(() => {
    load();
  }, [load]);

  const handleCopy = async (id: string, text: string) => {
    if (await copyToClipboard(text)) {
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1400);
    }
  };

  const clearAll = useCallback(async () => {
    if (!confirm(t.historyClearConfirm)) return;
    await invoke('clear_history').catch(() => {});
    load();
  }, [load, t.historyClearConfirm]);

  const totalInWindow = useMemo(() => series.reduce((a, p) => a + p.count, 0), [series]);

  return (
    <div className="space-y-4 max-w-6xl mx-auto flex flex-col">
      <div className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center space-x-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            <Archive className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            <span>{t.historyTitle}</span>
            <span className="chip chip-neutral">{stats.rows.toLocaleString()} {t.historyRowsUnit}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[10px]">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {t.refresh}
            </button>
            <button onClick={clearAll} disabled={stats.rows === 0} className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[10px] disabled:opacity-40" style={{ color: 'var(--bad)' }}>
              <Trash2 className="w-3 h-3" /> {t.historyClear}
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="p-3 flex flex-wrap items-center gap-2 text-[11px]" style={{ borderBottom: '1px solid var(--border-panel)' }}>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder={t.historySearchHint}
              className="field-input w-full pl-8"
            />
          </div>
          <div className="seg-box">
            {(['all', 'in', 'out'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className="px-2 py-1 rounded text-[11px] transition"
                style={
                  direction === d
                    ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', fontWeight: 600 }
                    : { color: 'var(--text-secondary)' }
                }
              >
                {d === 'all' ? t.allDirections : d.toUpperCase()}
              </button>
            ))}
          </div>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="field-input">
            {[100, 200, 500, 1000, 2000].map((n) => (<option key={n} value={n}>{n}</option>))}
          </select>
          <button onClick={load} className="btn-accent !py-1.5">{t.historyQuery}</button>
        </div>

        {/* Trend chart */}
        <div className="p-3" style={{ borderBottom: '1px solid var(--border-panel)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <Clock className="w-3 h-3" style={{ color: 'var(--accent)' }} />
              {t.historyTrend} · {search ? search : t.historyAllTopics}
            </span>
            <div className="flex items-center gap-1">
              {WINDOWS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => { setWindowId(w.id); }}
                  className="px-2 py-0.5 rounded text-[10px] transition"
                  style={
                    windowId === w.id
                      ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', fontWeight: 600 }
                      : { color: 'var(--text-muted)' }
                  }
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
          {series.length === 0 ? (
            <div className="text-center text-[11px] py-6" style={{ color: 'var(--text-muted)' }}>{t.historyNoTrend}</div>
          ) : (
            <>
              <TrendChart points={series} color="var(--accent)" />
              <div className="text-[10px] mt-1 text-right" style={{ color: 'var(--text-muted)' }}>
                {t.historyWindowTotal}: <span className="font-mono" style={{ color: 'var(--accent)' }}>{totalInWindow.toLocaleString()}</span>
              </div>
            </>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[460px] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>{t.historyEmpty}</div>
          ) : (
            rows.map((r, idx) => (
              <div key={r.id} style={idx > 0 ? { borderTop: '1px solid var(--border-inset)' } : undefined}>
                <div
                  className="px-3 py-2 text-[11px] flex items-center gap-2 cursor-pointer hover:brightness-110"
                  onClick={() => setExpandedId((x) => (x === r.id ? null : r.id))}
                >
                  <span className={`chip ${r.direction === 'out' ? 'chip-info' : 'chip-ok'}`}>
                    {r.direction === 'out' ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                    {r.direction.toUpperCase()}
                  </span>
                  <span className="font-mono truncate flex-1" style={{ color: 'var(--text-primary)' }} title={r.topic}>{r.topic}</span>
                  {r.retain && <span className="chip chip-warn">R</span>}
                  <span className="chip chip-neutral">Q{r.qos}</span>
                  <span className="font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>{r.payloadLen}B</span>
                  <span className="font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>{fmtTime(r.ts)}</span>
                </div>
                {expandedId === r.id && (
                  <div className="px-3 pb-2.5 animate-fade-in">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{fmtDateTime(r.ts)}{r.contentType ? ` · ${r.contentType}` : ''}</span>
                      <button onClick={() => handleCopy(r.id, r.payload)} className="flex items-center gap-1 text-[10px]" style={{ color: copiedId === r.id ? 'var(--success)' : 'var(--accent)' }}>
                        {copiedId === r.id ? <Check className="w-3 h-3" /> : <Search className="w-3 h-3" />} {copiedId === r.id ? t.copied : t.copy}
                      </button>
                    </div>
                    <pre className="select-text w-full text-[11px] font-mono whitespace-pre-wrap break-all rounded-md border p-2.5 max-h-56 overflow-y-auto" style={{ background: 'var(--bg-code)', borderColor: 'rgba(148,163,184,0.2)', color: '#d3dae6' }}>
                      {r.payload || '(binary)'}
                    </pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
