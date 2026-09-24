import React, { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Send, Plus, Trash2, FileText, Layers } from 'lucide-react';
import { BatchFileItem } from '../../types';
import { Translations } from '../../i18n';

interface BatchSenderProps {
  publishTopic: string;
  setPublishTopic: (topic: string) => void;
  files: BatchFileItem[];
  onAddFiles: (files: { path: string; name: string; size: number }[]) => void;
  onRemoveFile: (id: string) => void;
  onClearFiles: () => void;
  onStartSendBatch: (chunkSize: number, qos: number) => void;
  onCancelBatch: () => void;
  isSending: boolean;
  sendingIndex: number;
  connected: boolean;
  t: Translations;
}

const CHUNK_OPTIONS = [
  { label: '64 KB (IoT / Restricted)', value: 64 * 1024 },
  { label: '256 KB (Recommended)', value: 256 * 1024 },
  { label: '512 KB (High Speed)', value: 512 * 1024 },
  { label: '1 MB (LAN / Fast)', value: 1024 * 1024 },
  { label: '2 MB (Maximum)', value: 2 * 1024 * 1024 },
];

const OPT_STYLE = { background: 'var(--bg-panel-solid)', color: 'var(--text-primary)' };

const statusChip = (status: string) =>
  status === 'completed' ? 'chip-ok' : status === 'sending' ? 'chip-info animate-pulse' : status === 'failed' ? 'chip-bad' : 'chip-neutral';

const statusLabel = (status: string, t: Translations) =>
  status === 'completed' ? t.completed : status === 'sending' ? t.sending : t.pending;

