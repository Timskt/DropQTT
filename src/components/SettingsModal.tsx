import React, { useState } from 'react';
import { BrokerConfig, BROKER_PRESETS } from '../types';
import { Language, Translations } from '../i18n';
import { Theme } from '../themes';
import { X, Server, Shield, Key, Sliders, CheckCircle2, Globe, Palette, RefreshCw } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: BrokerConfig;
  onSaveAndConnect: (config: BrokerConfig) => void;
  onDisconnect: () => void;
  isConnected: boolean;
  lang: Language;
  onLangChange: (lang: Language) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  t: Translations;
  onCheckUpdate: () => void;
  updateStatusText: string | null;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveAndConnect,
  onDisconnect,
  isConnected,
  lang,
  onLangChange,
  theme,
  onThemeChange,
  t,
  onCheckUpdate,
  updateStatusText,
}) => {
  const [form, setForm] = useState<BrokerConfig>(config);
  const [selectedPreset, setSelectedPreset] = useState<string>('EMQX Public');

  if (!isOpen) return null;

  const handleApplyPreset = (presetName: string) => {
    const preset = BROKER_PRESETS.find((p) => p.name === presetName);
    if (preset) {
      setSelectedPreset(presetName);
      setForm((prev) => ({
        ...prev,
        host: preset.host,
        port: preset.port,
        useTls: preset.useTls,
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveAndConnect(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-white/10 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20">
          <div className="flex items-center gap-2 font-semibold">
            <Server className="w-5 h-5 text-cyan-400" />
            <span>{t.brokerConfig}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Theme & Language Controls */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-black/30 border border-white/5">
            <div>
              <label className="block text-xs font-semibold opacity-70 mb-1.5 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-indigo-400" />
                <span>{t.theme}</span>
              </label>
              <select
                value={theme}
                onChange={(e) => onThemeChange(e.target.value as Theme)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg glass-input bg-slate-800 text-white"
              >
                <option value="cyberpunk">{t.themeCyberpunk}</option>
                <option value="obsidian">{t.themeObsidian}</option>
                <option value="nord">{t.themeNord}</option>
                <option value="solaris">{t.themeSolaris}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold opacity-70 mb-1.5 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t.language}</span>
              </label>
              <select
                value={lang}
                onChange={(e) => onLangChange(e.target.value as Language)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg glass-input bg-slate-800 text-white"
              >
                <option value="zh-CN">简体中文 (Simplified Chinese)</option>
                <option value="en">English</option>
                <option value="zh-TW">繁體中文 (Traditional Chinese)</option>
                <option value="ja">日本語 (Japanese)</option>
              </select>
            </div>
          </div>

          {/* Quick Presets */}
          <div>
            <label className="block text-xs font-semibold opacity-70 uppercase tracking-wider mb-2">
              {t.brokerPresets}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {BROKER_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.name}
                  onClick={() => handleApplyPreset(preset.name)}
                  className={`px-2.5 py-2 text-xs rounded-lg font-medium border text-center transition-all ${
                    selectedPreset === preset.name && form.host === preset.host
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-semibold'
                      : 'bg-white/5 border-white/10 opacity-80 hover:opacity-100 hover:bg-white/10'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Host & Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium opacity-80 mb-1.5">{t.brokerHost}</label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => {
                  setSelectedPreset('Custom');
                  setForm({ ...form, host: e.target.value });
                }}
                required
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white font-mono"
                placeholder="broker.emqx.io"
              />
            </div>
            <div>
              <label className="block text-xs font-medium opacity-80 mb-1.5">{t.port}</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 1883 })}
                required
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white font-mono"
                placeholder="1883"
              />
            </div>
          </div>

          {/* TLS Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/10">
            <div className="flex items-center gap-2.5">
              <Shield className="w-4 h-4 text-cyan-400" />
              <div>
                <p className="text-xs font-medium">{t.tls}</p>
                <p className="text-[11px] opacity-60">{t.tlsDesc}</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={form.useTls}
                onChange={(e) => setForm({ ...form, useTls: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>

          {/* Client ID */}
          <div>
            <label className="block text-xs font-medium opacity-80 mb-1.5">{t.clientId}</label>
            <input
              type="text"
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white font-mono"
            />
          </div>

          {/* Username & Password */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium opacity-80 mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 opacity-60" />
                <span>{t.username}</span>
              </label>
              <input
                type="text"
                value={form.username || ''}
                onChange={(e) => setForm({ ...form, username: e.target.value || undefined })}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white"
                placeholder="User"
              />
            </div>
            <div>
              <label className="block text-xs font-medium opacity-80 mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 opacity-60" />
                <span>{t.password}</span>
              </label>
              <input
                type="password"
                value={form.password || ''}
                onChange={(e) => setForm({ ...form, password: e.target.value || undefined })}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white"
                placeholder="••••••"
              />
            </div>
          </div>

          {/* QoS & KeepAlive */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-medium opacity-80 mb-1.5 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t.defaultQos}</span>
              </label>
              <select
                value={form.defaultQos}
                onChange={(e) => setForm({ ...form, defaultQos: parseInt(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-slate-800 text-white"
              >
                <option value={0}>{t.qos0Desc}</option>
                <option value={1}>{t.qos1Desc}</option>
                <option value={2}>{t.qos2Desc}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium opacity-80 mb-1.5">{t.keepAlive}</label>
              <input
                type="number"
                value={form.keepAliveSecs}
                onChange={(e) => setForm({ ...form, keepAliveSecs: parseInt(e.target.value) || 60 })}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white font-mono"
              />
            </div>
          </div>

          {/* Auto Update Section */}
          <div className="p-3.5 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t.autoUpdate}</span>
              </p>
              <p className="text-[11px] opacity-60 mt-0.5">
                {updateStatusText || `${t.currentVersion}: v0.1.0`}
              </p>
            </div>
            <button
              type="button"
              onClick={onCheckUpdate}
              className="px-3 py-1.5 text-xs rounded-lg bg-white/10 hover:bg-white/20 text-cyan-300 font-medium transition-all"
            >
              {t.checkForUpdates}
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-white/10">
            {isConnected ? (
              <button
                type="button"
                onClick={() => {
                  onDisconnect();
                  onClose();
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-colors"
              >
                {t.disconnected}
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold shadow-lg shadow-cyan-500/20 transition-all active:scale-98"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{t.saveAndConnect}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
