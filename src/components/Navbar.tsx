import React, { useState } from 'react';
import { DropQTTLogo } from './DropQTTLogo';
import { ConnectionStatus } from '../types';
import { Settings, Wifi, WifiOff, Hash, Copy, Check } from 'lucide-react';

interface NavbarProps {
  status: ConnectionStatus;
  onOpenSettings: () => void;
  onChannelChange: (newChannel: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ status, onOpenSettings, onChannelChange }) => {
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
    <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md select-none">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <DropQTTLogo size={36} />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
              DropQTT
            </h1>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              v0.1.0
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Fast, Resilient File Transfer over MQTT</p>
        </div>
      </div>

      {/* Room / Channel Selector */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-700/60">
          <Hash className="w-3.5 h-3.5 text-cyan-400" />
          {editingChannel ? (
            <form onSubmit={handleChannelSubmit} className="flex items-center gap-1.5">
              <input
                type="text"
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
                placeholder="Channel Name"
                className="bg-transparent text-xs text-slate-200 outline-none w-28 font-mono"
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
              className="text-xs font-mono text-slate-300 hover:text-cyan-300 cursor-pointer transition-colors max-w-[140px] truncate"
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
              <span>{status.brokerHost || 'Connected'}</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5" />
              <span>Disconnected</span>
            </>
          )}
        </div>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          title="MQTT Broker Settings"
          className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-slate-300 hover:text-white transition-all shadow-sm"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
