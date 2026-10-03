import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes as fmtBytes } from '../../utils/format';
import { invoke } from '@tauri-apps/api/core';
import {
  Archive, RefreshCw, Search, Trash2, ArrowUpRight, ArrowDownRight, Clock,
  Inbox, Send, Rss, Filter, Copy, Check, Zap, BarChart3, Download, ChevronRight,
} from 'lucide-react';
import { ConsolePublishParams, HistoryRow, HistorySeriesPoint, HistoryStats } from '../../types';
import { Translations, fill } from '../../i18n';
import { copyToClipboard } from '../../utils/clipboard';
import { toast } from '../../utils/toast';
import { canReplayHistory, fillHistorySeries, historyMessage, historyPayload, HistoryView } from '../../utils/history';
import { exportMessages, ExportFormat } from '../../utils/exportMessages';

interface HistoryPanelProps {
  t: Translations;
  connected: boolean;
  onPublish: (params: ConsolePublishParams) => Promise<void>;
  onSubscribe: (topic: string) => void;
}

const WINDOWS = [
  { id: 'all', ms: 0, label: '' },
  { id: '5m', ms: 5 * 60_000, label: '5m' },
  { id: '15m', ms: 15 * 60_000, label: '15m' },
  { id: '1h', ms: 60 * 60_000, label: '1h' },
  { id: '24h', ms: 24 * 60 * 60_000, label: '24h' },
];

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();
const fmtDateTime = (ms: number) => new Date(ms).toLocaleString();

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
          <span style={{ color }}>{t.historyPeak}: {max.toLocaleString()} {t.historyPerBucket}</span>
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

