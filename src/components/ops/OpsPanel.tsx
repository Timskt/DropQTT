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
import { BrokerCapabilities, DiagnosticLevel } from '../../types';
import { formatBytes, formatUptime } from '../../utils/format';
import { Translations } from '../../i18n';
import { useDiagnostics } from '../../hooks/useDiagnostics';
import { EnvironmentCard } from './EnvironmentCard';
import { MetricsCard } from './MetricsCard';
import { copyToClipboard } from '../../utils/clipboard';
import { saveTextFile } from '../../utils/exportMessages';
import { toast } from '../../utils/toast';
import { fmtClock as fmtZoneClock } from '../../utils/timePref';

interface OpsPanelProps {
  t: Translations;
  /** What the connected broker announced in its CONNACK. */
  caps?: BrokerCapabilities | null;
  onOpenSettings: () => void;
  onOpenConsole: () => void;
  onOpenHistory: () => void;
  onToggleConnect: () => void;
  isConnecting: boolean;
  onTestLatency: () => void;
  isTestingLatency: boolean;
}

/**
 * The broker's own account of its limits. Everything the publish and subscribe
 * forms refuse to send is derived from this, so it has to be readable somewhere
 * that is not a tooltip — "the broker said no" is the sentence that settles a
 * support conversation.
 */
