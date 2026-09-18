import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { DownloadCloud, Folder, CheckCircle, ShieldCheck, Radio } from 'lucide-react';

interface ReceiveCardProps {
  downloadDir: string;
  onChangeDownloadDir: (newDir: string) => void;
  channel: string;
  isConnected: boolean;
}

export const ReceiveCard: React.FC<ReceiveCardProps> = ({
  downloadDir,
  onChangeDownloadDir,
  channel,
  isConnected,
}) => {
  const handlePickDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Choose DropQTT Download Directory',
      });
      if (selected && typeof selected === 'string') {
        onChangeDownloadDir(selected);
      }
    } catch (err) {
      console.error('Failed to change download directory:', err);
    }
  };

  return (
    <div className="rounded-2xl glass-card p-6 flex flex-col justify-between relative overflow-hidden border border-slate-700/60 shadow-xl">
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <DownloadCloud className="w-4 h-4 text-indigo-400" />
            <span>Automatic Receiver</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
            <Radio className={`w-3 h-3 ${isConnected ? 'animate-pulse text-indigo-400' : 'text-slate-500'}`} />
            <span>{isConnected ? 'Listening' : 'Offline'}</span>
          </div>
        </div>

        {/* Download destination card */}
        <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-indigo-400" />
              <span>Save Folder</span>
            </span>
            <button
              onClick={handlePickDirectory}
              className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline font-medium"
            >
              Browse
            </button>
          </div>
          <p className="text-xs font-mono text-slate-200 truncate bg-slate-900/60 px-2.5 py-1.5 rounded-lg border border-slate-700/40">
            {downloadDir || 'Default System Downloads'}
          </p>
        </div>

        {/* Feature Highlights */}
        <div className="mt-4 space-y-2.5">
          <div className="flex items-start gap-2 text-xs text-slate-300">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
            <span>
              Files broadcasted to channel <strong className="font-mono text-cyan-300">#{channel}</strong> stream directly into this directory.
            </span>
          </div>
          <div className="flex items-start gap-2 text-xs text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
            <span>
              End-to-end SHA-256 integrity check ensures bit-perfect reassembly without corrupted packets.
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 p-3 rounded-xl bg-slate-900/50 border border-slate-800 text-[11px] text-slate-400">
        💡 <strong className="text-slate-300">Tip:</strong> Both sender and receiver simply need to enter the same channel name and broker to exchange files anywhere behind restrictive firewalls.
      </div>
    </div>
  );
};
