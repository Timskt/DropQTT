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
    <div className="panel p-4 space-y-4">
      {/* 1. Subscribe Topic Configuration */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <label className="font-semibold flex items-center space-x-1.5" style={{ color: 'var(--text-primary)' }}>
            <Inbox className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} />
            <span>{t.subscribeTopic}</span>
          </label>
          <div className="flex items-center space-x-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: connected ? 'var(--ok)' : 'var(--text-muted)',
                boxShadow: connected ? '0 0 8px color-mix(in srgb, var(--ok) 60%, transparent)' : 'none',
              }}
            />
            <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
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
            className="field-input flex-1 font-mono"
            style={{ color: 'var(--ok)' }}
          />
          <button onClick={handleApply} disabled={!connected || isApplying} className="btn-ghost px-3 py-1.5 flex items-center space-x-1">
            <RefreshCw className={`w-3 h-3 ${isApplying ? 'animate-spin' : ''}`} />
            <span>{t.subscribe}</span>
          </button>
        </div>
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.subscribeTopicHint}</div>

        {/* Sub-topic Protocol Topology Preview */}
        <div className="inset-box p-2 text-[11px] space-y-1">
          <div className="ui-label font-semibold">{t.topicPreview}:</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            {[
              { label: t.metaTopicPreview, value: `${cleanPrefix}/meta` },
              { label: t.chunkTopicPreview, value: `${cleanPrefix}/chunk/#` },
              { label: t.ctrlTopicPreview, value: `${cleanPrefix}/ctrl/#` },
            ].map((row) => (
              <div key={row.label} className="inset-box px-2 py-1 truncate" style={{ background: 'var(--bg-panel)' }}>
                <span className="font-semibold" style={{ color: 'var(--ok)' }}>{row.label}:</span> {row.value}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Auto-accept toggle */}
      <div className="inset-box p-3 flex items-center justify-between gap-3">
        <div className="flex items-start space-x-2 min-w-0">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" style={{ color: autoReceive ? 'var(--warn)' : 'var(--fuchsia)' }} />
          <div>
            <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t.autoAcceptFiles}</div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.autoAcceptDesc}</div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoReceive}
          onClick={() => onToggleAutoReceive(!autoReceive)}
          className="relative w-10 h-5 rounded-full border transition shrink-0"
          style={{ background: autoReceive ? 'var(--ok)' : 'var(--bg-inset)', borderColor: autoReceive ? 'var(--ok)' : 'var(--border-inset)' }}
        >
          <span
            className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all"
            style={{ left: autoReceive ? 'calc(100% - 1rem)' : '0.125rem' }}
          />
        </button>
      </div>

      {/* 3. Download Save Folder */}
      <div className="space-y-1.5 pt-1">
        <label className="text-[11px] font-semibold flex items-center space-x-1" style={{ color: 'var(--text-secondary)' }}>
          <Folder className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
          <span>{t.saveFolder}</span>
        </label>
        <div className="flex items-center space-x-2">
          <div className="flex-1 inset-box px-3 py-1.5 text-xs truncate font-mono" style={{ color: 'var(--text-secondary)' }}>
            {downloadDir || './downloads'}
          </div>
          <button onClick={onSelectDownloadDir} className="btn-ghost px-3 py-1.5 text-xs">
            {t.browse}
          </button>
        </div>
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {t.recvDesc1} • {t.recvDesc2}
        </div>
      </div>
    </div>
  );
};
