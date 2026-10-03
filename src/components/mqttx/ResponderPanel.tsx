import React, { useState } from 'react';
import { RotateCcw, Plus, Trash2, CircleAlert, Bot } from 'lucide-react';
import { ResponderRule, ResponderStats, responderRuleDefaults } from '../../types';
import { Translations, fill } from '../../i18n';

interface ResponderPanelProps {
  rules: ResponderRule[];
  stats: ResponderStats[];
  lastError: string | null;
  connected: boolean;
  onAdd: (rule: ResponderRule) => void;
  onUpdate: (rule: ResponderRule) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onReset: () => void;
  t: Translations;
}

const newId = () => `rp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/**
 * Fake devices: a trigger filter and a reply template, evaluated in Rust against
 * every inbound publish. Useful when the device is not on the bench, and dangerous
 * when it is — so a reply that answers its own trigger is refused before it can be
 * saved, and the reply rate has a ceiling.
 */
export const ResponderPanel: React.FC<ResponderPanelProps> = ({
  rules, stats, lastError, connected, onAdd, onUpdate, onRemove, onToggle, onReset, t,
}) => {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const statFor = (id: string) => stats.find((s) => s.id === id);
  const armedCount = rules.filter((r) => r.enabled).length;

  const add = () => {
    // Valid on arrival: an empty reply topic would be refused by the backend, and a
    // rejected sync leaves the previous set armed.
    onAdd({
      id: newId(),
      trigger: 'devices/+/cmd',
      ...responderRuleDefaults,
      replyTopic: 'devices/gw1/ack',
    });
  };

  const patch = (rule: ResponderRule, over: Partial<ResponderRule>) =>
    onUpdate({ ...rule, ...over });

  const remove = (id: string) => {
    if (confirmId === id) {
      onRemove(id);
      setConfirmId(null);
    } else {
      setConfirmId(id);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Bot className="w-4 h-4" style={{ color: armedCount > 0 ? 'var(--accent)' : 'var(--text-muted)' }} />
          <span>{t.responderTitle}</span>
          {rules.length > 0 && (
            <span className={`chip ${armedCount > 0 ? 'chip-ok' : 'chip-neutral'}`} data-testid="responder-armed">
              {armedCount}/{rules.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {stats.some((s) => s.matched + s.replied + s.failed + s.throttled + s.suppressed > 0) && (
            <button
              onClick={onReset}
              className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[11px]"
              title={t.responderResetHint}
              data-testid="responder-reset"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t.resetStats}
            </button>
          )}
          <button onClick={add} className="btn-accent !px-3 !py-1 flex items-center gap-1 text-[11px]" data-testid="responder-add">
            <Plus className="w-3.5 h-3.5" />
            {t.addRule}
          </button>
        </div>
      </div>

      <p className="px-4 pt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {t.responderHint}
        <span className="font-mono" style={{ color: 'var(--code-number)' }}> {t.responderTokens}</span>
        {!connected && <span style={{ color: 'var(--warn)' }}> {t.responderNeedsConnection}</span>}
      </p>

      {lastError && (
        <div
          role="alert"
          className="mx-4 mt-2 px-3 py-2 text-xs break-words flex items-start gap-1.5 rounded"
          style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}
          data-testid="responder-error"
        >
          <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{lastError} — {t.faultsPreviousKept}</span>
        </div>
      )}

      <div className="p-4 space-y-2">
        {rules.length === 0 && (
          <div className="text-xs italic" style={{ color: 'var(--text-muted)' }} data-testid="responder-empty">
            {t.responderEmpty}
          </div>
        )}
        {rules.map((r) => {
          const s = statFor(r.id);
          return (
            <div key={r.id} className="inset-box px-3 py-2 space-y-1.5" data-testid={`responder-row-${r.id}`}>
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: r.enabled ? 'var(--ok)' : 'var(--text-muted)' }}>
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => onToggle(r.id)}
                    aria-label={`${t.responderTitle} ${r.name || r.trigger}`}
                  />
                  <span className="text-[10px]">{t.responderEnabled}</span>
                </label>
                <input
                  className="field-input w-32 !px-1.5 !py-0.5 text-[11px]"
                  value={r.name}
                  placeholder={t.responderNamePlaceholder}
                  aria-label={t.ruleName}
                  onChange={(e) => patch(r, { name: e.target.value })}
                />
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.responderTrigger}</span>
                <input
                  className="field-input font-mono flex-1 min-w-[9rem] !px-1.5 !py-0.5 text-[11px]"
                  value={r.trigger}
                  aria-label={t.responderTrigger}
                  data-testid={`responder-trigger-${r.id}`}
                  onChange={(e) => patch(r, { trigger: e.target.value })}
                />
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>→</span>
                <input
                  className="field-input font-mono flex-1 min-w-[9rem] !px-1.5 !py-0.5 text-[11px]"
                  value={r.replyTopic}
                  aria-label={t.responderReplyTopic}
                  data-testid={`responder-reply-topic-${r.id}`}
                  onChange={(e) => patch(r, { replyTopic: e.target.value })}
                />
                <button
                  onClick={() => remove(r.id)}
                  className="p-1.5 rounded"
                  style={{ color: 'var(--danger)', background: confirmId === r.id ? 'var(--bad-soft)' : undefined }}
                  title={confirmId === r.id ? t.deleteConfirmAgain : t.deleteRule}
                  aria-label={`${t.deleteRule} ${r.name || r.trigger}`}
                  data-testid={`responder-delete-${r.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <textarea
                className="field-input w-full h-12 font-mono text-[11px]"
                spellCheck={false}
                value={r.replyPayload}
                aria-label={t.responderReplyPayload}
                data-testid={`responder-payload-${r.id}`}
                placeholder='{"ok":true,"echo":"${payload}"}'
                onChange={(e) => patch(r, { replyPayload: e.target.value })}
              />

              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <span>{t.responderQos}</span>
                  <select
                    className="field-input !px-1.5 !py-0.5 text-[11px]"
                    value={r.qos}
                    aria-label={t.responderQos}
                    data-testid={`responder-qos-${r.id}`}
                    onChange={(e) => patch(r, { qos: Number(e.target.value) })}
                  >
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                </label>
                <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <input
                    type="checkbox"
                    checked={r.retain}
                    onChange={(e) => patch(r, { retain: e.target.checked })}
                    aria-label={t.responderRetain}
                  />
                  <span>{t.responderRetain}</span>
                </label>
                <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <span>{t.responderDelay}</span>
                  <input
                    type="number"
                    min={0}
                    max={60_000}
                    value={r.delayMs}
                    aria-label={t.responderDelay}
                    data-testid={`responder-delay-${r.id}`}
                    onChange={(e) => patch(r, { delayMs: Math.max(0, Math.min(60_000, Number(e.target.value) || 0)) })}
                    className="field-input w-20 !px-1.5 !py-0.5 text-[11px] font-mono"
                  />
                </label>
                <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <span>{t.responderRate}</span>
                  <input
                    type="number"
                    min={0}
                    max={10_000}
                    value={r.maxPerSec}
                    aria-label={t.responderRate}
                    data-testid={`responder-rate-${r.id}`}
                    onChange={(e) => patch(r, { maxPerSec: Math.max(0, Math.min(10_000, Number(e.target.value) || 0)) })}
                    className="field-input w-16 !px-1.5 !py-0.5 text-[11px] font-mono"
                  />
                </label>
                <span className="text-[10px] font-mono ml-auto" style={{ color: 'var(--text-muted)' }} data-testid={`responder-counts-${r.id}`}>
                  {s
                    ? fill(t.responderCounts, {
                      matched: String(s.matched),
                      replied: String(s.replied),
                      throttled: String(s.throttled),
                      suppressed: String(s.suppressed),
                      failed: String(s.failed),
                    })
                    : t.faultsNoStats}
                  {s?.lastError ? ` · ${s.lastError}` : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
