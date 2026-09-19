import React, { useMemo } from 'react';
import {
  Layers, ArrowUpRight, ArrowDownRight, Pause, Play, X, FolderOpen,
  ShieldCheck, Check, Trash2, AlertTriangle,
} from 'lucide-react';
import { TransferProgress, TransferStatus } from '../../types';
import { Translations } from '../../i18n';

interface TransferQueueProps {
  transfers: Record<string, TransferProgress>;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onReveal: (path: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onClearFinished: () => void;
  t: Translations;
}

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

const statusBadge = (status: TransferStatus): string => {
  switch (status) {
    case 'completed':
    case 'delivered':
      return 'text-emerald-400 bg-emerald-950/30 border-emerald-800';
    case 'verifying':
      return 'text-amber-400 bg-amber-950/30 border-amber-800 animate-pulse';
    case 'awaiting_approval':
      return 'text-fuchsia-400 bg-fuchsia-950/30 border-fuchsia-800 animate-pulse';
    case 'paused':
      return 'text-amber-400 bg-amber-950/30 border-amber-800';
    case 'sent':
      return 'text-sky-400 bg-sky-950/30 border-sky-800';
    case 'failed':
      return 'text-rose-400 bg-rose-950/30 border-rose-800';
    case 'cancelled':
      return 'text-slate-400 bg-slate-800/50 border-slate-700';
    default:
      return 'text-cyan-400 bg-cyan-950/30 border-cyan-800';
  }
};

const TransferRow = React.memo(function TransferRow({
  item,
  t,
  onPause,
  onResume,
  onCancel,
  onReveal,
  onApprove,
  onReject,
}: {
  item: TransferProgress;
  t: Translations;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onReveal: (path: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const percent =
    item.totalBytes > 0
      ? Math.min(100, Math.round((item.bytesTransferred / item.totalBytes) * 100))
      : item.status === 'completed' || item.status === 'delivered' || item.status === 'sent'
        ? 100
        : 0;
  const isSend = item.direction === 'send';
  const active = item.status === 'transferring' || item.status === 'paused';

  const statusLabel = (() => {
    switch (item.status) {
      case 'completed':
      case 'delivered':
        return t.verified;
      case 'verifying':
        return t.verifying;
      case 'awaiting_approval':
        return t.awaitingApproval;
      case 'paused':
        return t.paused;
      case 'failed':
        return t.failed;
      case 'cancelled':
        return t.cancelled;
      case 'sent':
        return t.sent;
      default:
        return `${percent}%`;
    }
  })();

  return (
    <div className={`p-3 space-y-2 transition ${item.status === 'awaiting_approval' ? 'bg-fuchsia-950/20' : 'hover:bg-slate-950/40'}`}>
      {/* Header row */}
      <div className="flex items-center justify-between text-xs gap-2">
        <div className="flex items-center space-x-2 truncate min-w-0">
          <span
            className={`inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${
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

          <span className="text-[10px] text-slate-500 truncate max-w-[160px]">[{item.channel}]</span>
        </div>

        {/* Actions & Status */}
        <div className="flex items-center space-x-2 shrink-0">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusBadge(item.status)}`}>
            {statusLabel}
          </span>

          {/* Receive approval */}
          {item.status === 'awaiting_approval' && (
            <>
              <button
                onClick={() => onApprove(item.transferId)}
                title={t.approve}
                className="px-2 py-1 rounded text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center space-x-1 transition"
              >
                <Check className="w-3 h-3" />
                <span>{t.approve}</span>
              </button>
              <button
                onClick={() => onReject(item.transferId)}
                title={t.reject}
                className="px-2 py-1 rounded text-[10px] font-semibold bg-rose-700/80 hover:bg-rose-600 text-white flex items-center space-x-1 transition"
              >
                <X className="w-3 h-3" />
                <span>{t.reject}</span>
              </button>
            </>
          )}

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
          {active && (
            <button
              onClick={() => onCancel(item.transferId)}
              title={t.cancel}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          {item.savePath && (item.status === 'completed' || item.status === 'awaiting_approval') && (
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

      {item.status === 'failed' && item.errorMessage && (
        <div className="flex items-start space-x-1.5 text-[10px] text-rose-400/90 bg-rose-950/20 border border-rose-900/50 rounded px-2 py-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="break-all">{item.errorMessage}</span>
        </div>
      )}

      {/* Progress bar */}
      <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
        <div
          className={`h-full transition-all duration-200 ${
            item.status === 'completed' || item.status === 'delivered'
              ? 'bg-emerald-400'
              : item.status === 'failed'
                ? 'bg-rose-500'
                : item.status === 'awaiting_approval'
                  ? 'bg-fuchsia-400'
                  : item.status === 'sent'
                    ? 'bg-sky-400'
                    : isSend
                      ? 'bg-cyan-400'
                      : 'bg-emerald-400'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Metrics row */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 gap-2">
        <div className="flex items-center space-x-3 min-w-0">
          <span className="shrink-0">
            {formatBytes(item.bytesTransferred)} / {formatBytes(item.totalBytes)}
          </span>
          <span>•</span>
          <span className="shrink-0">
            {t.chunks}: {item.chunksTransferred}/{item.totalChunks}
          </span>
          {item.status === 'transferring' && (
            <>
              <span>•</span>
              <span className="text-cyan-300 font-semibold shrink-0">{formatSpeed(item.speedBps)}</span>
            </>
          )}
        </div>

        {item.sha256 && (
          <div
            className="flex items-center space-x-1 text-[10px] text-slate-500 truncate max-w-[200px]"
            title={item.sha256}
          >
            <ShieldCheck className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span className="truncate">SHA: {item.sha256.substring(0, 16)}...</span>
          </div>
        )}
      </div>
    </div>
  );
});

export const TransferQueue: React.FC<TransferQueueProps> = ({
  transfers,
  onPause,
  onResume,
  onCancel,
  onReveal,
  onApprove,
  onReject,
  onClearFinished,
  t,
}) => {
  const items = useMemo(() => Object.values(transfers).reverse(), [transfers]);
  const finishedCount = items.filter(
    (i) => i.status === 'completed' || i.status === 'failed' || i.status === 'cancelled' || i.status === 'delivered',
  ).length;

  return (
    <div className="panel overflow-hidden font-mono">
      <div className="panel-header px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          <span>
            {t.transfersQueue} ({items.length})
          </span>
        </div>
        {finishedCount > 0 && (
          <button
            onClick={onClearFinished}
            title={t.clearFinished}
            className="btn-ghost px-2 py-1 text-[10px] flex items-center space-x-1"
          >
            <Trash2 className="w-3 h-3" />
            <span>{t.clearFinished}</span>
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-xs">
          <div className="text-slate-400 font-medium mb-1">{t.noTransfers}</div>
          <div className="text-[11px] text-slate-600">{t.noTransfersDesc}</div>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/80 max-h-[380px] overflow-y-auto">
          {items.map((item) => (
            <TransferRow
              key={item.transferId}
              item={item}
              t={t}
              onPause={onPause}
              onResume={onResume}
              onCancel={onCancel}
              onReveal={onReveal}
              onApprove={onApprove}
              onReject={onReject}
            />
          ))}
        </div>
      )}
    </div>
  );
};
