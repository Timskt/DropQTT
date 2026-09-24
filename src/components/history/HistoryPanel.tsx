import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Archive, RefreshCw, Search, Trash2, ArrowUpRight, ArrowDownRight, Clock,
  Inbox, Send, Rss, Filter, Copy, Check, Zap, BarChart3,
} from 'lucide-react';
import { ConsolePublishParams, HistoryRow, HistorySeriesPoint, HistoryStats } from '../../types';
import { Translations } from '../../i18n';
import { copyToClipboard } from '../../utils/clipboard';
import { toast } from '../../utils/toast';

interface HistoryPanelProps {
  t: Translations;
  connected: boolean;
  isV5: boolean;
  onPublish: (params: ConsolePublishParams) => Promise<void>;
  onSubscribe: (topic: string) => void;
}

const WINDOWS = [
  { id: '5m', ms: 5 * 60_000, label: '5m' },
  { id: '15m', ms: 15 * 60_000, label: '15m' },
  { id: '1h', ms: 60 * 60_000, label: '1h' },
  { id: '24h', ms: 24 * 60 * 60_000, label: '24h' },
];

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();
const fmtDateTime = (ms: number) => new Date(ms).toLocaleString();
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Human span between two epoch-ms stamps (e.g. "2d 3h", "1m 20s"). */
const fmtSpan = (from?: number | null, to?: number | null): string => {
  if (!from || !to || to < from) return '—';
  let s = Math.floor((to - from) / 1000);
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
};

/** Single-line, whitespace-collapsed payload preview for a history row. */
const previewOf = (r: HistoryRow, t: Translations): string => {
  const raw = (r.payload || '').replace(/\s+/g, ' ').trim();
  if (!raw) return r.payloadBase64 ? `⋯ ${t.historyBinary} · ${fmtBytes(r.payloadLen)}` : `(${t.historyEmptyPayload})`;
  return raw.length > 90 ? `${raw.slice(0, 90)}…` : raw;
};

