import React, { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ArrowRight,
  Download,
  GitBranch,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  Settings,
  SlidersHorizontal,
  Trash2,
  Upload,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import {
  BridgeRule,
  BrokerConfig,
  BrokerProfile,
  TopicMapEntry,
  bridgeRuleDefaults,
  DEFAULT_BROKER_CONFIG,
} from '../../types';
import { Translations } from '../../i18n';
import { useBridge } from '../../hooks/useBridge';
import { saveTextFile } from '../../utils/exportMessages';

interface BridgePanelProps {
  /** Selectable broker configs (current session + saved profiles) */
  options: BrokerProfile[];
  bridge: ReturnType<typeof useBridge>;
  /** Opens the global settings modal (where profiles are managed) */
  onOpenSettings: () => void;
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
  ...bridgeRuleDefaults,
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

/** "from => to" lines <-> mapping rows */
const parseTopicMap = (text: string): TopicMapEntry[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const idx = l.indexOf('=>');
      if (idx < 0) return { from: '', to: '' };
      return { from: l.slice(0, idx).trim(), to: l.slice(idx + 2).trim() };
    })
    .filter((e) => e.from && e.to);

const formatTopicMap = (rows: TopicMapEntry[]): string =>
  (rows ?? []).map((e) => `${e.from} => ${e.to}`).join('\n');

const SAMPLE_SCRIPT = `// transform(topic, payload, qos, retain)
// return the new payload; returning null drops this message
function transform(topic, payload, qos, retain) {
  // example: {"temp":23.5} -> temperature number, skip without field
  try {
    const obj = JSON.parse(payload);
    if (obj.temp === undefined) return null;
    return String(obj.temp);
  } catch (e) {
    return payload;
  }
}`;

/** UTF-8 string -> base64 (for the transform dry-run command) */
const b64Encode = (s: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)));

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
  onManageConfigs: () => void;
  t: Translations;
}> = ({ connId, title, accent, options, lastConfig, conn, busy, onConnect, onDisconnect, onManageConfigs, t }) => {
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
                {p.name} · {p.config.host || '—'}:{p.config.port}
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

        {/* Saved endpoint quick-picks: every configured profile is one click away */}
        {!conn && (
          <div className="flex flex-wrap gap-1.5">
            {options.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setCustomMode(false);
                  setSelected(p.id);
                  onConnect(p.id);
                }}
                disabled={busy}
                title={`${p.config.host}:${p.config.port}`}
                className={`px-2 py-1 rounded border text-[10px] font-mono transition select-text ${
                  selected === p.id && !customMode
                    ? 'font-semibold'
                    : 'opacity-75 hover:opacity-100'
                }`}
                style={{
                  borderColor: selected === p.id && !customMode ? accent : 'var(--border-inset)',
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                }}>
                {p.name} · {p.config.host || '—'}:{p.config.port}
              </button>
            ))}
            <button
              onClick={onManageConfigs}
              className="px-2 py-1 rounded border text-[10px] font-mono transition flex items-center gap-1"
              style={{ borderColor: 'var(--border-inset)', background: 'var(--bg-inset)', color: 'var(--accent)' }}
              title={t.manageConfigs}
            >
              <Settings className="w-3 h-3" />
              {t.manageConfigs}
            </button>
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

