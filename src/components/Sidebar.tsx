import React from 'react';
import { Layers, Terminal, Settings, Globe, Palette, Radio } from 'lucide-react';
import { Language, Translations } from '../i18n';
import { Theme } from '../themes';
import { DropQTTLogo } from './DropQTTLogo';

interface SidebarProps {
  activeMode: 'transfer' | 'mqttx';
  setActiveMode: (mode: 'transfer' | 'mqttx') => void;
  activeTransfersCount: number;
  activeSubsCount: number;
  connected: boolean;
  brokerHost: string;
  brokerPort: number;
  latency: number | null;
  channel: string;
  onOpenSettings: () => void;
  lang: Language;
  setLang: (lang: Language) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  t: Translations;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeMode,
  setActiveMode,
  activeTransfersCount,
  activeSubsCount,
  connected,
  brokerHost,
  brokerPort,
  latency,
  channel,
  onOpenSettings,
  lang,
  setLang,
  theme,
  setTheme,
  t,
}) => {
  return (
    <aside className="w-60 flex-shrink-0 bg-slate-950/80 border-r border-slate-800/80 flex flex-col justify-between select-none h-screen text-slate-300">
      {/* Top Header */}
      <div>
        <div className="p-4 border-b border-slate-800/70 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <DropQTTLogo className="w-7 h-7" />
            <div>
              <span className="font-mono font-bold tracking-wider text-sm text-white">DropQTT</span>
              <div className="flex items-center space-x-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                <span className="text-[10px] text-slate-400 font-mono">v0.2.0-core</span>
              </div>
            </div>
          </div>
          <button
            onClick={onOpenSettings}
            title={t.settings}
            className="p-1.5 rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-900 border border-transparent hover:border-slate-700 transition"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Modes */}
        <div className="p-3 space-y-1">
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500">
            Workspace Mode
          </div>

          <button
            onClick={() => setActiveMode('transfer')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded text-xs font-mono transition border ${
              activeMode === 'transfer'
                ? 'bg-cyan-950/40 text-cyan-300 border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border-transparent'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Layers className="w-4 h-4 text-cyan-400" />
              <div className="text-left">
                <div className="font-medium">{t.modeFileTransfer}</div>
                <div className="text-[10px] text-slate-500 truncate max-w-[120px]">Chunked Transfer</div>
              </div>
            </div>
            {activeTransfersCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 animate-pulse">
                {activeTransfersCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveMode('mqttx')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded text-xs font-mono transition border ${
              activeMode === 'mqttx'
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border-transparent'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <div className="text-left">
                <div className="font-medium">{t.modeMqttClient}</div>
                <div className="text-[10px] text-slate-500 truncate max-w-[120px]">Pub/Sub Console</div>
              </div>
            </div>
            {activeSubsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {activeSubsCount}
              </span>
            )}
          </button>
        </div>

        {/* Current Channel Info */}
        <div className="px-3 py-2">
          <div className="bg-slate-900/70 rounded p-2.5 border border-slate-800/80">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
              <span className="flex items-center space-x-1">
                <Radio className="w-3 h-3 text-cyan-400" />
                <span>{t.channel}</span>
              </span>
              <span className="text-[10px] text-slate-500">Lobby</span>
            </div>
            <div className="font-mono text-xs text-cyan-300 truncate bg-slate-950/90 px-2 py-1 rounded border border-slate-800">
              #{channel}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Status & Quick Preferences */}
      <div className="p-3 border-t border-slate-800/80 space-y-2.5 bg-slate-950/40">
        {/* Connection Widget */}
        <div className="bg-slate-900/60 rounded p-2 border border-slate-800 text-[11px] font-mono">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse' : 'bg-rose-500'
                }`}
              />
              <span className={connected ? 'text-emerald-400 font-semibold' : 'text-rose-400'}>
                {connected ? t.connected : t.disconnected}
              </span>
            </div>
            {connected && latency !== null && (
              <span className="text-[10px] text-slate-400 font-mono">{latency}ms</span>
            )}
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            {brokerHost}:{brokerPort}
          </div>
        </div>

        {/* Preferences row */}
        <div className="flex items-center space-x-2 text-xs">
          <div className="flex-1 flex items-center space-x-1 bg-slate-900/60 rounded px-2 py-1 border border-slate-800">
            <Globe className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Language)}
              className="bg-transparent text-[11px] font-mono text-slate-300 focus:outline-none w-full cursor-pointer"
            >
              <option value="zh-CN" className="bg-slate-900 text-slate-200">简中</option>
              <option value="en" className="bg-slate-900 text-slate-200">EN</option>
              <option value="zh-TW" className="bg-slate-900 text-slate-200">繁中</option>
              <option value="ja" className="bg-slate-900 text-slate-200">日本語</option>
            </select>
          </div>

          <div className="flex-1 flex items-center space-x-1 bg-slate-900/60 rounded px-2 py-1 border border-slate-800">
            <Palette className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className="bg-transparent text-[11px] font-mono text-slate-300 focus:outline-none w-full cursor-pointer"
            >
              <option value="cyberpunk" className="bg-slate-900 text-slate-200">Cyber</option>
              <option value="obsidian" className="bg-slate-900 text-slate-200">OLED</option>
              <option value="nord" className="bg-slate-900 text-slate-200">Nord</option>
              <option value="solaris" className="bg-slate-900 text-slate-200">Solar</option>
            </select>
          </div>
        </div>
      </div>
    </aside>
  );
};
