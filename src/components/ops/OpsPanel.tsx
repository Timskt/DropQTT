import React from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  GitBranch,
  Gauge,
  Radio,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Terminal,
  Wifi,
} from 'lucide-react';
import { DiagnosticLevel } from '../../types';
import { Translations } from '../../i18n';
import { useDiagnostics } from '../../hooks/useDiagnostics';
import { copyToClipboard } from '../../utils/clipboard';
import { saveTextFile } from '../../utils/exportMessages';
import { toast } from '../../utils/toast';

interface OpsPanelProps {
  t: Translations;
  onOpenSettings: () => void;
  onOpenConsole: () => void;
  onOpenHistory: () => void;
  onToggleConnect: () => void;
  isConnecting: boolean;
  onTestLatency: () => void;
  isTestingLatency: boolean;
}

const levelChip = (level: DiagnosticLevel) =>
  level === 'ok' ? 'chip-ok' : level === 'warn' ? 'chip-warn' : 'chip-bad';

const checkTitle = (id: string, t: Translations): string => {
  switch (id) {
    case 'download_dir': return t.opsCheckDownloadDir;
    case 'history_store': return t.opsCheckHistory;
    case 'broker_connection': return t.opsCheckBroker;
    case 'transport_security': return t.opsCheckTransport;
    case 'subscriptions': return t.opsCheckSubscriptions;
    case 'feed_pressure': return t.opsCheckFeed;
    case 'transfer_activity': return t.opsCheckTransfers;
    case 'bridge_health': return t.opsCheckBridge;
    default: return id;
  }
};

const Metric: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  color?: string;
}> = ({ label, value, hint, color = 'var(--text-primary)' }) => (
  <div className="ops-metric">
    <div className="ui-label truncate">{label}</div>
    <div className="text-sm font-mono font-semibold truncate" style={{ color }} title={String(value)}>
      {value}
    </div>
    {hint && <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{hint}</div>}
  </div>
);

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}> = ({ icon, title, children, action }) => (
  <section className="panel overflow-hidden">
    <div className="panel-header">
      <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
        <span style={{ color: 'var(--accent)' }}>{icon}</span>
        {title}
      </div>
      {action}
    </div>
    <div className="p-3">{children}</div>
  </section>
);