const CapsCard: React.FC<{ caps: BrokerCapabilities | null | undefined; t: Translations }> = ({ caps, t }) => {
  const row = (label: string, value: string, ok = true) => (
    <div key={label} className="flex items-baseline justify-between gap-2 text-[11px]">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span
        className="font-mono"
        style={{ color: ok ? 'var(--text-primary)' : 'var(--danger)' }}
      >
        {value}
      </span>
    </div>
  );
  return (
    <div className="panel p-3">
      <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        {t.opsBrokerCapabilities}
      </div>
      {!caps ? (
        <div className="text-[11px] italic" style={{ color: 'var(--text-muted)' }}>
          {t.capAnnouncedAfterConnect}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1" data-testid="broker-caps">
          {row(t.qosLevel, String(caps.maxQos))}
          {row(t.retain, caps.retainAvailable ? t.capAvailable : t.capUnavailable, caps.retainAvailable)}
          {row(t.subShareToggle, caps.sharedAvailable ? t.capAvailable : t.capUnavailable, caps.sharedAvailable)}
          {row(t.capRowWildcard, caps.wildcardAvailable ? t.capAvailable : t.capUnavailable, caps.wildcardAvailable)}
          {row(t.capRowAlias, String(caps.topicAliasMax))}
          {row(t.capRowReceive, String(caps.receiveMax))}
          {caps.maxPacketSize ? row(t.capRowPacket, formatBytes(caps.maxPacketSize)) : null}
          {caps.serverKeepAlive ? row('keep-alive', `${caps.serverKeepAlive} s`) : null}
          {caps.sessionExpiry ? row('session-expiry', `${caps.sessionExpiry} s`) : null}
          {caps.assignedClientId ? row(t.capAssignedClientId, caps.assignedClientId) : null}
          {caps.responseInformation ? row(t.capResponseInfo, caps.responseInformation) : null}
          {caps.serverReference ? row(t.capServerRef, caps.serverReference) : null}
        </div>
      )}
    </div>
  );
};

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
    case 'fault_injection': return t.opsCheckFaults;
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
  caps,
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
          <Metric label={t.opsLastUpdated} value={snapshot ? fmtZoneClock(snapshot.runtime.generatedAt) : t.opsNever} />
          <Metric label={t.opsSubscriptions} value={snapshot?.mqtt.subscriptions ?? '—'} hint={`${snapshot?.mqtt.topicStatsCount ?? 0} ${t.opsTrackedTopics}`} />
          <Metric label={t.opsBridgeConnections} value={`${snapshot?.bridge.connectedConnections ?? 0}/${snapshot?.bridge.totalConnections ?? 0}`} hint={`${snapshot?.bridge.enabledRules ?? 0} ${t.opsEnabledRules}`} />
        </div>

        <div className="px-3 pb-3">
          <CapsCard caps={caps} t={t} />
        </div>
      </div>

      <EnvironmentCard t={t} />

      {!snapshot ? (
        <div className="panel p-10 text-center text-xs" style={{ color: 'var(--text-muted)' }}>{t.opsNoSnapshot}</div>
      ) : (
        <>
          <div className="ops-grid">
            <Section icon={<Terminal className="w-4 h-4" />} title={t.opsRuntime}>
              <div className="ops-metric-grid">
                <Metric label={t.opsVersion} value={`v${snapshot.runtime.appVersion}`} />
                <Metric
                  label={t.opsUptime}
                  value={formatUptime(snapshot.runtime.uptimeSecs ?? 0)}
                  hint={t.opsUptimeHint}
                />
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
                {/* Background publishers keep running after the console is closed,
                    so they have to be visible somewhere the user can audit. */}
                <Metric
                  label={t.opsScheduledRuns}
                  value={snapshot.mqtt.scheduledRuns}
                  color={snapshot.mqtt.scheduledRuns ? 'var(--ok)' : 'var(--text-primary)'}
                />
                <Metric
                  label={t.opsBenchRuns}
                  value={snapshot.mqtt.benchRuns}
                  color={snapshot.mqtt.benchRuns ? 'var(--warn)' : 'var(--text-primary)'}
                />
                <Metric
                  label={t.opsConfirmTimeouts}
                  value={snapshot.mqtt.confirmTimeouts}
                  color={snapshot.mqtt.confirmTimeouts ? 'var(--warn)' : 'var(--text-primary)'}
                />
                <Metric
                  label={t.opsRejectedSubs}
                  value={snapshot.mqtt.subscriptionsRejected ?? 0}
                  color={snapshot.mqtt.subscriptionsRejected ? 'var(--danger)' : 'var(--text-primary)'}
                />
                <Metric
                  label={t.opsRefusedUnsubs}
                  value={snapshot.mqtt.unsubscribesRejected ?? 0}
                  color={snapshot.mqtt.unsubscribesRejected ? 'var(--warn)' : 'var(--text-primary)'}
                />
                <Metric
                  label={t.opsPublishRejected}
                  value={snapshot.mqtt.publishRejected ?? 0}
                  color={snapshot.mqtt.publishRejected ? 'var(--danger)' : 'var(--text-primary)'}
                />
                <Metric
                  label={t.opsFeedFlushMs}
                  value={`${snapshot.mqtt.feedFlush?.avgMs ?? 0} / ${snapshot.mqtt.feedFlush?.maxMs ?? 0}`}
                  hint={`${snapshot.mqtt.feedFlush?.totalCalls ?? 0} ${t.opsCalls}`}
                  color={(snapshot.mqtt.feedFlush?.maxMs ?? 0) >= 500 ? 'var(--warn)' : 'var(--text-primary)'}
                />
                <Metric
                  label={t.opsFeedLagMs}
                  value={`${snapshot.mqtt.feedLag?.avgMs ?? 0} / ${snapshot.mqtt.feedLag?.maxMs ?? 0}`}
                  hint={t.opsLagHint}
                  color={(snapshot.mqtt.feedLag?.maxMs ?? 0) >= 500 ? 'var(--warn)' : 'var(--text-primary)'}
                />
                <Metric
                  label={t.opsHistoryWriteMs}
                  value={`${snapshot.mqtt.historyWrite?.avgMs ?? 0} / ${snapshot.mqtt.historyWrite?.maxMs ?? 0}`}
                  hint={`${snapshot.mqtt.historyWrite?.totalCalls ?? 0} ${t.opsCalls}`}
                />
                <Metric
                  label={t.opsReceivedTotal}
                  value={(snapshot.mqtt.receivedTotal ?? 0).toLocaleString()}
                  hint={t.opsLifetimeHint}
                  color="var(--sky)"
                />
                <Metric
                  label={t.opsSentTotal}
                  value={(snapshot.mqtt.sentTotal ?? 0).toLocaleString()}
                  hint={t.opsLifetimeHint}
                />
                <Metric
                  label={t.opsAcksUnattributed}
                  value={snapshot.mqtt.acksUnattributed ?? 0}
                  color={snapshot.mqtt.acksUnattributed ? 'var(--warn)' : 'var(--text-primary)'}
                />
                <Metric
                  label={t.opsRpcPending}
                  value={snapshot.mqtt.rpcPending ?? 0}
                  color={snapshot.mqtt.rpcPending ? 'var(--warn)' : 'var(--text-primary)'}
                />
                <Metric
                  label={t.opsRpcTimeouts}
                  value={snapshot.mqtt.rpcTimeouts ?? 0}
                  color={snapshot.mqtt.rpcTimeouts ? 'var(--warn)' : 'var(--text-primary)'}
                />
              </div>
            </Section>

            <Section icon={<Wifi className="w-4 h-4" />} title={t.opsTransferFeed}>
              <div className="ops-metric-grid">
                <Metric label={t.opsIncoming} value={snapshot.mqtt.incomingActive} color="var(--ok)" />
                <Metric label={t.opsOutgoing} value={snapshot.mqtt.outgoingActive} color="var(--info)" />
                <Metric label={t.opsBuffered} value={`${snapshot.mqtt.feedBuffered}/${snapshot.mqtt.feedBufferCapacity}`} />
                <Metric label={t.opsDropped} value={snapshot.mqtt.feedDropped} color={snapshot.mqtt.feedDropped ? 'var(--warn)' : 'var(--text-primary)'} />
                {/* Non-zero here means retention itself failed, not just display. */}
                <Metric label={t.opsFeedLost} value={snapshot.mqtt.feedLost} color={snapshot.mqtt.feedLost ? 'var(--bad)' : 'var(--text-primary)'} />
              </div>
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={onOpenConsole} className="btn-ghost !px-2.5 !py-1.5 text-[10px]"><Terminal className="inline w-3 h-3 mr-1" />{t.opsOpenConsole}</button>
              </div>
            </Section>

            <Section icon={<Archive className="w-4 h-4" />} title={t.opsStorageHistory} action={<button type="button" onClick={onOpenHistory} className="btn-ghost !px-2 !py-1 text-[10px]">{t.opsOpenHistory}</button>}>
              <div className="ops-metric-grid">
                <Metric label={t.opsHistoryRows} value={snapshot.mqtt.history.rows.toLocaleString()} color="var(--sky)" />
                <Metric label={t.opsHistoryStore} value={snapshot.mqtt.historyAvailable ? t.opsAvailable : t.opsUnavailable} color={snapshot.mqtt.historyAvailable ? 'var(--ok)' : 'var(--warn)'} />
                {/* The write path is deliberately best-effort; the only way to
                    know it lost something is for the count to be on screen. */}
                <Metric
                  label={t.opsHistoryLost}
                  value={(snapshot.mqtt.history.lostRows ?? 0).toLocaleString()}
                  color={snapshot.mqtt.history.lostRows ? 'var(--warn)' : 'var(--text-primary)'}
                />
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

          <MetricsCard t={t} />

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
