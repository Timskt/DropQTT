import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BrokerConfig, BROKER_PRESETS, BrokerProfile } from '../types';
import { Language, Translations } from '../i18n';
import { Theme } from '../themes';
import {
  X,
  Server,
  Shield,
  Key,
  Sliders,
  CheckCircle2,
  Globe,
  Palette,
  RefreshCw,
  Zap,
  BookmarkPlus,
  Trash2,
  Check,
  AlertCircle,
  Hash,
  Activity,
} from 'lucide-react';

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
  profiles: BrokerProfile[];
  onSaveProfile: (name: string, config: BrokerConfig) => void;
  onDeleteProfile: (id: string) => void;
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
  profiles,
  onSaveProfile,
  onDeleteProfile,
}) => {
  const [form, setForm] = useState<BrokerConfig>(config);
  const [selectedPreset, setSelectedPreset] = useState<string>('Custom');
  const [newProfileName, setNewProfileName] = useState<string>('');
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Re-sync the form whenever the modal opens or the external config changes
  // (e.g. profile selected from the status bar while modal is open)
  useEffect(() => {
    if (isOpen) {
      setForm(config);
      setTestResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleApplyPreset = (preset: { name: string; host: string; port: number; useTls: boolean; baseTopic?: string }) => {
    setSelectedPreset(preset.name);
    setForm((prev) => ({
      ...prev,
      host: preset.host,
      port: preset.port,
      useTls: preset.useTls,
      baseTopic: preset.baseTopic || 'dropqtt',
    }));
    setTestResult(null);
  };

  const handleApplyProfile = (profile: BrokerProfile) => {
    setSelectedPreset(profile.name);
    setForm({ ...profile.config });
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const latency = await invoke<number>('test_broker_connection', { config: form });
      setTestResult({
        success: true,
        message: t.connectionSuccess.replace('{ms}', latency.toString()),
      });
    } catch (err) {
      setTestResult({
        success: false,
        message: `${t.connectionFailed}: ${String(err)}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveCurrentAsProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newProfileName.trim() || `${form.host}:${form.port}`;
    onSaveProfile(name, form);
    setNewProfileName('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveAndConnect(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-xl rounded-2xl bg-slate-900 border border-white/10 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
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

          {/* Presets & Saved Profiles */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold opacity-70 uppercase tracking-wider">
                {t.brokerPresets} / {t.brokerProfiles}
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {BROKER_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.name}
                  onClick={() => handleApplyPreset(preset)}
                  className={`px-2.5 py-2 text-xs rounded-lg font-medium border text-center transition-all ${
                    selectedPreset === preset.name && form.host === preset.host && form.port === preset.port
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-semibold shadow-sm'
                      : 'bg-white/5 border-white/10 opacity-80 hover:opacity-100 hover:bg-white/10'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            {/* Custom Saved Profiles List */}
            {profiles.length > 0 && (
              <div className="pt-2">
                <div className="flex flex-wrap gap-1.5">
                  {profiles.map((p) => (
                    <div
                      key={p.id}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border transition-all ${
                        form.host === p.config.host && form.port === p.config.port
                          ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300 font-semibold'
                          : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleApplyProfile(p)}
                        className="cursor-pointer"
                      >
                        {p.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteProfile(p.id)}
                        className="opacity-50 hover:opacity-100 hover:text-rose-400 p-0.5 ml-1"
                        title={t.deleteProfile}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Host & Port Configuration */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium opacity-80 mb-1.5 flex items-center justify-between">
                <span>{t.brokerHost}</span>
                <span className="text-[10px] opacity-60">IP / Domain</span>
              </label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => {
                  setSelectedPreset('Custom');
                  setForm({ ...form, host: e.target.value });
                  setTestResult(null);
                }}
                required
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white font-mono"
                placeholder="192.168.1.100 or mqtt.example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium opacity-80 mb-1.5">{t.port}</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => {
                  setForm({ ...form, port: Math.min(65535, Math.max(1, parseInt(e.target.value) || 1883)) });
                  setTestResult(null);
                }}
                required
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white font-mono"
                placeholder="1883"
              />
            </div>
          </div>

          {/* Protocol Version & Clean Session */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium opacity-80 mb-1.5 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-violet-400" />
                <span>{t.protocolVersion}</span>
              </label>
              <select
                value={form.protocolVersion ?? 3}
                onChange={(e) => {
                  setForm({ ...form, protocolVersion: parseInt(e.target.value) });
                  setTestResult(null);
                }}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-slate-800 text-white"
              >
                <option value={3}>{t.mqttV311}</option>
                <option value={5}>{t.mqttV5}</option>
              </select>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-black/20 border border-white/10 px-3">
              <div className="min-w-0 pr-2">
                <p className="text-xs font-medium">{t.cleanSession}</p>
                <p className="text-[10px] opacity-60 truncate">{t.cleanSessionDesc}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={form.cleanSession ?? true}
                  onChange={(e) => setForm({ ...form, cleanSession: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-500"></div>
              </label>
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
                onChange={(e) => {
                  setForm({ ...form, useTls: e.target.checked });
                  setTestResult(null);
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>

          {/* Base Topic & Client ID */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium opacity-80 mb-1.5 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t.baseTopic}</span>
              </label>
              <input
                type="text"
                value={form.baseTopic || 'dropqtt'}
                onChange={(e) => setForm({ ...form, baseTopic: e.target.value.trim() || 'dropqtt' })}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white font-mono"
                placeholder="dropqtt"
              />
              <p className="text-[10px] opacity-60 mt-1">{t.baseTopicDesc}</p>
            </div>
            <div>
              <label className="block text-xs font-medium opacity-80 mb-1.5">{t.clientId}</label>
              <input
                type="text"
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white font-mono"
              />
            </div>
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
                onChange={(e) => {
                  setForm({ ...form, username: e.target.value || undefined });
                  setTestResult(null);
                }}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white"
                placeholder="User / Token"
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
                onChange={(e) => {
                  setForm({ ...form, password: e.target.value || undefined });
                  setTestResult(null);
                }}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input bg-black/40 text-white"
                placeholder="••••••••"
              />
            </div>
          </div>

          {/* Test Connection Live Button & Feedback */}
          <div className="p-3.5 rounded-xl bg-black/30 border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>{t.testConnection}</span>
              </span>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/20 text-amber-300 border border-amber-400/30 transition-all disabled:opacity-50"
              >
                <Zap className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                <span>{testing ? t.testingConnection : t.testConnection}</span>
              </button>
            </div>

            {testResult && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-center gap-2 animate-in fade-in ${
                  testResult.success
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
                }`}
              >
                {testResult.success ? (
                  <Check className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Save Profile Option */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder={t.profileName}
              className="flex-1 px-3 py-1.5 text-xs rounded-lg glass-input bg-black/40 text-white"
            />
            <button
              type="button"
              onClick={handleSaveCurrentAsProfile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 transition-all"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>{t.saveProfile}</span>
            </button>
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
                onChange={(e) => setForm({ ...form, keepAliveSecs: Math.min(600, Math.max(5, parseInt(e.target.value) || 60)) })}
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
                {updateStatusText || `${t.currentVersion}: v0.2.0`}
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
