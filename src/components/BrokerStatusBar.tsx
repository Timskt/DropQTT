import React from 'react';
import { Activity, Power, Server, ChevronDown, Check } from 'lucide-react';
import { BrokerConfig, BrokerProfile } from '../types';
import { Translations } from '../i18n';

interface BrokerStatusBarProps {
  activeMode: 'transfer' | 'mqttx';
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
  return (
    <header
      className="h-11 border-b px-4 flex items-center justify-between text-xs font-mono select-none"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-panel)', color: 'var(--text-secondary)' }}
    >
      {/* Left: Mode Title + Target Broker */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">MODE:</span>
          <span className={activeMode === 'transfer' ? 'text-cyan-400 font-semibold' : 'text-emerald-400 font-semibold'}>
            {activeMode === 'transfer' ? t.modeFileTransfer : t.modeMqttClient}
          </span>
        </div>

        <div className="h-3 w-px bg-slate-800" />

        {/* Profile Selector */}
        <div className="relative group">
          <button className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 transition">
            <Server className="w-3 h-3 text-slate-400" />
            <span className="truncate max-w-[130px] font-medium">{config.host}:{config.port}</span>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </button>

          <div className="absolute left-0 top-full mt-1 w-56 bg-slate-900/95 border border-slate-700 rounded shadow-xl py-1 z-50 hidden group-hover:block backdrop-blur-md">
            <div className="px-2.5 py-1 text-[10px] uppercase text-slate-500 font-semibold border-b border-slate-800">
              {t.brokerProfiles}
            </div>
            {profiles.map((p) => {
              const isActive = p.config.host === config.host && p.config.port === config.port;
              return (
                <button
                  key={p.id}
                  onClick={() => onSelectProfile(p)}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-slate-800/70 text-xs flex items-center justify-between transition"
                >
                  <div>
                    <div className="text-slate-200 font-medium">{p.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{p.config.host}:{p.config.port}</div>
                  </div>
                  {isActive && <Check className="w-3.5 h-3.5 text-cyan-400" />}
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
          className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-900/60 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition"
        >
          <Activity className={`w-3 h-3 ${isTesting ? 'animate-spin text-cyan-400' : 'text-slate-500'}`} />
          <span>
            {isTesting ? '...' : latency !== null ? `${latency}ms` : 'PING'}
          </span>
        </button>

        {/* Client ID pill */}
        <div className="hidden md:flex items-center space-x-1 text-slate-500 text-[11px] px-2 py-0.5 bg-slate-900/40 rounded border border-slate-800/60">
          <span
            className={`text-[9px] px-1 rounded border ${
              config.protocolVersion === 5
                ? 'text-violet-300 border-violet-800 bg-violet-950/60'
                : 'text-slate-500 border-slate-700'
            }`}
            title={t.protocolVersion}
          >
            {config.protocolVersion === 5 ? 'v5' : 'v3'}
          </span>
          <span>ID:</span>
          <span className="text-slate-400 truncate max-w-[120px]">{config.clientId}</span>
        </div>

        {/* Connect / Disconnect Action Button */}
        <button
          onClick={onToggleConnect}
          disabled={isConnecting}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-semibold tracking-wide transition border ${
            connected
              ? 'bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border-rose-700/60'
              : 'bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-400 shadow-sm'
          }`}
        >
          <Power className={`w-3 h-3 ${isConnecting ? 'animate-spin' : ''}`} />
          <span>
            {isConnecting ? '...' : connected ? t.disconnect : t.connect}
          </span>
        </button>
      </div>
    </header>
  );
};
