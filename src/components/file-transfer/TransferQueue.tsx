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

const statusChip = (status: TransferStatus): string => {
  switch (status) {
    case 'completed':
    case 'delivered':
      return 'chip-ok';
    case 'verifying':
    case 'paused':
      return 'chip-warn';
    case 'awaiting_approval':
      return 'chip-fuchsia animate-pulse';
    case 'sent':
      return 'chip-sky';
    case 'failed':
      return 'chip-bad';
    case 'cancelled':
      return 'chip-neutral';
    default:
      return 'chip-info';
  }
};

/** Progress-fill + direction-accent CSS var per status */
const statusVar = (status: TransferStatus, isSend: boolean): string => {
  switch (status) {
    case 'completed':
    case 'delivered':
      return 'var(--ok)';
    case 'verifying':
    case 'paused':
      return 'var(--warn)';
    case 'awaiting_approval':
      return 'var(--fuchsia)';
    case 'sent':
      return 'var(--sky)';
    case 'failed':
      return 'var(--bad)';
    case 'cancelled':
      return 'var(--text-muted)';
    default:
      return isSend ? 'var(--info)' : 'var(--ok)';
  }
};

/** Small icon action button with a hover tint driven by a token */
const IconAction: React.FC<{ title: string; hoverVar: string; onClick: () => void; children: React.ReactNode }> = ({
  title, hoverVar, onClick, children,
}) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className="p-1 rounded transition"
    style={{ color: 'var(--text-muted)' }}
    onMouseEnter={(e) => (e.currentTarget.style.color = hoverVar)}
    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
  >
    {children}
  </button>
);

const TransferRow = React.memo(function TransferRow({
  item, t, onPause, onResume, onCancel, onReveal, onApprove, onReject,
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
  const fill = statusVar(item.status, isSend);

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
    <div className="p-3 space-y-2 transition" style={item.status === 'awaiting_approval' ? { background: 'var(--fuchsia-soft)' } : undefined}>
      {/* Header row */}
      <div className="flex items-center justify-between text-xs gap-2">
        <div className="flex items-center space-x-2 truncate min-w-0">
          <span className={`chip ${isSend ? 'chip-info' : 'chip-ok'}`}>
            {isSend ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            <span>{isSend ? 'SEND' : 'RECV'}</span>
          </span>
          <span className="font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={item.fileName}>
            {item.fileName}
          </span>
          <span className="text-[10px] truncate max-w-[160px]" style={{ color: 'var(--text-muted)' }}>[{item.channel}]</span>
        </div>

        {/* Actions & Status */}
        <div className="flex items-center space-x-2 shrink-0">
          <span className={`chip ${statusChip(item.status)}`}>{statusLabel}</span>

          {item.status === 'awaiting_approval' && (
            <>
              <button
                onClick={() => onApprove(item.transferId)}
                title={t.approve}
                className="px-2 py-1 rounded text-[10px] font-semibold flex items-center space-x-1 transition"
                style={{ background: 'var(--ok)', color: '#fff' }}
              >
                <Check className="w-3 h-3" />
                <span>{t.approve}</span>
              </button>
              <button
                onClick={() => onReject(item.transferId)}
                title={t.reject}
                className="px-2 py-1 rounded text-[10px] font-semibold flex items-center space-x-1 transition"
                style={{ background: 'var(--bad)', color: '#fff' }}
              >
                <X className="w-3 h-3" />
                <span>{t.reject}</span>
              </button>
            </>
          )}

          {isSend && item.status === 'transferring' && (
            <IconAction title={t.pause} hoverVar="var(--warn)" onClick={() => onPause(item.transferId)}>
              <Pause className="w-3 h-3" />
            </IconAction>
          )}
          {isSend && item.status === 'paused' && (
            <IconAction title={t.resume} hoverVar="var(--info)" onClick={() => onResume(item.transferId)}>
              <Play className="w-3 h-3" />
            </IconAction>
          )}
          {active && (
            <IconAction title={t.cancel} hoverVar="var(--bad)" onClick={() => onCancel(item.transferId)}>
              <X className="w-3 h-3" />
            </IconAction>
          )}
          {item.savePath && (item.status === 'completed' || item.status === 'awaiting_approval') && (
            <IconAction title={t.showInFolder} hoverVar="var(--ok)" onClick={() => onReveal(item.savePath!)}>
              <FolderOpen className="w-3 h-3" />
            </IconAction>
          )}
        </div>
      </div>

      {item.status === 'failed' && item.errorMessage && (
        <div className="flex items-start space-x-1.5 text-[10px] rounded px-2 py-1" style={{ color: 'var(--bad)', background: 'var(--bad-soft)', border: '1px solid var(--bad-border)' }}>
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="break-all">{item.errorMessage}</span>
        </div>
      )}

      {/* Progress bar */}
      <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-inset)' }}>
        <div className="h-full transition-all duration-200" style={{ width: `${percent}%`, background: fill }} />
      </div>

      {/* Metrics row */}
      <div className="flex items-center justify-between text-[11px] gap-2" style={{ color: 'var(--text-secondary)' }}>
        <div className="flex items-center space-x-3 min-w-0">
          <span className="shrink-0">{formatBytes(item.bytesTransferred)} / {formatBytes(item.totalBytes)}</span>
          <span>•</span>
          <span className="shrink-0">{t.chunks}: {item.chunksTransferred}/{item.totalChunks}</span>
          {item.status === 'transferring' && (
            <>
              <span>•</span>
              <span className="font-semibold shrink-0" style={{ color: 'var(--info)' }}>{formatSpeed(item.speedBps)}</span>
            </>
          )}
        </div>

        {item.sha256 && (
          <div className="flex items-center space-x-1 text-[10px] truncate max-w-[200px]" style={{ color: 'var(--text-muted)' }} title={item.sha256}>
            <ShieldCheck className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            <span className="truncate">SHA: {item.sha256.substring(0, 16)}...</span>
          </div>
        )}
      </div>
    </div>
  );
});

export const TransferQueue: React.FC<TransferQueueProps> = ({
  transfers, onPause, onResume, onCancel, onReveal, onApprove, onReject, onClearFinished, t,
}) => {
  const items = useMemo(() => Object.values(transfers).reverse(), [transfers]);
  const finishedCount = items.filter(
    (i) => i.status === 'completed' || i.status === 'failed' || i.status === 'cancelled' || i.status === 'delivered',
  ).length;

  return (
    <div className="panel overflow-hidden">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Layers className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
          <span>{t.transfersQueue} ({items.length})</span>
        </div>
        {finishedCount > 0 && (
          <button onClick={onClearFinished} title={t.clearFinished} className="btn-ghost px-2 py-1 text-[10px] flex items-center space-x-1">
            <Trash2 className="w-3 h-3" />
            <span>{t.clearFinished}</span>
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="p-8 text-center text-xs">
          <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{t.noTransfers}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t.noTransfersDesc}</div>
        </div>
      ) : (
        <div className="max-h-[380px] overflow-y-auto">
          {items.map((item, idx) => (
            <div key={item.transferId} style={idx > 0 ? { borderTop: '1px solid var(--border-inset)' } : undefined}>
              <TransferRow
                item={item}
                t={t}
                onPause={onPause}
                onResume={onResume}
                onCancel={onCancel}
                onReveal={onReveal}
                onApprove={onApprove}
                onReject={onReject}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
