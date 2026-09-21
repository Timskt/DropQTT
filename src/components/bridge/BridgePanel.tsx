import React, { useState } from 'react';
import {
  ArrowRight,
  GitBranch,
  Plus,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Trash2,
  WifiOff,
  Zap,
} from 'lucide-react';
import {
  BridgeRule,
  BrokerConfig,
  BrokerProfile,
  DEFAULT_BROKER_CONFIG,
} from '../../types';
import { Translations } from '../../i18n';
import { useBridge } from '../../hooks/useBridge';

interface BridgePanelProps {
  /** Selectable broker configs (current session + saved profiles) */
  options: BrokerProfile[];
  bridge: ReturnType<typeof useBridge>;
  t: Translations;
}

const newRuleDraft = (sourceConn: string, targetConn: string): BridgeRule => ({
  id: '',
  name: '',
  sourceConn,
  sourceFilter: '',
  sourceQos: 1,
  targetConn,
  topicMode: 'same',
  prefixFrom: '',
  prefixTo: '',
  qosMode: 'source',
  fixedQos: 1,
  retainMode: 'source',
  forwardProps: true,
  enabled: true,
});

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

/** One source/target bridge connection card */
const BridgeConnCard: React.FC<{
  connId: 'src' | 'dst';
  title: string;
  accent: string;
  options: BrokerProfile[];
  lastConfig?: BrokerConfig;
  conn?: { connected: boolean; brokerHost: string; brokerPort: number; error?: string | null };
  busy: boolean;
  onConnect: (profileId: string, custom?: { host: string; port: number }) => void;
  onDisconnect: () => void;
  t: Translations;
}> = ({ connId, title, accent, options, lastConfig, conn, busy, onConnect, onDisconnect, t }) => {
  const [selected, setSelected] = useState(lastConfig ? '__last__' : (options[0]?.id ?? ''));
  const [customMode, setCustomMode] = useState(false);
  const [customHost, setCustomHost] = useState(lastConfig?.host ?? '127.0.0.1');
  const [customPort, setCustomPort] = useState(String(lastConfig?.port ?? 1883));

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          <GitBranch className="w-4 h-4" style={{ color: accent }} />
          {title}
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-inset)', color: 'var(--text-muted)' }}>
            {connId}
          </span>
        </div>
        <span
          className="flex items-center gap-1.5 text-[11px] font-mono"
          style={{ color: conn?.connected ? 'var(--success)' : 'var(--text-muted)' }}
        >
          <span
            className={`w-2 h-2 rounded-full ${conn?.connected ? 'animate-pulse' : ''}`}
            style={{ background: conn?.connected ? 'var(--success)' : 'var(--text-muted)' }}
          />
          {conn?.connected ? t.connected : t.disconnected}
        </span>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={customMode ? '__custom__' : selected}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                setCustomMode(true);
              } else {
                setCustomMode(false);
                setSelected(e.target.value);
              }
            }}
            className="field-input flex-1"
            style={{ color: 'var(--text-primary)' }}
          >
            {lastConfig && (
              <option value="__last__" style={{ background: 'var(--bg-panel-solid)' }}>
                {t.lastUsed} · {lastConfig.host}:{lastConfig.port}
              </option>
            )}
            {options.map((p) => (
              <option key={p.id} value={p.id} style={{ background: 'var(--bg-panel-solid)' }}>
                {p.name} · {p.config.host}:{p.config.port}
              </option>
            ))}
            <option value="__custom__" style={{ background: 'var(--bg-panel-solid)' }}>
              {t.customEndpoint}
            </option>
          </select>
          <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
        </div>

        {customMode && (
          <div className="grid grid-cols-3 gap-2">
            <input
              className="field-input col-span-2"
              placeholder={t.hostPlaceholder}
              value={customHost}
              onChange={(e) => setCustomHost(e.target.value)}
            />
            <input
              className="field-input"
              placeholder={t.portPlaceholder}
              type="number"
              value={customPort}
              onChange={(e) => setCustomPort(e.target.value)}
            />
          </div>
        )}

        {conn ? (
          <div className="inset-box px-3 py-2 flex items-center justify-between text-[11px] font-mono">
            <span style={{ color: 'var(--text-secondary)' }}>
              {conn.brokerHost}:{conn.brokerPort}
            </span>
            <button
              onClick={onDisconnect}
              className="flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition"
              style={{ borderColor: 'var(--border-inset)', color: 'var(--danger)' }}
            >
              <WifiOff className="w-3 h-3" />
              {t.disconnect}
            </button>
          </div>
        ) : (
          <button
            onClick={() =>
              customMode
                ? onConnect('', { host: customHost.trim(), port: Number(customPort) || 1883 })
                : onConnect(selected)
            }
            disabled={busy || (!customMode && !selected)}
            className="btn-accent w-full flex items-center justify-center gap-2"
          >
            <Server className="w-3.5 h-3.5" />
            {selected === '__last__' && lastConfig ? `${t.connect} · ${lastConfig.host}:${lastConfig.port}` : t.connect}
          </button>
        )}

        {conn?.error && (
          <div className="text-[11px] font-mono px-2 py-1.5 rounded" style={{ color: 'var(--danger)', background: 'var(--bg-inset)' }}>
            {conn.error}
          </div>
        )}
      </div>
    </div>
  );
};

