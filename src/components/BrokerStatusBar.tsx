import React from 'react';
import { Activity, Power, Server, ChevronDown, Check } from 'lucide-react';
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
      className="h-11 border-b px-4 flex items-center justify-between text-xs select-none"
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
        <div className="relative group">
          <button
            className="flex items-center space-x-1.5 inset-box px-2 py-0.5 transition hover:brightness-110"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Server className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
            <span className="truncate max-w-[130px] font-medium font-mono" style={{ color: 'var(--text-primary)' }}>
              {config.host}:{config.port}
            </span>
            <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
          </button>

          <div
            className="absolute left-0 top-full mt-1 w-56 rounded-md border shadow-xl py-1 z-50 hidden group-hover:block"
            style={{ background: 'var(--bg-panel-solid)', borderColor: 'var(--border-panel)' }}
          >
            <div className="px-2.5 py-1 ui-label font-semibold" style={{ borderBottom: '1px solid var(--border-inset)' }}>
              {t.brokerProfiles}
            </div>
            {profiles.map((p) => {
              const isActive = p.config.host === config.host && p.config.port === config.port;
              return (
                <button
                  key={p.id}
                  onClick={() => onSelectProfile(p)}
                  className="w-full text-left px-2.5 py-1.5 text-xs flex items-center justify-between transition hover:brightness-110"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                    <div className="text-[10px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                      {p.config.host}:{p.config.port}
                    </div>
                  </div>
                  {isActive && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--info)' }} />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: Latency, ClientID, Connection Action */}
      <div className="flex items-center space-x-3">
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