export const OpsPanel: React.FC<OpsPanelProps> = ({
  t,
  onOpenSettings,
  onOpenConsole,
  onOpenHistory,
  onToggleConnect,
  isConnecting,
  onTestLatency,
  isTestingLatency,
}) => {
  const { snapshot, loading, error, refresh } = useDiagnostics(true);
  const warningCount = snapshot?.checks.filter((c) => c.level === 'warn').length ?? 0;
  const errorCount = snapshot?.checks.filter((c) => c.level === 'error').length ?? 0;
  const healthLabel = errorCount > 0 ? t.opsIssues : warningCount > 0 ? t.opsAttention : t.opsHealthy;
  const healthColor = errorCount > 0 ? 'var(--bad)' : warningCount > 0 ? 'var(--warn)' : 'var(--ok)';

  const report = snapshot ? JSON.stringify(snapshot, null, 2) : '';

  const copyReport = async () => {
    if (!report) return;
    if (await copyToClipboard(report)) toast.success(t.opsCopied);
    else toast.error(t.opsCopyFailed);
  };

  const exportReport = async () => {
    if (!report) return;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const saved = await saveTextFile(`dropqtt-diagnostics-${stamp}.json`, report);
      if (saved) toast.success(t.opsExported);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="panel overflow-hidden">
        <div className="panel-header flex-wrap gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              <Activity className="w-4 h-4" style={{ color: 'var(--violet)' }} />
              {t.opsTitle}
              {snapshot && (
                <span className={`chip ${errorCount ? 'chip-bad' : warningCount ? 'chip-warn' : 'chip-ok'}`}>
                  {healthLabel}
                </span>
              )}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t.opsSubtitle}</div>
          </div>

          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="btn-ghost !px-2.5 !py-1.5 flex items-center gap-1.5 text-[11px] disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {t.opsRefresh}
            </button>
            <button type="button" onClick={copyReport} disabled={!snapshot} className="btn-ghost !px-2.5 !py-1.5 flex items-center gap-1.5 text-[11px] disabled:opacity-40">
              <Copy className="w-3.5 h-3.5" />
              {t.opsCopyReport}
            </button>
            <button type="button" onClick={exportReport} disabled={!snapshot} className="btn-accent !px-2.5 !py-1.5 flex items-center gap-1.5 text-[11px] disabled:opacity-40">
              <Download className="w-3.5 h-3.5" />
              {t.opsExportReport}
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 text-[11px] font-mono" style={{ color: 'var(--bad)', background: 'var(--bad-soft)', borderBottom: '1px solid var(--bad-border)' }}>
            {error}
          </div>
        )}

        <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          <Metric label={t.opsHealthScore} value={`${errorCount} / ${warningCount}`} hint={t.opsErrorsWarnings} color={healthColor} />
          <Metric label={t.opsLastUpdated} value={snapshot ? new Date(snapshot.runtime.generatedAt).toLocaleTimeString() : t.opsNever} />
          <Metric label={t.opsSubscriptions} value={snapshot?.mqtt.subscriptions ?? '—'} hint={`${snapshot?.mqtt.topicStatsCount ?? 0} ${t.opsTrackedTopics}`} />
          <Metric label={t.opsBridgeConnections} value={`${snapshot?.bridge.connectedConnections ?? 0}/${snapshot?.bridge.totalConnections ?? 0}`} hint={`${snapshot?.bridge.enabledRules ?? 0} ${t.opsEnabledRules}`} />
        </div>
      </div>

      {!snapshot ? (
        <div className="panel p-10 text-center text-xs" style={{ color: 'var(--text-muted)' }}>{t.opsNoSnapshot}</div>
      ) : (
        <>
          <div className="ops-grid">
            <Section icon={<Terminal className="w-4 h-4" />} title={t.opsRuntime}>
              <div className="ops-metric-grid">
                <Metric label={t.opsVersion} value={`v${snapshot.runtime.appVersion}`} />
                <Metric label={t.opsPlatform} value={`${snapshot.runtime.os} / ${snapshot.runtime.arch}`} />
                <Metric label={t.opsProtocol} value={snapshot.mqtt.protocolVersion === 5 ? 'MQTT 5.0' : 'MQTT 3.1.1'} />
                <Metric label={t.opsTransport} value={snapshot.mqtt.useWebsocket ? (snapshot.mqtt.useTls ? 'WSS' : 'WebSocket') : (snapshot.mqtt.useTls ? 'TLS' : 'TCP')} color={snapshot.mqtt.useTls ? 'var(--ok)' : 'var(--warn)'} />
              </div>
            </Section>

            <Section
              icon={<Server className="w-4 h-4" />}
              title={t.opsBroker}
              action={<button type="button" onClick={onOpenSettings} className="btn-ghost !px-2 !py-1 text-[10px]"><Settings className="inline w-3 h-3 mr-1" />{t.opsOpenSettings}</button>}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className={`chip ${snapshot.mqtt.connected ? 'chip-ok' : 'chip-warn'}`}>
                  <Radio className="w-3 h-3" />{snapshot.mqtt.connected ? t.connected : t.disconnected}
                </span>
                <div className="flex gap-1.5">
                  <button type="button" onClick={onTestLatency} disabled={isTestingLatency} className="btn-ghost !px-2 !py-1 text-[10px] disabled:opacity-50">
                    {isTestingLatency ? t.testingConnection : t.testLatency}
                  </button>
                  <button type="button" onClick={onToggleConnect} disabled={isConnecting} className="btn-accent !px-2 !py-1 text-[10px] disabled:opacity-50">
                    {snapshot.mqtt.connected ? t.disconnect : t.connect}
                  </button>
                </div>
              </div>
              <div className="ops-metric-grid">
                <Metric label={t.brokerHost} value={`${snapshot.mqtt.host || '—'}:${snapshot.mqtt.port}`} />
                <Metric label={t.clientId} value={snapshot.mqtt.clientId || '—'} />
                <Metric label={t.opsSubscriptions} value={snapshot.mqtt.subscriptions} />
                <Metric label={t.opsTrackedTopics} value={snapshot.mqtt.topicStatsCount} />
              </div>
            </Section>

            <Section icon={<Wifi className="w-4 h-4" />} title={t.opsTransferFeed}>
              <div className="ops-metric-grid">
                <Metric label={t.opsIncoming} value={snapshot.mqtt.incomingActive} color="var(--ok)" />
                <Metric label={t.opsOutgoing} value={snapshot.mqtt.outgoingActive} color="var(--info)" />
                <Metric label={t.opsBuffered} value={`${snapshot.mqtt.feedBuffered}/${snapshot.mqtt.feedBufferCapacity}`} />
                <Metric label={t.opsDropped} value={snapshot.mqtt.feedDropped} color={snapshot.mqtt.feedDropped ? 'var(--warn)' : 'var(--text-primary)'} />
              </div>
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={onOpenConsole} className="btn-ghost !px-2.5 !py-1.5 text-[10px]"><Terminal className="inline w-3 h-3 mr-1" />{t.opsOpenConsole}</button>
              </div>
            </Section>

            <Section icon={<Archive className="w-4 h-4" />} title={t.opsStorageHistory} action={<button type="button" onClick={onOpenHistory} className="btn-ghost !px-2 !py-1 text-[10px]">{t.opsOpenHistory}</button>}>
              <div className="ops-metric-grid">
                <Metric label={t.opsHistoryRows} value={snapshot.mqtt.history.rows.toLocaleString()} color="var(--sky)" />
                <Metric label={t.opsHistoryStore} value={snapshot.mqtt.historyAvailable ? t.opsAvailable : t.opsUnavailable} color={snapshot.mqtt.historyAvailable ? 'var(--ok)' : 'var(--warn)'} />
                <Metric label={t.opsDownloadDir} value={snapshot.mqtt.downloadDirWritable ? t.opsWritable : t.opsReadOnly} color={snapshot.mqtt.downloadDirWritable ? 'var(--ok)' : 'var(--bad)'} hint={snapshot.mqtt.downloadDir} />
                <Metric label={t.inbound} value={snapshot.mqtt.history.inbound.toLocaleString()} />
                <Metric label={t.outbound} value={snapshot.mqtt.history.outbound.toLocaleString()} />
              </div>
            </Section>

            <Section icon={<GitBranch className="w-4 h-4" />} title={t.opsBridge}>
              <div className="ops-metric-grid">
                <Metric label={t.opsBridgeConnections} value={`${snapshot.bridge.connectedConnections}/${snapshot.bridge.totalConnections}`} color={snapshot.bridge.connectedConnections ? 'var(--ok)' : 'var(--text-primary)'} />
                <Metric label={t.opsBridgeRules} value={`${snapshot.bridge.enabledRules}/${snapshot.bridge.configuredRules}`} />
                <Metric label={t.forwarded} value={snapshot.bridge.forwarded.toLocaleString()} color="var(--ok)" />
                <Metric label={t.failed} value={snapshot.bridge.errors.toLocaleString()} color={snapshot.bridge.errors ? 'var(--bad)' : 'var(--text-primary)'} />
                <Metric label={t.dropped} value={snapshot.bridge.dropped.toLocaleString()} color={snapshot.bridge.dropped ? 'var(--warn)' : 'var(--text-primary)'} />
              </div>
            </Section>
          </div>

          <Section
            icon={<ShieldCheck className="w-4 h-4" />}
            title={t.opsHealthChecks}
            action={<span className="text-[10px] font-mono" style={{ color: healthColor }}>{healthLabel}</span>}
          >
            <div className="divide-y" style={{ borderColor: 'var(--border-inset)' }}>
              {snapshot.checks.map((check) => (
                <div key={check.id} className="py-2.5 flex items-start gap-3">
                  <span className={`chip ${levelChip(check.level)} mt-0.5`}>
                    {check.level === 'ok' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    {check.level === 'ok' ? t.opsHealthy : check.level === 'warn' ? t.opsAttention : t.opsIssues}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{checkTitle(check.id, t)}</div>
                    <div className="text-[11px] font-mono break-words" style={{ color: 'var(--text-secondary)' }}>{check.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <div className="panel p-3 flex items-start gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <Gauge className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--info)' }} />
            <div>
              <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{t.opsTroubleshootingHint}</div>
              <div className="mt-1">{t.opsReportHint}</div>
            </div>
            <Clock className="w-3.5 h-3.5 ml-auto shrink-0" />
          </div>
        </>
      )}
    </div>
  );
};
