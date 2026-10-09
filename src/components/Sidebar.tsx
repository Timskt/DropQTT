import React, { useState, useEffect } from 'react';
import { Activity, Layers, Terminal, Settings, Globe, Palette, Server, GitBranch, Archive, ChevronLeft, ChevronRight } from 'lucide-react';
import { Language, Translations } from '../i18n';
import { Theme } from '../themes';
import { DropQTTLogo } from './DropQTTLogo';

/** Persist collapse state to localStorage */
function useCollapsedState(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return JSON.parse(saved) as boolean;
    } catch (e) {
      console.warn(`Failed to restore ${key}:`, e);
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`Failed to persist ${key}:`, e);
    }
  }, [key, value]);

  return [value, setValue];
}

export type WorkspaceMode = 'transfer' | 'mqttx' | 'bridge' | 'history' | 'ops';

interface SidebarProps {
  activeMode: WorkspaceMode;
  setActiveMode: (mode: WorkspaceMode) => void;
  activeTransfersCount: number;
  awaitingApprovalCount: number;
  activeSubsCount: number;
  activeBridgeRulesCount: number;
  historyCount: number;
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
  countLabel?: string;
  pulse?: boolean;
  collapsed?: boolean;
}> = ({ active, onClick, icon, title, subtitle, accentVar, chipClass, count, countLabel, pulse, collapsed }) => {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={title}
        aria-current={active ? 'page' : undefined}
        className="w-full flex items-center justify-center px-1 py-2.5 rounded-md text-xs transition border"
        style={
          active
            ? { borderColor: `color-mix(in srgb, ${accentVar} 45%, transparent)`, background: 'var(--hover)', color: accentVar }
            : { borderColor: 'transparent', color: 'var(--text-secondary)' }
        }
      >
        <span style={{ color: accentVar }}>{icon}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
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
        <span className={`chip ${chipClass} ${pulse ? 'animate-pulse' : ''}`}>{countLabel ?? count}</span>
      ) : null}
    </button>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeMode,
  setActiveMode,
  activeTransfersCount,
  awaitingApprovalCount,
  activeSubsCount,
  activeBridgeRulesCount,
  historyCount,
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
  const [collapsed, setCollapsed] = useCollapsedState('dropqtt_sidebar_collapsed', false);

  return (
    <aside
      className={`${collapsed ? 'w-14' : 'w-60'} flex-shrink-0 border-r flex flex-col justify-between select-none h-screen transition-[width] duration-200`}
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border-panel)', color: 'var(--text-secondary)' }}
    >
      {/* Top Header */}
      <div>
        <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-panel)' }}>
          {collapsed ? (
            <div className="w-full flex flex-col items-center gap-2">
              <DropQTTLogo className="w-7 h-7" />
              <div className="flex flex-col gap-1">
                <button
                  onClick={onOpenSettings}
                  title={t.settings}
                  aria-label={t.settings}
                  className="p-1.5 rounded transition"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCollapsed(!collapsed)}
                  title={t.expand}
                  aria-label={t.expand}
                  className="p-1.5 rounded transition"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center space-x-2.5">
              <DropQTTLogo className="w-7 h-7" />
              <div>
                <span className="font-mono font-bold tracking-wider text-sm" style={{ color: 'var(--text-primary)' }}>
                  DropQTT
                </span>
                <div className="flex items-center space-x-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--info)' }}></span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>v{__APP_VERSION__}-core</span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 ml-auto">
                <button
                  onClick={onOpenSettings}
                  title={t.settings}
                  aria-label={t.settings}
                  className="p-1.5 rounded transition"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCollapsed(!collapsed)}
                  title={t.collapse}
                  aria-label={t.collapse}
                  className="p-1.5 rounded transition"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Modes */}
        <nav className="p-3 space-y-1" aria-label={t.uiWorkspaceMode}>
          {!collapsed && <div className="px-2 py-1 ui-label font-mono">{t.uiWorkspaceMode}</div>}

          <NavItem
            active={activeMode === 'transfer'}
            onClick={() => setActiveMode('transfer')}
            icon={<Layers className="w-4 h-4" />}
            title={t.modeFileTransfer}
            subtitle={t.modeSubTransfer}
            accentVar="var(--info)"
            chipClass="chip-info"
            count={activeTransfersCount}
            pulse
            collapsed={collapsed}
          />

          <NavItem
            active={activeMode === 'mqttx'}
            onClick={() => setActiveMode('mqttx')}
            icon={<Terminal className="w-4 h-4" />}
            title={t.modeMqttClient}
            subtitle={t.modeSubConsole}
            accentVar="var(--ok)"
            chipClass="chip-ok"
            count={activeSubsCount}
            collapsed={collapsed}
          />

          {awaitingApprovalCount > 0 && !collapsed && (
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
            subtitle={t.modeSubBridge}
            accentVar="var(--warn)"
            chipClass="chip-warn"
            count={activeBridgeRulesCount}
            collapsed={collapsed}
          />

          <NavItem
            active={activeMode === 'history'}
            onClick={() => setActiveMode('history')}
            icon={<Archive className="w-4 h-4" />}
            title={t.modeHistory}
            subtitle={t.modeHistoryDesc}
            accentVar="var(--sky)"
            chipClass="chip-sky"
            count={historyCount}
            countLabel={historyCount >= 1000 ? `${(historyCount / 1000).toFixed(1)}k` : undefined}
            collapsed={collapsed}
          />

          <NavItem
            active={activeMode === 'ops'}
            onClick={() => setActiveMode('ops')}
            icon={<Activity className="w-4 h-4" />}
            title={t.modeOps}
            subtitle={t.modeOpsDesc}
            accentVar="var(--violet)"
            chipClass="chip-violet"
            collapsed={collapsed}
          />
        </nav>

        {/* Broker & Protocol Info */}
        {!collapsed && (
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
        )}
      </div>

      {/* Bottom Status & Quick Preferences */}
      <div className="p-3 space-y-2.5" style={{ borderTop: '1px solid var(--border-panel)', background: 'var(--bg-inset)' }}>
        {/* Connection Widget */}
        {collapsed ? (
          <div
            className="inset-box rounded-md border p-2 flex items-center justify-center"
            style={{ background: 'var(--bg-panel)' }}
            title={connected ? t.connected : t.disconnected}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: connected ? 'var(--ok)' : 'var(--bad)',
                boxShadow: connected ? '0 0 8px color-mix(in srgb, var(--ok) 60%, transparent)' : 'none',
              }}
            />
          </div>
        ) : (
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
        )}

        {/* Preferences row */}
        {!collapsed && (
          <div className="flex items-center space-x-2 text-xs">
            <div className="flex-1 flex items-center space-x-1 inset-box px-2 py-1">
              <Globe className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as Language)}
                aria-label={t.language}
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
                aria-label={t.theme}
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
        )}
      </div>
    </aside>
  );
};
