import React, { useMemo, useState } from 'react';
import { Activity, Gauge, Search, Trash2 } from 'lucide-react';
import { SysRow } from '../../types';
import { Translations, fill } from '../../i18n';
import { SysMetricId, detectDialect, detectVendor, pickMetrics } from '../../utils/sysDialect';

interface BrokerSysPanelProps {
  rows: SysRow[];
  connected: boolean;
  onClear: () => void;
  t: Translations;
}

/** Humanize a $SYS topic into a short leaf label (last 2 segments). */
const leaf = (topic: string): string => {
  const parts = topic.replace(/^\$SYS\//, '').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || topic;
};

export const BrokerSysPanel: React.FC<BrokerSysPanelProps> = ({ rows, connected, onClear, t }) => {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(false);

  const dialect = useMemo(() => detectDialect(rows), [rows]);
  const software = useMemo(() => detectVendor(rows), [rows]);
  const highlights = useMemo(() => {
    // Built inside the memo so the translation object is a real dependency rather
    // than a captured identity that needs a lint suppression to be believed.
    const labels: Record<SysMetricId, string> = {
      version: t.sysVersion,
      uptime: t.sysUptime,
      connections: t.sysConnections,
      msgReceived: t.sysMsgReceived,
      msgSent: t.sysMsgSent,
      load1min: t.sysLoad,
      retained: t.sysRetained,
      subscriptions: t.sysSubscriptions,
      bytesReceived: t.sysBytesIn,
      bytesSent: t.sysBytesOut,
    };
    return pickMetrics(rows, dialect).map(({ id, row }) => ({ label: labels[id], row }));
  }, [rows, dialect, t]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const term = filter.toLowerCase();
    return rows.filter((r) => r.topic.toLowerCase().includes(term) || r.value.toLowerCase().includes(term));
  }, [rows, filter]);

  return (
    <div className="panel overflow-hidden">
      <div className="panel-header">
        <div className="flex items-center space-x-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Gauge className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          <span>{t.brokerSys}</span>
          {software && <span className="chip chip-violet">{software}</span>}
          <span className="chip chip-neutral">{rows.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <button onClick={() => setExpanded((v) => !v)} className="btn-ghost !px-2 !py-1 text-[10px]">
              {expanded ? t.collapse : t.expandAll}
            </button>
          )}
          <button onClick={onClear} disabled={rows.length === 0} title={t.sysClear} aria-label={t.sysClear} className="btn-ghost !px-2 !py-1 text-[10px] flex items-center gap-1 disabled:opacity-40">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          {connected ? t.sysEmptyWaiting : t.sysEmptyOffline}
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {!dialect && (
            <div
              className="text-[11px] px-2 py-1.5 rounded inset-box"
              data-testid="sys-no-dialect"
              style={{ color: 'var(--warn)' }}
            >
              {fill(t.sysNoDialect, { vendor: software || t.sysUnknownVendor })}
            </div>
          )}

          {/* Highlight cards */}
          {highlights.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {highlights.map(({ label, row }) => (
                <div key={label} className="inset-box p-2">
                  <div className="text-[9px] uppercase tracking-wider truncate" style={{ color: 'var(--text-muted)' }} title={row!.topic}>
                    {label}
                  </div>
                  <div className="text-[13px] font-mono font-semibold truncate" style={{ color: 'var(--accent)' }} title={row!.value}>
                    {row!.value || '—'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Full searchable list (collapsed by default) */}
          {expanded && (
            <div className="space-y-2 animate-fade-in">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.sysFilter} aria-label={t.sysFilter} className="field-input w-full pl-8" />
              </div>
              <div className="inset-box divide-y max-h-64 overflow-y-auto">
                {filtered.map((r) => (
                  <div key={r.topic} className="flex items-center justify-between gap-3 px-2.5 py-1 text-[11px]">
                    <span className="font-mono truncate shrink-0 max-w-[55%]" title={r.topic} style={{ color: 'var(--text-secondary)' }}>
                      {leaf(r.topic)}
                    </span>
                    <span className="font-mono truncate text-right" title={r.value} style={{ color: 'var(--text-primary)' }}>
                      {r.value || '—'}
                    </span>
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div className="px-3 py-4 text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>{t.noMessagesFiltered}</div>
                )}
              </div>
            </div>
          )}
          {!expanded && highlights.length === 0 && (
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <Activity className="w-3 h-3" /> {t.sysExpandHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
