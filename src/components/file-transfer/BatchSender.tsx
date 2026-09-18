import React, { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
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

export const BatchSender: React.FC<BatchSenderProps> = ({
  publishTopic,
  setPublishTopic,
  files,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
  onStartSendBatch,
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
      const selected = await open({
        multiple: true,
        directory: false,
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const newItems = paths.map((p) => {
          const name = p.split(/[\\/]/).pop() || 'file';
          return {
            path: p,
            name,
            size: 0, // In desktop app, rust gets exact size when hashing
          };
        });
        onAddFiles(newItems);
      }
    } catch (e) {
      console.error('File dialog error:', e);
    }
  };

  const totalSize = files.reduce((acc, curr) => acc + (curr.size || 0), 0);

  // Clean topic for preview
  const cleanPrefix = publishTopic.trim().replace(/\/\+$/, '').replace(/\/meta$/, '');

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded p-4 font-mono space-y-4">
      {/* 1. Explicit Publish Topic Configuration */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <label className="text-slate-300 font-semibold flex items-center space-x-1.5">
            <Send className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t.publishTopic}</span>
          </label>
          <span className="text-[10px] text-slate-500">{t.publishTopicHint}</span>
        </div>
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={publishTopic}
            onChange={(e) => setPublishTopic(e.target.value)}
            placeholder="dropqtt/public-lobby"
            className="flex-1 bg-slate-950 border border-slate-700/80 focus:border-cyan-500 rounded px-3 py-1.5 text-xs text-cyan-300 font-mono focus:outline-none transition"
          />
        </div>

        {/* Sub-topic Protocol Topology Preview */}
        <div className="bg-slate-950/60 rounded p-2 border border-slate-800/60 text-[11px] space-y-1">
          <div className="text-[10px] uppercase text-slate-500 font-semibold">{t.topicPreview}:</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px] text-slate-400">
            <div className="bg-slate-900/80 px-2 py-1 rounded border border-slate-800 truncate">
              <span className="text-cyan-400 font-semibold">{t.metaTopicPreview}:</span> {cleanPrefix}/meta
            </div>
            <div className="bg-slate-900/80 px-2 py-1 rounded border border-slate-800 truncate">
              <span className="text-cyan-400 font-semibold">{t.chunkTopicPreview}:</span> {cleanPrefix}/chunk/{'{id}'}/{'{idx}'}
            </div>
            <div className="bg-slate-900/80 px-2 py-1 rounded border border-slate-800 truncate">
              <span className="text-cyan-400 font-semibold">{t.ctrlTopicPreview}:</span> {cleanPrefix}/ctrl/{'{id}'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Multi-File Selection & Drag/Drop */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-300 font-semibold flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t.batchQueue} ({files.length})</span>
          </span>
          {files.length > 0 && !isSending && (
            <button
              onClick={onClearFiles}
              className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center space-x-1 transition"
            >
              <Trash2 className="w-3 h-3" />
              <span>{t.clearBatch}</span>
            </button>
          )}
        </div>

        {/* Dropzone / Select button */}
        <div
          onClick={handleSelectFiles}
          className="border-2 border-dashed rounded p-4 text-center cursor-pointer transition border-slate-700/80 hover:border-slate-600 bg-slate-950/40 hover:bg-slate-950/70"
        >
          <div className="flex flex-col items-center justify-center space-y-1.5 py-1">
            <Plus className="w-6 h-6 text-cyan-400" />
            <div className="text-xs text-slate-200 font-medium">
              {t.multiFileSelect}
            </div>
            <div className="text-[11px] text-slate-500">
              {t.dropHint}
            </div>
          </div>
        </div>

        {/* File Batch List Table */}
        {files.length > 0 && (
          <div className="bg-slate-950/70 border border-slate-800 rounded divide-y divide-slate-800/80 max-h-48 overflow-y-auto">
            {files.map((file, idx) => {
              const isCurrent = isSending && idx === sendingIndex;
              return (
                <div
                  key={file.id}
                  className={`flex items-center justify-between px-3 py-2 text-xs transition ${
                    isCurrent ? 'bg-cyan-950/30' : 'hover:bg-slate-900/40'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 truncate max-w-[75%]">
                    <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${isCurrent ? 'text-cyan-400 animate-pulse' : 'text-slate-400'}`} />
                    <div className="truncate">
                      <div className="text-slate-200 truncate font-medium">{file.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">{file.path}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      file.status === 'completed'
                        ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800'
                        : file.status === 'sending'
                        ? 'text-cyan-400 bg-cyan-950/40 border-cyan-800 animate-pulse'
                        : file.status === 'failed'
                        ? 'text-rose-400 bg-rose-950/40 border-rose-800'
                        : 'text-slate-400 bg-slate-900 border-slate-800'
                    }`}>
                      {file.status === 'completed' ? t.completed : file.status === 'sending' ? t.sending : t.pending}
                    </span>

                    {!isSending && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveFile(file.id);
                        }}
                        className="text-slate-500 hover:text-rose-400 transition"
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

      {/* 3. Transfer Configuration (Chunk Size & QoS) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <div className="space-y-1">
          <label className="text-[11px] text-slate-400 font-semibold">{t.packetChunkSize}</label>
          <select
            value={chunkSize}
            disabled={isSending}
            onChange={(e) => setChunkSize(Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            {CHUNK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-slate-900 text-slate-200">
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] text-slate-400 font-semibold">{t.qosLevel}</label>
          <select
            value={qos}
            disabled={isSending}
            onChange={(e) => setQos(Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value={0} className="bg-slate-900 text-slate-200">{t.qos0Desc}</option>
            <option value={1} className="bg-slate-900 text-slate-200">{t.qos1Desc}</option>
            <option value={2} className="bg-slate-900 text-slate-200">{t.qos2Desc}</option>
          </select>
        </div>
      </div>

      {/* 4. Action Bar */}
      <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
        <div className="text-[11px] text-slate-500">
          {files.length > 0 && (
            <span>
              {t.totalFiles.replace('{count}', String(files.length))} • {t.totalSize.replace('{size}', formatBytes(totalSize))}
            </span>
          )}
        </div>

        <button
          onClick={() => onStartSendBatch(chunkSize, qos)}
          disabled={!connected || files.length === 0 || isSending}
          className={`flex items-center space-x-2 px-5 py-2 rounded text-xs font-semibold tracking-wide transition border shadow-sm ${
            !connected || files.length === 0 || isSending
              ? 'bg-slate-800/60 text-slate-500 border-slate-700/50 cursor-not-allowed'
              : 'bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-400 hover:shadow-[0_0_12px_rgba(6,182,212,0.4)]'
          }`}
        >
          <Send className={`w-3.5 h-3.5 ${isSending ? 'animate-bounce' : ''}`} />
          <span>
            {isSending
              ? t.sendingBatch
                  .replace('{current}', String(sendingIndex + 1))
                  .replace('{total}', String(files.length))
              : t.sendBatch}
          </span>
        </button>
      </div>
    </div>
  );
};
