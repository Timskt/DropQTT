import React, { useMemo, useState } from 'react';
import { formatBytes } from '../../utils/format';
import { Activity, Camera, Download, Flame, RotateCcw, Square, Zap } from 'lucide-react';
import { BenchStatus, TopicStatRow } from '../../types';
import { Translations } from '../../i18n';
import { usePersistentState } from '../../hooks/usePersistentState';
import { useBench } from '../../hooks/useBench';
import { saveTextFile } from '../../utils/exportMessages';
import { csvRow } from '../../utils/csv';

interface TopicTrafficPanelProps {
  rows: TopicStatRow[];
  onReset: () => void;
  connected: boolean;
  /** Runtime-configurable topic tracking cap (LRU eviction when full) */
  cap: number;
  setCap: (cap: number) => void;
  t: Translations;
}

/** Snapshot row for delta comparison ("who ramped up since I looked") */
const MAX_VISIBLE_ROWS = 80;

interface SnapRow {
  count: number;
  bytes: number;
}
interface Snapshot {
  ts: number;
  rows: Record<string, SnapRow>;
}

type SortKey = 'rate' | 'peak' | 'bytes' | 'count';

const CAP_OPTIONS = [1000, 5000, 20000, 50000, 200000];

const BENCH_COLOR: Record<BenchStatus, string> = {
  running: 'var(--success)',
  finished: 'var(--accent)',
  stopped: 'var(--text-muted)',
  failed: 'var(--danger)',
};

const BENCH_LABEL: Record<BenchStatus, (t: Translations) => string> = {
  running: () => '',
  finished: (t) => t.scheduleRunDone,
  stopped: (t) => t.scheduleRunStopped,
  failed: (t) => t.scheduleRunFailed,
};


const relativeSec = (unixSec: number, nowSec: number): string => {
  const d = Math.max(0, nowSec - unixSec);
  if (d < 2) return 'now';
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  return `${Math.floor(d / 3600)}h`;
};

/**
 * Live ranking of inbound topic traffic with hot-topic discovery:
 * sortable dimensions, anomaly threshold alerts, snapshot-based delta
 * comparison (finds who ramped up over a window) and CSV export.
 */
