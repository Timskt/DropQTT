import React, { useState } from 'react';
import { DropQTTLogo } from './DropQTTLogo';
import { ConnectionStatus } from '../types';
import { Language, Translations } from '../i18n';
import { Theme } from '../themes';
import { Settings, Wifi, WifiOff, Hash, Copy, Check, Globe, Palette, RefreshCw } from 'lucide-react';

interface NavbarProps {
  status: ConnectionStatus;
  onOpenSettings: () => void;
  onChannelChange: (newChannel: string) => void;
  lang: Language;
  onLangChange: (lang: Language) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  t: Translations;
  onCheckUpdate: () => void;
  updateStatusText: string | null;
}

export const Navbar: React.FC<NavbarProps> = ({
  status,
  onOpenSettings,
  onChannelChange,
  lang,
  onLangChange,
  theme,
  onThemeChange,
  t,
  onCheckUpdate,
  updateStatusText,
}) => {
  const [editingChannel, setEditingChannel] = useState(false);
  const [channelInput, setChannelInput] = useState(status.channel);
  const [copied, setCopied] = useState(false);

  const handleChannelSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (channelInput.trim()) {
      onChannelChange(channelInput.trim());
      setEditingChannel(false);
    }
  };

  const handleCopyChannel = () => {
    navigator.clipboard.writeText(status.channel);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="flex flex-wrap items-center justify-between px-6 py-3.5 border-b border-white/10 bg-black/20 backdrop-blur-md select-none gap-4">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <DropQTTLogo size={36} />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
              DropQTT
            </h1>
            <button
              onClick={onCheckUpdate}
              title={t.checkForUpdates}
              className="text-[10px] px-2 py-0.5 rounded font-mono font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 flex items-center gap-1 transition-all"
            >
              <span>v0.1.3</span>
              <RefreshCw className="w-2.5 h-2.5 opacity-70" />
            </button>
            {updateStatusText && (
              <span className="text-[10px] text-emerald-400 font-medium animate-pulse">
                {updateStatusText}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 font-medium">{t.tagline}</p>
        </div>
      </div>

      {/* Center & Right Controls */}
      <div className="flex items-center flex-wrap gap-2.5">
        {/* Room / Channel Selector */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/30 border border-white/10 text-xs">
          <Hash className="w-3.5 h-3.5 text-cyan-400" />
          {editingChannel ? (
            <form onSubmit={handleChannelSubmit} className="flex items-center gap-1.5">
              <input
                type="text"
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
                placeholder="Channel Name"
                className="bg-transparent text-xs text-white outline-none w-28 font-mono"
                autoFocus
                onBlur={handleChannelSubmit}
              />
            </form>
          ) : (
            <span
              onClick={() => {
                setChannelInput(status.channel);
                setEditingChannel(true);
              }}
              title="Click to rename room channel"
              className="text-xs font-mono text-slate-200 hover:text-cyan-300 cursor-pointer transition-colors max-w-[130px] truncate"
            >
              {status.channel || 'public-lobby'}
            </span>
          )}
          <button
            onClick={handleCopyChannel}
            title="Copy channel code"
            className="text-slate-400 hover:text-cyan-400 p-0.5 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Theme Selector Pill */}
        <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/30 border border-white/10 text-xs text-slate-300">
          <Palette className="w-3.5 h-3.5 text-indigo-400" />
          <select
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as Theme)}
            className="bg-transparent text-xs text-slate-200 outline-none cursor-pointer"
          >
            <option value="cyberpunk" className="bg-slate-900 text-white">Cyberpunk</option>
            <option value="obsidian" className="bg-slate-900 text-white">Obsidian</option>
            <option value="nord" className="bg-slate-900 text-white">Nord Frost</option>
            <option value="solaris" className="bg-slate-900 text-white">Solaris Light</option>
          </select>
        </div>

        {/* Language Selector Pill */}
        <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/30 border border-white/10 text-xs text-slate-300">
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <select
            value={lang}
            onChange={(e) => onLangChange(e.target.value as Language)}
            className="bg-transparent text-xs text-slate-200 outline-none cursor-pointer"
          >
            <option value="zh-CN" className="bg-slate-900 text-white">简体中文</option>
            <option value="en" className="bg-slate-900 text-white">English</option>
            <option value="zh-TW" className="bg-slate-900 text-white">繁體中文</option>
            <option value="ja" className="bg-slate-900 text-white">日本語</option>
          </select>
        </div>

        {/* Connection Status Pill */}
        <div
          onClick={onOpenSettings}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-all ${
            status.connected
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20'
          }`}
        >
          {status.connected ? (
            <>
              <Wifi className="w-3.5 h-3.5 animate-pulse" />
              <span>{status.brokerHost || t.connected}</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5" />
              <span>{t.disconnected}</span>
            </>
          )}
        </div>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          title={t.settings}
          className="p-2 rounded-lg bg-black/30 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all shadow-sm"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
