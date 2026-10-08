import React, { useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { HistoryRow } from '../../types';
import { Translations, fill } from '../../i18n';
import { auditDelivery, DeliveryAudit } from '../../utils/deliveryAudit';

const Reason: React.FC<{ a: DeliveryAudit; t: Translations }> = ({ a, t }) => {
  if (a.latency.measurable) {
    return (
      <span className="font-mono" style={{ color: 'var(--text-secondary)' }} data-testid="audit-latency">
        {fill(t.auditLatency, { p50: a.latency.p50Ms ?? 0, p95: a.latency.p95Ms ?? 0, max: a.latency.maxMs ?? 0 })}
      </span>
    );
  }
  return (
    <span className="font-mono" style={{ color: 'var(--text-muted)' }} data-testid="audit-nolatency">
      {fill(t.auditNoLatency, { reason: a.latency.reason === 'noTimePath' ? t.auditTimePath : t.auditNothing })}
    </span>
  );
};

const AuditRow: React.FC<{ a: DeliveryAudit; t: Translations }> = ({ a, t }) => {
  return (
    <div className="px-3 py-1.5 text-[10px]" style={{ borderTop: '1px solid var(--border-inset)' }} data-testid="audit-row">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono truncate" style={{ color: 'var(--text-primary)' }} title={a.topic}>
          {a.topic}
        </span>
        {a.firstSeq !== null && a.lastSeq !== null && (
          <span className="font-mono" style={{ color: 'var(--text-muted)' }}>
            {fill(t.auditSpan, { from: a.firstSeq, to: a.lastSeq, received: a.usable, expected: a.expectedCount ?? a.usable })}
          </span>
        )}
        {a.unusable > 0 && (
          <span className="font-mono" style={{ color: 'var(--warn)' }} data-testid="audit-unusable">
            {fill(t.auditUnusable, { unusable: a.unusable, inSpan: a.unusableInSpan })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-1">
        {a.missingCount > 0 && (
          <span className="chip chip-warn" data-testid="audit-missing">
            {fill(t.auditMissing, { count: a.missingCount })}
          </span>
        )}
        {a.duplicates.length > 0 && (
          <span className="chip chip-warn">{fill(t.auditDup, { count: a.duplicates.length })}</span>
        )}
        {a.outOfOrder > 0 && <span className="chip chip-warn">{fill(t.auditOutOfOrder, { count: a.outOfOrder })}</span>}
        {a.latency.clockSkew > 0 && <span className="chip chip-neutral">{fill(t.auditSkew, { count: a.latency.clockSkew })}</span>}
        <Reason a={a} t={t} />
      </div>
    </div>
  );
};

interface Props {
  rows: HistoryRow[];
  t: Translations;
}

export const DeliveryAuditCard: React.FC<Props> = ({ rows, t }) => {
  const [seqDraft, setSeqDraft] = useState('seq');
  const [timeDraft, setTimeDraft] = useState('');
  const [run, setRun] = useState<{ seqPath: string; timePath?: string } | null>(null);

  const audits = useMemo(
    () => (run ? auditDelivery(rows, { seqPath: run.seqPath, timePath: run.timePath }) : []),
    [rows, run],
  );

  // A topic whose rows carry no readable sequence number has nothing to say; rendering it
  // as an empty audit row would read as "checked and clean", which is the opposite of true.
  const auditable = useMemo(() => audits.filter((a) => a.usable > 0), [audits]);

  const start = (): void => {
    const seqPath = seqDraft.trim();
    if (!seqPath) return;
    setRun({ seqPath, timePath: timeDraft.trim() || undefined });
  };

  return (
    <div className="inset-box mt-2" data-testid="delivery-audit">
      <div className="flex items-center gap-2 px-3 py-2 flex-wrap" style={{ borderBottom: '1px solid var(--border-inset)' }}>
        <ClipboardCheck className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <span className="text-[11px] font-medium shrink-0">{t.auditTitle}</span>
        <input
          value={seqDraft}
          onChange={(e) => setSeqDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && start()}
          placeholder={t.auditSeqPath}
          aria-label={t.auditSeqPath}
          data-testid="audit-seq-path"
          className="w-32 min-w-0 bg-transparent text-[11px] font-mono outline-none"
          style={{ color: 'var(--text-primary)' }}
        />
        <input
          value={timeDraft}
          onChange={(e) => setTimeDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && start()}
          placeholder={t.auditTimePath}
          aria-label={t.auditTimePath}
          data-testid="audit-time-path"
          className="w-40 min-w-0 bg-transparent text-[11px] font-mono outline-none"
          style={{ color: 'var(--text-primary)' }}
        />
        <button onClick={start} className="btn-ghost !px-2 !py-0.5 text-[10px]" data-testid="audit-run">
          {t.auditRun}
        </button>
      </div>

      {!run && <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.auditEmpty}</div>}
      {run && auditable.length === 0 && (
        <div className="px-3 py-2 text-[10px]" style={{ color: 'var(--warn)' }} data-testid="audit-nothing">
          {t.auditNothing}
          {audits.length > 0 && (
            <span data-testid="audit-unusable">
              {' · '}
              {fill(t.auditUnusable, {
                unusable: audits.reduce((n, a) => n + a.unusable, 0),
                inSpan: audits.reduce((n, a) => n + a.unusableInSpan, 0),
              })}
            </span>
          )}
        </div>
      )}
      {run && auditable.length > 0 && (
        <>
          {auditable.map((a) => (
            <AuditRow key={a.topic} a={a} t={t} />
          ))}
          <div className="px-3 py-1.5 text-[10px]" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-inset)' }} data-testid="audit-caveat">
            {t.auditCaveat}
          </div>
        </>
      )}
    </div>
  );
};
