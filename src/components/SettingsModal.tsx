import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { BrokerConfig, BROKER_PRESETS, BrokerProfile, SecretStatus } from '../types';
import { Language, Translations, fill } from '../i18n';
import { Theme } from '../themes';
import { TimePref } from '../utils/timePref';
import {
  X, Server, Shield, Key, Sliders, CheckCircle2, Globe, Palette,
  RefreshCw, Zap, BookmarkPlus, Trash2, Check, AlertCircle, Hash, Activity, ShieldCheck, Clock, Pencil,
} from 'lucide-react';
import {
  dropSecret, hasSecret, newSecretRef, readSecretStatus, takeBootReport, writeSecret,
  MigrationReport,
} from '../utils/secrets';

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
  /** Which zone UI timestamps render in (files always export UTC) */
  timePref: TimePref;
  onTimePrefChange: (pref: TimePref) => void;
  t: Translations;
  onCheckUpdate: () => void;
  updateStatusText: string | null;
  profiles: BrokerProfile[];
  onSaveProfile: (name: string, config: BrokerConfig) => void;
  onUpdateProfile: (id: string, name: string, config: BrokerConfig) => void;
  onDeleteProfile: (id: string) => void;
}

const OPT_STYLE = { background: 'var(--bg-panel-solid)', color: 'var(--text-primary)' };
const LABEL = 'block text-xs font-semibold mb-1.5';
const LABEL_COLOR = { color: 'var(--text-secondary)' };

/** Pick a PEM file, storing its absolute path on the config */
const pickFile = async (onPath: (p: string) => void) => {
  try {
    const sel = await open({ multiple: false, directory: false });
    if (typeof sel === 'string' && sel) onPath(sel);
  } catch {
    /* dialog cancelled or unavailable in browser dev */
  }
};

/** Token-driven peer toggle switch */
const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; onVar?: string; label: string }> = ({
  checked, onChange, onVar = 'var(--accent)', label,
}) => (
  <label className="relative inline-flex items-center cursor-pointer shrink-0">
    {/* The wrapping <label> holds no text -- the caption is rendered by the caller
        in a sibling element -- so without this the switch announces as an unnamed
        checkbox. */}
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="sr-only peer"
      aria-label={label}
    />
    <div
      className="w-9 h-5 rounded-full peer-focus:outline-none border peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"
      style={{
        background: checked ? onVar : 'var(--bg-inset)',
        borderColor: checked ? onVar : 'var(--border-inset)',
      }}
    />
  </label>
);

/** Read-only PEM path row with Browse / Clear */
import { TlsMaterialPanel } from './TlsMaterialPanel';

