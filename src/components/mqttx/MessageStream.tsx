import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Trash2, Copy, Check, ArrowDownRight, ArrowUpRight,
  Code2, AlignLeft, Binary, Braces, Box, Lock, FileText, Globe,
  Pause, Play, Download, Eraser, Pin, RotateCcw, Activity,
} from 'lucide-react';
import { MqttGenericMessage } from '../../types';
import { Translations } from '../../i18n';
import {
  base64ToUint8, cborToDisplayJson, decodeCbor,
  uint8ToBase64, uint8ToHexDump, uint8ToUtf8,
} from '../../utils/cbor';
import { ExportFormat, exportMessages } from '../../utils/exportMessages';
import { copyToClipboard } from '../../utils/clipboard';
import { HtmlPreview, MarkdownView } from './RichText';
import { JsonTree } from './JsonTree';

interface MessageStreamProps {
  messages: MqttGenericMessage[];
  onClearMessages: () => void;
  /** Publish an empty retained message on each topic to wipe broker retain state */
  onClearRetained: (topics: string[]) => Promise<void>;
  /** Re-publish this exact message (topic/payload/qos/retain) to the broker */
  onReplay: (msg: MqttGenericMessage) => Promise<void>;
  /** Add this message's topic to the subscription registry */
  onQuickSubscribe: (topic: string) => void;
  connected: boolean;
  paused: boolean;
  pendingCount: number;
  /** Backend feed drops under overload (stats stay exact) */
  feedDropped?: number;
  onTogglePaused: () => void;
  t: Translations;
}

type ViewMode = 'auto' | 'json' | 'text' | 'md' | 'html' | 'cbor' | 'base64' | 'hex';
type DirectionFilter = 'all' | 'in' | 'out';

const VIEW_MODES: { id: ViewMode; label: string; titleKey?: keyof Translations; icon: React.ReactNode }[] = [
  { id: 'auto', label: 'Auto', icon: <Box className="w-3 h-3" /> },
  { id: 'json', label: 'JSON', titleKey: 'formatJson', icon: <Braces className="w-3 h-3" /> },
  { id: 'text', label: 'Text', titleKey: 'formatRaw', icon: <AlignLeft className="w-3 h-3" /> },
  { id: 'md', label: 'MD', titleKey: 'mdView', icon: <FileText className="w-3 h-3" /> },
  { id: 'html', label: 'HTML', titleKey: 'htmlView', icon: <Globe className="w-3 h-3" /> },
  { id: 'cbor', label: 'CBOR', icon: <Code2 className="w-3 h-3" /> },
  { id: 'base64', label: 'B64', icon: <Lock className="w-3 h-3" /> },
  { id: 'hex', label: 'Hex', titleKey: 'formatHex', icon: <Binary className="w-3 h-3" /> },
];

/** Resolve effective view + decoded text for one message (runs inside memoized rows) */
function resolveView(msg: MqttGenericMessage, mode: ViewMode): { effective: ViewMode; display: string } {
  const bytes = base64ToUint8(msg.payloadBase64);

  let effective = mode;
  if (mode === 'auto') {
    const ct = (msg.contentType || '').toLowerCase();
    if (ct.includes('cbor')) effective = 'cbor';
    else if (ct.includes('markdown')) effective = 'md';
    else if (ct.includes('html')) effective = 'html';
    else if (ct.includes('json')) effective = 'json';
    else if (ct.includes('octet-stream')) effective = 'hex';
    else if (looksLikeJson(bytes)) effective = 'json';
    else if (looksLikeText(bytes)) effective = 'text';
    else effective = 'hex';
  }

  switch (effective) {
    case 'json': {
      const text = uint8ToUtf8(bytes);
      try {
        return { effective, display: JSON.stringify(JSON.parse(text), null, 2) };
      } catch {
        return { effective: 'text', display: text };
      }
    }
    case 'cbor':
      try {
        return { effective, display: cborToDisplayJson(decodeCbor(bytes)) };
      } catch {
        return { effective: 'base64', display: uint8ToBase64(bytes) };
      }
    case 'base64':
      return { effective, display: uint8ToBase64(bytes) };
    case 'hex':
      return { effective, display: uint8ToHexDump(bytes) };
    default:
      // text / md / html all show their UTF-8 source in rich mode
      return { effective, display: uint8ToUtf8(bytes) };
  }
}

