import React, { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { Translations, fill } from '../i18n';

interface CertFacts {
  subject: string;
  issuer: string;
  serial: string;
  signature_algorithm: string;
  not_before_secs: number;
  not_after_secs: number;
  days_left: number;
  verdict: string;
  is_ca: boolean;
  san_dns: string[];
  san_ip: string[];
  hostname_match: boolean;
  hostname_matched_by: string;
  cn_would_match_but_san_rules: boolean;
}

interface SlotReport {
  path: string;
  readable: boolean;
  certs: CertFacts[];
  problems: string[];
}

/**
 * Problem codes emitted by `tls_report.rs`. An unmapped code is rendered as the code rather
 * than dropped: a new Rust-side finding must show up as something readable in the settings
 * pane, not as silence that looks like "no problems".
 */
const PROBLEMS: Record<string, keyof Translations> = {
  unreadable: 'tlsProbUnreadable',
  noCert: 'tlsProbNoCert',
  caSlotHoldsLeaf: 'tlsProbCaSlotLeaf',
  leafSlotHasCa: 'tlsProbLeafSlotCa',
  certSlotHoldsKey: 'tlsProbCertSlotKey',
  hostnameMismatch: 'tlsProbHostnameMismatch',
  cnOnlyMatch: 'tlsProbCnOnlyMatch',
  keyNotPem: 'tlsProbKeyNotPem',
  keyUnreadable: 'tlsProbKeyUnreadable',
};

const fmtDate = (secs: number): string => new Date(secs * 1000).toISOString().slice(0, 10);

const verdictText = (c: CertFacts, t: Translations): { text: string; bad: boolean } => {
  switch (c.verdict) {
    case 'expired':
      return { text: fill(t.tlsVerdictExpired, { days: Math.abs(c.days_left) }), bad: true };
    case 'expiring_soon':
      return { text: fill(t.tlsVerdictExpiring, { days: c.days_left }), bad: true };
    case 'not_yet_valid':
      return { text: t.tlsVerdictNotYet, bad: true };
    default:
      return { text: t.tlsVerdictValid, bad: false };
  }
};

interface Props {
  /** The TLS switch in the settings form: with it off there is nothing to report on. */
  enabled: boolean;
  caPath?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
  /** The host the client is about to validate against; empty means "not checked". */
  hostname?: string;
  t: Translations;
}

export const TlsMaterialPanel: React.FC<Props> = ({ enabled, caPath, clientCertPath, clientKeyPath, hostname, t }) => {
  const [reports, setReports] = useState<SlotReport[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setUnavailable(false);
    try {
      const res = await invoke<SlotReport[] | null>('inspect_tls_material', {
        caPath: caPath ?? null,
        clientCertPath: clientCertPath ?? null,
        clientKeyPath: clientKeyPath ?? null,
        hostname: hostname ?? null,
      });
      // A backend that answers null (no Tauri, older build) is stated as unavailable rather
      // than rendered as an empty report that reads like "everything checked out".
      if (!res) {
        setReports(null);
        setUnavailable(true);
      } else {
        setReports(res);
      }
    } catch {
      setReports(null);
      setUnavailable(true);
    } finally {
      setBusy(false);
    }
  }, [caPath, clientCertPath, clientKeyPath, hostname]);

  if (!enabled) return null;
  const hasMaterial = !!(caPath || clientCertPath || clientKeyPath);

  const anythingWrong = (reports ?? []).some((r) => r.problems.length > 0);

  return (
    <div className="col-span-1" data-testid="tls-material">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        data-testid="tls-inspect"
        className="btn-ghost !px-2 !py-1 flex items-center gap-1.5 text-[11px]"
      >
        {anythingWrong ? (
          <ShieldAlert className="w-3.5 h-3.5" style={{ color: 'var(--bad)' }} />
        ) : (
          <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} />
        )}
        {t.tlsInspect}
      </button>

      {!hasMaterial && (
        <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }} data-testid="tls-no-material">
          {t.tlsNoMaterial}
        </div>
      )}

      {unavailable && (
        <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }} data-testid="tls-unavailable">
          {t.tlsInspectNoBackend}
        </div>
      )}

      {reports?.map((r) => (
        <div key={r.path} className="mt-1 inset-box px-2 py-1.5 text-[10px] font-mono" data-testid="tls-slot">
          <div className="truncate" title={r.path} style={{ color: 'var(--text-secondary)' }}>
            {r.path.split(/[\\/]/).pop()}
          </div>
          {r.problems.map((p) => {
            const key = PROBLEMS[p];
            return (
              <div key={p} style={{ color: 'var(--bad)' }} data-testid="tls-problem">
                {key ? t[key] : p}
              </div>
            );
          })}
          {r.certs.map((c) => {
            const v = verdictText(c, t);
            return (
              <div key={c.serial} className="mt-1" data-testid="tls-cert">
                <div style={{ color: v.bad ? 'var(--bad)' : 'var(--ok)' }}>
                  {c.is_ca ? t.tlsRoleCa : t.tlsRoleLeaf} · {v.text} · {t.tlsFieldExpires} {fmtDate(c.not_after_secs)}
                </div>
                <div className="truncate" title={c.subject} style={{ color: 'var(--text-muted)' }}>
                  {t.tlsFieldSubject}: {c.subject}
                </div>
                {(c.san_dns.length > 0 || c.san_ip.length > 0) && (
                  <div className="truncate" style={{ color: 'var(--text-muted)' }} title={[...c.san_dns, ...c.san_ip].join(', ')}>
                    {t.tlsFieldSan}: {[...c.san_dns, ...c.san_ip].join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};
