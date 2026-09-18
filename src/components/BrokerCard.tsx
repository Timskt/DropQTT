import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BrokerConfig, ConnectionStatus, BrokerProfile } from '../types';
import { Translations } from '../i18n';
import { Server, Shield, Key, Wifi, WifiOff, Zap, Sliders, Check, AlertCircle } from 'lucide-react';

interface BrokerCardProps {
  status: ConnectionStatus;
  config: BrokerConfig;
  onOpenSettings: () => void;
  onQuickSwitch: (config: BrokerConfig) => void;
  profiles: BrokerProfile[];
  t: Translations;
}

export const BrokerCard: React.FC<BrokerCardProps> = ({
  status,
  config,
  onOpenSettings,
  onQuickSwitch,
  profiles,
  t,
}) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ latency?: number; error?: string } | null>(null);

  const handleTestLatency = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const latency = await invoke<number>('test_broker_connection', { config });
      setTestResult({ latency });
    } catch (err) {
      setTestResult({ error: String(err) });
    } finally {
      setTesting(false);
      setTimeout(() => {
        setTestResult(null);
      }, 5000);
    }
  };

  return (
    <div className="rounded-2xl glass-card p-4 sm:p-5 shadow-lg border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
      {/* Left: Broker Info */}
      <div className="flex items-start sm:items-center gap-3.5">
        <div className={`p-2.5 rounded-xl border ${
          status.connected
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-slate-800 border-white/10 text-slate-400'
        }`}>
          <Server className="w-5 h-5" />
        </div>

        <div className="space-y-1">
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider opacity-60">
              {t.activeBroker}
            </span>
            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium border ${
              status.connected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}>
              {status.connected ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <Wifi className="w-3 h-3" />
                  <span>{t.connected}</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                  <WifiOff className="w-3 h-3" />
                  <span>{t.disconnected}</span>
                </>
              )}
            </div>

            {testResult?.latency !== undefined && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 animate-in fade-in">
                <Check className="w-3 h-3" />
                <span>{testResult.latency} ms</span>
              </span>
            )}

            {testResult?.error && (
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1 animate-in fade-in" title={testResult.error}>
                <AlertCircle className="w-3 h-3" />
                <span>{t.connectionFailed}</span>
              </span>
            )}
          </div>

          <div className="flex items-center flex-wrap gap-2 text-sm">
            <span className="font-mono font-bold text-cyan-300">
              {config.host}:{config.port}
            </span>

            <span className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-slate-300 flex items-center gap-1">
              <Shield className="w-3 h-3 text-cyan-400" />
              <span>{config.useTls ? 'TLS' : 'TCP'}</span>
            </span>

            {config.username ? (
              <span className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-slate-300 flex items-center gap-1" title="Authenticated">
                <Key className="w-3 h-3 text-amber-400" />
                <span>{config.username}</span>
              </span>
            ) : null}

            <span className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-slate-400">
              Topic: {config.baseTopic || 'dropqtt'}/{status.channel || 'lobby'}
            </span>
          </div>
        </div>
      </div>

      {/* Right: Quick Actions & Profile Dropdown */}
      <div className="flex items-center flex-wrap gap-2.5 pt-2 md:pt-0 border-t md:border-t-0 border-white/10">
        {profiles.length > 0 && (
          <select
            onChange={(e) => {
              const p = profiles.find((prof) => prof.id === e.target.value);
              if (p) onQuickSwitch(p.config);
            }}
            value=""
            className="px-2.5 py-1.5 text-xs rounded-lg glass-input bg-black/40 text-slate-200 border border-white/10 cursor-pointer"
          >
            <option value="" disabled>{t.brokerProfiles}...</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                {p.name} ({p.config.host}:{p.config.port})
              </option>
            ))}
          </select>
        )}

        <button
          onClick={handleTestLatency}
          disabled={testing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all disabled:opacity-50"
          title={t.testConnection}
        >
          <Zap className={`w-3.5 h-3.5 text-amber-400 ${testing ? 'animate-spin' : ''}`} />
          <span>{testing ? t.testingConnection : t.testLatency}</span>
        </button>

        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 transition-all active:scale-98 shadow-sm"
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>{t.manageBrokers}</span>
        </button>
      </div>
    </div>
  );
};
