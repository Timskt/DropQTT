import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BrokerConfig, BROKER_PRESETS, BrokerProfile } from '../types';
import { Language, Translations } from '../i18n';
import { Theme } from '../themes';
import {
  X, Server, Shield, Key, Sliders, CheckCircle2, Globe, Palette,
  RefreshCw, Zap, BookmarkPlus, Trash2, Check, AlertCircle, Hash, Activity,
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

const OPT_STYLE = { background: 'var(--bg-panel-solid)', color: 'var(--text-primary)' };
const LABEL = 'block text-xs font-semibold mb-1.5';
const LABEL_COLOR = { color: 'var(--text-secondary)' };

/** Token-driven peer toggle switch */
const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; onVar?: string }> = ({
  checked, onChange, onVar = 'var(--accent)',
}) => (
  <label className="relative inline-flex items-center cursor-pointer shrink-0">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
    <div
      className="w-9 h-5 rounded-full peer-focus:outline-none border peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"
      style={{
        background: checked ? onVar : 'var(--bg-inset)',
        borderColor: checked ? onVar : 'var(--border-inset)',
      }}
    />
  </label>
);

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen, onClose, config, onSaveAndConnect, onDisconnect, isConnected,
  lang, onLangChange, theme, onThemeChange, t, onCheckUpdate, updateStatusText,
  profiles, onSaveProfile, onDeleteProfile,
}) => {
  const [form, setForm] = useState<BrokerConfig>(config);
  const [selectedPreset, setSelectedPreset] = useState<string>('Custom');
  const [newProfileName, setNewProfileName] = useState<string>('');
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

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
    setForm((prev) => ({ ...prev, host: preset.host, port: preset.port, useTls: preset.useTls, baseTopic: preset.baseTopic || 'dropqtt' }));
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
      setTestResult({ success: true, message: t.connectionSuccess.replace('{ms}', latency.toString()) });
    } catch (err) {
      setTestResult({ success: false, message: `${t.connectionFailed}: ${String(err)}` });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
      <div className="panel w-full max-w-xl rounded-2xl overflow-hidden max-h-[90vh] flex flex-col" style={{ background: 'var(--bg-panel-solid)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border-panel)', background: 'var(--bg-inset)' }}>
          <div className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
            <Server className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <span>{t.brokerConfig}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg transition" style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Theme & Language */}
          <div className="grid grid-cols-2 gap-3 inset-box p-3.5">
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Palette className="w-3.5 h-3.5" style={{ color: 'var(--indigo)' }} /><span>{t.theme}</span></span>
              </label>
              <select value={theme} onChange={(e) => onThemeChange(e.target.value as Theme)} className="field-input w-full">
                <option value="cyberpunk" style={OPT_STYLE}>{t.themeCyberpunk}</option>
                <option value="obsidian" style={OPT_STYLE}>{t.themeObsidian}</option>
                <option value="nord" style={OPT_STYLE}>{t.themeNord}</option>
                <option value="solaris" style={OPT_STYLE}>{t.themeSolaris}</option>
              </select>
            </div>
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} /><span>{t.language}</span></span>
              </label>
              <select value={lang} onChange={(e) => onLangChange(e.target.value as Language)} className="field-input w-full">
                <option value="zh-CN" style={OPT_STYLE}>简体中文 (Simplified Chinese)</option>
                <option value="en" style={OPT_STYLE}>English</option>
                <option value="zh-TW" style={OPT_STYLE}>繁體中文 (Traditional Chinese)</option>
                <option value="ja" style={OPT_STYLE}>日本語 (Japanese)</option>
              </select>
            </div>
          </div>

          {/* Presets & Saved Profiles */}
          <div className="space-y-2.5">
            <label className={LABEL} style={{ color: 'var(--text-muted)' }}>
              {t.brokerPresets} / {t.brokerProfiles}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {BROKER_PRESETS.map((preset) => {
                const active = selectedPreset === preset.name && form.host === preset.host && form.port === preset.port;
                return (
                  <button
                    type="button"
                    key={preset.name}
                    onClick={() => handleApplyPreset(preset)}
                    className="px-2.5 py-2 text-xs rounded-lg font-medium border text-center transition"
                    style={active
                      ? { background: 'var(--info-soft)', borderColor: 'var(--info-border)', color: 'var(--info)' }
                      : { background: 'var(--bg-inset)', borderColor: 'var(--border-inset)', color: 'var(--text-secondary)' }}
                  >
                    {preset.name}
                  </button>
                );
              })}
            </div>

            {profiles.length > 0 && (
              <div className="pt-2">
                <div className="flex flex-wrap gap-1.5">
                  {profiles.map((p) => {
                    const active = form.host === p.config.host && form.port === p.config.port;
                    return (
                      <div
                        key={p.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border transition"
                        style={active
                          ? { background: 'var(--indigo-soft)', borderColor: 'var(--indigo-border)', color: 'var(--indigo)' }
                          : { background: 'var(--bg-inset)', borderColor: 'var(--border-inset)', color: 'var(--text-secondary)' }}
                      >
                        <button type="button" onClick={() => handleApplyProfile(p)} className="cursor-pointer">{p.name}</button>
                        <button type="button" onClick={() => onDeleteProfile(p.id)} className="opacity-60 hover:opacity-100 p-0.5 ml-1" style={{ color: 'var(--bad)' }} title={t.deleteProfile}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Host & Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center justify-between"><span>{t.brokerHost}</span><span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>IP / Domain</span></span>
              </label>
              <input type="text" value={form.host} required onChange={(e) => { setSelectedPreset('Custom'); setForm({ ...form, host: e.target.value }); setTestResult(null); }} className="field-input w-full font-mono" placeholder="192.168.1.100 or mqtt.example.com" />
            </div>
            <div>
              <label className={LABEL} style={LABEL_COLOR}>{t.port}</label>
              <input type="number" value={form.port} required onChange={(e) => { setForm({ ...form, port: Math.min(65535, Math.max(1, parseInt(e.target.value) || 1883)) }); setTestResult(null); }} className="field-input w-full font-mono" placeholder="1883" />
            </div>
          </div>

          {/* Protocol Version & Clean Session */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" style={{ color: 'var(--violet)' }} /><span>{t.protocolVersion}</span></span>
              </label>
              <select value={form.protocolVersion ?? 3} onChange={(e) => { setForm({ ...form, protocolVersion: parseInt(e.target.value) }); setTestResult(null); }} className="field-input w-full">
                <option value={3} style={OPT_STYLE}>{t.mqttV311}</option>
                <option value={5} style={OPT_STYLE}>{t.mqttV5}</option>
              </select>
            </div>
            <div className="inset-box flex items-center justify-between px-3">
              <div className="min-w-0 pr-2">
                <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t.cleanSession}</p>
                <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{t.cleanSessionDesc}</p>
              </div>
              <Toggle checked={form.cleanSession ?? true} onChange={(v) => setForm({ ...form, cleanSession: v })} onVar="var(--violet)" />
            </div>
          </div>

          {/* TLS Toggle */}
          <div className="inset-box flex items-center justify-between p-3">
            <div className="flex items-center gap-2.5">
              <Shield className="w-4 h-4" style={{ color: 'var(--info)' }} />
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t.tls}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t.tlsDesc}</p>
              </div>
            </div>
            <Toggle checked={form.useTls} onChange={(v) => { setForm({ ...form, useTls: v }); setTestResult(null); }} />
          </div>

          {/* Base Topic & Client ID */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Hash className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} /><span>{t.baseTopic}</span></span>
              </label>
              <input type="text" value={form.baseTopic || 'dropqtt'} onChange={(e) => setForm({ ...form, baseTopic: e.target.value.trim() || 'dropqtt' })} className="field-input w-full font-mono" placeholder="dropqtt" />
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{t.baseTopicDesc}</p>
            </div>
            <div>
              <label className={LABEL} style={LABEL_COLOR}>{t.clientId}</label>
              <input type="text" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="field-input w-full font-mono" />
            </div>
          </div>

          {/* Username & Password */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /><span>{t.username}</span></span>
              </label>
              <input type="text" value={form.username || ''} onChange={(e) => { setForm({ ...form, username: e.target.value || undefined }); setTestResult(null); }} className="field-input w-full" placeholder="User / Token" />
            </div>
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /><span>{t.password}</span></span>
              </label>
              <input type="password" value={form.password || ''} onChange={(e) => { setForm({ ...form, password: e.target.value || undefined }); setTestResult(null); }} className="field-input w-full" placeholder="••••••••" />
            </div>
          </div>

          {/* Test Connection */}
          <div className="inset-box p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                <Zap className="w-3.5 h-3.5" style={{ color: 'var(--warn)' }} /><span>{t.testConnection}</span>
              </span>
              <button type="button" onClick={handleTestConnection} disabled={testing} className="chip chip-warn !px-3 !py-1.5 !text-xs font-semibold transition disabled:opacity-50" style={{ background: 'transparent' }}>
                <Zap className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                <span>{testing ? t.testingConnection : t.testConnection}</span>
              </button>
            </div>
            {testResult && (
              <div className="p-2.5 rounded-lg text-xs flex items-center gap-2 animate-fade-in" style={testResult.success ? { background: 'var(--ok-soft)', border: '1px solid var(--ok-border)', color: 'var(--ok)' } : { background: 'var(--bad-soft)', border: '1px solid var(--bad-border)', color: 'var(--bad)' }}>
                {testResult.success ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Save Profile */}
          <div className="flex items-center gap-2 pt-1">
            <input type="text" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} placeholder={t.profileName} className="field-input flex-1" />
            <button type="button" onClick={handleSaveCurrentAsProfile} className="chip chip-indigo !px-3 !py-1.5 !text-xs transition">
              <BookmarkPlus className="w-3.5 h-3.5" /><span>{t.saveProfile}</span>
            </button>
          </div>

          {/* QoS & KeepAlive */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Sliders className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} /><span>{t.defaultQos}</span></span>
              </label>
              <select value={form.defaultQos} onChange={(e) => setForm({ ...form, defaultQos: parseInt(e.target.value) })} className="field-input w-full">
                <option value={0} style={OPT_STYLE}>{t.qos0Desc}</option>
                <option value={1} style={OPT_STYLE}>{t.qos1Desc}</option>
                <option value={2} style={OPT_STYLE}>{t.qos2Desc}</option>
              </select>
            </div>
            <div>
              <label className={LABEL} style={LABEL_COLOR}>{t.keepAlive}</label>
              <input type="number" value={form.keepAliveSecs} onChange={(e) => setForm({ ...form, keepAliveSecs: Math.min(600, Math.max(5, parseInt(e.target.value) || 60)) })} className="field-input w-full font-mono" />
            </div>
          </div>

          {/* Auto Update */}
          <div className="inset-box p-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                <RefreshCw className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} /><span>{t.autoUpdate}</span>
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{updateStatusText || `${t.currentVersion}: v0.7.0`}</p>
            </div>
            <button type="button" onClick={onCheckUpdate} className="btn-ghost !px-3 !py-1.5 text-xs font-medium">{t.checkForUpdates}</button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4" style={{ borderTop: '1px solid var(--border-panel)' }}>
            {isConnected ? (
              <button type="button" onClick={() => { onDisconnect(); onClose(); }} className="chip chip-bad !px-4 !py-2 !text-xs font-semibold border transition">
                {t.disconnected}
              </button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} className="btn-ghost !px-4 !py-2 text-xs font-semibold">{t.cancel}</button>
              <button type="submit" className="btn-accent flex items-center gap-2 !px-5 !py-2 text-xs font-bold">
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