const PayloadViewer: React.FC<{ row: HistoryRow; t: Translations }> = ({ row, t }) => {
  const [view, setView] = useState<HistoryView>(
    row.contentType?.includes('senml') ? 'senml'
      : row.contentType?.includes('cbor') ? 'cbor'
      : row.contentType?.includes('json') ? 'json' : 'text',
  );
  let text = '';
  let error = '';
  try { text = historyPayload(row, view); } catch (e) { error = String(e); }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="seg-box" aria-label={t.payloadFormat}>
          {(['text', 'json', 'senml', 'hex', 'base64', 'cbor'] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)} className="px-2 py-1 rounded text-[10px]" style={{ color: view === mode ? 'var(--accent)' : 'var(--text-muted)', background: view === mode ? 'var(--hover)' : undefined }}>{mode.toUpperCase()}</button>
          ))}
        </div>
        {!canReplayHistory(row) && <span className="chip chip-warn">{t.replayTruncated}</span>}
      </div>
      <pre className="select-text text-[11px] font-mono whitespace-pre-wrap break-all rounded-md border p-3 max-h-64 overflow-auto" style={{ background: 'var(--bg-code)', borderColor: 'var(--code-border)', color: error ? 'var(--bad)' : 'var(--code-text)' }}>{error || text || `(${t.historyEmptyPayload})`}</pre>
      {(row.properties?.responseTopic || row.properties?.correlationData || row.properties?.userProperties?.length > 0) && (
        <div className="flex flex-wrap gap-2 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
          {row.properties.responseTopic && <span>↩ {row.properties.responseTopic}</span>}
          {row.properties.correlationData && <span>#{row.properties.correlationData}</span>}
          {row.properties.userProperties?.map(([k, v], i) => <span key={i} className="chip chip-neutral">{k}: {v}</span>)}
        </div>
      )}
    </div>
  );
};

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ t, connected, onPublish, onSubscribe }) => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const [limit, setLimit] = useState<number>(200);
  const [windowId, setWindowId] = useState('all');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [series, setSeries] = useState<HistorySeriesPoint[]>([]);
  const [stats, setStats] = useState<HistoryStats>({ rows: 0, inbound: 0, outbound: 0 });
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const win = WINDOWS.find((w) => w.id === windowId) ?? WINDOWS[0];
      const st = await invoke<HistoryStats>('history_stats');
      if (requestId !== requestRef.current) return;
      const until = Date.now();
      const since = win.ms ? until - win.ms : Math.min(st.oldestTs ?? until, until);
      const bucket = Math.max(1000, Math.ceil((until - since) / 60 / 1000) * 1000);
      const [r, s] = await Promise.all([
        invoke<HistoryRow[]>('query_history', { search: debouncedSearch, direction, limit, sinceMs: since, untilMs: until }),
        invoke<HistorySeriesPoint[]>('history_series', { topic: debouncedSearch, direction, bucketMs: bucket, sinceMs: since, untilMs: until }),
      ]);
      if (requestId !== requestRef.current) return;
      setRows(r);
      setSeries(s.length ? fillHistorySeries(s, since, until, bucket) : []);
      setStats(st);
      setError(null);
    } catch (e) {
      if (requestId !== requestRef.current) return;
      setError(String(e));
      setRows([]);
      setSeries([]);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [debouncedSearch, direction, limit, windowId]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  // Auto-refresh: keep the view live without hammering when off.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
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
    if (!connected || !canReplayHistory(r)) return;
    try {
      await onPublish({
        topic: r.topic,
        payloadBase64: r.payloadBase64,
        qos: r.qos,
        retain: r.retain,
        properties: { ...r.properties, contentType: r.contentType ?? r.properties?.contentType, userProperties: r.properties?.userProperties ?? [] },
      });
      toast.success(`${t.historyResend}: ${r.topic}`);
    } catch (e) {
      toast.error(`${t.historyResend} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const clearAll = useCallback(async () => {
    if (!confirm(t.historyClearConfirm)) return;
    try { await invoke('clear_history'); await load(); } catch (e) { setError(String(e)); }
  }, [load, t.historyClearConfirm]);

  const totalInWindow = useMemo(() => series.reduce((a, p) => a + p.count, 0), [series]);
  const win = WINDOWS.find((w) => w.id === windowId) ?? WINDOWS[0];
  const runSearch = () => {
    if (search !== debouncedSearch) setDebouncedSearch(search);
    else void load();
  };
  const handleExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      if (await exportMessages(rows.map(historyMessage), format)) toast.success(fill(t.exportDone, { count: String(rows.length) }));
    } catch (e) { toast.error(String(e)); } finally { setExporting(false); }
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto flex flex-col">
      {/* Header */}
      <div className="panel overflow-hidden">
        <div className="panel-header flex-wrap gap-2">
          <div className="flex items-center space-x-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            <Archive className="w-4 h-4" style={{ color: 'var(--sky)' }} />
            <span>{t.historyTitle}</span>
            <span className="chip chip-sky">{stats.rows.toLocaleString()} {t.historyRowsUnit}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
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
        {error && <div role="alert" className="px-4 py-2 text-xs break-words" style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}>{error}</div>}

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
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              aria-label={t.historySearchHint}
              placeholder={t.historySearchHint}
              className="field-input w-full pl-8"
            />
          </div>
          <div className="seg-box">
            {(['all', 'in', 'out'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                aria-pressed={direction === d}
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
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="field-input" title={t.historyStatTotal} aria-label={t.historyStatTotal}>
            {[100, 200, 500, 1000, 2000].map((n) => (<option key={n} value={n}>{n}</option>))}
          </select>
          <button onClick={runSearch} className="btn-accent !py-1.5">{t.historyQuery}</button>
          <div className="flex gap-1 ml-auto" aria-label={t.historyExportResults}>
            {(['json', 'csv'] as const).map((format) => <button key={format} onClick={() => void handleExport(format)} disabled={!rows.length || loading || exporting || search !== debouncedSearch} className="btn-ghost !px-2 !py-1.5 flex items-center gap-1 disabled:opacity-40" title={t.historyExportResults}><Download className="w-3 h-3" />{format.toUpperCase()}</button>)}
          </div>
        </div>

        {/* Trend chart */}
        <div className="p-3" style={{ borderBottom: '1px solid var(--border-panel)' }}>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <span className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <BarChart3 className="w-3.5 h-3.5" style={{ color: 'var(--sky)' }} />
              {t.historyTrend} · {debouncedSearch || t.historyAllTopics}
              <span style={{ color: 'var(--text-muted)' }}>· {win.ms ? win.label : t.historyAllTime}</span>
            </span>
            <div className="flex items-center gap-1">
              {WINDOWS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setWindowId(w.id)}
                  aria-pressed={windowId === w.id}
                  className="px-2 py-0.5 rounded text-[10px] transition"
                  style={
                    windowId === w.id
                      ? { background: 'color-mix(in srgb, var(--sky) 18%, transparent)', color: 'var(--sky)', fontWeight: 600 }
                      : { color: 'var(--text-muted)' }
                  }
                >
                  {w.ms ? w.label : t.historyAllTime}
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
          <span>{fill(t.historyShowing, { count: String(rows.length) })}</span>
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
                  <button
                    type="button"
                    aria-expanded={expanded}
                    className="history-row w-full min-w-0 text-left px-3 py-2.5 text-[11px] flex items-center gap-2 cursor-pointer transition"
                    style={expanded ? { background: 'var(--hover)' } : undefined}
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                  >
                    <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }} />
                    <span className={`chip ${r.direction === 'out' ? 'chip-info' : 'chip-ok'} shrink-0`}>
                      {r.direction === 'out' ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                    </span>
                    <span className="font-mono shrink-0 max-w-[34%] truncate" style={{ color: 'var(--text-primary)' }} title={r.topic}>{r.topic}</span>
                    <span className="font-mono truncate flex-1" style={{ color: 'var(--text-muted)' }}>{previewOf(r, t)}</span>
                    {r.retain && <span className="chip chip-warn shrink-0">R</span>}
                    <span className="chip chip-neutral shrink-0">Q{r.qos}</span>
                    <span className="font-mono shrink-0 hidden md:inline" style={{ color: 'var(--text-muted)' }}>{fmtBytes(r.payloadLen)}</span>
                    <span className="font-mono shrink-0" style={{ color: 'var(--text-secondary)' }}>{fmtTime(r.ts)}</span>
                  </button>
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
                          <button onClick={() => handleResend(r)} disabled={!connected || !canReplayHistory(r)} className="btn-accent !px-2 !py-1 flex items-center gap-1 text-[10px] disabled:opacity-40" title={canReplayHistory(r) ? t.historyResend : t.replayTruncated}>
                            <Send className="w-3 h-3" /> {t.historyResend}
                          </button>
                        </div>
                      </div>
                      <PayloadViewer row={r} t={t} />
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
