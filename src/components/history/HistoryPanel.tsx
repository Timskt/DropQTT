import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes as fmtBytes } from '../../utils/format';
import { invoke } from '@tauri-apps/api/core';
import {
  Archive, RefreshCw, Search, Trash2, ArrowUpRight, ArrowDownRight, Clock,
  Inbox, Send, Rss, Filter, Copy, Check, Zap, BarChart3, Download, ChevronRight,
  GitCompareArrows, Globe, Film,
} from 'lucide-react';
import { ConsolePublishParams, HistoryRow, HistorySeriesPoint, HistoryStats, HistoryTopicRow, TraceResult } from '../../types';
import { Translations, fill } from '../../i18n';
import { copyToClipboard } from '../../utils/clipboard';
import { toast } from '../../utils/toast';
import { buildTraceExport, canReplayHistory, fillHistorySeries, historyMessage, historyPayload, HistoryView } from '../../utils/history';
import { buildTraceHtml } from '../../utils/traceHtml';
import { buildCapture, CAPTURE_EXTENSION } from '../../utils/capture';
import { TimelineCard } from './TimelineCard';
import { exportMessages, ExportFormat, saveTextFile } from '../../utils/exportMessages';

interface HistoryPanelProps {
  t: Translations;
  connected: boolean;
  /** A token handed over from a feed row: trace it as soon as this page mounts */
  requestTrace?: string | null;
  /** `host:port` of the broker being traced — scrubbed out of any shared file */
  brokerLabel?: string;
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

/** How many hops one trace returns; the panel says so when it stops short. */
const TRACE_LIMIT = 500;

/** Which claim put this hop in the list — the same message, or merely related. */
const matchLabel = (matched: string, t: Translations): string =>
  matched === 'correlation' ? t.matchedCorrelation : matched === 'topic' ? t.matchedTopic : t.matchedPayload;

const matchColor = (matched: string): string =>
  matched === 'correlation' ? 'var(--accent)' : 'var(--text-muted)';

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

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  t, connected, requestTrace, brokerLabel, onPublish, onSubscribe,
}) => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const [limit, setLimit] = useState<number>(200);
  const [windowId, setWindowId] = useState('all');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [series, setSeries] = useState<HistorySeriesPoint[]>([]);
  const [stats, setStats] = useState<HistoryStats>({ rows: 0, inbound: 0, outbound: 0 });
  // Per-topic totals over the same window the list is showing
  const [topics, setTopics] = useState<HistoryTopicRow[]>([]);
  const [retentionDraft, setRetentionDraft] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // One token's whole life, over the same window the list is showing.
  const [traceToken, setTraceToken] = useState('');
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [tracing, setTracing] = useState(false);
  const [traceExpanded, setTraceExpanded] = useState<string | null>(null);
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
      const [r, s, tp] = await Promise.all([
        invoke<HistoryRow[]>('query_history', { search: debouncedSearch, direction, limit, sinceMs: since, untilMs: until }),
        invoke<HistorySeriesPoint[]>('history_series', { topic: debouncedSearch, direction, bucketMs: bucket, sinceMs: since, untilMs: until }),
        invoke<HistoryTopicRow[]>('history_topics', { search: debouncedSearch, direction, sinceMs: since, untilMs: until, limit: 12 }),
      ]);
      if (requestId !== requestRef.current) return;
      setRows(r);
      setSeries(s.length ? fillHistorySeries(s, since, until, bucket) : []);
      setTopics(tp ?? []);
      setStats(st);
      setError(null);
    } catch (e) {
      if (requestId !== requestRef.current) return;
      setError(String(e));
      setRows([]);
      setSeries([]);
      setTopics([]);
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

  const handleCapture = async () => {
    setExporting(true);
    try {
      // `rows` is the list the user is looking at, and that list is capped; a
      // recording that held "the newest N of M" without saying so would misreport
      // the window it captured.
      const capped = rows.length >= limit;
      const name = `dropqtt-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.${CAPTURE_EXTENSION}`;
      const saved = await saveTextFile(name, buildCapture(rows, { filter: debouncedSearch || undefined, capped }));
      if (saved) {
        const file = saved.replace(/^.*[\\/]/, '');
        toast.success(capped ? fill(t.captureSavedCapped, { name: file, count: String(rows.length) }) : fill(t.captureSaved, { name: file }));
      }
    } catch (e) { toast.error(String(e)); } finally { setExporting(false); }
  };

  const traceWindow = (windowMs: number) => {
    const untilMs = Date.now();
    return { sinceMs: windowMs ? untilMs - windowMs : 0, untilMs };
  };

  /**
   * The runner every trace goes through: it awaits first and only then touches
   * state, so a trace handed over from a feed row cannot render a half-applied
   * result if the window is closed mid-flight.
   */
  const executeTrace = useCallback(async (rawToken: string, windowMs: number) => {
    const token = rawToken.trim();
    if (!token) return;
    try {
      const result = await invoke<TraceResult>('history_trace', { token, limit: TRACE_LIMIT, ...traceWindow(windowMs) });
      setTraceToken(token);
      setTrace(result);
      setTraceError(null);
      setTraceExpanded(null);
    } catch (e) {
      setTrace(null);
      setTraceError(String(e));
    } finally {
      setTracing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.ms]);

  const runTrace = () => {
    if (!traceToken.trim()) {
      // The box is the only place that can say what it is waiting for.
      setTrace(null);
      setTraceError(t.traceNeedsToken);
      return;
    }
    setTracing(true);
    void executeTrace(traceToken, win.ms);
  };

  // A trace asked for from a feed row. The panel remembers which token it already
  // ran so the hand-off is consumed here rather than by a callback that would
  // re-render the app and cancel the pending run; leaving and coming back runs it
  // again, which is a fresh query for the same question.
  const ranRef = useRef<string | null>(null);
  useEffect(() => {
    if (!requestTrace || ranRef.current === requestTrace) return;
    const id = setTimeout(() => {
      // Marked as run inside the timer, not before it: React can mount, unmount and
      // remount this panel in one pass, and a guard set at schedule time would let
      // the cleanup cancel the only run that was ever scheduled.
      ranRef.current = requestTrace;
      void executeTrace(requestTrace, win.ms);
    }, 0);
    return () => clearTimeout(id);
  }, [requestTrace, executeTrace, win.ms]);

  const traceFileName = (ext: string) => {
    const safe = traceToken.trim().replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40) || 'trace';
    return `dropqtt-trace-${safe}.${ext}`;
  };

  const exportTrace = async () => {
    if (!trace) return;
    const token = traceToken.trim();
    const text = buildTraceExport(token, win.id || 'all', traceWindow(win.ms), trace, new Date().toISOString());
    if (await saveTextFile(traceFileName('json'), text)) {
      toast.success(fill(t.exportDone, { count: String(trace.hits.length) }));
    }
  };

  /**
   * The shareable form: one HTML file with the broker address scrubbed, meant to be
   * pasted into a ticket by someone who has never opened this app.
   */
  const exportTraceHtml = async () => {
    if (!trace) return;
    const html = buildTraceHtml({
      token: traceToken.trim(),
      windowLabel: win.id || 'all',
      ...traceWindow(win.ms),
      generatedAt: new Date().toISOString(),
      result: trace,
      brokerLabel,
    });
    if (await saveTextFile(traceFileName('html'), html)) {
      toast.success(fill(t.exportDone, { count: String(trace.hits.length) }));
    }
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
            <button onClick={clearAll} disabled={stats.rows === 0} title={stats.rows === 0 ? t.whyNoRows : t.historyClear} className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[10px] disabled:opacity-40" style={{ color: 'var(--bad)' }}>
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
              data-testid="history-search"
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
          <label
            className="flex items-center gap-1 text-[10px]"
            style={{ color: 'var(--text-muted)' }}
            title={t.historyRetentionHint}
          >
            {t.historyRetention}
            <input
              type="number" min={0} max={3650}
              className="field-input w-16 !py-1"
              data-testid="history-retention"
              aria-label={t.historyRetention}
              value={retentionDraft ?? stats.retentionDays ?? 0}
              onChange={(e) => setRetentionDraft(Math.max(0, Math.min(3650, parseInt(e.target.value, 10) || 0)))}
            />
            <button
              type="button"
              className="btn-ghost !px-2 !py-1"
              data-testid="history-retention-apply"
              disabled={retentionDraft === null || retentionDraft === (stats.retentionDays ?? 0)}
              onClick={() => {
                const days = retentionDraft;
                if (days === null) return;
                void (async () => {
                  try {
                    await invoke('set_history_retention', { days });
                    setRetentionDraft(null);
                    await load();
                  } catch (e) {
                    setError(String(e));
                  }
                })();
              }}
            >
              {t.historyRetentionApply}
            </button>
          </label>
          <button onClick={runSearch} className="btn-accent !py-1.5">{t.historyQuery}</button>
          <div className="flex gap-1 ml-auto" aria-label={t.historyExportResults}>
            {(['json', 'csv'] as const).map((format) => <button key={format} onClick={() => void handleExport(format)} disabled={!rows.length || loading || exporting || search !== debouncedSearch} className="btn-ghost !px-2 !py-1.5 flex items-center gap-1 disabled:opacity-40" title={search !== debouncedSearch ? t.whyFilterPending : loading || exporting ? t.whyBusy : !rows.length ? t.whyNoRows : t.historyExportResults}><Download className="w-3 h-3" />{format.toUpperCase()}</button>)}
            {/* A capture is the one export you can run again: same rows, but with the
                intervals and v5 properties needed to publish them back. */}
            <button onClick={() => void handleCapture()} disabled={!rows.length || loading || exporting || search !== debouncedSearch} className="btn-ghost !px-2 !py-1.5 flex items-center gap-1 disabled:opacity-40" title={search !== debouncedSearch ? t.whyFilterPending : loading || exporting ? t.whyBusy : !rows.length ? t.captureNothing : t.captureExportHint} data-testid="history-capture"><Film className="w-3 h-3" />{t.captureExport}</button>
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

        {/* Per-topic totals over the same window. "Which device was noisy at 3 am"
            is one question here and twenty pages of filtered history otherwise. */}
        {topics.length > 0 && (
          <div className="p-3" style={{ borderBottom: '1px solid var(--border-panel)' }}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                {t.historyByTopic} · {debouncedSearch || t.historyAllTopics}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.historyByTopicHint}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1" data-testid="history-topics">
              {topics.map((tp) => (
                <button
                  key={tp.topic}
                  type="button"
                  data-testid={`history-topic-${tp.topic}`}
                  onClick={() => { setSearch(tp.topic); setDebouncedSearch(tp.topic); }}
                  className="flex items-center justify-between gap-2 px-2 py-1 rounded text-[11px] font-mono text-left transition hover:opacity-100"
                  style={{ color: 'var(--text-secondary)', background: 'var(--bg-inset)' }}
                  title={`${t.historyStatIn}: ${tp.inbound.toLocaleString()} · ${t.historyStatOut}: ${tp.outbound.toLocaleString()} · ${fmtBytes(tp.bytes)} · ${new Date(tp.lastTs).toLocaleTimeString()}`}
                >
                  <span className="truncate">{tp.topic}</span>
                  <span className="shrink-0" style={{ color: 'var(--sky)' }}>{tp.count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Time on one axis, a topic prefix per row: "when did it stop happening"
            is a shape question the list below cannot answer. */}
        <TimelineCard
          t={t}
          search={debouncedSearch}
          windowMs={win.ms}
          oldestTs={stats.oldestTs}
          totalRows={stats.rows}
        />

        {/* One token's life: a deviceId or a correlation value, across every topic
            and both directions, oldest first. */}
        <div className="p-3 space-y-2" style={{ borderBottom: '1px solid var(--border-panel)' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <GitCompareArrows className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t.traceTitle}</span>
            <input
              className="field-input flex-1 min-w-[12rem] font-mono"
              aria-label={t.traceTitle}
              placeholder={t.tracePlaceholder}
              value={traceToken}
              spellCheck={false}
              data-testid="trace-token"
              onChange={(e) => setTraceToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runTrace(); }}
            />
            <button
              type="button"
              className="btn-accent !px-3 !py-1 text-[11px]"
              onClick={() => void runTrace()}
              disabled={tracing || !traceToken.trim()}
              title={traceToken.trim() ? t.traceRunHint : t.traceNeedsToken}
              data-testid="trace-run"
            >
              {t.traceRun}
            </button>
            {trace && trace.hits.length > 0 && (
              <button
                type="button"
                className="btn-ghost !px-2 !py-1 text-[11px] flex items-center gap-1"
                onClick={() => void exportTrace()}
                title={t.traceExportHint}
                data-testid="trace-export"
              >
                <Download className="w-3 h-3" />
                {t.traceExport}
              </button>
            )}
            {trace && trace.hits.length > 0 && (
              <button
                type="button"
                className="btn-ghost !px-2 !py-1 text-[11px] flex items-center gap-1"
                onClick={() => void exportTraceHtml()}
                title={t.traceExportHtmlHint}
                data-testid="trace-export-html"
              >
                <Globe className="w-3 h-3" />
                {t.traceExportHtml}
              </button>
            )}
          </div>

          {traceError && (
            <div className="text-[11px] font-mono select-text" style={{ color: 'var(--danger)' }} data-testid="trace-error">
              {traceError}
            </div>
          )}

          {trace && (
            <div className="space-y-1.5" data-testid="trace-result">
              <div className="text-[10px] font-mono select-text" style={{ color: 'var(--text-muted)' }} data-testid="trace-summary">
                {fill(t.traceSummary, {
                  count: String(trace.summary.count),
                  topics: String(trace.summary.topics.length),
                  in: String(trace.summary.inbound),
                  out: String(trace.summary.outbound),
                  span: fmtSpan(trace.summary.firstMs, trace.summary.lastMs),
                })}
              </div>
              {/* Several correlation keys under one token is several conversations;
                  drawing them as one timeline would invent a story. */}
              {trace.summary.correlations.length > 1 && (
                <div className="text-[10px]" style={{ color: 'var(--warning)' }} data-testid="trace-multi">
                  {fill(t.traceCorrelations, { n: String(trace.summary.correlations.length) })}
                </div>
              )}
              {trace.summary.truncated && (
                <div className="text-[10px]" style={{ color: 'var(--warning)' }} data-testid="trace-truncated">
                  {fill(t.traceTruncated, { n: String(TRACE_LIMIT) })}
                </div>
              )}
              {trace.hits.length === 0 ? (
                <div className="text-[11px] italic" style={{ color: 'var(--text-muted)' }} data-testid="trace-empty">
                  {t.traceEmpty}
                </div>
              ) : (
                <ol className="space-y-1">
                  {trace.hits.map((hit, i) => (
                    <li key={`${hit.id}-${i}`} data-testid={`trace-hop-${hit.id}`}>
                      <button
                        type="button"
                        onClick={() => setTraceExpanded((cur) => (cur === hit.id ? null : hit.id))}
                        aria-expanded={traceExpanded === hit.id}
                        className="w-full text-left px-2 py-1.5 rounded flex items-start gap-2"
                        style={{ background: 'var(--bg-inset)' }}
                      >
                        <span className="text-[10px] font-mono shrink-0 pt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {fmtTime(hit.ts)}
                        </span>
                        {hit.direction === 'out'
                          ? <ArrowUpRight className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                          : <ArrowDownRight className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--ok)' }} />}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-mono truncate select-text" style={{ color: 'var(--text-primary)' }}>{hit.topic}</span>
                          <span className="block text-[10px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>{previewOf(hit, t)}</span>
                        </span>
                        <span
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: 'var(--bg-code)', color: matchColor(hit.matchedBy) }}
                        >
                          {matchLabel(hit.matchedBy, t)}
                        </span>
                      </button>
                      {traceExpanded === hit.id && (
                        <div className="px-2 pt-1.5 pb-1 inset-box">
                          <PayloadViewer row={hit} t={t} />
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              <div className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{t.traceBoundary}</div>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="flex items-center justify-between px-3 py-1.5 text-[10px]" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-inset)' }}>
          <span className="flex items-center gap-2">
            {fill(t.historyShowing, { count: String(rows.length) })}
            {(stats.prunedRows ?? 0) > 0 && (
              <span data-testid="history-pruned" style={{ color: 'var(--warn)' }}>
                {fill(t.historyPruned, { count: String(stats.prunedRows ?? 0) })}
              </span>
            )}
          </span>
          {loading && <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> {t.refresh}</span>}
        </div>
        <div className="max-h-[52vh] overflow-y-auto" data-testid="history-results">
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