export const BridgePanel: React.FC<BridgePanelProps> = ({ options, bridge, onOpenSettings, t }) => {
  const {
    conns, rules, stats, events, busy, lastError, totalSent, remember, autoReconnect, setAutoReconnect,
    connect, disconnect, addRule, updateRule, removeRule, toggleRule, importRules, resetStats, clearEvents,
  } = bridge;

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [excludeText, setExcludeText] = useState('');
  const [topicMapText, setTopicMapText] = useState('');
  const [draft, setDraft] = useState<BridgeRule>(() => newRuleDraft('src', 'dst'));
  const fileRef = useRef<HTMLInputElement>(null);

  // Script dry-run state
  const [testPayload, setTestPayload] = useState('{"temp":23.5}');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);

  const runScriptTest = async () => {
    const firstFilter = draft.sourceFilter.split('\n').map((s) => s.trim()).filter(Boolean)[0] || 'test/topic';
    try {
      const res = await invoke<{ action: string; payload?: string; bytes?: number }>('bridge_test_transform', {
        script: draft.transformScript,
        topic: firstFilter,
        payloadBase64: b64Encode(testPayload),
      });
      if (res.action === 'drop') {
        setTestOk(true);
        setTestResult(`null → ${t.testDropped}`);
      } else {
        setTestOk(true);
        setTestResult(`(${res.bytes} B) ${res.payload}`);
      }
    } catch (e) {
      setTestOk(false);
      setTestResult(String(e));
    }
  };

  const handleExportRules = async () => {
    if (rules.length === 0) return;
    await saveTextFile(
      'dropqtt-bridge-rules.json',
      JSON.stringify({ app: 'dropqtt-bridge', version: 1, rules }, null, 2),
    );
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list: BridgeRule[] = Array.isArray(parsed) ? parsed : parsed.rules;
      if (!Array.isArray(list) || list.some((r) => !r || typeof r.sourceFilter !== 'string')) {
        setLastErrorText(t.importFailed);
        return;
      }
      importRules(list);
    } catch {
      setLastErrorText(t.importFailed);
    }
  };
  const setLastErrorText = (msg: string) => {
    setFormError(msg);
    setShowForm(true);
  };

  const connOf = (id: string) => conns.find((c) => c.id === id);
  const set = <K extends keyof BridgeRule>(k: K, v: BridgeRule[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormError(null);
  };

  const startEdit = (r: BridgeRule) => {
    // Older persisted rules lack the advanced fields — fill defaults
    const full = { ...newRuleDraft(r.sourceConn, r.targetConn), ...bridgeRuleDefaults, ...r };
    setDraft(full);
    setExcludeText((full.excludeFilters ?? []).join('\n'));
    setTopicMapText(formatTopicMap(full.topicMap ?? []));
    setEditingId(r.id);
    setFormError(null);
    setShowAdvanced(
      Boolean(
        (full.excludeFilters?.length ?? 0) ||
          full.transformScript ||
          full.payloadPrefix ||
          full.payloadSuffix ||
          full.wrapJson ||
          full.rateLimit > 0,
      ),
    );
    setShowForm(true);
  };

  const submitDraft = () => {
    if (!draft.name.trim() || !draft.sourceFilter.trim()) {
      setFormError(t.ruleName + ' / ' + t.sourceTopicFilter);
      return;
    }
    const clash = rules.find(
      (r) =>
        r.id !== editingId &&
        r.sourceConn === draft.sourceConn &&
        r.sourceFilter.trim() === draft.sourceFilter.trim() &&
        r.targetConn === draft.targetConn,
    );
    if (clash) {
      setFormError(t.ruleDuplicate.replace('{name}', clash.name));
      return;
    }
    const finalRule: BridgeRule = {
      ...draft,
      excludeFilters: excludeText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      topicMap: draft.topicMode === 'map' ? parseTopicMap(topicMapText) : [],
      rateLimit: Math.max(0, Math.min(1_000_000, draft.rateLimit || 0)),
    };
    if (finalRule.topicMode === 'map' && finalRule.topicMap.length === 0) {
      setFormError(t.topicMapEmpty);
      return;
    }
    if (editingId) {
      updateRule({ ...finalRule, id: editingId });
    } else {
      addRule({ ...finalRule, id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` });
    }
    setDraft(newRuleDraft(draft.sourceConn, draft.targetConn));
    setExcludeText('');
    setTopicMapText('');
    closeForm();
  };

  const topicRewriteDescription = (r: BridgeRule) => {
    switch (r.topicMode) {
      case 'prefix':
        return r.prefixFrom ? `${r.prefixFrom} → ${r.prefixTo}` : t.topicPrefixMap;
      case 'fixed':
        return `⇒ ${r.fixedTopic}`;
      case 'regex':
        return `⌇ ${r.regexPattern} → ${r.regexReplacement}`;
      case 'map':
        return `▦ ${(r.topicMap ?? [])[0]?.from ?? ''} → ${(r.topicMap ?? [])[0]?.to ?? ''}${(r.topicMap?.length ?? 0) > 1 ? ` +${r.topicMap.length - 1}` : ''}`;
      default:
        return t.topicKeepSame;
    }
  };
  const targetDescription = topicRewriteDescription;

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
          onManageConfigs={onOpenSettings}
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
          onManageConfigs={onOpenSettings}
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
            <button
              onClick={handleExportRules}
              disabled={rules.length === 0}
              className="btn-ghost !px-2.5 !py-1 flex items-center gap-1 text-[11px]"
              title={t.exportRules}
            >
              <Download className="w-3 h-3" />
              {t.exportRules}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="btn-ghost !px-2.5 !py-1 flex items-center gap-1 text-[11px]"
              title={t.importRules}
            >
              <Upload className="w-3 h-3" />
              {t.importRules}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                e.target.value = '';
              }}
            />
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
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-semibold" style={{ color: 'var(--accent)' }}>
                {editingId ? `✎ ${t.editRule}` : `＋ ${t.addRule}`}
              </span>
              <button onClick={closeForm} className="p-1 rounded" style={{ color: 'var(--text-muted)' }} title={t.cancel}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
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
              <div className="md:col-span-2">
                <textarea
                  className="field-input w-full h-16 resize-y font-mono"
                  placeholder={t.sourceFilterMultiPlaceholder}
                  title={t.sourceFiltersMulti}
                  value={draft.sourceFilter}
                  onChange={(e) => set('sourceFilter', e.target.value)}
                  spellCheck={false}
                />
                <div className="flex items-center justify-between mt-0.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  <span>{t.sourceFiltersMulti}</span>
                  {draft.sourceFilter.split('\n').filter((s) => s.trim()).length > 1 && (
                    <span className="px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}>
                      {draft.sourceFilter.split('\n').filter((s) => s.trim()).length} ✓
                    </span>
                  )}
                </div>
              </div>
              <select className="field-input self-start" value={draft.sourceQos} onChange={(e) => set('sourceQos', Number(e.target.value))}>
                {[0, 1, 2].map((q) => <option key={q} value={q}>Sub QoS {q}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select className="field-input" value={draft.topicMode} onChange={(e) => set('topicMode', e.target.value as BridgeRule['topicMode'])}>
                <option value="same">{t.topicKeepSame}</option>
                <option value="prefix">{t.topicPrefixMap}</option>
                <option value="fixed">{t.topicFixed}</option>
                <option value="regex">{t.topicRegex}</option>
                <option value="map">{t.topicMapMode}</option>
              </select>
              {draft.topicMode === 'prefix' && (
                <>
                  <input className="field-input" placeholder={t.prefixFrom} value={draft.prefixFrom} onChange={(e) => set('prefixFrom', e.target.value)} />
                  <input className="field-input" placeholder={t.prefixTo} value={draft.prefixTo} onChange={(e) => set('prefixTo', e.target.value)} />
                </>
              )}
              {draft.topicMode === 'fixed' && (
                <input className="field-input md:col-span-2" placeholder={t.fixedTopicPlaceholder} value={draft.fixedTopic} onChange={(e) => set('fixedTopic', e.target.value)} />
              )}
              {draft.topicMode === 'regex' && (
                <>
                  <input className="field-input" placeholder={t.regexPatternPlaceholder} value={draft.regexPattern} onChange={(e) => set('regexPattern', e.target.value)} />
                  <input className="field-input" placeholder={t.regexReplacePlaceholder} value={draft.regexReplacement} onChange={(e) => set('regexReplacement', e.target.value)} />
                </>
              )}
              {draft.topicMode === 'map' && (
                <textarea
                  className="field-input md:col-span-2 h-20 resize-y font-mono"
                  placeholder={t.topicMapPlaceholder}
                  value={topicMapText}
                  onChange={(e) => setTopicMapText(e.target.value)}
                  spellCheck={false}
                />
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

            {/* Advanced: exclusions, payload rewrites, rate limit */}
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-[11px] font-mono underline decoration-dotted"
              style={{ color: 'var(--accent)' }}
            >
              {showAdvanced ? `▾ ${t.advanced}` : `▸ ${t.advanced}`}
            </button>
            {showAdvanced && (
              <div className="space-y-3 rounded-md border p-3" style={{ borderColor: 'var(--border-inset)', background: 'var(--bg-panel)' }}>
                {/* JS transform script */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{t.transformScriptLabel}</span>
                    <button
                      type="button"
                      onClick={() => set('transformScript', SAMPLE_SCRIPT)}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
                      style={{ borderColor: 'var(--border-inset)', color: 'var(--accent)' }}
                    >
                      {t.insertSample}
                    </button>
                  </div>
                  <textarea
                    className="field-input w-full h-24 resize-y font-mono text-[11px]"
                    placeholder={t.transformScriptPlaceholder}
                    value={draft.transformScript}
                    onChange={(e) => set('transformScript', e.target.value)}
                    spellCheck={false}
                  />
                  <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>{t.scriptHint}</div>
                  {/* Dry-run: sample payload -> result without saving the rule */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <input
                      className="field-input flex-1 font-mono text-[11px]"
                      placeholder={t.testPayloadPlaceholder}
                      value={testPayload}
                      onChange={(e) => setTestPayload(e.target.value)}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={runScriptTest}
                      disabled={!draft.transformScript.trim()}
                      className="btn-ghost flex items-center gap-1 text-[11px] shrink-0"
                    >
                      <Play className="w-3 h-3" />
                      {t.runTest}
                    </button>
                  </div>
                  {testResult !== null && (
                    <div
                      className="text-[11px] font-mono px-2 py-1.5 rounded mt-1 select-text break-all"
                      style={{
                        background: 'var(--bg-code)',
                        color: testOk ? 'var(--success)' : 'var(--danger)',
                        border: `1px solid ${testOk ? 'var(--success)' : 'var(--danger)'}`,
                      }}
                    >
                      {testOk ? '✓' : '✗'} {testResult}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-mono mb-1" style={{ color: 'var(--text-muted)' }}>{t.excludeTopics}</div>
                    <textarea
                      className="field-input w-full h-16 resize-y font-mono"
                      placeholder={'home/private/#\nhome/secret'}
                      value={excludeText}
                      onChange={(e) => setExcludeText(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-2">
                    <input
                      className="field-input w-full"
                      placeholder={t.payloadPrefixPlaceholder}
                      value={draft.payloadPrefix}
                      onChange={(e) => set('payloadPrefix', e.target.value)}
                    />
                    <input
                      className="field-input w-full"
                      placeholder={t.payloadSuffixPlaceholder}
                      value={draft.payloadSuffix}
                      onChange={(e) => set('payloadSuffix', e.target.value)}
                    />
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-[11px] font-mono cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                        <input
                          type="checkbox"
                          checked={draft.wrapJson}
                          onChange={(e) => set('wrapJson', e.target.checked)}
                          className="w-3.5 h-3.5"
                          style={{ accentColor: 'var(--accent)' }}
                        />
                        {t.wrapJson}
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {t.rateLimit}
                        <input
                          type="number"
                          min={0}
                          className="field-input !w-20"
                          value={draft.rateLimit || 0}
                          onChange={(e) => set('rateLimit', Number(e.target.value) || 0)}
                        />
                        {t.perSec}
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[11px] font-mono flex-1 min-w-0" style={{ color: formError ? 'var(--danger)' : 'var(--text-muted)' }}>
                {formError ?? t.bridgeHint}
              </span>
              <div className="flex gap-2">
                <button onClick={closeForm} className="btn-ghost">{t.cancel}</button>
                <button onClick={submitDraft} className="btn-accent">
                  {editingId ? t.saveChanges : t.addRule}
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
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded select-text" style={{ background: 'var(--bg-code)', color: '#9cdcfe' }}>
                      {r.sourceConn}:{r.sourceFilter.split('\n').map((s) => s.trim()).filter(Boolean).join(' · ')}
                    </span>
                    <ArrowRight className="w-3 h-3 shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded select-text" style={{ background: 'var(--bg-code)', color: '#ce9177' }}>
                      {r.targetConn}
                      {r.topicMode === 'prefix' && r.prefixFrom ? ` → ${r.prefixTo}` : ''}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono mt-1 select-text" style={{ color: 'var(--text-muted)' }}>
                    {targetDescription(r)} · {r.qosMode === 'fixed' ? `QoS ${r.fixedQos}` : t.qosFollowSource} ·{' '}
                    {r.retainMode === 'on' ? t.retainForceOn : r.retainMode === 'off' ? t.retainForceOff : t.retainFollow} ·{' '}
                    {r.forwardProps ? t.forwardV5Props : '—'}
                    {(r.excludeFilters?.length ?? 0) > 0 && <span className="ml-2">⊘ {r.excludeFilters.length}</span>}
                    {r.transformScript?.trim() && <span className="ml-2" style={{ color: 'var(--accent)' }}>✎js</span>}
                    {(r.payloadPrefix || r.payloadSuffix || r.wrapJson) && <span className="ml-2">✎payload</span>}
                    {r.rateLimit > 0 && <span className="ml-2">≈{r.rateLimit}/s</span>}
                    {s?.lastTopic && <span className="ml-2 truncate">↩ {s.lastTopic}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono px-2 py-1 rounded select-text" style={{ background: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)' }}>
                    {t.forwarded} {s?.forwarded ?? 0}
                  </span>
                  {(s?.errors ?? 0) > 0 && (
                    <span className="text-[11px] font-mono px-2 py-1 rounded" style={{ background: 'color-mix(in srgb, var(--danger) 14%, transparent)', color: 'var(--danger)' }}>
                      {s.errors}
                    </span>
                  )}
                  {(s?.dropped ?? 0) > 0 && (
                    <span
                      className="text-[11px] font-mono px-2 py-1 rounded"
                      title={t.dropped}
                      style={{ background: 'color-mix(in srgb, var(--warning) 14%, transparent)', color: 'var(--warning)' }}
                    >
                      ⊘ {s.dropped}
                    </span>
                  )}
                  <button
                    onClick={() => startEdit(r)}
                    className="p-1.5 rounded border transition"
                    style={{ borderColor: 'var(--border-inset)', color: 'var(--text-muted)' }}
                    title={t.editRule}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
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
            <span className="ml-2 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {t.logSummary
                .replace('{sent}', String(totalSent))
                .replace('{kept}', String(events.length))
                .replace('{cap}', '150')
                .replace('{shown}', '80')}
            </span>
          </div>
          <button onClick={clearEvents} className="btn-ghost !px-2.5 !py-1 text-[11px]">{t.clearLog}</button>
        </div>
        <div className="p-3 max-h-60 overflow-y-auto space-y-1 font-mono text-[11px]">
          {events.length === 0 && (
            <div className="text-center py-6" style={{ color: 'var(--text-muted)' }}>{t.noBridgeEvents}</div>
          )}
          {events.slice(-80).reverse().map(({ key, ev }) => (
            <div key={key} className="flex items-center gap-2 px-2 py-1 rounded animate-fade-in select-text" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
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
