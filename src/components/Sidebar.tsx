import React from 'react';
import { Layers, Terminal, Settings, Globe, Palette, Server, GitBranch } from 'lucide-react';
import { Language, Translations } from '../i18n';
import { Theme } from '../themes';
import { DropQTTLogo } from './DropQTTLogo';

export type WorkspaceMode = 'transfer' | 'mqttx' | 'bridge';

interface SidebarProps {
  activeMode: WorkspaceMode;
  setActiveMode: (mode: WorkspaceMode) => void;
  activeTransfersCount: number;
  awaitingApprovalCount: number;
  activeSubsCount: number;
  activeBridgeRulesCount: number;
  connected: boolean;
  brokerHost: string;
  brokerPort: number;
  protocolVersion: number;
  latency: number | null;
  onOpenSettings: () => void;
  lang: Language;
  setLang: (lang: Language) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  t: Translations;
}

/** A workspace-mode navigation entry; `accent` picks the semantic status family. */
const NavItem: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accentVar: string;
  chipClass: string;
  count?: number;
  pulse?: boolean;
}> = ({ active, onClick, icon, title, subtitle, accentVar, chipClass, count, pulse }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs transition border"
    style={
      active
        ? { borderColor: `color-mix(in srgb, ${accentVar} 45%, transparent)`, background: 'var(--hover)', color: accentVar }
        : { borderColor: 'transparent', color: 'var(--text-secondary)' }
    }
  >
    <div className="flex items-center space-x-2.5 min-w-0">
      <span style={{ color: accentVar }}>{icon}</span>
      <div className="text-left min-w-0">
        <div className="font-medium truncate">{title}</div>
        <div className="text-[10px] truncate max-w-[130px]" style={{ color: 'var(--text-muted)' }}>
          {subtitle}
        </div>
      </div>
    </div>
    {count ? (
      <span className={`chip ${chipClass} ${pulse ? 'animate-pulse' : ''}`}>{count}</span>
    ) : null}
  </button>
);

