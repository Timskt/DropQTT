import React, { useMemo, useState } from 'react';
import { Eraser, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { RpcCall, RpcReply } from '../../types';
import { fill, Translations } from '../../i18n';
import { base64ToUint8 } from '../../utils/cbor';

const STATE_COLOR: Record<RpcCall['state'], string> = {
  pending: 'var(--warn)',
  resolved: 'var(--ok)',
  timeout: 'var(--bad)',
};

const STATE_LABEL: Record<RpcCall['state'], (t: Translations) => string> = {
  pending: (t) => t.rpcPending,
  resolved: (t) => t.rpcResolved,
  timeout: (t) => t.rpcNoReply,
};

function decodeBody(reply?: RpcReply | null): string {
  if (!reply) return '';
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(base64ToUint8(reply.payloadBase64));
  } catch {
    return '';
  }
}

/** Every answer that arrived. A one-to-one request has at most one; a broadcast
 * collected several, and showing only the first would hide the point of asking. */
function bodiesOf(call: RpcCall): RpcReply[] {
  if (call.replies && call.replies.length > 0) return call.replies;
  return call.reply ? [call.reply] : [];
}

interface RpcPanelProps {
  calls: RpcCall[];
  onClearFinished: () => Promise<void>;
  t: Translations;
}

/**
 * Ledger of MQTT5 request/response calls. The state machine lives in Rust, so
 * this is a read-only view: closing the console does not abandon a call, and a
 * reply that lands after a reload still updates the row.
 */
export const RpcPanel: React.FC<RpcPanelProps> = ({ calls, onClearFinished, t }) => {
  const [openBody, setOpenBody] = useState<string | null>(null);
  const pending = useMemo(() => calls.filter((c) => c.state === 'pending').length, [calls]);
  const hasFinished = calls.some((c) => c.state !== 'pending');

  if (calls.length === 0) {
    return (
      <div className="panel text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {t.rpcEmpty}
      </div>
    );
  }

  return (
    <div className="panel space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t.rpcTitle}
        </span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {calls.length} · {pending} {t.rpcPending}
        </span>
        {hasFinished && (
          <button
            type="button"
            onClick={() => void onClearFinished()}
            className="ml-auto shrink-0 flex items-center gap-1 text-[10px] opacity-70 hover:opacity-100"
            style={{ color: 'var(--text-muted)' }}
            title={t.rpcClear}
          >
            <Eraser className="w-3 h-3" />
            <span className="hidden md:inline">{t.rpcClear}</span>
          </button>
        )}
      </div>

      <div className="space-y-1">
        {calls.map((call) => {
          const color = STATE_COLOR[call.state];
          const Icon = call.state === 'pending' ? Loader2 : call.state === 'resolved' ? CheckCircle2 : XCircle;
          const bodies = bodiesOf(call);
          const expanded = openBody === call.id;
          // A broadcast that got one answer of three did not get "no reply", and
          // saying so is the difference between a slow device and a dead one.
          const label = call.state === 'timeout' && bodies.length > 0
            ? fill(t.rpcPartialTimeout, { n: String(bodies.length), m: String(call.expected ?? bodies.length) })
            : STATE_LABEL[call.state](t);
          return (
            <div key={call.id} className="space-y-0.5" data-testid="rpc-row">
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <Icon
                  className={'w-3 h-3 shrink-0 ' + (call.state === 'pending' ? 'animate-spin' : '')}
                  style={{ color }}
                />
                <span className="truncate" style={{ color: 'var(--text-primary)' }} title={call.requestTopic}>
                  {call.requestTopic}
                </span>
                <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>→</span>
                <span className="truncate max-w-[28%]" style={{ color: 'var(--text-muted)' }} title={call.responseTopic}>
                  {call.responseTopic}
                </span>
                <span
                  className="shrink-0 hidden xl:inline"
                  style={{ color: 'var(--text-muted)' }}
                  data-testid="rpc-corr"
                  title={`${t.rpcCorrelationLabel}: ${call.correlation}${
                    call.reply?.correlationHex
                      ? ` ⇐ ${t.corrHexHint}: ${call.reply.correlationHex}`
                      : ` ⇐ ${t.rpcNoCorrelation}`
                  }`}
                >
                  #{call.correlation.slice(0, 8)}
                </span>
                <span className="ml-auto shrink-0" style={{ color }}>
                  {label}
                  {call.state === 'resolved' && call.rttMs !== null && call.rttMs !== undefined
                    ? ` · ${t.rpcRoundTrip} ${call.rttMs} ms`
                    : ''}
                  {call.reply ? ` · ${call.reply.payloadLen} B` : ''}
                  {/* A broadcast that is still filling up says how many answers it has;
                      a retry says which send this is. Both change what "pending" means. */}
                  {(call.expected ?? 1) > 1
                    ? ` · ${(call.replies ?? []).length}/${call.expected}`
                    : ''}
                  {(call.attemptsTotal ?? 1) > 1 && call.state === 'pending'
                    ? ` · ${fill(t.rpcAttemptOf, { n: String((call.attempt ?? 0) + 1), m: String(call.attemptsTotal) })}`
                    : ''}
                </span>
                {bodies.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpenBody(expanded ? null : call.id)}
                    className="shrink-0 opacity-70 hover:opacity-100 underline decoration-dotted"
                    style={{ color: 'var(--text-muted)' }}
                    title={t.rpcReplyBody}
                  >
                    {expanded ? '−' : `+ ${bodies.length}`}
                  </button>
                )}
              </div>
              {call.pairedByPosition && (
                <div className="pl-4 text-[10px]" style={{ color: 'var(--warn)' }} title={t.rpcHint}>
                  {t.rpcPairedByPosition}
                </div>
              )}
              {expanded && bodies.map((reply, i) => (
                <div
                  key={i}
                  className="pl-4 text-[10px] font-mono break-all whitespace-pre-wrap"
                  style={{ color: 'var(--text-secondary)' }}
                  data-testid="rpc-reply-body"
                >
                  {bodies.length > 1 && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      #{i + 1} {new Date(reply.timestampMs).toLocaleTimeString()} ·{' '}
                    </span>
                  )}
                  {decodeBody(reply)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
