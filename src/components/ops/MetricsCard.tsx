import React, { useState } from 'react';
import { Copy, Radio, RotateCcw } from 'lucide-react';
import { Translations } from '../../i18n';
import { useMetrics } from '../../hooks/useMetrics';
import { buildMetricLegend, buildScrapeConfig, metricsUrl } from '../../utils/metrics';
import { copyToClipboard } from '../../utils/clipboard';
import { toast } from '../../utils/toast';

/**
 * The Prometheus endpoint switch.
 *
 * Two things this has to get right in its own behaviour, not just its wording:
 * - A typed port does not rebind on its own. `Apply` is what moves a live listener, so
 *   a scrape in flight cannot have its target changed under it.
 * - The failure text comes from Rust. "port already in use" is the backend's sentence,
 *   and inventing a friendlier one here would hide which process holds it.
 */
export const MetricsCard: React.FC<{ t: Translations }> = ({ t }) => {
  const { status, busy, error, setEndpoint } = useMetrics(true);
  /**
   * What the user typed, or `null` while the box should follow the backend's port.
   *
   * An override rather than a copied state: after a reconfigure lands, clearing it lets
   * the input show the port the endpoint actually holds without an effect re-syncing it.
   */
  const [draftOverride, setDraftOverride] = useState<number | null>(null);

  const livePort = status?.port ?? 0;
  const enabled = status?.enabled ?? false;
  const minPort = status?.minPort ?? 1024;
  const shownPort = draftOverride ?? (status ? status.port : '');
  const draftChanged = draftOverride !== null && draftOverride !== livePort;

  const toggle = async () => {
    try {
      const target = enabled ? livePort : (draftOverride ?? livePort);
      await setEndpoint(!enabled, target);
      setDraftOverride(null);
    } catch {
      /* the error string is already on screen */
    }
  };

  const apply = async () => {
    if (draftOverride === null) return;
    try {
      await setEndpoint(true, draftOverride);
      setDraftOverride(null);
    } catch {
      /* shown below */
    }
  };

  const copy = async (text: string) => {
    if (await copyToClipboard(text)) toast.success(t.opsCopied);
    else toast.error(t.opsCopyFailed);
  };

  return (
    <div className="panel p-3" data-testid="metrics-card">
      <div className="flex items-center gap-2 mb-2">
        <Radio className="w-4 h-4" style={{ color: 'var(--info)' }} />
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t.metricsTitle}
        </span>
        <span
          className={`chip ml-auto ${enabled ? 'chip-ok' : 'chip-neutral'}`}
          data-testid="metrics-state"
        >
          {enabled ? t.metricsListening : t.metricsStopped}
        </span>
      </div>

      <div className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
        {t.metricsExplain}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] flex items-center gap-1.5" htmlFor="metrics-port">
          <span style={{ color: 'var(--text-secondary)' }}>{t.metricsPortLabel}</span>
          <input
            id="metrics-port"
            type="number"
            inputMode="numeric"
            min={minPort}
            max={65535}
            value={shownPort}
            onChange={(e) => {
              const raw = e.target.value;
              // An empty box means "stop overriding", so the field falls back to the
              // port the endpoint actually holds rather than to 0.
              setDraftOverride(raw === '' ? null : Number(raw));
            }}
            className="input-base !w-24 !py-1 text-[11px] font-mono"
            data-testid="metrics-port"
          />
        </label>

        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy || (enabled && draftChanged)}
          className={`btn-${enabled ? 'ghost' : 'accent'} !px-2.5 !py-1.5 text-[11px] disabled:opacity-40`}
          data-testid="metrics-toggle"
          title={enabled && draftChanged ? t.metricsApplyFirst : undefined}
        >
          {enabled ? t.metricsDisable : t.metricsEnable}
        </button>

        {enabled && draftChanged ? (
          <button
            type="button"
            onClick={() => void apply()}
            disabled={busy}
            className="btn-ghost !px-2.5 !py-1.5 flex items-center gap-1.5 text-[11px] disabled:opacity-40"
            data-testid="metrics-apply"
          >
            <RotateCcw className="w-3 h-3" />
            {t.metricsApply}
          </button>
        ) : null}
      </div>

      {enabled ? (
        <div className="mt-3 text-[11px] font-mono break-all" style={{ color: 'var(--text-secondary)' }} data-testid="metrics-url">
          {metricsUrl(livePort)}
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 text-[11px] font-mono" style={{ color: 'var(--bad)' }} data-testid="metrics-error">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          onClick={() => void copy(buildScrapeConfig(draftOverride ?? livePort))}
          className="btn-ghost !px-2.5 !py-1.5 flex items-center gap-1.5 text-[10px]"
          data-testid="metrics-copy-config"
        >
          <Copy className="w-3 h-3" />
          {t.metricsCopyConfig}
        </button>
        <button
          type="button"
          onClick={() => void copy(buildMetricLegend())}
          className="btn-ghost !px-2.5 !py-1.5 flex items-center gap-1.5 text-[10px]"
          data-testid="metrics-copy-legend"
        >
          <Copy className="w-3 h-3" />
          {t.metricsCopyLegend}
        </button>
      </div>

      <ul className="mt-3 text-[10px] space-y-0.5" style={{ color: 'var(--text-muted)' }}>
        <li>{t.metricsLoopbackNote}</li>
        <li>{t.metricsPrivacyNote}</li>
        <li>{t.metricsOffOnRestartNote}</li>
      </ul>
    </div>
  );
};