/** Dependency-free SVG area chart with gradient fill, peak marker and time axis. */
const TrendChart: React.FC<{ points: HistorySeriesPoint[]; color: string; t: Translations }> = ({ points, color, t }) => {
  const W = 600;
  const H = 120;
  const pad = 8;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.count));
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (c: number) => H - pad - (c / max) * (H - pad * 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ');
  const area = n ? `${line} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z` : '';
  const peakIdx = points.reduce((best, p, i) => (p.count > points[best].count ? i : best), 0);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: '120px' }}>
        <defs>
          <linearGradient id="histArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.38} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={W} y1={H * g} y2={H * g} stroke={color} strokeOpacity={0.08} strokeWidth={1} />
        ))}
        {n > 0 && <path d={area} fill="url(#histArea)" />}
        {n > 0 && <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {n > 0 && <circle cx={x(peakIdx)} cy={y(points[peakIdx].count)} r={2.6} fill={color} />}
      </svg>
      {n > 0 && (
        <div className="flex justify-between text-[10px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
          <span>{new Date(points[0].bucket).toLocaleTimeString()}</span>
          <span style={{ color }}>{t.historyPeak}: {max.toLocaleString()}/桶</span>
          <span>{new Date(points[n - 1].bucket).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
};

const StatTile: React.FC<{ icon: React.ReactNode; label: string; value: string; color: string }> = ({ icon, label, value, color }) => (
  <div className="inset-box px-3 py-2.5 flex items-center gap-3">
    <span className="p-2 rounded-md" style={{ background: 'color-mix(in srgb, var(--bg-panel) 60%, transparent)', color }}>
      {icon}
    </span>
    <div className="min-w-0">
      <div className="text-[10px] ui-label truncate">{label}</div>
      <div className="text-lg font-semibold font-mono leading-tight truncate" style={{ color }}>{value}</div>
    </div>
  </div>
);

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ t, connected, isV5, onPublish, onSubscribe }) => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const [limit, setLimit] = useState<number>(200);
  const [windowId, setWindowId] = useState('15m');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [series, setSeries] = useState<HistorySeriesPoint[]>([]);
  const [stats, setStats] = useState<HistoryStats>({ rows: 0, inbound: 0, outbound: 0 });
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh: keep the view live without hammering when off.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => loadRef.current(), 3000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  const handleCopy = async (id: string, text: string) => {
    if (await copyToClipboard(text)) {
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1400);
    }
  };

  const handleResend = async (r: HistoryRow) => {
    try {
      await onPublish({
        topic: r.topic,
        payloadBase64: r.payloadBase64,
        qos: r.qos,
        retain: r.retain,
        properties: { contentType: r.contentType ?? undefined, userProperties: [] },
      });
      toast.success(`${t.historyResend}: ${r.topic}`);
    } catch (e) {
      toast.error(`${t.historyResend} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const clearAll = useCallback(async () => {
    if (!confirm(t.historyClearConfirm)) return;
    await invoke('clear_history').catch(() => {});
    load();
  }, [load, t.historyClearConfirm]);

  const totalInWindow = useMemo(() => series.reduce((a, p) => a + p.count, 0), [series]);
  const win = WINDOWS.find((w) => w.id === windowId) ?? WINDOWS[1];

  return (
    <div className="space-y-4 max-w-6xl mx-auto flex flex-col">
      {/* Header */}
      <div className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center space-x-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            <Archive className="w-4 h-4" style={{ color: 'var(--sky)' }} />
            <span>{t.historyTitle}</span>
            <span className="chip chip-sky">{stats.rows.toLocaleString()} {t.historyRowsUnit}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              title={t.historyAutoRefresh}
              aria-pressed={autoRefresh}
              className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[10px]"
              style={autoRefresh ? { color: 'var(--sky)', background: 'color-mix(in srgb, var(--sky) 14%, transparent)' } : undefined}
            >
              <Zap className={`w-3 h-3 ${autoRefresh ? 'animate-pulse' : ''}`} /> {t.historyAutoRefresh}
            </button>
            <button onClick={load} className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[10px]">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {t.refresh}
            </button>
            <button onClick={clearAll} disabled={stats.rows === 0} className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[10px] disabled:opacity-40" style={{ color: 'var(--bad)' }}>
              <Trash2 className="w-3 h-3" /> {t.historyClear}
            </button>
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3" style={{ borderBottom: '1px solid var(--border-panel)' }}>
          <StatTile icon={<Archive className="w-4 h-4" />} label={t.historyStatTotal} value={stats.rows.toLocaleString()} color="var(--sky)" />
          <StatTile icon={<ArrowDownRight className="w-4 h-4" />} label={t.historyStatIn} value={stats.inbound.toLocaleString()} color="var(--ok)" />
          <StatTile icon={<ArrowUpRight className="w-4 h-4" />} label={t.historyStatOut} value={stats.outbound.toLocaleString()} color="var(--info)" />
          <StatTile icon={<Clock className="w-4 h-4" />} label={t.historyStatSpan} value={fmtSpan(stats.oldestTs, stats.newestTs)} color="var(--violet)" />
        </div>

        {/* Toolbar */}
        <div className="p-3 flex flex-wrap items-center gap-2 text-[11px]" style={{ borderBottom: '1px solid var(--border-panel)' }}>
          <div className="relative flex-1 min-w-[200px]">
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
                className="px-2.5 py-1 rounded text-[11px] transition"
                style={
                  direction === d
                    ? { background: 'color-mix(in srgb, var(--sky) 18%, transparent)', color: 'var(--sky)', fontWeight: 600 }
                    : { color: 'var(--text-secondary)' }
                }
              >
                {d === 'all' ? t.allDirections : d.toUpperCase()}
              </button>
            ))}
          </div>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="field-input" title={t.historyStatTotal}>
            {[100, 200, 500, 1000, 2000].map((n) => (<option key={n} value={n}>{n}</option>))}
          </select>
          <button onClick={load} className="btn-accent !py-1.5">{t.historyQuery}</button>
        </div>

        {/* Trend chart */}
        <div className="p-3" style={{ borderBottom: '1px solid var(--border-panel)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <BarChart3 className="w-3.5 h-3.5" style={{ color: 'var(--sky)' }} />
              {t.historyTrend} · {search ? search : t.historyAllTopics}
              <span style={{ color: 'var(--text-muted)' }}>· {win.label}</span>
            </span>
            <div className="flex items-center gap-1">
              {WINDOWS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setWindowId(w.id)}
                  className="px-2 py-0.5 rounded text-[10px] transition"
                  style={
                    windowId === w.id
                      ? { background: 'color-mix(in srgb, var(--sky) 18%, transparent)', color: 'var(--sky)', fontWeight: 600 }
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
              <TrendChart points={series} color="var(--sky)" t={t} />
              <div className="text-[10px] mt-1 text-right" style={{ color: 'var(--text-muted)' }}>
                {t.historyWindowTotal}: <span className="font-mono" style={{ color: 'var(--sky)' }}>{totalInWindow.toLocaleString()}</span>
              </div>
            </>
          )}
        </div>

        {/* Results */}
        <div className="flex items-center justify-between px-3 py-1.5 text-[10px]" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-inset)' }}>
          <span>{t.historyShowing.replace('{count}', String(rows.length))}</span>
          {loading && <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> {t.refresh}</span>}
        </div>
        <div className="max-h-[52vh] overflow-y-auto">
          {rows.length === 0 && !loading ? (
            <div className="p-10 text-center flex flex-col items-center gap-2">
              <Inbox className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
              <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{t.historyEmptyTitle}</div>
              <div className="text-[11px] max-w-sm" style={{ color: 'var(--text-muted)' }}>{t.historyEmptyHint}</div>
            </div>
          ) : (
            rows.map((r, idx) => {
              const expanded = expandedId === r.id;
              return (
                <div key={r.id} style={idx > 0 ? { borderTop: '1px solid var(--border-inset)' } : undefined}>
                  <div
                    className="px-3 py-2 text-[11px] flex items-center gap-2 cursor-pointer transition hover:brightness-110"
                    style={expanded ? { background: 'var(--hover)' } : undefined}
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                  >
                    <span className={`chip ${r.direction === 'out' ? 'chip-info' : 'chip-ok'} shrink-0`}>
                      {r.direction === 'out' ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                    </span>
                    <span className="font-mono shrink-0 max-w-[34%] truncate" style={{ color: 'var(--text-primary)' }} title={r.topic}>{r.topic}</span>
                    <span className="font-mono truncate flex-1" style={{ color: 'var(--text-muted)' }}>{previewOf(r, t)}</span>
                    {r.retain && <span className="chip chip-warn shrink-0">R</span>}
                    <span className="chip chip-neutral shrink-0">Q{r.qos}</span>
                    <span className="font-mono shrink-0 hidden md:inline" style={{ color: 'var(--text-muted)' }}>{fmtBytes(r.payloadLen)}</span>
                    <span className="font-mono shrink-0" style={{ color: 'var(--text-secondary)' }}>{fmtTime(r.ts)}</span>
                  </div>
                  {expanded && (
                    <div className="px-3 pb-3 animate-fade-in">
                      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {fmtDateTime(r.ts)}{r.contentType ? ` · ${r.contentType}` : ''} · {fmtBytes(r.payloadLen)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => handleCopy(r.id, r.payload || r.payloadBase64)} className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[10px]" style={{ color: copiedId === r.id ? 'var(--success)' : 'var(--accent)' }}>
                            {copiedId === r.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copiedId === r.id ? t.copied : t.copy}
                          </button>
                          <button onClick={() => setSearch(r.topic)} className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[10px]" title={t.historyFilterByTopic}>
                            <Filter className="w-3 h-3" /> {t.historyFilterByTopic}
                          </button>
                          <button onClick={() => onSubscribe(r.topic)} className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[10px]" title={t.historySubscribeTopic} style={{ color: 'var(--ok)' }}>
                            <Rss className="w-3 h-3" /> {t.historySubscribeTopic}
                          </button>
                          <button onClick={() => handleResend(r)} disabled={!connected || !r.payloadBase64} className="btn-accent !px-2 !py-1 flex items-center gap-1 text-[10px] disabled:opacity-40" title={t.historyResend}>
                            <Send className="w-3 h-3" /> {t.historyResend}
                          </button>
                        </div>
                      </div>
                      <pre className="select-text w-full text-[11px] font-mono whitespace-pre-wrap break-all rounded-md border p-2.5 max-h-56 overflow-y-auto" style={{ background: 'var(--bg-code)', borderColor: 'rgba(148,163,184,0.2)', color: '#d3dae6' }}>
                        {r.payload || `(base64 ${r.payloadLen}B)`}
                      </pre>
                      {isV5 && <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>MQTT 5</div>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
