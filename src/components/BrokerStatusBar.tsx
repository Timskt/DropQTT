import React from 'react';
import { Activity, Power, Server } from 'lucide-react';
import { BrokerConfig, BrokerProfile } from '../types';
import { Translations } from '../i18n';
import { WorkspaceMode } from './Sidebar';

interface BrokerStatusBarProps {
  activeMode: WorkspaceMode;
  connected: boolean;
  config: BrokerConfig;
  profiles: BrokerProfile[];
  onSelectProfile: (profile: BrokerProfile) => void;
  latency: number | null;
  isTesting: boolean;
  onTestLatency: () => void;
  onToggleConnect: () => void;
  isConnecting: boolean;
  t: Translations;
}

const modeAccent = (mode: WorkspaceMode) =>
  mode === 'transfer'
    ? 'var(--info)'
    : mode === 'bridge'
      ? 'var(--warn)'
      : mode === 'history'
        ? 'var(--sky)'
        : mode === 'ops'
          ? 'var(--violet)'
          : 'var(--ok)';

export const BrokerStatusBar: React.FC<BrokerStatusBarProps> = ({
  activeMode,
  connected,
  config,
  profiles,
  onSelectProfile,
  latency,
  isTesting,
  onTestLatency,
  onToggleConnect,
  isConnecting,
  t,
}) => {
  const accent = modeAccent(activeMode);
  return (
    <header
      className="min-h-11 shrink-0 border-b px-4 py-2 flex flex-wrap gap-2 items-center justify-between text-xs select-none"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-panel)', color: 'var(--text-secondary)' }}
    >
      {/* Left: Mode Title + Target Broker */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-1.5 inset-box px-2 py-0.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>MODE:</span>
          <span className="font-semibold" style={{ color: accent }}>
            {activeMode === 'transfer'
              ? t.modeFileTransfer
              : activeMode === 'bridge'
                ? t.modeBridge
                : activeMode === 'history'
                  ? t.modeHistory
                  : activeMode === 'ops'
                    ? t.modeOps
                    : t.modeMqttClient}
          </span>
        </div>

        <div className="h-3 w-px" style={{ background: 'var(--border-panel)' }} />

        {/* Profile Selector */}
        <div className="flex items-center gap-1.5 min-w-0">
            <Server className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
          <select
            aria-label={t.brokerProfiles}
            className="field-input max-w-[210px] !py-1 !px-2"
            disabled={isConnecting}
            value=""
            onChange={(e) => {
              const profile = profiles.find((p) => p.id === e.target.value);
              if (profile) onSelectProfile(profile);
            }}
          >
            <option value="" disabled>{config.host}:{config.port}</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.config.host}:{p.config.port}</option>)}
          </select>
        </div>
      </div>

      {/* Right: Latency, ClientID, Connection Action */}
      <div className="flex items-center space-x-3 ml-auto">
        {/* Latency badge with ping trigger */}
        <button
          onClick={onTestLatency}
          disabled={isTesting}
          title={t.testLatency}
          className="flex items-center space-x-1 inset-box px-2 py-0.5 transition hover:brightness-110"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Activity
            className={`w-3 h-3 ${isTesting ? 'animate-spin' : ''}`}
            style={{ color: isTesting ? 'var(--info)' : 'var(--text-muted)' }}
          />
          <span>{isTesting ? '...' : latency !== null ? `${latency}ms` : 'PING'}</span>
        </button>

        {/* Client ID pill */}
        <div className="hidden md:flex items-center space-x-1 text-[11px] inset-box px-2 py-0.5" style={{ color: 'var(--text-muted)' }}>
          <span className={`chip ${config.protocolVersion === 5 ? 'chip-violet' : 'chip-neutral'} !px-1 !py-0`}>
            {config.protocolVersion === 5 ? 'v5' : 'v3'}
          </span>
          <span>ID:</span>
          <span className="truncate max-w-[120px]" style={{ color: 'var(--text-secondary)' }}>{config.clientId}</span>
        </div>

        {/* Connect / Disconnect Action Button */}
        <button
          onClick={onToggleConnect}
          disabled={isConnecting}
          className="flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold tracking-wide transition border"
          style={
            connected
              ? { background: 'var(--bad-soft)', borderColor: 'var(--bad-border)', color: 'var(--bad)' }
              : { background: 'var(--accent-strong)', borderColor: 'var(--accent)', color: 'var(--accent-contrast)' }
          }
        >
          <Power className={`w-3 h-3 ${isConnecting ? 'animate-spin' : ''}`} />
          <span>{isConnecting ? '...' : connected ? t.disconnect : t.connect}</span>
        </button>
      </div>
    </header>
  );
};
