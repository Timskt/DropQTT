import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Activity, Flame, RotateCcw, Zap } from 'lucide-react';
import { TopicStatRow } from '../../types';
import { Translations } from '../../i18n';

interface TopicTrafficPanelProps {
  rows: TopicStatRow[];
  onReset: () => void;
  connected: boolean;
  t: Translations;
}

interface BenchProgress {
  sent: number;
  elapsedMs: number;
  done?: boolean;
}

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
 * Live ranking of inbound topic traffic — surfaces "hot" topics that flood
 * the subscription with high message rates / byte volumes.
 */
export const TopicTrafficPanel: React.FC<TopicTrafficPanelProps> = ({ rows, onReset, connected, t }) => {
  const maxRate = useMemo(() => Math.max(1, ...rows.map((r) => r.rate)), [rows]);
  const nowSec = Math.floor(Date.now() / 1000);
  const totalRate = useMemo(() => rows.reduce((a, r) => a + r.rate, 0), [rows]);

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
            <button
              onClick={startBench}
              disabled={!connected}
              className="btn-accent !py-1 text-[11px] flex items-center gap-1"
              title={connected ? '' : t.connect}
            >
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
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
            <thead>
              <tr className="text-left sticky top-0" style={{ background: 'var(--bg-inset)', color: 'var(--text-muted)' }}>
                <th className="px-3 py-1.5 font-medium w-8">#</th>
                <th className="px-2 py-1.5 font-medium">{t.topicPattern}</th>
                <th className="px-2 py-1.5 font-medium text-right">{t.msgsPerSec}</th>
                <th className="px-2 py-1.5 font-medium text-right">{t.totalMsgs}</th>
                <th className="px-2 py-1.5 font-medium text-right">{t.totalBytes}</th>
                <th className="px-2 py-1.5 font-medium text-right">{t.peakRate}</th>
                <th className="px-3 py-1.5 font-medium text-right">{t.lastActive}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((r, i) => {
                const hot = i < 3 && r.rate > 0;
                return (
                  <tr key={r.topic} className="border-t" style={{ borderColor: 'var(--border-inset)' }}>
                    <td className="px-3 py-1.5" style={{ color: hot ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {hot ? <Flame className="w-3.5 h-3.5 inline" /> : i + 1}
                    </td>
                    <td className="px-2 py-1.5 max-w-0 w-[36%]">
                      <span className="block truncate select-text" title={r.topic} style={{ color: 'var(--text-primary)' }}>
                        {r.topic}
                      </span>
                      {/* rate bar relative to the hottest topic */}
                      <span
                        className="block h-1 mt-0.5 rounded-full"
                        style={{
                          width: `${Math.max(3, Math.round((r.rate / maxRate) * 100))}%`,
                          background: hot ? 'var(--danger)' : 'var(--accent)',
                          opacity: 0.75,
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold" style={{ color: hot ? 'var(--danger)' : 'var(--text-primary)' }}>
                      {r.rate}/s
                    </td>
                    <td className="px-2 py-1.5 text-right">{r.count.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right">
                      {formatBytes(r.bytes)}
                      {r.bytesRate > 0 && <span className="opacity-60"> · {formatBytes(r.bytesRate)}/s</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right" style={{ color: 'var(--warning)' }}>
                      {r.peakRate}/s
                    </td>
                    <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>
                      {relativeSec(r.lastSeen, nowSec)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 50 && (
            <div className="px-3 py-1.5 text-[10px] border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-inset)' }}>
              {t.trafficMore.replace('{n}', String(rows.length - 50))}
            </div>
          )}
          <div className="px-3 py-1.5 text-[10px] border-t flex items-center justify-between gap-2" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-inset)' }}>
            <span>{t.actualTopicNote}</span>
            {rows.length >= 1000 && <span style={{ color: 'var(--warning)' }}>{t.trafficCap}</span>}
          </div>
        </div>
      )}
    </div>
  );
};