export const BatchSender: React.FC<BatchSenderProps> = ({
  publishTopic,
  setPublishTopic,
  files,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
  onStartSendBatch,
  onCancelBatch,
  isSending,
  sendingIndex,
  connected,
  t,
}) => {
  const [chunkSize, setChunkSize] = useState<number>(256 * 1024);
  const [qos, setQos] = useState<number>(1);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleSelectFiles = async () => {
    try {
      const selected = await open({ multiple: true, directory: false });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        // Resolve real file sizes so the batch total is accurate (was always 0).
        const newItems = await Promise.all(
          paths.map(async (p) => {
            let size = 0;
            try {
              size = await invoke<number>('file_size', { path: p });
            } catch {
              /* stat failed (e.g. browser dev) — leave 0 */
            }
            return { path: p, name: p.split(/[\\/]/).pop() || 'file', size };
          }),
        );
        onAddFiles(newItems);
      }
    } catch (e) {
      console.error('File dialog error:', e);
    }
  };

  const totalSize = files.reduce((acc, curr) => acc + (curr.size || 0), 0);
  const cleanPrefix = publishTopic.trim().replace(/\/\+$/, '').replace(/\/meta$/, '');

  return (
    <div className="panel p-4 space-y-4">
      {/* 1. Publish Topic Configuration */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <label className="font-semibold flex items-center space-x-1.5" style={{ color: 'var(--text-primary)' }}>
            <Send className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
            <span>{t.publishTopic}</span>
          </label>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.publishTopicHint}</span>
        </div>
        <input
          type="text"
          value={publishTopic}
          onChange={(e) => setPublishTopic(e.target.value)}
          placeholder="dropqtt/public-lobby"
          className="field-input w-full font-mono"
          style={{ color: 'var(--info)' }}
        />

        {/* Sub-topic Protocol Topology Preview */}
        <div className="inset-box p-2 text-[11px] space-y-1">
          <div className="ui-label font-semibold">{t.topicPreview}:</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            {[
              { label: t.metaTopicPreview, value: `${cleanPrefix}/meta` },
              { label: t.chunkTopicPreview, value: `${cleanPrefix}/chunk/{id}/{idx}` },
              { label: t.ctrlTopicPreview, value: `${cleanPrefix}/ctrl/{id}` },
            ].map((row) => (
              <div key={row.label} className="inset-box px-2 py-1 truncate" style={{ background: 'var(--bg-panel)' }}>
                <span className="font-semibold" style={{ color: 'var(--info)' }}>{row.label}:</span> {row.value}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Multi-File Selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold flex items-center space-x-1.5" style={{ color: 'var(--text-primary)' }}>
            <Layers className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
            <span>{t.batchQueue} ({files.length})</span>
          </span>
          {files.length > 0 && !isSending && (
            <button onClick={onClearFiles} className="text-[10px] flex items-center space-x-1 transition" style={{ color: 'var(--bad)' }}>
              <Trash2 className="w-3 h-3" />
              <span>{t.clearBatch}</span>
            </button>
          )}
        </div>

        {/* Dropzone / Select button */}
        <div
          onClick={handleSelectFiles}
          className="rounded-md border-2 border-dashed p-4 text-center cursor-pointer transition"
          style={{ borderColor: 'var(--border-inset)', background: 'var(--bg-inset)' }}
        >
          <div className="flex flex-col items-center justify-center space-y-1.5 py-1">
            <Plus className="w-6 h-6" style={{ color: 'var(--info)' }} />
            <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t.multiFileSelect}</div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t.dropHint}</div>
          </div>
        </div>

        {/* File Batch List */}
        {files.length > 0 && (
          <div className="inset-box divide-y max-h-48 overflow-y-auto" style={{ borderColor: 'var(--border-inset)' }}>
            {files.map((file, idx) => {
              const isCurrent = isSending && idx === sendingIndex;
              return (
                <div
                  key={file.id}
                  className="flex items-center justify-between px-3 py-2 text-xs transition"
                  style={isCurrent ? { background: 'var(--info-soft)' } : undefined}
                >
                  <div className="flex items-center space-x-2.5 truncate max-w-[75%]">
                    <FileText
                      className={`w-3.5 h-3.5 flex-shrink-0 ${isCurrent ? 'animate-pulse' : ''}`}
                      style={{ color: isCurrent ? 'var(--info)' : 'var(--text-muted)' }}
                    />
                    <div className="truncate">
                      <div className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>{file.name}</div>
                      <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{file.path}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <span className={`chip ${statusChip(file.status)}`}>{statusLabel(file.status, t)}</span>
                    {!isSending && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveFile(file.id); }}
                        className="transition"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--bad)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Transfer Configuration */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <div className="space-y-1">
          <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t.packetChunkSize}</label>
          <select value={chunkSize} disabled={isSending} onChange={(e) => setChunkSize(Number(e.target.value))} className="field-input w-full">
            {CHUNK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} style={OPT_STYLE}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t.qosLevel}</label>
          <select value={qos} disabled={isSending} onChange={(e) => setQos(Number(e.target.value))} className="field-input w-full">
            {[0, 1, 2].map((q) => (
              <option key={q} value={q} style={OPT_STYLE}>{q === 0 ? t.qos0Desc : q === 1 ? t.qos1Desc : t.qos2Desc}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 4. Action Bar */}
      <div className="pt-2 flex items-center justify-between" style={{ borderTop: '1px solid var(--border-inset)' }}>
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {files.length > 0 && (
            <span>
              {t.totalFiles.replace('{count}', String(files.length))} • {t.totalSize.replace('{size}', formatBytes(totalSize))}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {isSending && (
            <button
              onClick={onCancelBatch}
              className="flex items-center space-x-1.5 px-3 py-2 rounded text-xs font-semibold border transition"
              style={{ background: 'var(--bad-soft)', borderColor: 'var(--bad-border)', color: 'var(--bad)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t.cancelBatch}</span>
            </button>
          )}
          <button
            onClick={() => onStartSendBatch(chunkSize, qos)}
            disabled={!connected || files.length === 0 || isSending}
            className="btn-accent flex items-center space-x-2 !px-5"
          >
            <Send className={`w-3.5 h-3.5 ${isSending ? 'animate-bounce' : ''}`} />
            <span>
              {isSending
                ? t.sendingBatch.replace('{current}', String(sendingIndex + 1)).replace('{total}', String(files.length))
                : t.sendBatch}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
