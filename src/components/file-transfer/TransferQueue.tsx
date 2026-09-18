import React from 'react';
import { Layers, ArrowUpRight, ArrowDownRight, Pause, Play, X, FolderOpen, ShieldCheck } from 'lucide-react';
import { TransferProgress } from '../../types';
import { Translations } from '../../i18n';

interface TransferQueueProps {
  transfers: Record<string, TransferProgress>;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onReveal: (path: string) => void;
  t: Translations;
}

export const TransferQueue: React.FC<TransferQueueProps> = ({
  transfers,
  onPause,
  onResume,
  onCancel,
  onReveal,
  t,
}) => {
  const items = Object.values(transfers).reverse();

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bps: number) => {
    if (!bps || bps <= 0) return '0 B/s';
    return `${formatBytes(bps)}/s`;
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded font-mono overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          <span>{t.transfersQueue} ({items.length})</span>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-xs">
          <div className="text-slate-400 font-medium mb-1">{t.noTransfers}</div>
          <div className="text-[11px] text-slate-600">{t.noTransfersDesc}</div>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/80 max-h-[380px] overflow-y-auto">
          {items.map((item) => {
            const percent = item.totalBytes > 0
              ? Math.min(100, Math.round((item.bytesTransferred / item.totalBytes) * 100))
              : 0;
            const isSend = item.direction === 'send';

            return (
              <div key={item.transferId} className="p-3 hover:bg-slate-950/40 transition space-y-2">
                {/* Header row */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2 truncate max-w-[70%]">
                    <span
                      className={`inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        isSend
                          ? 'bg-cyan-950/60 text-cyan-300 border-cyan-800/80'
                          : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80'
                      }`}
                    >
                      {isSend ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      <span>{isSend ? 'SEND' : 'RECV'}</span>
                    </span>

                    <span className="font-semibold text-slate-200 truncate" title={item.fileName}>
                      {item.fileName}
                    </span>

                    <span className="text-[10px] text-slate-500 truncate max-w-[160px]">
                      [{item.channel}]
                    </span>
                  </div>

                  {/* Actions & Status */}
                  <div className="flex items-center space-x-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        item.status === 'completed'
                          ? 'text-emerald-400 bg-emerald-950/30 border-emerald-800'
                          : item.status === 'verifying'
                          ? 'text-amber-400 bg-amber-950/30 border-amber-800 animate-pulse'
                          : item.status === 'paused'
                          ? 'text-amber-400 bg-amber-950/30 border-amber-800'
                          : item.status === 'failed'
                          ? 'text-rose-400 bg-rose-950/30 border-rose-800'
                          : 'text-cyan-400 bg-cyan-950/30 border-cyan-800'
                      }`}
                    >
                      {item.status === 'completed'
                        ? t.verified
                        : item.status === 'verifying'
                        ? t.verifying
                        : item.status === 'paused'
                        ? t.paused
                        : item.status === 'failed'
                        ? t.failed
                        : item.status === 'cancelled'
                        ? t.cancelled
                        : `${percent}%`}
                    </span>

                    {/* Controls */}
                    {isSend && item.status === 'transferring' && (
                      <button
                        onClick={() => onPause(item.transferId)}
                        title={t.pause}
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition"
                      >
                        <Pause className="w-3 h-3" />
                      </button>
                    )}
                    {isSend && item.status === 'paused' && (
                      <button
                        onClick={() => onResume(item.transferId)}
                        title={t.resume}
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-cyan-400 transition"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    )}
                    {(item.status === 'transferring' || item.status === 'paused') && (
                      <button
                        onClick={() => onCancel(item.transferId)}
                        title={t.cancel}
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {item.savePath && item.status === 'completed' && (
                      <button
                        onClick={() => onReveal(item.savePath!)}
                        title={t.showInFolder}
                        className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-400 transition"
                      >
                        <FolderOpen className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-200 ${
                      item.status === 'completed'
                        ? 'bg-emerald-400'
                        : item.status === 'failed'
                        ? 'bg-rose-500'
                        : isSend
                        ? 'bg-cyan-400'
                        : 'bg-emerald-400'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                {/* Metrics Row */}
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <div className="flex items-center space-x-3">
                    <span>
                      {formatBytes(item.bytesTransferred)} / {formatBytes(item.totalBytes)}
                    </span>
                    <span>•</span>
                    <span>
                      {t.chunks}: {item.chunksTransferred}/{item.totalChunks}
                    </span>
                    {item.status === 'transferring' && (
                      <>
                        <span>•</span>
                        <span className="text-cyan-300 font-semibold">{formatSpeed(item.speedBps)}</span>
                      </>
                    )}
                  </div>

                  {item.sha256 && (
                    <div className="flex items-center space-x-1 text-[10px] text-slate-500 truncate max-w-[200px]" title={item.sha256}>
                      <ShieldCheck className="w-3 h-3 text-slate-400 flex-shrink-0" />
                      <span className="truncate">SHA: {item.sha256.substring(0, 16)}...</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