const CertRow: React.FC<{
  label: string; path?: string; onPick: () => void; onClear: () => void; browse: string; clear: string;
}> = ({ label, path, onPick, onClear, browse, clear }) => (
  <div className="flex items-center gap-2">
    <span className="w-24 shrink-0 text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
    <span className="flex-1 inset-box px-2 py-1 text-[11px] font-mono truncate" style={{ color: path ? 'var(--text-primary)' : 'var(--text-muted)' }} title={path}>
      {path || '—'}
    </span>
    <button type="button" onClick={onPick} className="btn-ghost !px-2 !py-1 text-[11px]">{browse}</button>
    {path && (
      <button type="button" onClick={onClear} className="btn-ghost !px-2 !py-1 text-[11px]" style={{ color: 'var(--bad)' }}>{clear}</button>
    )}
  </div>
);

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen, onClose, config, onSaveAndConnect, onDisconnect, isConnected,
  lang, onLangChange, theme, onThemeChange, timePref, onTimePrefChange, t, onCheckUpdate, updateStatusText,
  profiles, onSaveProfile, onUpdateProfile, onDeleteProfile,
}) => {
  const [form, setForm] = useState<BrokerConfig>(config);
  const [selectedPreset, setSelectedPreset] = useState<string>('Custom');
  const [newProfileName, setNewProfileName] = useState<string>('');
  /**
   * The saved profile the form is currently editing. Opening one and changing its port
   * used to have no honest outcome: "保存为常用预设" appended a second entry and left the
   * stale one, so the list grew every time someone fixed a typo.
   */
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  /** The password being typed now. It is never part of `form`, so nothing can save it. */
  const [passwordDraft, setPasswordDraft] = useState('');
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);
  const [storedPresent, setStoredPresent] = useState<boolean | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [bootReport, setBootReport] = useState<MigrationReport | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      setForm(config);
      setTestResult(null);
      setPasswordDraft('');
      setEditingProfileId(null);
      setStoredPresent(null);
      const report = takeBootReport();
      setSecretError(report?.failed[0] ?? null);
      setBootReport(report);
    }
  }, [isOpen, config]);

  // Where passwords can go on this machine, asked once per dialog rather than cached
  // for the session: a locked keychain unlocks, and a stale "unavailable" would keep
  // writing plaintext long after the store came back.
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    void readSecretStatus().then((next) => {
      if (alive) setSecretStatus(next);
    });
    return () => {
      alive = false;
    };
  }, [isOpen]);

  /**
   * "Is this reference actually still in the store" — asked **only when the button is
   * pressed**. It used to run whenever the dialog opened, and on macOS that single read
   * of the stored password is an authorization prompt: opening Settings to look at a port
   * number interrupted the user for their login keychain. Nothing here needs the value,
   * and a reference whose password was deleted still fails loudly at connect, so the
   * answer is worth a click and not worth a prompt.
   */
  const checkStoredSecret = () => {
    const reference = form.secretRef;
    if (secretStatus?.available !== true || !reference) return;
    void hasSecret(reference).then(setStoredPresent);
  };

  // Escape closes the dialog, Tab stays inside it, and focus returns on close.
  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  /** Where the password is going, said plainly, because the field's meaning changed. */
  const secretNote = !secretStatus
    ? t.secretStoreChecking
    : secretStatus.available
      ? t.secretStoredSecurely
      : secretStatus.supported
        ? fill(t.secretStoreLocked, { reason: secretStatus.reason ?? '' })
        : t.secretStoreUnsupported;
  // Order matters: a reference with nothing behind it is the one thing the user has to
  // act on, so it outranks the informational "N moved" notice, which outranks the
  // standing statement about where passwords live.
  const movedNote = bootReport && bootReport.moved > 0
    ? fill(t.secretMovedCount, { count: String(bootReport.moved) })
    : null;
  const staleReference = storedPresent === false && !!form.secretRef;
  const credentialNote = (staleReference ? t.secretReferenceStale : null) ?? movedNote ?? secretNote;
  const credentialProblem = secretError ?? null;

  const handleApplyPreset = (preset: { name: string; host: string; port: number; useTls: boolean; baseTopic?: string }) => {
    setSelectedPreset(preset.name);
    // A public preset is a starting point, not an entry being maintained: saving after
    // one must create, never overwrite the profile that happened to be loaded.
    setEditingProfileId(null);
    setNewProfileName('');
    setForm((prev) => ({ ...prev, host: preset.host, port: preset.port, useTls: preset.useTls, baseTopic: preset.baseTopic || 'dropqtt' }));
    setTestResult(null);
  };

  const handleApplyProfile = (profile: BrokerProfile) => {
    setSelectedPreset(profile.name);
    setEditingProfileId(profile.id);
    setNewProfileName(profile.name);
    setForm({ ...profile.config });
    setPasswordDraft('');
    setTestResult(null);
  };

  /**
   * Move a typed password into the credential store and return the config that points
   * at it. `null` means the store refused: the caller must then stop, because the
   * alternative is connecting with a password that was never saved anywhere and
   * telling the user about it only when the broker refuses the next one.
   *
   * With no store on this machine the draft travels in the config as it always did.
   * That is the one case where plaintext is still written, and the banner under the
   * password field says so rather than letting it look secure.
   */
  const commitDraft = async (): Promise<BrokerConfig | null> => {
    const next: BrokerConfig = { ...form };
    // Either the password being typed now, or one an older build left sitting in the
    // config. Both go to the store on save, so "Save" is also the moment a profile
    // that predates the credential store stops carrying its password.
    const candidate = passwordDraft || next.password || '';
    if (!candidate) return next;
    if (!secretStatus?.available) {
      next.password = candidate;
      delete next.secretRef;
      setPasswordDraft('');
      return next;
    }
    const reference = next.secretRef || newSecretRef();
    const error = await writeSecret(reference, candidate);
    if (error) {
      setSecretError(error);
      return null;
    }
    next.secretRef = reference;
    delete next.password;
    setPasswordDraft('');
    setStoredPresent(true);
    return next;
  };

  /** What the backend should be handed for a test: the form plus whatever is being typed. */
  const configForProbe = (): BrokerConfig =>
    passwordDraft ? { ...form, password: passwordDraft } : form;

  const handleClearStoredPassword = async () => {
    const reference = form.secretRef;
    if (reference) {
      const error = await dropSecret(reference);
      if (error) {
        setSecretError(error);
        return;
      }
    }
    setForm((prev) => {
      const next = { ...prev };
      delete next.secretRef;
      delete next.password;
      return next;
    });
    setPasswordDraft('');
    setStoredPresent(null);
    setSecretError(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const latency = await invoke<number>('test_broker_connection', { config: configForProbe() });
      setTestResult({ success: true, message: fill(t.connectionSuccess, { ms: latency.toString() }) });
    } catch (err) {
      setTestResult({ success: false, message: `${t.connectionFailed}: ${String(err)}` });
    } finally {
      setTesting(false);
    }
  };

  /** The profile the save row would update, if any. Cleared once it is gone. */
  const editingProfile = profiles.find((p) => p.id === editingProfileId) ?? null;

  /**
   * Save the form as a profile. With one loaded it updates that entry — including its
   * name, when the name box was edited — instead of appending a near-duplicate.
   */
  const handleSaveCurrentAsProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const committed = await commitDraft();
    if (!committed) return;
    const typed = newProfileName.trim();
    if (editingProfile) {
      onUpdateProfile(editingProfile.id, typed || editingProfile.name, committed);
    } else {
      onSaveProfile(typed || `${committed.host}:${committed.port}`, committed);
    }
    setNewProfileName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const committed = await commitDraft();
    if (!committed) return;
    onSaveAndConnect(committed);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className="panel w-full max-w-xl rounded-2xl overflow-hidden max-h-[90vh] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title" style={{ background: 'var(--bg-panel-solid)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border-panel)', background: 'var(--bg-inset)' }}>
          <div className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
            <Server className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <span id="settings-dialog-title">{t.brokerConfig}</span>
          </div>
          <button type="button" onClick={onClose} aria-label={t.cancel} className="p-1 rounded-lg transition" style={{ color: 'var(--text-muted)' }}
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
              <select value={theme} onChange={(e) => onThemeChange(e.target.value as Theme)} className="field-input w-full" aria-label={t.theme}>
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
              <select value={lang} onChange={(e) => onLangChange(e.target.value as Language)} className="field-input w-full" aria-label={t.language}>
                <option value="zh-CN" style={OPT_STYLE}>简体中文 (Simplified Chinese)</option>
                <option value="en" style={OPT_STYLE}>English</option>
                <option value="zh-TW" style={OPT_STYLE}>繁體中文 (Traditional Chinese)</option>
                <option value="ja" style={OPT_STYLE}>日本語 (Japanese)</option>
              </select>
            </div>
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" style={{ color: 'var(--violet)' }} /><span>{t.timePrefLabel}</span></span>
              </label>
              <select
                value={timePref}
                onChange={(e) => onTimePrefChange(e.target.value as TimePref)}
                className="field-input w-full"
                aria-label={t.timePrefLabel}
                title={t.timePrefHint}
              >
                <option value="local" style={OPT_STYLE}>{t.timePrefLocal}</option>
                <option value="utc" style={OPT_STYLE}>{t.timePrefUtc}</option>
              </select>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{t.timePrefHint}</p>
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
                        {/* The pencil says "this one is editable" — the name button alone
                            read as "connect to this", so changing a saved broker had no
                            visible way in. */}
                        <button type="button" onClick={() => handleApplyProfile(p)} className="opacity-60 hover:opacity-100 p-0.5" style={{ color: 'var(--text-secondary)' }} title={fill(t.editProfile, { name: p.name })} aria-label={fill(t.editProfile, { name: p.name })}>
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button type="button" onClick={() => { onDeleteProfile(p.id); if (editingProfileId === p.id) { setEditingProfileId(null); setNewProfileName(''); } }} className="opacity-60 hover:opacity-100 p-0.5 ml-1" style={{ color: 'var(--bad)' }} title={t.deleteProfile} aria-label={t.deleteProfile}>
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
              <input type="text" value={form.host} required onChange={(e) => { setSelectedPreset('Custom'); setForm({ ...form, host: e.target.value }); setTestResult(null); }} className="field-input w-full font-mono" placeholder="192.168.1.100 or mqtt.example.com" aria-label={t.brokerHost} />
            </div>
            <div>
              <label className={LABEL} style={LABEL_COLOR}>{t.port}</label>
              <input type="number" value={form.port} required onChange={(e) => { setForm({ ...form, port: Math.min(65535, Math.max(1, parseInt(e.target.value) || 1883)) }); setTestResult(null); }} className="field-input w-full font-mono" placeholder="1883" aria-label={t.port} />
            </div>
          </div>

          {/* Transport: TCP vs WebSocket */}
          <div className="flex items-center justify-between inset-box px-3 py-2">
            <span className="text-xs font-medium flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
              <Activity className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} /><span>{t.transport}</span>
            </span>
            <div className="seg-box">
              <button
                type="button"
                onClick={() => setForm({ ...form, useWebsocket: false })}
                className="px-2.5 py-1 rounded text-[11px] transition"
                style={!form.useWebsocket ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', fontWeight: 600 } : { color: 'var(--text-secondary)' }}
              >
                {t.transportTcp}
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, useWebsocket: true })}
                className="px-2.5 py-1 rounded text-[11px] transition"
                style={form.useWebsocket ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', fontWeight: 600 } : { color: 'var(--text-secondary)' }}
              >
                {t.transportWs}
              </button>
            </div>
          </div>

          {/* Protocol Version & Clean Session */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dropqtt-protocol-version" className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" style={{ color: 'var(--violet)' }} /><span>{t.protocolVersion}</span></span>
              </label>
              <select
                id="dropqtt-protocol-version"
                value={form.protocolVersion ?? 3}
                onChange={(e) => { setForm({ ...form, protocolVersion: parseInt(e.target.value) }); setTestResult(null); }}
                className="field-input w-full"
              >
                <option value={3} style={OPT_STYLE}>{t.mqttV311}</option>
                <option value={5} style={OPT_STYLE}>{t.mqttV5}</option>
              </select>
            </div>
            <div className="inset-box flex items-center justify-between px-3">
              <div className="min-w-0 pr-2">
                <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t.cleanSession}</p>
                <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{t.cleanSessionDesc}</p>
              </div>
              <Toggle checked={form.cleanSession ?? true} onChange={(v) => setForm({ ...form, cleanSession: v })} onVar="var(--violet)" label={t.cleanSession} />
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
            <Toggle checked={form.useTls} onChange={(v) => { setForm({ ...form, useTls: v }); setTestResult(null); }} label={t.tls} />
          </div>

          {/* Advanced: Last Will & mTLS trust */}
          <div className="inset-box p-3.5 space-y-3">
            <div className="ui-label font-semibold">{t.advancedConn}</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={LABEL} style={LABEL_COLOR}>{t.willTopic}</label>
                <input type="text" value={form.willTopic || ''} onChange={(e) => setForm({ ...form, willTopic: e.target.value || undefined })} className="field-input w-full font-mono" placeholder="device/{id}/status" aria-label={t.willTopic} />
              </div>
              <div>
                <label className={LABEL} style={LABEL_COLOR}>{t.willPayload}</label>
                <input type="text" value={form.willPayload || ''} onChange={(e) => setForm({ ...form, willPayload: e.target.value || undefined })} className="field-input w-full font-mono" placeholder="offline" aria-label={t.willPayload} />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className={LABEL} style={LABEL_COLOR}>{t.willQos}</label>
                  <select value={form.willQos ?? 0} onChange={(e) => setForm({ ...form, willQos: Number(e.target.value) })} className="field-input w-full" aria-label={t.willQos}>
                    {[0, 1, 2].map((q) => (<option key={q} value={q} style={OPT_STYLE}>QoS {q}</option>))}
                  </select>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] pb-2 cursor-pointer shrink-0" style={{ color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={form.willRetain ?? false} onChange={(e) => setForm({ ...form, willRetain: e.target.checked })} className="rounded" style={{ accentColor: 'var(--accent)' }} />
                  {t.willRetain}
                </label>
              </div>
              {/* v5-only session/will properties. Left empty they stay off the wire,
                  which is what a v3.1.1-compatible CONNECT looks like. */}
              {form.protocolVersion === 5 && (
                <div className="col-span-2 grid grid-cols-3 gap-2">
                  <div>
                    <label htmlFor="dropqtt-session-expiry" className={LABEL} style={LABEL_COLOR} title={t.sessionExpiryHint}>
                      {t.sessionExpiry}
                    </label>
                    <input
                      id="dropqtt-session-expiry"
                      type="number" min={0} className="field-input w-full"
                      value={form.sessionExpirySecs ?? ''}
                      placeholder="—"
                      onChange={(e) => setForm({ ...form, sessionExpirySecs: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                    />
                  </div>
                  <div>
                    <label htmlFor="dropqtt-will-delay" className={LABEL} style={LABEL_COLOR}>{t.willDelay}</label>
                    <input
                      id="dropqtt-will-delay"
                      type="number" min={0} className="field-input w-full"
                      value={form.willDelaySecs ?? ''}
                      placeholder="—"
                      onChange={(e) => setForm({ ...form, willDelaySecs: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                    />
                  </div>
                  <div>
                    <label htmlFor="dropqtt-will-content-type" className={LABEL} style={LABEL_COLOR}>{t.willContentType}</label>
                    <input
                      id="dropqtt-will-content-type"
                      type="text" className="field-input w-full font-mono"
                      value={form.willContentType || ''}
                      placeholder="application/json"
                      onChange={(e) => setForm({ ...form, willContentType: e.target.value || undefined })}
                    />
                  </div>
                  <div>
                    <label htmlFor="dropqtt-will-expiry" className={LABEL} style={LABEL_COLOR}>{t.messageExpiryLabel}</label>
                    <input
                      id="dropqtt-will-expiry"
                      type="number" min={0} className="field-input w-full"
                      value={form.willMessageExpiry ?? ''}
                      placeholder="—"
                      onChange={(e) => setForm({ ...form, willMessageExpiry: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                    />
                  </div>
                  <div>
                    <label htmlFor="dropqtt-will-format" className={LABEL} style={LABEL_COLOR}>{t.payloadFormat}</label>
                    <select
                      id="dropqtt-will-format"
                      className="field-input w-full"
                      value={form.willPayloadFormat ?? ''}
                      onChange={(e) => setForm({ ...form, willPayloadFormat: e.target.value === '' ? undefined : Number(e.target.value) })}
                    >
                      <option value="">{t.payloadFormatUnset}</option>
                      <option value={1}>PFI · UTF-8</option>
                      <option value={0}>PFI · Bytes</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="dropqtt-will-response-topic" className={LABEL} style={LABEL_COLOR}>{t.responseTopicLabel}</label>
                    <input
                      id="dropqtt-will-response-topic"
                      type="text" className="field-input w-full font-mono"
                      value={form.willResponseTopic || ''}
                      placeholder="ops/alarm"
                      onChange={(e) => setForm({ ...form, willResponseTopic: e.target.value || undefined })}
                    />
                  </div>
                  <div>
                    <label htmlFor="dropqtt-will-correlation" className={LABEL} style={LABEL_COLOR}>{t.correlationDataLabel}</label>
                    <input
                      id="dropqtt-will-correlation"
                      type="text" className="field-input w-full font-mono"
                      value={form.willCorrelationData || ''}
                      placeholder="—"
                      onChange={(e) => setForm({ ...form, willCorrelationData: e.target.value || undefined })}
                    />
                  </div>
                </div>
              )}
            </div>
            {form.useTls && (
              <div className="grid grid-cols-1 gap-2 pt-2" style={{ borderTop: '1px solid var(--border-inset)' }}>
                <CertRow label={t.tlsCaCert} path={form.tlsCaPath} onPick={() => pickFile((p) => setForm({ ...form, tlsCaPath: p }))} onClear={() => setForm({ ...form, tlsCaPath: undefined })} browse={t.browse} clear={t.clear} />
                <CertRow label={t.clientCert} path={form.tlsClientCertPath} onPick={() => pickFile((p) => setForm({ ...form, tlsClientCertPath: p }))} onClear={() => setForm({ ...form, tlsClientCertPath: undefined })} browse={t.browse} clear={t.clear} />
                <CertRow label={t.clientKey} path={form.tlsClientKeyPath} onPick={() => pickFile((p) => setForm({ ...form, tlsClientKeyPath: p }))} onClear={() => setForm({ ...form, tlsClientKeyPath: undefined })} browse={t.browse} clear={t.clear} />
                <TlsMaterialPanel enabled={form.useTls} caPath={form.tlsCaPath} clientCertPath={form.tlsClientCertPath}
                  clientKeyPath={form.tlsClientKeyPath} hostname={form.host} t={t} />
              </div>
            )}
          </div>

          {/* Base Topic & Client ID */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Hash className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} /><span>{t.baseTopic}</span></span>
              </label>
              <input type="text" value={form.baseTopic || 'dropqtt'} onChange={(e) => setForm({ ...form, baseTopic: e.target.value.trim() || 'dropqtt' })} className="field-input w-full font-mono" placeholder="dropqtt" aria-label={t.baseTopic} />
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{t.baseTopicDesc}</p>
            </div>
            <div>
              <label className={LABEL} style={LABEL_COLOR}>{t.clientId}</label>
              <input type="text" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="field-input w-full font-mono" aria-label={t.clientId} />
            </div>
          </div>

          {/* Username & Password */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /><span>{t.username}</span></span>
              </label>
              <input type="text" value={form.username || ''} onChange={(e) => { setForm({ ...form, username: e.target.value || undefined }); setTestResult(null); }} className="field-input w-full" placeholder={t.brokerUserPh} aria-label={t.username} />
            </div>
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /><span>{t.password}</span></span>
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="password"
                  value={passwordDraft}
                  onChange={(e) => { setPasswordDraft(e.target.value); setTestResult(null); setSecretError(null); }}
                  className="field-input w-full"
                  placeholder={form.secretRef ? t.passwordKeptInKeyring : '••••••••'}
                  autoComplete="off"
                  aria-label={t.password}
                />
                {form.secretRef && (
                  <button
                    type="button"
                    onClick={checkStoredSecret}
                    className="btn-ghost !px-2 !py-1 text-[11px] shrink-0"
                    style={{ color: 'var(--text-muted)' }}
                    title={t.checkStoredPassword}
                    aria-label={t.checkStoredPassword}
                  >
                    {storedPresent === null ? t.check : t.checkAgain}
                  </button>
                )}
                {form.secretRef && (
                  <button
                    type="button"
                    onClick={() => void handleClearStoredPassword()}
                    className="btn-ghost !px-2 !py-1 text-[11px] shrink-0"
                    style={{ color: 'var(--bad)' }}
                    title={t.clearStoredPassword}
                    aria-label={t.clearStoredPassword}
                  >
                    {t.clear}
                  </button>
                )}
              </div>
              <p className="text-[10px] mt-1 flex items-start gap-1.5" style={{ color: credentialProblem || staleReference ? 'var(--bad)' : 'var(--text-muted)' }}>
                {credentialProblem || staleReference
                  ? <AlertCircle className="w-3 h-3 mt-px shrink-0" />
                  : <ShieldCheck className="w-3 h-3 mt-px shrink-0" />}
                <span>{credentialProblem ?? credentialNote}</span>
              </p>
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

          {/* Save / update the named profile. One box, and the buttons say which of the
              two they do — the old single "保存为常用预设" appended a duplicate every time
              someone fixed a port. */}
          <div className="inset-box p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editingProfile ? `${t.editingProfile} · ${editingProfile.name}` : t.newProfile}
              </span>
              {editingProfile && (
                <button
                  type="button"
                  onClick={() => { setEditingProfileId(null); setNewProfileName(''); }}
                  className="text-[10px] font-mono underline decoration-dotted"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t.saveAsNew}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder={t.profileName}
                aria-label={t.profileName}
                className="field-input flex-1"
              />
              <button type="button" onClick={handleSaveCurrentAsProfile} className="chip chip-indigo !px-3 !py-1.5 !text-xs transition shrink-0">
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>{editingProfile ? t.updateProfile : t.saveProfile}</span>
              </button>
            </div>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {editingProfile ? t.updateProfileHint : t.saveProfileHint}
            </p>
          </div>

          {/* QoS & KeepAlive */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className={LABEL} style={LABEL_COLOR}>
                <span className="flex items-center gap-1.5"><Sliders className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} /><span>{t.defaultQos}</span></span>
              </label>
              <select value={form.defaultQos} onChange={(e) => setForm({ ...form, defaultQos: parseInt(e.target.value) })} className="field-input w-full" aria-label={t.defaultQos}>
                <option value={0} style={OPT_STYLE}>{t.qos0Desc}</option>
                <option value={1} style={OPT_STYLE}>{t.qos1Desc}</option>
                <option value={2} style={OPT_STYLE}>{t.qos2Desc}</option>
              </select>
            </div>
            <div>
              <label className={LABEL} style={LABEL_COLOR}>{t.keepAlive}</label>
              <input type="number" value={form.keepAliveSecs} onChange={(e) => setForm({ ...form, keepAliveSecs: Math.min(600, Math.max(5, parseInt(e.target.value) || 60)) })} className="field-input w-full font-mono" aria-label={t.keepAlive} />
            </div>
          </div>

          {/* Auto Update */}
          <div className="inset-box p-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                <RefreshCw className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} /><span>{t.autoUpdate}</span>
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{updateStatusText || `${t.currentVersion}: v${__APP_VERSION__}`}</p>
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
