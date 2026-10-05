import React, { useState } from 'react';
import { Download, ClipboardCopy, CircleAlert, Package } from 'lucide-react';
import {
  MergePlan,
  buildEnvironmentBundle,
  collectPersistedSections,
  mergePersistedSections,
  parseEnvironmentBundle,
  planTotal,
} from '../../utils/environment';
import { copyToClipboard } from '../../utils/clipboard';
import { saveTextFile } from '../../utils/exportMessages';
import { Translations, fill } from '../../i18n';
import { toast } from '../../utils/toast';

interface EnvironmentCardProps {
  t: Translations;
}

/**
 * The handoff card: export what a bench consists of, or paste one in. Import is
 * paste-based on purpose — this app does not read arbitrary paths, so a bundle
 * arrives as text and is validated before anything is added.
 */
export const EnvironmentCard: React.FC<EnvironmentCardProps> = ({ t }) => {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportBundle = async () => {
    const body = buildEnvironmentBundle(collectPersistedSections(), new Date().toISOString());
    const path = await saveTextFile(`dropqtt-environment-${Date.now()}.json`, body);
    if (path) toast.success(t.envExported);
  };

  const check = () => {
    const result = parseEnvironmentBundle(text, collectPersistedSections());
    if (result.ok === false) {
      setPlan(null);
      setError(result.error);
      return;
    }
    setError(null);
    setPlan(result.plan);
  };

  const merge = () => {
    if (!plan) return;
    mergePersistedSections(plan);
    setPlan(null);
    setText('');
    // The owning hooks read their key when they mount, so applying means reloading.
    window.setTimeout(() => window.location.reload(), 150);
  };

  return (
    <div className="panel p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
        <Package className="w-4 h-4" style={{ color: 'var(--accent)' }} />
        <span>{t.envTitle}</span>
      </div>
      <p className="text-[11px] leading-relaxed mb-2" style={{ color: 'var(--text-secondary)' }}>
        {t.envHint}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => void exportBundle()} className="btn-ghost !px-2.5 !py-1 flex items-center gap-1.5 text-[11px]" data-testid="env-export">
          <Download className="w-3.5 h-3.5" />
          {t.envExport}
        </button>
        <button
          onClick={() => {
            const body = buildEnvironmentBundle(collectPersistedSections(), new Date().toISOString());
            void copyToClipboard(body);
            toast.success(t.envCopied);
          }}
          className="btn-ghost !px-2.5 !py-1 flex items-center gap-1.5 text-[11px]"
          data-testid="env-copy"
        >
          <ClipboardCopy className="w-3.5 h-3.5" />
          {t.envCopy}
        </button>
      </div>

      <label className="block mt-3 text-[11px] space-y-1" style={{ color: 'var(--text-secondary)' }}>
        <span>{t.envImportPaste}</span>
        <textarea
          className="field-input w-full h-20 font-mono text-[11px]"
          spellCheck={false}
          value={text}
          placeholder={`{"kind":"dropqtt.environment","version":1,…}`}
          aria-label={t.envImportPaste}
          data-testid="env-paste"
          onChange={(e) => {
            setText(e.target.value);
            setPlan(null);
            setError(null);
          }}
        />
      </label>

      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={check}
          disabled={!text.trim()}
          title={text.trim() ? undefined : t.envPasteFirst}
          className="btn-ghost !px-2.5 !py-1 text-[11px]"
          data-testid="env-check"
        >
          {t.envCheck}
        </button>
        <button
          onClick={merge}
          disabled={!plan || planTotal(plan) === 0}
          title={!plan ? t.envPasteFirst : planTotal(plan) === 0 ? t.envNothingNew : undefined}
          className="btn-accent !px-2.5 !py-1 text-[11px]"
          data-testid="env-merge"
        >
          {t.envMerge}
        </button>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.envReloadNote}</span>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-2 px-2.5 py-1.5 text-[11px] rounded flex items-start gap-1.5"
          style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}
          data-testid="env-error"
        >
          <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {plan && (
        <div className="mt-2 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }} data-testid="env-summary">
          {fill(t.envSummary, {
            add: String(planTotal(plan)),
            skipped: String(Object.values(plan.skipped).reduce((a, b) => a + b, 0)),
            malformed: String(plan.malformed),
          })}
          {plan.webhookRedactions > 0 && (
            <div style={{ color: 'var(--warn)' }}>
              {fill(t.envRedactionNote, { n: String(plan.webhookRedactions) })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