export const BridgePanel: React.FC<BridgePanelProps> = ({ options, bridge, t }) => {
  const {
    conns, rules, stats, events, busy, lastError, remember, autoReconnect, setAutoReconnect,
    connect, disconnect, addRule, removeRule, toggleRule, resetStats, clearEvents,
  } = bridge;

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<BridgeRule>(() => newRuleDraft('src', 'dst'));

  const connOf = (id: string) => conns.find((c) => c.id === id);
  const set = <K extends keyof BridgeRule>(k: K, v: BridgeRule[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submitDraft = () => {
    if (!draft.name.trim() || !draft.sourceFilter.trim()) return;
    addRule({ ...draft, id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` });
    setDraft(newRuleDraft(draft.sourceConn, draft.targetConn));
    setShowForm(false);
  };

  const targetDescription = (r: BridgeRule) =>
    r.topicMode === 'prefix' && r.prefixFrom ? `${r.prefixFrom} → ${r.prefixTo}` : t.topicKeepSame;

  return (
    <div className="space-y-4 max-w-6xl mx-auto flex flex-col">
      {/* Autostart preference */}
      <div className="flex items-center justify-end">
        <label className="flex items-center gap-2 text-[11px] font-mono cursor-pointer px-3 py-1.5 rounded border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-panel)', background: 'var(--bg-panel)' }}>
          <input
            type="checkbox"
            checked={autoReconnect}
            onChange={(e) => setAutoReconnect(e.target.checked)}
            className="w-3.5 h-3.5"
            style={{ accentColor: 'var(--accent)' }}
          />
          {t.bridgeAutoReconnect}
        </label>
      </div>

      {/* ---- Connections ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BridgeConnCard
          connId="src"
          title={t.bridgeSource}
          accent="var(--accent)"
          options={options}
          lastConfig={remember.src}
          conn={connOf('src')}
          busy={busy}
          t={t}
          onConnect={(profileId, custom) => {
            if (custom) {
              connect('src', { ...DEFAULT_BROKER_CONFIG, host: custom.host, port: custom.port, clientId: 'DropQTT' });
            } else if (profileId === '__last__' && remember.src) {
              connect('src', remember.src);
            } else {
              const p = options.find((o) => o.id === profileId);
              if (p) connect('src', p.config);
            }
          }}
          onDisconnect={() => disconnect('src')}
        />
        <BridgeConnCard
          connId="dst"
          title={t.bridgeTarget}
          accent="var(--warning)"
          options={options}
          lastConfig={remember.dst}
          conn={connOf('dst')}
          busy={busy}
          t={t}
          onConnect={(profileId, custom) => {
            if (custom) {
              connect('dst', { ...DEFAULT_BROKER_CONFIG, host: custom.host, port: custom.port, clientId: 'DropQTT' });
            } else if (profileId === '__last__' && remember.dst) {
              connect('dst', remember.dst);
            } else {
              const p = options.find((o) => o.id === profileId);
              if (p) connect('dst', p.config);
            }
          }}
          onDisconnect={() => disconnect('dst')}
        />
      </div>

      {lastError && (
        <div className="text-[11px] font-mono px-3 py-2 rounded border" style={{ color: 'var(--danger)', borderColor: 'var(--danger)', background: 'var(--bg-inset)' }}>
          {lastError}
        </div>
      )}

      {/* ---- Rules ---- */}
      <div className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            <Zap className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            {t.bridgeRules}
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>({rules.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={resetStats} className="btn-ghost !px-2.5 !py-1 flex items-center gap-1 text-[11px]">
              <RefreshCw className="w-3 h-3" />
              {t.resetStats}
            </button>
            <button onClick={() => setShowForm((v) => !v)} className="btn-accent !px-3 !py-1 flex items-center gap-1 text-[11px]">
              <Plus className="w-3.5 h-3.5" />
              {t.addRule}
            </button>
          </div>
        </div>

        {showForm && (
          <div className="px-4 py-4 border-b space-y-3" style={{ borderColor: 'var(--border-panel)', background: 'var(--bg-inset)' }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                className="field-input"
                placeholder={t.ruleName}
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
              />
              <select className="field-input" value={draft.sourceConn} onChange={(e) => setDraft((d) => ({ ...d, sourceConn: e.target.value, targetConn: d.sourceConn === e.target.value ? d.targetConn : e.target.value === 'src' ? 'dst' : 'src' }))}>
                <option value="src">{t.bridgeSource} (src)</option>
                <option value="dst">{t.bridgeTarget} (dst)</option>
              </select>
              <select className="field-input" value={draft.targetConn} onChange={(e) => setDraft((d) => ({ ...d, targetConn: e.target.value, sourceConn: d.targetConn === e.target.value ? d.sourceConn : e.target.value === 'src' ? 'dst' : 'src' }))}>
                <option value="dst">{t.bridgeTarget} (dst)</option>
                <option value="src">{t.bridgeSource} (src)</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                className="field-input md:col-span-2"
                placeholder={t.sourceTopicFilter}
                value={draft.sourceFilter}
                onChange={(e) => set('sourceFilter', e.target.value)}
              />
              <select className="field-input" value={draft.sourceQos} onChange={(e) => set('sourceQos', Number(e.target.value))}>
                {[0, 1, 2].map((q) => <option key={q} value={q}>Sub QoS {q}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select className="field-input" value={draft.topicMode} onChange={(e) => set('topicMode', e.target.value as BridgeRule['topicMode'])}>
                <option value="same">{t.topicKeepSame}</option>
                <option value="prefix">{t.topicPrefixMap}</option>
              </select>
              {draft.topicMode === 'prefix' && (
                <>
                  <input className="field-input" placeholder={t.prefixFrom} value={draft.prefixFrom} onChange={(e) => set('prefixFrom', e.target.value)} />
                  <input className="field-input" placeholder={t.prefixTo} value={draft.prefixTo} onChange={(e) => set('prefixTo', e.target.value)} />
                </>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="flex items-center gap-2">
                <select className="field-input flex-1" value={draft.qosMode} onChange={(e) => set('qosMode', e.target.value as BridgeRule['qosMode'])}>
                  <option value="source">{t.qosFollowSource}</option>
                  <option value="fixed">{t.qosFixed}</option>
                </select>
                {draft.qosMode === 'fixed' && (
                  <select className="field-input !w-20" value={draft.fixedQos} onChange={(e) => set('fixedQos', Number(e.target.value))}>
                    {[0, 1, 2].map((q) => <option key={q} value={q}>QoS {q}</option>)}
                  </select>
                )}
              </div>
              <select className="field-input" value={draft.retainMode} onChange={(e) => set('retainMode', e.target.value as BridgeRule['retainMode'])}>
                <option value="source">{t.retainFollow}</option>
                <option value="on">{t.retainForceOn}</option>
                <option value="off">{t.retainForceOff}</option>
              </select>
              <label className="flex items-center gap-2 text-[12px] font-mono cursor-pointer px-1" style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={draft.forwardProps}
                  onChange={(e) => set('forwardProps', e.target.checked)}
                  className="w-4 h-4"
                  style={{ accentColor: 'var(--accent)' }}
                />
                {t.forwardV5Props}
              </label>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{t.bridgeHint}</span>
              <div className="flex gap-2">
                <button onClick={() => setShowForm(false)} className="btn-ghost">{t.cancel}</button>
                <button
                  onClick={submitDraft}
                  disabled={!draft.name.trim() || !draft.sourceFilter.trim()}
                  className="btn-accent"
                >
                  {t.addRule}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 space-y-2.5">
          {rules.length === 0 && (
            <div className="text-center py-8 text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {t.noBridgeRules}
            </div>
          )}
          {rules.map((r) => {
            const s = stats[r.id];
            return (
              <div key={r.id} className="inset-box px-3 py-2.5 flex items-center gap-3 flex-wrap">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={() => toggleRule(r.id)}
                  className="w-4 h-4 shrink-0"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{r.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-code)', color: '#9cdcfe' }}>
                      {r.sourceConn}:{r.sourceFilter}
                    </span>
                    <ArrowRight className="w-3 h-3 shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-code)', color: '#ce9177' }}>
                      {r.targetConn}
                      {r.topicMode === 'prefix' && r.prefixFrom ? ` → ${r.prefixTo}` : ''}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
                    {targetDescription(r)} · {r.qosMode === 'fixed' ? `QoS ${r.fixedQos}` : t.qosFollowSource} ·{' '}
                    {r.retainMode === 'on' ? t.retainForceOn : r.retainMode === 'off' ? t.retainForceOff : t.retainFollow} ·{' '}
                    {r.forwardProps ? t.forwardV5Props : '—'}
                    {s?.lastTopic && <span className="ml-2 truncate">↩ {s.lastTopic}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono px-2 py-1 rounded" style={{ background: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)' }}>
                    {t.forwarded} {s?.forwarded ?? 0}
                  </span>
                  {(s?.errors ?? 0) > 0 && (
                    <span className="text-[11px] font-mono px-2 py-1 rounded" style={{ background: 'color-mix(in srgb, var(--danger) 14%, transparent)', color: 'var(--danger)' }}>
                      {s.errors}
                    </span>
                  )}
                  <button
                    onClick={() => removeRule(r.id)}
                    className="p-1.5 rounded border transition"
                    style={{ borderColor: 'var(--border-inset)', color: 'var(--text-muted)' }}
                    title={t.deleteRule}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- Live forward log ---- */}
      <div className="panel">
        <div className="panel-header">
          <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t.bridgeLog}
            <span className="ml-2 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{events.length}</span>
          </div>
          <button onClick={clearEvents} className="btn-ghost !px-2.5 !py-1 text-[11px]">{t.clearLog}</button>
        </div>
        <div className="p-3 max-h-60 overflow-y-auto space-y-1 font-mono text-[11px]">
          {events.length === 0 && (
            <div className="text-center py-6" style={{ color: 'var(--text-muted)' }}>{t.noBridgeEvents}</div>
          )}
          {events.slice(-80).reverse().map(({ key, ev }) => (
            <div key={key} className="flex items-center gap-2 px-2 py-1 rounded animate-fade-in" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-muted)' }}>{ev.timestamp}</span>
              <span className="px-1.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}>{ev.ruleName}</span>
              <span className="truncate flex-1">
                {ev.fromTopic} <ArrowRight className="inline w-3 h-3" /> {ev.toTopic}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>{formatBytes(ev.bytes)} · Q{ev.qos}{ev.retain ? ' R' : ''}</span>
              <span style={{ color: ev.ok ? 'var(--success)' : 'var(--danger)' }}>{ev.ok ? '✓' : '✗'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
