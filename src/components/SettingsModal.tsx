import React, { useState } from 'react';
import { BrokerConfig, BROKER_PRESETS } from '../types';
import { X, Server, Shield, Key, Sliders, CheckCircle2 } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: BrokerConfig;
  onSaveAndConnect: (config: BrokerConfig) => void;
  onDisconnect: () => void;
  isConnected: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveAndConnect,
  onDisconnect,
  isConnected,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2 text-slate-200 font-semibold">
            <Server className="w-5 h-5 text-cyan-400" />
            <span>MQTT Broker Configuration</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Quick Presets */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Broker Presets
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
                      : 'bg-slate-800/50 border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:text-white'
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
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Broker Host / IP</label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => {
                  setSelectedPreset('Custom');
                  setForm({ ...form, host: e.target.value });
                }}
                required
                className="w-full px-3 py-2 text-sm rounded-lg glass-input text-white font-mono"
                placeholder="broker.emqx.io"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Port</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 1883 })}
                required
                className="w-full px-3 py-2 text-sm rounded-lg glass-input text-white font-mono"
                placeholder="1883"
              />
            </div>
          </div>

          {/* TLS Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
            <div className="flex items-center gap-2.5">
              <Shield className="w-4 h-4 text-cyan-400" />
              <div>
                <p className="text-xs font-medium text-slate-200">TLS / SSL Encryption</p>
                <p className="text-[11px] text-slate-400">Secure connection (e.g. port 8883)</p>
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
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Client Identifier</label>
            <input
              type="text"
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg glass-input text-white font-mono"
              placeholder="DropQTT_Client"
            />
          </div>

          {/* Username & Password */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-slate-400" />
                <span>Username (Optional)</span>
              </label>
              <input
                type="text"
                value={form.username || ''}
                onChange={(e) => setForm({ ...form, username: e.target.value || undefined })}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input text-white"
                placeholder="User"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-slate-400" />
                <span>Password (Optional)</span>
              </label>
              <input
                type="password"
                value={form.password || ''}
                onChange={(e) => setForm({ ...form, password: e.target.value || undefined })}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input text-white"
                placeholder="••••••"
              />
            </div>
          </div>

          {/* QoS & KeepAlive */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>Default QoS</span>
              </label>
              <select
                value={form.defaultQos}
                onChange={(e) => setForm({ ...form, defaultQos: parseInt(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input text-white bg-slate-800"
              >
                <option value={0}>QoS 0 - At most once (Fastest)</option>
                <option value={1}>QoS 1 - At least once (Recommended)</option>
                <option value={2}>QoS 2 - Exactly once (Strict)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Keep Alive (Seconds)</label>
              <input
                type="number"
                value={form.keepAliveSecs}
                onChange={(e) => setForm({ ...form, keepAliveSecs: parseInt(e.target.value) || 60 })}
                className="w-full px-3 py-2 text-sm rounded-lg glass-input text-white font-mono"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            {isConnected ? (
              <button
                type="button"
                onClick={() => {
                  onDisconnect();
                  onClose();
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold shadow-lg shadow-cyan-500/20 transition-all active:scale-98"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Connect & Save</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
