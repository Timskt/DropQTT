import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RotateCcw, ShieldCheck, Trash2, X, Plus, CircleAlert } from 'lucide-react';
import { AssertionRule, AssertStats, AssertionViolation } from '../../types';
import { Translations } from '../../i18n';
import { assertionRuleText } from '../../utils/assertions';

interface AssertionPanelProps {
  rules: AssertionRule[];
  stats: AssertStats;
  /** How many rules the backend actually has armed — not the same as `rules.length`
   * when the last sync was rejected. */
  armed: number;
  recent: AssertionViolation[];
  lastError: string | null;
  onAdd: (rule: AssertionRule) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onReset: () => void;
  t: Translations;
}

const newId = () => `as_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/**
 * Message assertions: the line between watching traffic and judging it. Each rule
 * is a topic filter plus one predicate (`$.tempC < 80`, `payload contains panic`,
 * `qos >= 1`); the predicates are parsed and evaluated in Rust, and the verdict
 * rides on the feed row that produced it.
 */
export const AssertionPanel: React.FC<AssertionPanelProps> = ({
  rules, stats, armed, recent, lastError, onAdd, onRemove, onToggle, onReset, t,
}) => {
  const [draft, setDraft] = useState<{ filter: string; predicate: string; label: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    !!draft && !busy && draft.filter.trim().length > 0 && draft.predicate.trim().length > 0;

  const submit = async () => {
    if (!draft || !canSubmit) return;
    setBusy(true);
    try {
      const rule = await invoke<AssertionRule>('assertions_parse_rule', {
        id: newId(),
        filter: draft.filter,
        predicate: draft.predicate,
        label: draft.label,
      });
      onAdd(rule);
      setDraft(null);
      setFormError(null);
    } catch (e) {
      // Rust says why the line is not a rule; that sentence is the point.
      setFormError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => {
    if (confirmId === id) {
      onRemove(id);
      setConfirmId(null);
    } else {
      setConfirmId(id);
    }
  };

  const tally = (label: string, value: number, color?: string) => (
    <div key={label} className="flex items-baseline justify-between gap-2 text-[11px]">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="font-mono font-semibold" style={{ color: color ?? 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );

  return (
    <div className="panel">
      <div className="panel-header flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          <ShieldCheck className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <span>{t.assertionsTitle}</span>
          {rules.length > 0 && (
            <span
              className={`chip ${armed === 0 ? 'chip-bad' : 'chip-ok'}`}
              data-testid="assertions-armed"
              title={armed === 0 ? t.assertionsNotArmed : undefined}
            >
              {armed}/{rules.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {(stats.matched > 0 || recent.length > 0) && (
            <button
              onClick={onReset}
              className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[11px]"
              title={t.assertionsResetHint}
              data-testid="assertions-reset"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t.resetStats}
            </button>
          )}
          <button
            onClick={() => {
              setDraft({ filter: '', predicate: '', label: '' });
              setFormError(null);
            }}
            className="btn-accent !px-3 !py-1 flex items-center gap-1 text-[11px]"
            data-testid="assertions-add"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.addRule}
          </button>
        </div>
      </div>

      <p className="px-4 pt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {t.assertionsHint}
      </p>

      {(lastError || formError) && (
        <div
          role="alert"
          className="mx-4 mt-2 px-3 py-2 text-xs break-words flex items-start gap-1.5 rounded"
          style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}
          data-testid="assertions-error"
        >
          <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            {formError ?? lastError}
            {lastError && !formError && ` — ${t.assertionsPreviousKept}`}
          </span>
        </div>
      )}

      {draft && (
        <div
          className="mx-4 mt-3 p-3 rounded-md space-y-2.5"
          style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-panel)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-semibold" style={{ color: 'var(--accent)' }}>
              {t.addRule}
            </span>
            <button onClick={() => setDraft(null)} className="p-1 rounded" style={{ color: 'var(--text-muted)' }} title={t.cancel}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <label className="block text-[11px] space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <span>{t.assertionsFilter}</span>
              <input
                className="field-input w-full font-mono"
                value={draft.filter}
                onChange={(e) => setDraft({ ...draft, filter: e.target.value })}
                placeholder="devices/+/telemetry"
                aria-label={t.assertionsFilter}
              />
            </label>
            <label className="block text-[11px] space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <span>{t.ruleName}</span>
              <input
                className="field-input w-full"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder={t.assertionsLabelPlaceholder}
                aria-label={t.ruleName}
              />
            </label>
          </div>
          <label className="block text-[11px] space-y-1" style={{ color: 'var(--text-secondary)' }}>
            <span>{t.assertionsPredicate}</span>
            <input
              className="field-input w-full font-mono"
              spellCheck={false}
              value={draft.predicate}
              onChange={(e) => setDraft({ ...draft, predicate: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) void submit();
              }}
              placeholder="$.tempC < 80"
              aria-label={t.assertionsPredicate}
              data-testid="assertions-predicate"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            {!canSubmit && draft.predicate.trim().length > 0 && (
              <span className="text-[10px]" style={{ color: 'var(--warn)' }}>
                {t.assertionsNeedFields}
              </span>
            )}
            <button onClick={() => setDraft(null)} className="btn-ghost">{t.cancel}</button>
            <button
              onClick={() => void submit()}
              disabled={!canSubmit}
              title={canSubmit ? undefined : t.assertionsNeedFields}
              className="btn-accent"
              data-testid="assertions-save"
            >
              {t.addRule}
            </button>
          </div>
        </div>
      )}

      <div className="p-4 space-y-2">
        {rules.length === 0 && !draft && (
          <div className="text-xs italic" style={{ color: 'var(--text-muted)' }} data-testid="assertions-empty">
            {t.assertionsNoRules}
          </div>
        )}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2.5 text-[11px] px-3 py-2 rounded inset-box flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: r.enabled ? 'var(--ok)' : 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={() => onToggle(r.id)}
                aria-label={`${t.assertionsTitle} ${r.label || assertionRuleText(r)}`}
              />
              <span className="text-[10px]">{t.assertionsEnabled}</span>
            </label>
            {r.label && (
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{r.label}</span>
            )}
            <span className="font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-code)', color: 'var(--code-number)' }}>
              {r.filter}
            </span>
            <span
              className="font-mono"
              style={{ color: 'var(--text-secondary)' }}
              data-testid={`assertion-expr-${r.id}`}
            >
              {assertionRuleText(r)}
            </span>
            <div className="ml-auto flex gap-1">
              <button
                onClick={() => remove(r.id)}
                className="p-1.5 rounded"
                style={{ color: confirmId === r.id ? 'var(--bad)' : 'var(--danger)', background: confirmId === r.id ? 'var(--bad-soft)' : undefined }}
                title={confirmId === r.id ? t.deleteConfirmAgain : t.deleteRule}
                aria-label={`${t.deleteRule} ${r.label || assertionRuleText(r)}`}
                data-testid={`assertion-delete-${r.id}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1" data-testid="assertions-stats">
        {tally(t.assertionsMatched, stats.matched)}
        {tally(t.assertionsPassed, stats.passed, 'var(--ok)')}
        {tally(t.assertionsViolated, stats.violated, stats.violated > 0 ? 'var(--bad)' : undefined)}
        {tally(t.assertionsUnevaluable, stats.unevaluable, stats.unevaluable > 0 ? 'var(--warn)' : undefined)}
      </div>
      <p className="px-4 pb-3 text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {t.assertionsUnevaluableHint}
      </p>

      <div className="px-4 pb-4">
        <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          {t.assertionsRecent}
        </div>
        <div className="max-h-40 overflow-y-auto space-y-1">
          {recent.length === 0 ? (
            <div className="text-[11px] italic" style={{ color: 'var(--text-muted)' }} data-testid="assertions-no-violations">
              {t.assertionsNoViolations}
            </div>
          ) : (
            recent.map((v) => (
              <div
                key={`${v.msgId}-${v.ruleId}`}
                className="flex items-center gap-2 text-[10px] font-mono px-2 py-1 rounded"
                style={{ background: 'var(--bad-soft)' }}
                data-testid={`assertion-violation-${v.ruleId}`}
              >
                <span style={{ color: 'var(--bad)' }}>!</span>
                <span style={{ color: 'var(--text-primary)' }}>{v.topic}</span>
                <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{v.expr}</span>
                <span className="ml-auto shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {v.tsMs ? new Date(v.tsMs).toLocaleTimeString() : ''}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
