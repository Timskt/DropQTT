import React, { useState } from 'react';
import { BellOff, Plus, Trash2, X, Check, CircleAlert } from 'lucide-react';
import { SilenceRule, silenceRuleDefaults } from '../../types';
import { Translations, fill } from '../../i18n';
import { SilenceAlertEntry } from '../../hooks/useSilence';

interface SilencePanelProps {
  rules: SilenceRule[];
  alerts: SilenceAlertEntry[];
  lastError: string | null;
  onAdd: (rule: SilenceRule) => void;
  onUpdate: (rule: SilenceRule) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onClearAlerts: () => void;
  connected: boolean;
  t: Translations;
}

const MIN_TIMEOUT = 5;

const newId = () => `sil_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/**
 * Silence watchdog: the "has this device stopped talking?" question. Rules are
 * evaluated in Rust against every inbound publish, so a quiet topic is detected
 * even while this window is on another workspace.
 */
export const SilencePanel: React.FC<SilencePanelProps> = ({
  rules, alerts, lastError, onAdd, onUpdate, onRemove, onToggle, onClearAlerts, connected, t,
}) => {
  const [editing, setEditing] = useState<SilenceRule | null>(null);
  const [headerText, setHeaderText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const start = (existing?: SilenceRule) => {
    const base = existing ?? {
      id: newId(), name: '', topicFilter: '', ...silenceRuleDefaults,
    };
    setEditing(base);
    setHeaderText(base.webhook.headers.map(([k, v]) => `${k}: ${v}`).join('\n'));
    setFormError(null);
  };

  const submit = () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.topicFilter.trim()) {
      setFormError(t.silenceNeedFields);
      return;
    }
    if (editing.timeoutSec < MIN_TIMEOUT) {
      setFormError(fill(t.silenceMinTimeout, { n: String(MIN_TIMEOUT) }));
      return;
    }
    let url: URL;
    try {
      url = new URL(editing.webhook.url.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
    } catch {
      setFormError(t.webhookInvalid);
      return;
    }
    const headers: [string, string][] = headerText
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const colon = line.indexOf(':');
        if (colon < 1) throw new Error();
        return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as [string, string];
      });
    const rule: SilenceRule = {
      ...editing,
      name: editing.name.trim(),
      topicFilter: editing.topicFilter.trim(),
      webhook: { ...editing.webhook, url: url.toString(), headers },
    };
    (rules.some((r) => r.id === rule.id) ? onUpdate : onAdd)(rule);
    setEditing(null);
  };

  return (
    <div className="panel">
      <div className="panel-header flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          <BellOff className="w-4 h-4" style={{ color: 'var(--warn)' }} />
          <span>{t.silenceTitle}</span>
          {rules.length > 0 && <span className="chip chip-warn">{rules.filter((r) => r.enabled).length}/{rules.length}</span>}
        </div>
        <button onClick={() => start()} className="btn-accent !px-3 !py-1 flex items-center gap-1 text-[11px]">
          <Plus className="w-3.5 h-3.5" />
          {t.silenceAdd}
        </button>
      </div>

      {(lastError || formError) && (
        <div role="alert" className="px-4 py-2 text-xs break-words flex items-start gap-1.5" style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}>
          <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{formError ?? lastError}</span>
        </div>
      )}

      <p className="px-4 pt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {t.silenceHint}
        {!connected && <span style={{ color: 'var(--warn)' }}> {t.silenceNeedsConnection}</span>}
      </p>

      {editing && (
        <div className="mx-4 mt-3 p-3 rounded-md space-y-2.5" style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-panel)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-semibold" style={{ color: 'var(--accent)' }}>{t.silenceAdd}</span>
            <button onClick={() => setEditing(null)} className="p-1 rounded" style={{ color: 'var(--text-muted)' }} title={t.cancel}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <label className="block text-[11px] space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <span>{t.ruleName}</span>
              <input className="field-input w-full" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="edge-gateway heartbeat" />
            </label>
            <label className="block text-[11px] space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <span>{t.silenceFilter}</span>
              <input className="field-input w-full font-mono" value={editing.topicFilter} onChange={(e) => setEditing({ ...editing, topicFilter: e.target.value })} placeholder="devices/+/hb" />
            </label>
            <label className="block text-[11px] space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <span>{t.silenceTimeout}</span>
              <input type="number" min={MIN_TIMEOUT} className="field-input w-full" value={editing.timeoutSec} onChange={(e) => setEditing({ ...editing, timeoutSec: Number(e.target.value) || MIN_TIMEOUT })} />
            </label>
            <label className="block text-[11px] space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <span>{t.silenceCooldown}</span>
              <input type="number" min={MIN_TIMEOUT} className="field-input w-full" value={editing.cooldownSec} onChange={(e) => setEditing({ ...editing, cooldownSec: Number(e.target.value) || MIN_TIMEOUT })} />
            </label>
          </div>
          <label className="block text-[11px] space-y-1" style={{ color: 'var(--text-secondary)' }}>
            <span>{t.webhookUrl}</span>
            <input className="field-input w-full font-mono" placeholder="http://localhost:8080/alerts" value={editing.webhook.url} onChange={(e) => setEditing({ ...editing, webhook: { ...editing.webhook, url: e.target.value } })} />
          </label>
          <label className="block text-[11px] space-y-1" style={{ color: 'var(--text-secondary)' }}>
            <span>{t.webhookHeaders}</span>
            <textarea className="field-input w-full h-14 font-mono" spellCheck={false} placeholder="Authorization: Bearer …" value={headerText} onChange={(e) => setHeaderText(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="btn-ghost">{t.cancel}</button>
            <button onClick={submit} className="btn-accent">{t.saveChanges}</button>
          </div>
        </div>
      )}

      <div className="p-4 space-y-2">
        {rules.length === 0 && !editing && (
          <div className="text-xs italic" style={{ color: 'var(--text-muted)' }}>{t.silenceNoRules}</div>
        )}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2.5 text-[11px] px-3 py-2 rounded inset-box flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: r.enabled ? 'var(--ok)' : 'var(--text-muted)' }}>
              <input type="checkbox" checked={r.enabled} onChange={() => onToggle(r.id)} />
              <Check className="w-3 h-3" aria-hidden />
              <span className="text-[10px]">{t.silenceEnabled}</span>
            </label>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{r.name}</span>
            <span className="font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-code)', color: 'var(--code-number)' }}>{r.topicFilter}</span>
            <span style={{ color: 'var(--text-muted)' }}>
              {fill(t.silenceAfter, { n: String(r.timeoutSec) })} · {fill(t.silenceEvery, { n: String(r.cooldownSec) })}
            </span>
            <span className="font-mono truncate max-w-[220px]" style={{ color: 'var(--text-secondary)' }}>{r.webhook.url}</span>
            <div className="ml-auto flex gap-1">
              <button onClick={() => start(r)} className="btn-ghost !px-2 !py-1" title={t.editRule}>{t.editRule}</button>
              <button onClick={() => onRemove(r.id)} className="p-1.5 rounded" style={{ color: 'var(--danger)' }} title={t.deleteRule}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t.silenceLog}</span>
          {alerts.length > 0 && (
            <button onClick={onClearAlerts} className="text-[10px] underline opacity-70 hover:opacity-100" style={{ color: 'var(--text-muted)' }}>{t.clearLog}</button>
          )}
        </div>
        <div className="max-h-40 overflow-y-auto space-y-1">
          {alerts.length === 0 ? (
            <div className="text-[11px] italic" style={{ color: 'var(--text-muted)' }}>{t.silenceEmpty}</div>
          ) : (
            [...alerts].reverse().map(({ key, ev }) => (
              <div key={key} className="flex items-center gap-2 text-[10px] font-mono px-2 py-1 rounded" style={{ background: ev.ok ? 'var(--warn-soft)' : 'var(--bad-soft)' }}>
                <span style={{ color: ev.ok ? 'var(--warn)' : 'var(--bad)' }}>{ev.ok ? '↑' : '!'}</span>
                <span style={{ color: 'var(--text-primary)' }}>{ev.ruleName}</span>
                <span style={{ color: 'var(--text-muted)' }}>{ev.timestamp}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{fill(t.silenceAfter, { n: String(ev.silentForSec) })}</span>
                <span className="truncate" style={{ color: 'var(--text-muted)' }}>{ev.ok ? ev.target : ev.error}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
