import React, { useState } from 'react';
import { Inbox, Folder, RefreshCw, ShieldAlert } from 'lucide-react';
import { Translations } from '../../i18n';

interface ReceiverConfigProps {
  subscribeTopic: string;
  setSubscribeTopic: (topic: string) => void;
  onApplySubscribeTopic: (topic: string) => void;
  downloadDir: string;
  onSelectDownloadDir: () => void;
  connected: boolean;
  autoReceive: boolean;
  onToggleAutoReceive: (value: boolean) => void;
  t: Translations;
}

export const ReceiverConfig: React.FC<ReceiverConfigProps> = ({
  subscribeTopic,
  setSubscribeTopic,
  onApplySubscribeTopic,
  downloadDir,
  onSelectDownloadDir,
  connected,
  autoReceive,
  onToggleAutoReceive,
  t,
}) => {
  const [isApplying, setIsApplying] = useState(false);

  const handleApply = async () => {
    setIsApplying(true);
    try {
      await onApplySubscribeTopic(subscribeTopic);
    } finally {
      setTimeout(() => setIsApplying(false), 400);
    }
  };

  const cleanPrefix = subscribeTopic.trim().replace(/\/\#$/, '').replace(/\/\+$/, '');

  return (
    <div className="panel p-4 font-mono space-y-4">
      {/* 1. Explicit Subscribe Topic Configuration */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <label className="text-slate-300 font-semibold flex items-center space-x-1.5">
            <Inbox className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t.subscribeTopic}</span>
          </label>
          <div className="flex items-center space-x-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span className="text-[10px] text-slate-400">
              {connected ? t.listening : t.offline}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={subscribeTopic}
            onChange={(e) => setSubscribeTopic(e.target.value)}
            placeholder="dropqtt/public-lobby/#"
            className="field-input flex-1 text-emerald-300 focus:border-emerald-500"
          />
          <button
            onClick={handleApply}
            disabled={!connected || isApplying}
            className="btn-ghost px-3 py-1.5 flex items-center space-x-1"
          >
            <RefreshCw className={`w-3 h-3 ${isApplying ? 'animate-spin' : ''}`} />
            <span>{t.subscribe}</span>
          </button>
        </div>
        <div className="text-[10px] text-slate-500">{t.subscribeTopicHint}</div>

        {/* Sub-topic Protocol Topology Preview */}
        <div className="bg-slate-950/60 rounded p-2 border border-slate-800/60 text-[11px] space-y-1">
          <div className="text-[10px] uppercase text-slate-500 font-semibold">{t.topicPreview}:</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px] text-slate-400">
            <div className="bg-slate-900/80 px-2 py-1 rounded border border-slate-800 truncate">
              <span className="text-emerald-400 font-semibold">{t.metaTopicPreview}:</span> {cleanPrefix}/meta
            </div>
            <div className="bg-slate-900/80 px-2 py-1 rounded border border-slate-800 truncate">
              <span className="text-emerald-400 font-semibold">{t.chunkTopicPreview}:</span> {cleanPrefix}/chunk/#
            </div>
            <div className="bg-slate-900/80 px-2 py-1 rounded border border-slate-800 truncate">
              <span className="text-emerald-400 font-semibold">{t.ctrlTopicPreview}:</span> {cleanPrefix}/ctrl/#
            </div>
          </div>
        </div>
      </div>

      {/* 2. Auto-accept toggle */}
      <div className="inset-box p-3 flex items-center justify-between gap-3">
        <div className="flex items-start space-x-2 min-w-0">
          <ShieldAlert className={`w-4 h-4 mt-0.5 shrink-0 ${autoReceive ? 'text-amber-400' : 'text-fuchsia-400'}`} />
          <div>
            <div className="text-xs font-semibold text-slate-200">{t.autoAcceptFiles}</div>
            <div className="text-[10px] text-slate-500">{t.autoAcceptDesc}</div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoReceive}
          onClick={() => onToggleAutoReceive(!autoReceive)}
          className={`relative w-10 h-5 rounded-full border transition shrink-0 ${
            autoReceive ? 'bg-emerald-600/80 border-emerald-500' : 'bg-slate-800 border-slate-600'
          }`}
        >
          <span
            className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${
              autoReceive ? 'left-[calc(100%-1rem)]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {/* 3. Download Save Folder */}
      <div className="space-y-1.5 pt-1">
        <label className="text-[11px] text-slate-400 font-semibold flex items-center space-x-1">
          <Folder className="w-3 h-3 text-slate-400" />
          <span>{t.saveFolder}</span>
        </label>
        <div className="flex items-center space-x-2">
          <div className="flex-1 inset-box px-3 py-1.5 text-xs text-slate-300 truncate">
            {downloadDir || './downloads'}
          </div>
          <button
            onClick={onSelectDownloadDir}
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            {t.browse}
          </button>
        </div>
        <div className="text-[10px] text-slate-500">
          {t.recvDesc1} • {t.recvDesc2}
        </div>
      </div>
    </div>
  );
};
