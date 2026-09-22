import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Activity, Camera, Download, Flame, RotateCcw, Zap } from 'lucide-react';
import { TopicStatRow } from '../../types';
import { Translations } from '../../i18n';
import { usePersistentState } from '../../hooks/usePersistentState';
import { saveTextFile } from '../../utils/exportMessages';

interface TopicTrafficPanelProps {
  rows: TopicStatRow[];
  onReset: () => void;
  connected: boolean;
  /** Runtime-configurable topic tracking cap (LRU eviction when full) */
  cap: number;
  setCap: (cap: number) => void;
  t: Translations;
}

interface BenchProgress {
  sent: number;
  elapsedMs: number;
  done?: boolean;
}

/** Snapshot row for delta comparison ("who ramped up since I looked") */
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

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
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

  const sortedRows = useMemo(() => {
    const cmp: Record<SortKey, (a: TopicStatRow, b: TopicStatRow) => number> = {
      rate: (a, b) => b.rate - a.rate || b.count - a.count,
      peak: (a, b) => b.peakRate - a.peakRate || b.rate - a.rate,
      bytes: (a, b) => b.bytes - a.bytes,
      count: (a, b) => b.count - a.count,
    };
    return [...rows].sort(cmp[sortBy]);
  }, [rows, sortBy]);

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
    const lines = sortedRows.map((r) =>
      [
        `"${r.topic.replace(/"/g, '""')}"`,
        r.rate, r.peakRate, r.count, r.bytes, r.bytesRate,
        new Date(r.lastSeen * 1000).toISOString(),
      ].join(','),
    );
    await saveTextFile('dropqtt-topic-traffic.csv', [head, ...lines].join('\n'));
  };

  // Built-in publish stress lab (loops back through our own subscription)
  const [benchOpen, setBenchOpen] = useState(false);
  const [benchTopic, setBenchTopic] = useState('bench/hot');
  const [benchRate, setBenchRate] = useState(3000);
  const [benchSize, setBenchSize] = useState(64);
  const [benchDuration, setBenchDuration] = useState(30);
  const [bench, setBench] = useState<BenchProgress | null>(null);

  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    (async () => {
      const fn = await listen<BenchProgress>('bench-progress', (e) => {
        if (!disposed) setBench(e.payload);
      });
      if (disposed) fn();
      else un = fn;
    })();
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  const startBench = async () => {
    try {
      setBench({ sent: 0, elapsedMs: 0 });
      await invoke('start_bench', {
        topic: benchTopic.trim() || 'bench/hot',
        rate: Math.max(1, Math.min(20000, benchRate)),
        size: Math.max(1, Math.min(4096, benchSize)),
        duration: Math.max(1, Math.min(300, benchDuration)),
      });
    } catch (e) {
      setBench({ sent: -1, elapsedMs: 0 });
      console.error('start_bench:', e);
    }
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
            title={t.capHint}
          >
            {CAP_OPTIONS.map((c) => (
              <option key={c} value={c}>{c >= 1000 ? `${c / 1000}k` : c}</option>
            ))}
          </select>
          <button onClick={exportCsv} disabled={rows.length === 0} className="btn-ghost !px-2.5 !py-1 flex items-center gap-1 text-[11px]" title={t.exportTraffic}>
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <input className="field-input md:col-span-2 font-mono" placeholder={t.benchTopicPh} value={benchTopic} onChange={(e) => setBenchTopic(e.target.value)} spellCheck={false} />
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
              <input type="number" min={1} max={300} className="field-input flex-1 min-w-0" value={benchDuration} onChange={(e) => setBenchDuration(Number(e.target.value))} />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {bench
                ? bench.sent < 0
                  ? t.benchFailed
                  : `${bench.sent.toLocaleString()} ${t.benchSent} · ${(bench.elapsedMs / 1000).toFixed(1)}s`
                : t.benchHint}
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
          <table className="w-full text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
            <thead>
              <tr className="text-left sticky top-0 z-10" style={{ background: 'var(--bg-inset)', color: 'var(--text-muted)' }}>
                <th className="px-3 py-1.5 font-medium w-8">#</th>
                <th className="px-2 py-1.5 font-medium">{t.topicPattern}</th>
                <th className="px-2 py-1.5 font-medium">
                  <select className="bg-transparent focus:outline-none cursor-pointer" style={{ color: 'var(--text-muted)' }} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} title={t.sortBy}>
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
              {sortedRows.slice(0, 80).map((r, i) => {
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
          {sortedRows.length > 80 && (
            <div className="px-3 py-1.5 text-[10px] border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-inset)' }}>
              {t.trafficMore.replace('{n}', String(sortedRows.length - 80))}
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