export const TopicTrafficPanel: React.FC<TopicTrafficPanelProps> = ({
  rows, onReset, connected, cap, setCap, t,
}) => {
  const nowSec = Math.floor(Date.now() / 1000);
  const totalRate = useMemo(() => rows.reduce((a, r) => a + r.rate, 0), [rows]);

  // Hot-topic discovery controls
  const [sortBy, setSortBy] = useState<SortKey>('rate');
  const [alertThreshold, setAlertThreshold] = usePersistentState<number>('dropqtt_traffic_alert', 100);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [topicFilter, setTopicFilter] = useState('');

  const sortedRows = useMemo(() => {
    const cmp: Record<SortKey, (a: TopicStatRow, b: TopicStatRow) => number> = {
      rate: (a, b) => b.rate - a.rate || b.count - a.count,
      peak: (a, b) => b.peakRate - a.peakRate || b.rate - a.rate,
      bytes: (a, b) => b.bytes - a.bytes,
      count: (a, b) => b.count - a.count,
    };
    return [...rows].sort(cmp[sortBy]);
  }, [rows, sortBy]);

  // The backend can track up to 200k topics; the table only ever drew the first
  // 80, so the long tail was unreachable. Filter first, then cap the view -- and
  // count only what the cap hides, not what the filter deliberately left out.
  const filteredRows = useMemo(() => {
    const needle = topicFilter.trim().toLowerCase();
    return needle ? sortedRows.filter((r) => r.topic.toLowerCase().includes(needle)) : sortedRows;
  }, [sortedRows, topicFilter]);

  const visibleRows = useMemo(() => filteredRows.slice(0, MAX_VISIBLE_ROWS), [filteredRows]);

  const maxRate = useMemo(() => Math.max(1, ...rows.map((r) => r.rate)), [rows]);
  const hotRows = useMemo(
    () => rows.filter((r) => r.rate >= alertThreshold),
    [rows, alertThreshold],
  );

  // Snapshot delta helpers
  const snapElapsed = snapshot ? Math.max(1, nowSec - snapshot.ts) : 0;
  const deltaOf = (r: TopicStatRow) => {
    if (!snapshot) return null;
    const s = snapshot.rows[r.topic];
    const dCount = r.count - (s?.count ?? 0);
    const dBytes = r.bytes - (s?.bytes ?? 0);
    return { dCount, dBytes, dRate: dCount / snapElapsed, isNew: !s };
  };

  const takeSnapshot = () => {
    const rowsMap: Record<string, SnapRow> = {};
    for (const r of rows) rowsMap[r.topic] = { count: r.count, bytes: r.bytes };
    setSnapshot({ ts: nowSec, rows: rowsMap });
  };

  const exportCsv = async () => {
    const head = 'topic,rate_msgs_s,peak_msgs_s,count,bytes,bytes_s,last_seen';
    const lines = filteredRows.map((r) =>
      csvRow([
        r.topic,
        r.rate, r.peakRate, r.count, r.bytes, r.bytesRate,
        new Date(r.lastSeen * 1000).toISOString(),
      ]),
    );
    await saveTextFile('dropqtt-topic-traffic.csv', [head, ...lines].join('\n'));
  };

  // Built-in publish stress lab (loops back through our own subscription)
  const [benchOpen, setBenchOpen] = useState(false);
  const [benchTopics, setBenchTopics] = useState('bench/hot');
  const [benchRate, setBenchRate] = useState(3000);
  // Acceptance bar. Empty means "no verdict", which is different from a pass:
  // a run without thresholds stays a dashboard rather than claiming success.
  const [expectMinRate, setExpectMinRate] = useState('');
  const [expectP99, setExpectP99] = useState('');
  const [expectLost, setExpectLost] = useState('');
  const [benchSize, setBenchSize] = useState(64);
  const [benchQos, setBenchQos] = useState(0);
  const [benchRetain, setBenchRetain] = useState(false);
  // Mirroring is the default: a debugging run wants to see its own traffic.
  const [benchMirror, setBenchMirror] = useState(true);
  const [benchDuration, setBenchDuration] = useState(30);
  const {
    runs: benchRuns,
    lastError: benchError,
    start: startBenchRun,
    stop: stopBenchRun,
    clearFinished: clearBenchFinished,
  } = useBench(benchOpen);

  const startBench = () => {
    const topics = benchTopics.split(/[\s,]+/).filter(Boolean);
    if (topics.length === 0) return;
    void startBenchRun({
      id: `bench-${Date.now().toString(36)}`,
      topics,
      rate: Math.max(1, Math.min(20000, benchRate)),
      size: Math.max(1, Math.min(4096, benchSize)),
      qos: benchQos,
      retain: benchRetain,
      mirror: benchMirror,
      durationSec: Math.max(0, Math.min(3600, benchDuration)),
      expect:
        expectMinRate || expectP99 || expectLost
          ? {
              minRate: expectMinRate ? Number(expectMinRate) : undefined,
              maxP99Ms: expectP99 ? Number(expectP99) : undefined,
              maxLost: expectLost ? Number(expectLost) : undefined,
            }
          : undefined,
    });
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Activity className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          {t.topicTraffic}
          <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            ({rows.length} · Σ {totalRate}/s)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="field-input !py-0.5 !px-1.5 text-[10px]"
            value={cap}
            onChange={(e) => setCap(Number(e.target.value))}
            aria-label={t.capHint}
            title={t.capHint}
          >
            {CAP_OPTIONS.map((c) => (
              <option key={c} value={c}>{c >= 1000 ? `${c / 1000}k` : c}</option>
            ))}
          </select>
          <button onClick={exportCsv} disabled={rows.length === 0} className="btn-ghost !px-2.5 !py-1 flex items-center gap-1 text-[11px]" title={t.exportTraffic} aria-label={t.exportTraffic}>
            <Download className="w-3 h-3" />
          </button>
          <button
            onClick={() => setBenchOpen((v) => !v)}
            className="btn-ghost !px-2.5 !py-1 flex items-center gap-1 text-[11px]"
            title={t.benchLab}
          >
            <Zap className="w-3 h-3" style={{ color: 'var(--warning)' }} />
            {t.benchLab}
          </button>
          <button
            onClick={onReset}
            disabled={rows.length === 0}
            className="btn-ghost !px-2.5 !py-1 flex items-center gap-1 text-[11px]"
            title={t.resetStats}
          >
            <RotateCcw className="w-3 h-3" />
            {t.resetStats}
          </button>
        </div>
      </div>

      {/* Anomaly summary: topics at/above the configured rate threshold */}
      {hotRows.length > 0 && (
        <div
          className="px-4 py-1.5 border-b text-[11px] font-mono flex items-center gap-2 flex-wrap"
          style={{ background: 'color-mix(in srgb, var(--danger) 12%, transparent)', borderColor: 'var(--border-inset)', color: 'var(--danger)' }}
        >
          <Zap className="w-3.5 h-3.5" />
          {t.alertSummary
            .replace('{n}', String(hotRows.length))
            .replace('{x}', String(alertThreshold))}
          <span className="opacity-80 truncate">
            {hotRows.slice(0, 5).map((r) => `${r.topic} (${r.rate}/s)`).join(' · ')}
            {hotRows.length > 5 && ' …'}
          </span>
        </div>
      )}

      {benchOpen && (
        <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: 'var(--border-panel)', background: 'var(--bg-inset)' }}>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <input className="field-input md:col-span-2 font-mono" placeholder={t.benchTopicPh} aria-label={t.benchTopicPh} value={benchTopics} onChange={(e) => setBenchTopics(e.target.value)} spellCheck={false} />
            <label className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {t.benchRate}
              <input type="number" min={1} max={20000} className="field-input flex-1 min-w-0" value={benchRate} onChange={(e) => setBenchRate(Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {t.benchSize}
              <input type="number" min={1} max={4096} className="field-input flex-1 min-w-0" value={benchSize} onChange={(e) => setBenchSize(Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {t.benchDuration}
              <input
                type="number" min={0} max={3600} className="field-input flex-1 min-w-0" value={benchDuration}
                title={t.benchDurationHint}
                onChange={(e) => setBenchDuration(Number(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {t.benchExpectMinRate}
              <input
                type="number" min={0} className="field-input flex-1 min-w-0" value={expectMinRate}
                data-testid="bench-expect-rate"
                onChange={(e) => setExpectMinRate(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {t.benchExpectP99}
              <input
                type="number" min={0} className="field-input flex-1 min-w-0" value={expectP99}
                data-testid="bench-expect-p99"
                onChange={(e) => setExpectP99(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {t.benchExpectLost}
              <input
                type="number" min={0} className="field-input flex-1 min-w-0" value={expectLost}
                data-testid="bench-expect-lost"
                onChange={(e) => setExpectLost(e.target.value)}
              />
            </label>
            <div className="flex items-center gap-2">
              <select
                className="field-input !py-0.5 !px-1 text-[10px]"
                value={benchQos}
                onChange={(e) => setBenchQos(Number(e.target.value))}
                aria-label={t.qosLevel}
                title="QoS"
              >
                <option value={0}>QoS 0</option>
                <option value={1}>QoS 1</option>
                <option value={2}>QoS 2</option>
              </select>
              <label className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                <input
                  type="checkbox" checked={benchRetain}
                  onChange={(e) => setBenchRetain(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                  aria-label={`${t.benchLab} ${t.retain}`}
                />
                {t.retain}
              </label>
              <label
                className="flex items-center gap-1 text-[10px] font-mono"
                style={{ color: 'var(--text-muted)' }}
                title={t.benchMirrorHint}
              >
                <input
                  type="checkbox"
                  checked={benchMirror}
                  onChange={(e) => setBenchMirror(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                  data-testid="bench-mirror"
                  aria-label={`${t.benchLab} ${t.benchMirror}`}
                />
                {t.benchMirror}
              </label>
            </div>
          </div>

          {/* Live counters come from the backend run, not from this component */}
          {benchRuns.length > 0 && (
            <div className="space-y-1">
              {benchRuns.map((r) => {
                const rate = r.sent > 0 ? (r.sent / Math.max(1, r.elapsedMs)) * 1000 : 0;
                return (
                  <div key={r.id} className="space-y-0.5">
                    <div className="flex items-center gap-2 text-[10px] font-mono">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: BENCH_COLOR[r.status] }} />
                      <span className="truncate" style={{ color: 'var(--text-primary)' }} title={r.topics.join(' ')}>
                        {r.topics.join(' ')}
                      </span>
                      <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {r.size}B · QoS {r.qos}
                        {r.retain ? ' · R' : ''}
                      </span>
                      <span className="ml-auto shrink-0" style={{ color: 'var(--text-secondary)' }}>
                        {r.sent.toLocaleString()} {t.benchSent}
                        {r.qos > 0 ? ` · ${r.acked.toLocaleString()} ${t.benchAcked}` : ''}
                        {` · ${rate.toFixed(0)}/s`}
                      </span>
                      {r.verdict && (
                        <span
                          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold"
                          data-testid={`bench-verdict-${r.id}`}
                          style={
                            r.verdict.failures.length === 0 && r.verdict.settled
                              ? { background: 'var(--ok-soft)', color: 'var(--success)' }
                              : r.verdict.settled
                                ? { background: 'var(--bad-soft)', color: 'var(--danger)' }
                                : { background: 'var(--bg-inset)', color: 'var(--text-muted)' }
                          }
                          title={
                            r.verdict.settled
                              ? r.verdict.failures.length === 0
                                ? t.benchVerdictPass
                                : r.verdict.failures
                                    .map((f) =>
                                      f.kind === 'maxP99Ms' && f.actual === null
                                        ? t.benchFailNoSamples
                                        : (
                                          f.kind === 'minRate'
                                            ? t.benchFailMinRate
                                            : f.kind === 'maxP99Ms'
                                              ? t.benchFailP99
                                              : t.benchFailLost
                                        )
                                          .replace('{limit}', String(f.limit))
                                          .replace('{actual}', String(f.actual)),
                                    )
                                    .join(' · ')
                              : t.benchVerdictPending
                          }
                        >
                          {r.verdict.settled
                            ? r.verdict.failures.length === 0
                              ? t.benchVerdictPass
                              : `${t.benchVerdictFail} × ${r.verdict.failures.length}`
                            : t.benchVerdictPending}
                        </span>
                      )}
                      {r.mirror === false && (
                        <span
                          className="shrink-0 chip chip-neutral"
                          data-testid={`bench-quiet-${r.id}`}
                          title={t.benchMirrorHint}
                        >
                          {t.benchNotMirrored}
                        </span>
                      )}
                      {(r.nacked > 0 || r.noSubscribers > 0) && (
                        <span
                          className="shrink-0"
                          data-testid="bench-refused"
                          style={{ color: r.nacked > 0 ? 'var(--danger)' : 'var(--warn)' }}
                          aria-label={`${t.opsPublishRejected}: ${r.nacked}, ${t.benchNoSubscribers}: ${r.noSubscribers}`}
                          title={`${r.nacked} ${t.opsPublishRejected} · ${r.noSubscribers} ${t.benchNoSubscribers}`}
                        >
                          {r.nacked > 0 ? `✕ ${r.nacked.toLocaleString()}` : ''}
                          {r.noSubscribers > 0
                            ? `${r.nacked > 0 ? ' · ' : ''}∅ ${r.noSubscribers.toLocaleString()}`
                            : ''}
                        </span>
                      )}
                      <span className="shrink-0" style={{ color: r.latency.samples ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {r.latency.samples
                          ? `p50 ${r.latency.p50Ms} · p95 ${r.latency.p95Ms} · p99 ${r.latency.p99Ms} ms`
                          : `${t.benchObserved} 0`}
                      </span>
                      {r.status === 'running' ? (
                        <button
                          type="button"
                          onClick={() => void stopBenchRun(r.id)}
                          className="shrink-0 opacity-70 hover:opacity-100"
                          title={t.benchStop}
                        >
                          <Square className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="shrink-0" style={{ color: BENCH_COLOR[r.status] }}>
                          {BENCH_LABEL[r.status](t)}
                        </span>
                      )}
                    </div>
                    {r.lastError && (
                      <div className="pl-3.5 text-[10px] break-all" style={{ color: 'var(--danger)' }}>
                        {r.lastError}
                      </div>
                    )}
                  </div>
                );
              })}
              {benchRuns.some((r) => r.status !== 'running') && (
                <button
                  type="button"
                  onClick={() => void clearBenchFinished()}
                  className="text-[10px] underline opacity-60 hover:opacity-100"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {t.benchClear}
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono truncate" style={{ color: benchError ? 'var(--danger)' : 'var(--text-muted)' }}>
              {benchError || (benchRuns.length ? '' : t.benchHint)}
            </span>
            <button onClick={startBench} disabled={!connected} className="btn-accent !py-1 text-[11px] flex items-center gap-1" title={connected ? '' : t.connect}>
              <Zap className="w-3 h-3" />
              {t.benchStart}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {t.noTraffic}
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          {sortedRows.length > MAX_VISIBLE_ROWS && (
            <div className="sticky top-0 z-20 px-2 py-1" style={{ background: 'var(--bg-panel-solid)' }}>
              <input
                type="search"
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
                placeholder={t.trafficFilterPh}
                aria-label={t.trafficFilterPh}
                className="field-input !py-0.5 text-[10px] w-full font-mono"
              />
            </div>
          )}
          <table className="w-full text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
            <thead>
              <tr className="text-left sticky top-0 z-10" style={{ background: 'var(--bg-inset)', color: 'var(--text-muted)' }}>
                <th className="px-3 py-1.5 font-medium w-8">#</th>
                <th className="px-2 py-1.5 font-medium">{t.topicPattern}</th>
                <th className="px-2 py-1.5 font-medium">
                  <select className="bg-transparent focus:outline-none cursor-pointer" style={{ color: 'var(--text-muted)' }} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} title={t.sortBy} aria-label={t.sortBy}>
                    <option value="rate">{t.sortRate}</option>
                    <option value="peak">{t.sortPeak}</option>
                    <option value="bytes">{t.sortBytes}</option>
                    <option value="count">{t.sortCount}</option>
                  </select>
                </th>
                <th className="px-2 py-1.5 font-medium text-right">{t.totalMsgs}</th>
                <th className="px-2 py-1.5 font-medium text-right">{t.totalBytes}</th>
                <th className="px-2 py-1.5 font-medium text-right">{t.peakRate}</th>
                {snapshot && <th className="px-2 py-1.5 font-medium text-right" title={`${snapElapsed}s`}>{t.snapshotDelta}</th>}
                <th className="px-3 py-1.5 font-medium text-right">{t.lastActive}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => {
                const hot = r.rate >= alertThreshold && r.rate > 0;
                const d = deltaOf(r);
                return (
                  <tr key={r.topic} className="border-t" style={{ borderColor: 'var(--border-inset)' }}>
                    <td className="px-3 py-1.5" style={{ color: hot ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {hot ? <Zap className="w-3.5 h-3.5 inline" /> : i < 3 && r.rate > 0 ? <Flame className="w-3.5 h-3.5 inline" /> : i + 1}
                    </td>
                    <td className="px-2 py-1.5 max-w-0 w-[30%]">
                      <span className="block truncate select-text" title={r.topic} style={{ color: 'var(--text-primary)' }}>
                        {d?.isNew && (
                          <span className="mr-1 px-1 rounded text-[9px]" style={{ background: 'color-mix(in srgb, var(--success) 20%, transparent)', color: 'var(--success)' }}>NEW</span>
                        )}
                        {r.topic}
                      </span>
                      <span
                        className="block h-1 mt-0.5 rounded-full"
                        style={{
                          width: `${Math.max(3, Math.round((r.rate / maxRate) * 100))}%`,
                          background: hot ? 'var(--danger)' : 'var(--accent)',
                          opacity: 0.75,
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-semibold" style={{ color: hot ? 'var(--danger)' : 'var(--text-primary)' }}>
                      {r.rate}/s
                    </td>
                    <td className="px-2 py-1.5 text-right">{r.count.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right">
                      {formatBytes(r.bytes)}
                      {r.bytesRate > 0 && <span className="opacity-60"> · {formatBytes(r.bytesRate)}/s</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right" style={{ color: 'var(--warning)' }}>{r.peakRate}/s</td>
                    {snapshot && (
                      <td className="px-2 py-1.5 text-right" style={{ color: d && d.dCount > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {d ? `+${d.dCount.toLocaleString()} (${d.dRate.toFixed(0)}/s)` : '—'}
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>
                      {relativeSec(r.lastSeen, nowSec)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredRows.length > visibleRows.length && (
            <div className="px-3 py-1.5 text-[10px] border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-inset)' }}>
              {t.trafficMore.replace('{n}', String(filteredRows.length - visibleRows.length))}
            </div>
          )}
          <div className="px-3 py-1.5 text-[10px] border-t flex items-center justify-between gap-2 flex-wrap" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-inset)' }}>
            <span className="flex items-center gap-2">
              {t.actualTopicNote}
              <label className="flex items-center gap-1">
                {t.alertThreshold}
                <input
                  type="number"
                  min={1}
                  className="field-input !w-16 !py-0 !px-1 text-[10px]"
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(Math.max(1, Number(e.target.value) || 1))}
                />
                /s
              </label>
            </span>
            <span className="flex items-center gap-2">
              {snapshot ? (
                <>
                  <span>{t.snapshotAge.replace('{s}', String(snapElapsed))}</span>
                  <button onClick={() => setSnapshot(null)} className="underline decoration-dotted hover:opacity-80">{t.snapshotClear}</button>
                </>
              ) : (
                <button onClick={takeSnapshot} className="flex items-center gap-1 underline decoration-dotted hover:opacity-80">
                  <Camera className="w-3 h-3" />
                  {t.snapshotTake}
                </button>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