export const Sidebar: React.FC<SidebarProps> = ({
  activeMode,
  setActiveMode,
  activeTransfersCount,
  awaitingApprovalCount,
  activeSubsCount,
  activeBridgeRulesCount,
  connected,
  brokerHost,
  brokerPort,
  protocolVersion,
  latency,
  onOpenSettings,
  lang,
  setLang,
  theme,
  setTheme,
  t,
}) => {
  return (
    <aside
      className="w-60 flex-shrink-0 border-r flex flex-col justify-between select-none h-screen"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-panel)', color: 'var(--text-secondary)' }}
    >
      {/* Top Header */}
      <div>
        <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-panel)' }}>
          <div className="flex items-center space-x-2.5">
            <DropQTTLogo className="w-7 h-7" />
            <div>
              <span className="font-mono font-bold tracking-wider text-sm" style={{ color: 'var(--text-primary)' }}>
                DropQTT
              </span>
              <div className="flex items-center space-x-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--info)' }}></span>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>v0.7.1-core</span>
              </div>
            </div>
          </div>
          <button
            onClick={onOpenSettings}
            title={t.settings}
            className="p-1.5 rounded transition"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Modes */}
        <div className="p-3 space-y-1">
          <div className="px-2 py-1 ui-label font-mono">Workspace Mode</div>

          <NavItem
            active={activeMode === 'transfer'}
            onClick={() => setActiveMode('transfer')}
            icon={<Layers className="w-4 h-4" />}
            title={t.modeFileTransfer}
            subtitle="Chunked Transfer"
            accentVar="var(--info)"
            chipClass="chip-info"
            count={activeTransfersCount}
            pulse
          />

          <NavItem
            active={activeMode === 'mqttx'}
            onClick={() => setActiveMode('mqttx')}
            icon={<Terminal className="w-4 h-4" />}
            title={t.modeMqttClient}
            subtitle="Pub/Sub Console"
            accentVar="var(--ok)"
            chipClass="chip-ok"
            count={activeSubsCount}
          />

          {awaitingApprovalCount > 0 && (
            <div className="px-1 py-1.5">
              <div className="chip chip-fuchsia justify-between !px-2.5 !py-1.5 w-full animate-pulse">
                <span>{t.awaitingApproval}</span>
                <span className="font-bold">{awaitingApprovalCount}</span>
              </div>
            </div>
          )}

          <NavItem
            active={activeMode === 'bridge'}
            onClick={() => setActiveMode('bridge')}
            icon={<GitBranch className="w-4 h-4" />}
            title={t.modeBridge}
            subtitle="Broker ↔ Broker"
            accentVar="var(--warn)"
            chipClass="chip-warn"
            count={activeBridgeRulesCount}
          />
        </div>

        {/* Broker & Protocol Info */}
        <div className="px-3 py-2">
          <div className="inset-box p-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono mb-1" style={{ color: 'var(--text-secondary)' }}>
              <span className="flex items-center space-x-1">
                <Server className="w-3 h-3" style={{ color: 'var(--info)' }} />
                <span>{t.brokerProfiles}</span>
              </span>
              <span className={`chip ${protocolVersion === 5 ? 'chip-violet' : 'chip-neutral'}`}>
                {protocolVersion === 5 ? 'MQTT 5.0' : 'MQTT 3.1.1'}
              </span>
            </div>
            <div
              className="font-mono text-xs truncate px-2 py-1 rounded border"
              style={{ color: 'var(--accent)', background: 'var(--bg-inset)', borderColor: 'var(--border-inset)' }}
            >
              {brokerHost}:{brokerPort}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Status & Quick Preferences */}
      <div className="p-3 space-y-2.5" style={{ borderTop: '1px solid var(--border-panel)', background: 'var(--bg-inset)' }}>
        {/* Connection Widget */}
        <div className="inset-box rounded-md border p-2 text-[11px] font-mono" style={{ background: 'var(--bg-panel)' }}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  background: connected ? 'var(--ok)' : 'var(--bad)',
                  boxShadow: connected ? '0 0 8px color-mix(in srgb, var(--ok) 60%, transparent)' : 'none',
                }}
              />
              <span className="font-semibold" style={{ color: connected ? 'var(--ok)' : 'var(--bad)' }}>
                {connected ? t.connected : t.disconnected}
              </span>
            </div>
            {connected && latency !== null && (
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{latency}ms</span>
            )}
          </div>
          <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
            {brokerHost}:{brokerPort}
          </div>
        </div>

        {/* Preferences row */}
        <div className="flex items-center space-x-2 text-xs">
          <div className="flex-1 flex items-center space-x-1 inset-box px-2 py-1">
            <Globe className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Language)}
              className="bg-transparent text-[11px] font-mono focus:outline-none w-full cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              {(['zh-CN', 'en', 'zh-TW', 'ja'] as Language[]).map((l) => (
                <option key={l} value={l} style={{ background: 'var(--bg-panel-solid)', color: 'var(--text-primary)' }}>
                  {l === 'zh-CN' ? '简中' : l === 'en' ? 'EN' : l === 'zh-TW' ? '繁中' : '日本語'}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 flex items-center space-x-1 inset-box px-2 py-1">
            <Palette className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className="bg-transparent text-[11px] font-mono focus:outline-none w-full cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              <option value="cyberpunk" style={{ background: 'var(--bg-panel-solid)', color: 'var(--text-primary)' }}>Cyber</option>
              <option value="obsidian" style={{ background: 'var(--bg-panel-solid)', color: 'var(--text-primary)' }}>OLED</option>
              <option value="nord" style={{ background: 'var(--bg-panel-solid)', color: 'var(--text-primary)' }}>Nord</option>
              <option value="solaris" style={{ background: 'var(--bg-panel-solid)', color: 'var(--text-primary)' }}>Solar</option>
            </select>
          </div>
        </div>
      </div>
    </aside>
  );
};
