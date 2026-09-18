import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { DownloadCloud, Folder, CheckCircle, ShieldCheck, Radio } from 'lucide-react';
import { Translations } from '../i18n';

interface ReceiveCardProps {
  downloadDir: string;
  onChangeDownloadDir: (newDir: string) => void;
  channel: string;
  isConnected: boolean;
  t: Translations;
}

export const ReceiveCard: React.FC<ReceiveCardProps> = ({
  downloadDir,
  onChangeDownloadDir,
  channel,
  isConnected,
  t,
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
    <div className="rounded-2xl glass-card p-6 flex flex-col justify-between relative overflow-hidden shadow-xl">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <DownloadCloud className="w-4 h-4 text-indigo-400" />
            <span>{t.receiveTitle}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
            <Radio className={`w-3 h-3 ${isConnected ? 'animate-pulse text-indigo-400' : 'opacity-40'}`} />
            <span>{isConnected ? t.listening : t.offline}</span>
          </div>
        </div>

        {/* Download destination card */}
        <div className="p-4 rounded-xl bg-black/20 border border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs opacity-70 font-medium flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-indigo-400" />
              <span>{t.saveFolder}</span>
            </span>
            <button
              onClick={handlePickDirectory}
              className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline font-medium"
            >
              {t.browse}
            </button>
          </div>
          <p className="text-xs font-mono truncate bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/5">
            {downloadDir || 'Default System Downloads'}
          </p>
        </div>

        {/* Feature Highlights */}
        <div className="mt-4 space-y-2.5">
          <div className="flex items-start gap-2 text-xs opacity-90">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
            <span>
              {t.recvDesc1} (<strong className="font-mono text-cyan-300">#{channel}</strong>).
            </span>
          </div>
          <div className="flex items-start gap-2 text-xs opacity-90">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
            <span>{t.recvDesc2}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 p-3 rounded-xl bg-black/30 border border-white/5 text-[11px] opacity-75">
        {t.firewallTip}
      </div>
    </div>
  );
};
