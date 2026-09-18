import React from 'react';
import { TransferProgress } from '../types';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Pause,
  Play,
  XCircle,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Clock,
} from 'lucide-react';

interface TransferItemProps {
  transfer: TransferProgress;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onReveal: (path: string) => void;
}

export const TransferItem: React.FC<TransferItemProps> = ({
  transfer,
  onPause,
  onResume,
  onCancel,
  onReveal,
}) => {
  const isSend = transfer.direction === 'send';
  const percent = transfer.totalBytes > 0
    ? Math.min(100, Math.round((transfer.bytesTransferred / transfer.totalBytes) * 100))
    : 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bps: number) => {
    if (bps <= 0) return '0 KB/s';
    if (bps > 1024 * 1024) {
      return (bps / (1024 * 1024)).toFixed(2) + ' MB/s';
    }
    return (bps / 1024).toFixed(1) + ' KB/s';
  };

  const calculateEta = () => {
    if (transfer.status === 'completed' || transfer.speedBps <= 0) return null;
    const remainingBytes = transfer.totalBytes - transfer.bytesTransferred;
    if (remainingBytes <= 0) return null;
    const seconds = Math.ceil(remainingBytes / transfer.speedBps);
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    return `${mins}m ${seconds % 60}s`;
  };

  const eta = calculateEta();

  return (
    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 transition-all shadow-md">
      {/* Top row: Name, Direction, Status */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              isSend ? 'bg-cyan-500/10 text-cyan-400' : 'bg-indigo-500/10 text-indigo-400'
            }`}
          >
            {isSend ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-semibold text-white truncate max-w-xs sm:max-w-md">
              {transfer.fileName}
            </h4>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>{formatBytes(transfer.bytesTransferred)} / {formatBytes(transfer.totalBytes)}</span>
              <span>•</span>
              <span className="font-mono">{transfer.chunksTransferred}/{transfer.totalChunks} chunks</span>
            </div>
          </div>
        </div>

        {/* Status Pill */}
        <div className="flex items-center gap-1.5 shrink-0">
          {transfer.status === 'completed' && (
            <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3" />
              Verified
            </span>
          )}
          {transfer.status === 'verifying' && (
            <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">
              <ShieldCheck className="w-3 h-3" />
              Verifying Hash
            </span>
          )}
          {transfer.status === 'transferring' && (
            <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
              {formatSpeed(transfer.speedBps)}
            </span>
          )}
          {transfer.status === 'paused' && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Paused
            </span>
          )}
          {transfer.status === 'failed' && (
            <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <AlertCircle className="w-3 h-3" />
              Failed
            </span>
          )}
          {transfer.status === 'cancelled' && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              Cancelled
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-800/80 rounded-full h-2 overflow-hidden my-2.5">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            transfer.status === 'completed'
              ? 'bg-emerald-400'
              : transfer.status === 'failed'
              ? 'bg-rose-500'
              : transfer.status === 'paused'
              ? 'bg-amber-400'
              : 'bg-gradient-to-r from-cyan-400 to-blue-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Bottom row: Percentage, ETA, Controls */}
      <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-200">{percent}%</span>
          {eta && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <Clock className="w-3 h-3 text-slate-500" />
              ETA: {eta}
            </span>
          )}
          {transfer.sha256 && (
            <span
              title={`SHA-256: ${transfer.sha256}`}
              className="text-[10px] font-mono text-slate-500 hidden sm:inline truncate max-w-[140px]"
            >
              #{transfer.sha256.slice(0, 10)}...
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {transfer.status === 'transferring' && isSend && (
            <button
              onClick={() => onPause(transfer.transferId)}
              title="Pause Transfer"
              className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition-colors"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}

          {transfer.status === 'paused' && isSend && (
            <button
              onClick={() => onResume(transfer.transferId)}
              title="Resume Transfer"
              className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}

          {(transfer.status === 'transferring' || transfer.status === 'paused') && (
            <button
              onClick={() => onCancel(transfer.transferId)}
              title="Cancel Transfer"
              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          )}

          {transfer.status === 'completed' && transfer.savePath && (
            <button
              onClick={() => onReveal(transfer.savePath!)}
              title="Open enclosing folder"
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-colors"
            >
              <FolderOpen className="w-3 h-3" />
              <span>Show in Folder</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
