import React, { useState } from 'react';
import { RotateCcw, Plus, Trash2, CircleAlert, Zap } from 'lucide-react';
import { FaultCounts, FaultDirection, FaultRule, FaultRuleStats, faultActionTotal, faultRuleDefaults } from '../../types';
import { Translations, fill } from '../../i18n';

interface FaultPanelProps {
  rules: FaultRule[];
  stats: FaultRuleStats[];
  lastError: string | null;
  onAdd: (rule: FaultRule) => void;
  onUpdate: (rule: FaultRule) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onReset: () => void;
  t: Translations;
}

const newId = () => `fl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const MAX_DELAY_MS = 5000;

/**
 * Fault injection: the generator behind every "failures must be visible" claim this
 * project has made. Rates are strides (25% is every fourth message), so a loss test
 * reproduces instead of occasionally passing.
 */
export const FaultPanel: React.FC<FaultPanelProps> = ({
  rules, stats, lastError, onAdd, onUpdate, onRemove, onToggle, onReset, t,
}) => {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const countsFor = (id: string): FaultCounts | undefined => stats.find((s) => s.id === id)?.counts;
  const armedCount = rules.filter((r) => r.enabled).length;

  const add = () => {
    const filter = rules[rules.length - 1]?.filter ?? 'sensors/#';
    // Valid on arrival: a rule with every knob at zero would be rejected by the
    // backend, and a rejected sync leaves the *previous* set armed — so pressing
    // "Add rule" would silently disarm whatever was injecting.
    onAdd({ id: newId(), name: '', filter, ...faultRuleDefaults, dropPct: 25 });
    setFormError(null);
  };

  const patch = (rule: FaultRule, over: Partial<FaultRule>) => {
    const next = { ...rule, ...over };
    if (
      next.dropPct === 0 && next.delayMs === 0 && next.duplicatePct === 0
        && next.corruptPct === 0 && next.badCorrelationPct === 0
    ) {
      // Refuse locally too: the backend would reject the whole set on sync, and a
      // rejected sync leaves the *previous* set armed — a confusing second best.
      setFormError(t.faultsNeedsKnob);
      return;
    }
    setFormError(null);
    onUpdate(next);
  };

  const remove = (id: string) => {
    if (confirmId === id) {
      onRemove(id);
      setConfirmId(null);
    } else {
      setConfirmId(id);
    }
  };

  const numField = (
    label: string,
    value: number,
    max: number,
    testId: string,
    onCommit: (n: number) => void,
  ) => (
    <label key={label} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
      <span className="whitespace-nowrap">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onCommit(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
        className="field-input w-16 !px-1.5 !py-0.5 text-[11px] font-mono"
        aria-label={label}
        data-testid={testId}
      />
    </label>
  );

  return (
    <div className="panel">
      <div className="panel-header flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Zap className="w-4 h-4" style={{ color: armedCount > 0 ? 'var(--warn)' : 'var(--text-muted)' }} />
          <span>{t.faultsTitle}</span>
          {rules.length > 0 && (
            <span
              className={`chip ${armedCount > 0 ? 'chip-warn' : 'chip-neutral'}`}
              data-testid="faults-armed"
            >
              {armedCount}/{rules.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {stats.some((s) => faultActionTotal(s.counts) > 0) && (
            <button
              onClick={onReset}
              className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-[11px]"
              title={t.faultsResetHint}
              data-testid="faults-reset"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t.resetStats}
            </button>
          )}
          <button onClick={add} className="btn-accent !px-3 !py-1 flex items-center gap-1 text-[11px]" data-testid="faults-add">
            <Plus className="w-3.5 h-3.5" />
            {t.addRule}
          </button>
        </div>
      </div>

      <p className="px-4 pt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {t.faultsHint}
      </p>

      {(lastError || formError) && (
        <div
          role="alert"
          className="mx-4 mt-2 px-3 py-2 text-xs break-words flex items-start gap-1.5 rounded"
          style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}
          data-testid="faults-error"
        >
          <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            {formError ?? lastError}
            {lastError && !formError && ` — ${t.faultsPreviousKept}`}
          </span>
        </div>
      )}

      <div className="p-4 space-y-2">
        {rules.length === 0 && (
          <div className="text-xs italic" style={{ color: 'var(--text-muted)' }} data-testid="faults-empty">
            {t.faultsEmpty}
          </div>
        )}
        {rules.map((r) => {
          const counts = countsFor(r.id);
          return (
            <div key={r.id} className="inset-box px-3 py-2 space-y-1.5" data-testid={`fault-row-${r.id}`}>
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: r.enabled ? 'var(--warn)' : 'var(--text-muted)' }}>
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => onToggle(r.id)}
                    aria-label={`${t.faultsTitle} ${r.name || r.filter}`}
                  />
                  <span className="text-[10px]">{t.faultsEnabled}</span>
                </label>
                <input
                  className="field-input flex-1 min-w-[8rem] !px-1.5 !py-0.5 text-[11px]"
                  value={r.name}
                  placeholder={t.faultsNamePlaceholder}
                  aria-label={t.ruleName}
                  onChange={(e) => patch(r, { name: e.target.value })}
                />
                <input
                  className="field-input font-mono flex-1 min-w-[10rem] !px-1.5 !py-0.5 text-[11px]"
                  value={r.filter}
                  aria-label={t.faultsFilter}
                  data-testid={`fault-filter-${r.id}`}
                  onChange={(e) => patch(r, { filter: e.target.value })}
                />
                <select
                  className="field-input !px-1.5 !py-0.5 text-[11px]"
                  value={r.direction}
                  aria-label={t.faultsDirection}
                  data-testid={`fault-direction-${r.id}`}
                  onChange={(e) => patch(r, { direction: e.target.value as FaultDirection })}
                >
                  <option value="inbound">{t.faultsDirIn}</option>
                  <option value="outbound">{t.faultsDirOut}</option>
                  <option value="both">{t.faultsDirBoth}</option>
                </select>
                <button
                  onClick={() => remove(r.id)}
                  className="p-1.5 rounded"
                  style={{ color: 'var(--danger)', background: confirmId === r.id ? 'var(--bad-soft)' : undefined }}
                  title={confirmId === r.id ? t.deleteConfirmAgain : t.deleteRule}
                  aria-label={`${t.deleteRule} ${r.name || r.filter}`}
                  data-testid={`fault-delete-${r.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {numField(t.faultsDrop, r.dropPct, 100, `fault-drop-${r.id}`, (n) => patch(r, { dropPct: n }))}
                {numField(t.faultsDelay, r.delayMs, MAX_DELAY_MS, `fault-delay-${r.id}`, (n) => patch(r, { delayMs: n }))}
                {numField(t.faultsDuplicate, r.duplicatePct, 100, `fault-dup-${r.id}`, (n) => patch(r, { duplicatePct: n }))}
                {numField(t.faultsCorrupt, r.corruptPct, 100, `fault-corrupt-${r.id}`, (n) => patch(r, { corruptPct: n }))}
                {numField(t.faultsBadCorrelation, r.badCorrelationPct, 100, `fault-corr-${r.id}`, (n) => patch(r, { badCorrelationPct: n }))}
              </div>

              <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }} data-testid={`fault-counts-${r.id}`}>
                {counts
                  ? fill(t.faultsCounts, {
                    seen: String(counts.seen),
                    dropped: String(counts.dropped),
                    delayed: String(counts.delayed),
                    duplicated: String(counts.duplicated),
                    corrupted: String(counts.corrupted),
                    misCorrelated: String(counts.misCorrelated),
                  })
                  : t.faultsNoStats}
              </div>
            </div>
          );
        })}
      </div>

      {rules.some((r) => r.enabled) && (
        <p className="px-4 pb-3 text-[10px]" style={{ color: 'var(--warn)' }} data-testid="faults-warning">
          {t.faultsArmedWarning}
        </p>
      )}
    </div>
  );
};