function looksLikeText(bytes: Uint8Array): boolean {
  for (const b of bytes) {
    if (b < 0x09 || (b > 0x0d && b < 0x20)) return false;
  }
  return true;
}

function looksLikeJson(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  const first = bytes[0];
  if (first !== 0x7b /* { */ && first !== 0x5b /* [ */) return false;
  try {
    JSON.parse(uint8ToUtf8(bytes));
    return true;
  } catch {
    return false;
  }
}

interface MessageRowProps {
  msg: MqttGenericMessage;
  viewMode: ViewMode;
  copied: boolean;
  replayed: boolean;
  connected: boolean;
  onCopy: (id: string, text: string) => void;
  onReplay: (msg: MqttGenericMessage) => void;
  onQuickSubscribe: (topic: string) => void;
  t: Translations;
}

const MessageRow = React.memo(function MessageRow({
  msg, viewMode, copied, replayed, connected, onCopy, onReplay, onQuickSubscribe, t,
}: MessageRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isOut = msg.direction === 'out';

  const { effective, display } = useMemo(() => resolveView(msg, viewMode), [msg, viewMode]);
  const rich = effective === 'md' || effective === 'html';
  const overflow = display.length > 600 || display.split('\n').length > 12;

  return (
    <div className="pt-2.5 text-xs group">
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-2 truncate min-w-0">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border flex items-center gap-0.5 shrink-0 ${
              isOut
                ? 'bg-cyan-950/60 text-cyan-300 border-cyan-800'
                : 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
            }`}
          >
            {isOut ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
            <span>{isOut ? 'OUT' : 'IN'}</span>
          </span>

          <button
            type="button"
            onClick={() => onQuickSubscribe(msg.topic)}
            className="font-semibold truncate inset-box px-2 py-0.5 text-left transition hover:opacity-100"
            style={{ color: 'var(--text-primary)' }}
            title={t.quickSubscribe}
          >
            {msg.topic}
          </button>

          <span className="text-[11px] shrink-0" style={{ color: 'var(--text-muted)' }}>QoS {msg.qos}</span>
          {msg.retain && (
            <span className="text-[10px] px-1 py-0.5 bg-amber-950/60 border border-amber-800 text-amber-300 rounded shrink-0">
              RETAIN
            </span>
          )}
          {msg.contentType && (
            <span className="text-[10px] px-1 py-0.5 bg-violet-950/60 border border-violet-800 text-violet-300 rounded shrink-0 hidden lg:inline">
              {msg.contentType}
            </span>
          )}
          {viewMode === 'auto' && (
            <span className="text-[10px] shrink-0 hidden md:inline" style={{ color: 'var(--text-muted)' }}>{effective}</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] shrink-0" style={{ color: 'var(--text-muted)' }}>
          {msg.truncated && (
            <span style={{ color: 'var(--danger)' }} title="Payload truncated in feed">
              …
            </span>
          )}
          <span>{msg.payloadLen} B</span>
          <span>{msg.timestamp}</span>
          <button
            onClick={() => onReplay(msg)}
            disabled={!connected || msg.truncated}
            className="transition hover:opacity-100 opacity-60 disabled:opacity-25 disabled:cursor-not-allowed"
            style={{ color: replayed ? 'var(--success)' : 'var(--accent)' }}
            title={msg.truncated ? t.replayTruncated : t.replay}
          >
            {replayed ? <Check className="w-3 h-3" /> : <RotateCcw className="w-3 h-3" />}
          </button>
          <button
            onClick={() => onCopy(msg.id, display)}
            className="transition hover:opacity-100 opacity-60"
            style={{ color: 'var(--accent)' }}
          >
            {copied ? <Check className="w-3 h-3" style={{ color: 'var(--success)' }} /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {msg.userProperties && msg.userProperties.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {msg.userProperties.map(([k, v]) => (
            <span
              key={k}
              className="text-[10px] px-1.5 py-0.5 rounded inset-box font-mono"
              style={{ color: 'var(--text-secondary)' }}
            >
              {k}: {v}
            </span>
          ))}
        </div>
      )}

      {rich ? (
        <div className="rounded-md border p-3 max-h-[24rem] overflow-y-auto" style={{ background: 'var(--bg-code)', borderColor: 'rgba(148,163,184,0.2)' }}>
          {effective === 'md' ? <MarkdownView text={display} /> : <HtmlPreview source={display} />}
        </div>
      ) : effective === 'json' ? (
        <div className="rounded-md border p-2.5 max-h-[24rem] overflow-y-auto" style={{ background: 'var(--bg-code)', borderColor: 'rgba(148,163,184,0.2)' }}>
          <JsonTree text={display} />
        </div>
      ) : (
        <pre
          onClick={() => {
            // Don't toggle expansion while the user is selecting text
            if (window.getSelection()?.toString()) return;
            if (overflow) setExpanded((x) => !x);
          }}
          className={`select-text w-full text-left rounded-md border p-2.5 overflow-x-auto text-[12px] font-mono whitespace-pre leading-relaxed ${
            overflow ? 'cursor-pointer' : 'cursor-default'
          } ${expanded || !overflow ? '' : 'max-h-[12rem] overflow-hidden'}`}
          style={{ background: 'var(--bg-code)', borderColor: 'rgba(148,163,184,0.2)', color: '#d3dae6' }}
        >
          {display}
          {overflow && !expanded && (
            <span className="block text-[11px] mt-1 opacity-60" style={{ color: 'var(--accent)' }}>⋯ click to expand</span>
          )}
        </pre>
      )}
    </div>
  );
}, (a, b) =>
  a.msg === b.msg && a.viewMode === b.viewMode && a.copied === b.copied &&
  a.replayed === b.replayed && a.connected === b.connected);

export const MessageStream: React.FC<MessageStreamProps> = ({
  messages,
  onClearMessages,
  onClearRetained,
  onReplay,
  onQuickSubscribe,
  connected,
  paused,
  pendingCount,
  feedDropped = 0,
  onTogglePaused,
  t,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('auto');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [replayedId, setReplayedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [retainOpen, setRetainOpen] = useState(false);
  const [clearingRetain, setClearingRetain] = useState(false);
  const retainRef = useRef<HTMLDivElement>(null);

  // Unique topics that currently hold a retained message (inbound or echoed outbound)
  const retainedTopics = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) if (m.retain) set.add(m.topic);
    return [...set].sort();
  }, [messages]);

  // Close the retained popover on outside click
  useEffect(() => {
    if (!retainOpen) return;
    const onDown = (e: MouseEvent) => {
      if (retainRef.current && !retainRef.current.contains(e.target as Node)) setRetainOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [retainOpen]);

  const handleExport = useCallback(async (format: ExportFormat) => {
    if (messages.length === 0) return;
    setExporting(format);
    try {
      const saved = await exportMessages(messages, format);
      if (saved) {
        setExportNote(t.exportDone.replace('{count}', String(messages.length)));
        setTimeout(() => setExportNote(null), 2500);
      }
    } catch (e) {
      setExportNote(String(e));
      setTimeout(() => setExportNote(null), 3500);
    } finally {
      setExporting(null);
    }
  }, [messages, t]);

  const handleClearRetained = useCallback(async () => {
    if (retainedTopics.length === 0) return;
    setClearingRetain(true);
    try {
      await onClearRetained(retainedTopics);
      setRetainOpen(false);
    } finally {
      setClearingRetain(false);
    }
  }, [retainedTopics, onClearRetained]);

  const handleCopy = useCallback(async (id: string, text: string) => {
    const ok = await copyToClipboard(text);
    if (!ok) {
      console.warn('Clipboard copy failed for', id);
      return;
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handleReplay = useCallback(async (msg: MqttGenericMessage) => {
    try {
      await onReplay(msg);
      setReplayedId(msg.id);
      setTimeout(() => setReplayedId((cur) => (cur === msg.id ? null : cur)), 1500);
    } catch (e) {
      console.error('Replay failed:', e);
    }
  }, [onReplay]);

  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      if (directionFilter !== 'all' && msg.direction !== directionFilter) return false;
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        msg.topic.toLowerCase().includes(term) ||
        msg.payload.toLowerCase().includes(term) ||
        (msg.contentType ?? '').toLowerCase().includes(term)
      );
    });
  }, [messages, searchTerm, directionFilter]);

  return (
    <div className="panel flex flex-col h-full min-h-[260px] max-h-[560px] overflow-hidden">
      {/* Toolbar */}
      <div className="p-3 border-b flex flex-wrap items-center justify-between gap-2 text-xs" style={{ background: 'var(--bg-inset)', borderColor: 'var(--border-panel)' }}>
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t.filterTopic}
              className="field-input w-full pl-8"
            />
          </div>

          <div className="seg-box">
            {(['all', 'in', 'out'] as DirectionFilter[]).map((d) => (
              <button
                key={d}
                onClick={() => setDirectionFilter(d)}
                className={`px-2 py-1 rounded text-[11px] transition ${
                  directionFilter === d ? 'font-semibold' : 'opacity-60 hover:opacity-100'
                }`}
                style={
                  directionFilter === d
                    ? d === 'in'
                      ? { background: 'color-mix(in srgb, var(--success) 18%, transparent)', color: 'var(--success)' }
                      : d === 'out'
                        ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }
                        : { background: 'var(--bg-panel-solid)', color: 'var(--text-primary)' }
                    : { color: 'var(--text-secondary)' }
                }
              >
                {d === 'all' ? t.allDirections : d.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Pause / resume feed with pending badge */}
          <button
            onClick={onTogglePaused}
            title={paused ? t.resumeFeed : t.pauseFeed}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] border transition ${
              paused ? 'bg-amber-950/60 border-amber-800 text-amber-300 font-semibold' : ''
            }`}
            style={
              paused
                ? undefined
                : { background: 'var(--bg-inset)', borderColor: 'var(--border-inset)', color: 'var(--text-secondary)' }
            }
          >
            {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            {paused ? (
              <span>{pendingCount > 0 ? `+${pendingCount}` : t.resumeFeed}</span>
            ) : (
              <span>{t.pauseFeed}</span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="seg-box">
            {VIEW_MODES.map((vm) => (
              <button
                key={vm.id}
                onClick={() => setViewMode(vm.id)}
                title={vm.titleKey ? t[vm.titleKey] : vm.label}
                className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 transition ${
                  viewMode === vm.id ? 'font-semibold' : 'opacity-60 hover:opacity-100'
                }`}
                style={
                  viewMode === vm.id
                    ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }
                    : { color: 'var(--text-secondary)' }
                }
              >
                {vm.icon}
                <span>{vm.label}</span>
              </button>
            ))}
          </div>

          {/* Export JSON / CSV */}
          <div className="seg-box">
            <button
              onClick={() => handleExport('json')}
              disabled={messages.length === 0 || exporting !== null}
              title={t.exportJsonTitle}
              className="px-2 py-1 rounded text-[11px] flex items-center gap-1 transition hover:opacity-100 opacity-60 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ color: 'var(--text-secondary)' }}
            >
              {exporting === 'json' ? <Check className="w-3 h-3 animate-pulse" /> : <Download className="w-3 h-3" />}
              <span>JSON</span>
            </button>
            <button
              onClick={() => handleExport('csv')}
              disabled={messages.length === 0 || exporting !== null}
              title={t.exportCsvTitle}
              className="px-2 py-1 rounded text-[11px] flex items-center gap-1 transition hover:opacity-100 opacity-60 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ color: 'var(--text-secondary)' }}
            >
              {exporting === 'csv' ? <Check className="w-3 h-3 animate-pulse" /> : <Download className="w-3 h-3" />}
              <span>CSV</span>
            </button>
          </div>

          {/* Retained message clearer */}
          <div className="relative" ref={retainRef}>
            <button
              onClick={() => setRetainOpen((x) => !x)}
              disabled={retainedTopics.length === 0}
              title={t.clearRetainedTitle}
              className={`relative p-1.5 rounded border transition ${
                retainedTopics.length > 0
                  ? 'bg-amber-950/50 border-amber-800 text-amber-300 hover:border-amber-600'
                  : 'cursor-not-allowed opacity-40'
              }`}
              style={
                retainedTopics.length > 0
                  ? undefined
                  : { background: 'var(--bg-inset)', borderColor: 'var(--border-inset)', color: 'var(--text-muted)' }
              }
            >
              <Pin className="w-3.5 h-3.5" />
              {retainedTopics.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-slate-950 text-[9px] font-bold flex items-center justify-center">
                  {retainedTopics.length}
                </span>
              )}
            </button>
            {retainOpen && retainedTopics.length > 0 && (
              <div className="absolute right-0 top-full mt-1.5 z-20 w-72 rounded-md border shadow-xl p-2.5 animate-fade-in" style={{ background: 'var(--bg-panel-solid)', borderColor: 'var(--border-panel)' }}>
                <div className="text-[11px] mb-1.5 px-1" style={{ color: 'var(--text-secondary)' }}>{t.retainedOnTopics}</div>
                <div className="max-h-40 overflow-y-auto space-y-0.5 mb-2">
                  {retainedTopics.map((tp) => (
                    <div key={tp} className="text-[11px] font-mono text-amber-200/90 bg-amber-950/30 border border-amber-900/40 rounded px-1.5 py-0.5 truncate">
                      {tp}
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleClearRetained}
                  disabled={clearingRetain}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-amber-600/90 hover:bg-amber-500 text-slate-950 text-[11px] font-bold disabled:opacity-50 transition"
                >
                  <Eraser className="w-3 h-3" />
                  <span>{clearingRetain ? t.clearingRetained : t.clearAllRetained.replace('{count}', String(retainedTopics.length))}</span>
                </button>
                <div className="text-[10px] mt-1.5 px-1" style={{ color: 'var(--text-muted)' }}>{t.retainClearNote}</div>
              </div>
            )}
          </div>

          <button
            onClick={onClearMessages}
            title={t.clearMessages}
            className="p-2 rounded border transition hover:opacity-100 opacity-60"
            style={{ background: 'var(--bg-inset)', borderColor: 'var(--border-inset)', color: 'var(--danger)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Export feedback note */}
      {exportNote && (
        <div className="px-3 py-1 bg-cyan-950/40 border-b border-cyan-900/50 text-[10px] text-cyan-300 animate-fade-in">
          {exportNote}
        </div>
      )}

      {/* Frozen-feed hint bar */}
      {paused && (
        <div className="px-3 py-1 bg-amber-950/40 border-b border-amber-900/50 text-[10px] text-amber-300 flex items-center justify-between">
          <span>{t.feedPaused}</span>
          {pendingCount > 0 && (
            <button onClick={onTogglePaused} className="font-semibold hover:text-amber-100 underline">
              {t.flushPending.replace('{count}', String(pendingCount))}
            </button>
          )}
        </div>
      )}

      {/* High-throughput feed drop notice (traffic stats remain exact) */}
      {feedDropped > 0 && (
        <div className="px-3 py-1 border-b text-[10px] font-mono flex items-center gap-1.5" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', borderColor: 'var(--border-inset)', color: 'var(--danger)' }}>
          <Activity className="w-3 h-3" />
          {t.feedDroppedNotice.replace('{n}', feedDropped.toLocaleString())}
        </div>
      )}

      {/* Message feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filteredMessages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs italic" style={{ color: 'var(--text-muted)' }}>
            {messages.length === 0 ? t.noMessages : t.noMessagesFiltered}
          </div>
        ) : (
          filteredMessages.map((msg) => (
            <MessageRow
              key={msg.id}
              msg={msg}
              viewMode={viewMode}
              copied={copiedId === msg.id}
              replayed={replayedId === msg.id}
              connected={connected}
              onCopy={handleCopy}
              onReplay={handleReplay}
              onQuickSubscribe={onQuickSubscribe}
              t={t}
            />
          ))
        )}
        {filteredMessages.some((m) => m.truncated) && (
          <div className="text-[11px] text-center pb-1" style={{ color: 'var(--text-muted)' }}>{t.truncatedNote}</div>
        )}
      </div>
    </div>
  );
};
