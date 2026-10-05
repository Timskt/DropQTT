import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Trash2, Copy, Check, ArrowDownRight, ArrowUpRight,
  Code2, AlignLeft, Binary, Braces, Box, Lock, FileText, Globe,
  Pause, Play, Download, Eraser, Pin, RotateCcw, Activity, AlertCircle, GitCompare,
  Filter, Send, Terminal,
} from 'lucide-react';
import { MqttGenericMessage } from '../../types';
import { usePersistentState, usePersistentString } from '../../hooks/usePersistentState';
import { Translations, fill } from '../../i18n';
import { useCodec } from '../../hooks/useCodec';
import { MAX_MESSAGES } from '../../hooks/useMqttMessages';
import { mosquittoCommand, mosquittoCommandText } from '../../utils/mqttCommand';
import { traceTokenFor } from '../../utils/history';
import {
  base64ToUint8, cborToDisplayJson, decodeCbor,
  uint8ToBase64, uint8ToHexDump, uint8ToUtf8,
} from '../../utils/cbor';
import { ExportFormat, exportMessages } from '../../utils/exportMessages';
import { diffFields, diffLines } from '../../utils/diff';
import { copyToClipboard } from '../../utils/clipboard';
import { toast } from '../../utils/toast';
import { HtmlPreview, MarkdownView } from './RichText';
import { looksLikeSenml, parseSenmlPack, senmlFromDecoded, senmlToTable } from '../../utils/senml';
import { assertionOutcomeChip, assertionOutcomeGlyph, assertionVerdictTitle } from '../../utils/assertions';
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
  /** Where a copied command or a row-level request would go */
  broker: { host: string; port: number; tls: boolean };
  /** Follow this row's correlation (or its topic) in the history trace */
  onTrace: (msg: MqttGenericMessage) => void;
  /** Republish these bytes as an MQTT5 request and watch for the answer */
  onSendAsRpc: (msg: MqttGenericMessage) => Promise<void>;
  connected: boolean;
  paused: boolean;
  pendingCount: number;
  /** Backend feed drops under overload (stats stay exact) */
  feedDropped?: number;
  onTogglePaused: () => void;
  t: Translations;
}

type ViewMode = 'auto' | 'senml' | 'json' | 'text' | 'md' | 'html' | 'cbor' | 'base64' | 'hex';
type DirectionFilter = 'all' | 'in' | 'out';

const VIEW_MODES: { id: ViewMode; label: string; titleKey?: keyof Translations; icon: React.ReactNode }[] = [
  { id: 'auto', label: 'Auto', icon: <Box className="w-3 h-3" /> },
  { id: 'senml', label: 'SenML', titleKey: 'senmlView', icon: <Activity className="w-3 h-3" /> },
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
    // RFC 8428 registers application/senml+json and application/senml+cbor;
    // both contain "json"/"cbor", so they have to win over the generic branches.
    if (ct.includes('senml')) effective = 'senml';
    else if (ct.includes('cbor')) effective = 'cbor';
    else if (ct.includes('markdown')) effective = 'md';
    else if (ct.includes('html')) effective = 'html';
    else if (ct.includes('json')) effective = 'json';
    else if (ct.includes('octet-stream')) effective = 'hex';
    else if (looksLikeJson(bytes)) {
      // A device pack with recognisable labels is far more useful as a reading
      // table than as raw JSON, so SenML outranks plain JSON here.
      try { effective = looksLikeSenml(JSON.parse(uint8ToUtf8(bytes))) ? 'senml' : 'json'; }
      catch { effective = 'json'; }
    }
    else if (looksLikeText(bytes)) effective = 'text';
    else effective = 'hex';
  }

  switch (effective) {
    case 'senml': {
      try {
        const ct = (msg.contentType || '').toLowerCase();
        const decoded = ct.includes('cbor') ? senmlFromDecoded(decodeCbor(bytes))
          : parseSenmlPack(JSON.parse(uint8ToUtf8(bytes)));
        return { effective, display: senmlToTable(decoded) };
      } catch (e) {
        // Fall back to whatever generic rendering works rather than showing nothing.
        return { effective: 'json', display: uint8ToUtf8(bytes) };
      }
    }
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
  /** Where a copied command or an RPC would go; kept as one object so the row memo
   *  only breaks when the target actually changes. */
  broker: { host: string; port: number; tls: boolean };
  /** Display-only payload codec; empty/absent disables it. */
  codecScript?: string;
  onCopy: (id: string, text: string) => void;
  onReplay: (msg: MqttGenericMessage) => void;
  onQuickSubscribe: (topic: string) => void;
  /** Follow this row's correlation (or its topic) in the history trace */
  onTrace: (msg: MqttGenericMessage) => void;
  /** Republish these bytes as a request and watch for the answer */
  onSendAsRpc: (msg: MqttGenericMessage) => void;
  /** Filter the feed down to this row's topic */
  onFilterTopic: (topic: string) => void;
  t: Translations;
}

/** How many saved filters the strip keeps before the oldest fall off. */const MAX_FILTER_PRESETS = 8;

const MessageRow = React.memo(function MessageRow({
  msg, viewMode, copied, replayed, connected, broker, codecScript, onCopy, onReplay, onQuickSubscribe,
  onTrace, onSendAsRpc, onFilterTopic, t,
}: MessageRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);
  const isOut = msg.direction === 'out';

  const base = useMemo(() => resolveView(msg, viewMode), [msg, viewMode]);
  const codec = useCodec(codecScript, msg.topic, msg.payloadBase64);
  // A codec is a lens: on failure we keep the raw view and surface why.
  const effective = codec.text !== null ? 'text' : base.effective;
  const display = codec.text !== null ? codec.text : base.display;
  const codecFailed = codec.error !== null;
  const rich = effective === 'md' || effective === 'html';
  const overflow = display.length > 600 || display.split('\n').length > 12;

  return (
    // `msg-row` is the hook the compact-density rule in index.css tightens; spacing
    // lives in CSS rather than in a prop so a preference change does not have to
    // re-render every row in the feed.
    <div className="msg-row pt-2.5 text-xs group">
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-2 truncate min-w-0">
          <span className={`chip ${isOut ? 'chip-info' : 'chip-ok'} !font-bold`}>
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
          {msg.retain && <span className="chip chip-warn shrink-0">RETAIN</span>}
          {msg.contentType && <span className="chip chip-violet shrink-0 hidden lg:inline">{msg.contentType}</span>}
          {/* Only what the publisher declared, not what we guessed from the bytes */}
          {msg.payloadFormat !== undefined && (
            <span className="chip chip-neutral shrink-0 hidden lg:inline" title={t.payloadFormatHint}>
              {msg.payloadFormat === 1 ? 'UTF-8' : 'BYTES'}
            </span>
          )}
          {msg.responseTopic && <span className="chip chip-sky shrink-0 hidden xl:inline" title={t.responseTopicLabel}>↩ {msg.responseTopic}</span>}
          {/* Which subscription carried this in. Broker-reported when it echoed a
              Subscription Identifier, ours when it did not — the two are different
              claims and the chip is coloured differently. */}
          {msg.matchedFilters && msg.matchedFilters.length > 0 && (
            <span
              className={`chip ${msg.subscriptionIds && msg.subscriptionIds.length > 0 ? 'chip-sky' : 'chip-neutral'} shrink-0 hidden lg:inline font-mono max-w-[14rem] truncate`}
              data-testid="matched-chip"
              title={`${
                msg.subscriptionIds && msg.subscriptionIds.length > 0
                  ? t.matchedByBrokerHint
                  : t.matchedByLocalHint
              }: ${msg.matchedFilters.join(', ')}`}
            >
              ⌕ {msg.matchedFilters[0]}
              {msg.matchedFilters.length > 1 && ` +${msg.matchedFilters.length - 1}`}
            </span>
          )}
          {/* The assertion verdict, when any rule claimed this row. Colour alone
              would not survive greyscale or a screen reader, so the outcome is
              spelled out too. */}
          {msg.assertion && (
            <span
              className={`chip ${assertionOutcomeChip(msg.assertion.outcome)} shrink-0 font-mono`}
              data-testid="assertion-chip"
              title={assertionVerdictTitle(
                t,
                msg.assertion.expr,
                msg.assertion.label,
                msg.assertion.rules,
                msg.assertion.outcome,
              )}
            >
              {assertionOutcomeGlyph(msg.assertion.outcome)} {msg.assertion.expr}
            </span>
          )}
          {(msg.correlationData || msg.correlationHex) && (
            <span
              className="chip chip-neutral shrink-0 hidden xl:inline font-mono"
              title={
                msg.correlationData
                  ? `${t.correlationDataLabel}: ${msg.correlationData}`
                  : `${t.corrHexHint}: ${msg.correlationHex}`
              }
              data-testid="corr-chip"
            >
              #{(msg.correlationData ?? msg.correlationHex ?? '').slice(0, 12)}
              {!msg.correlationData && ` ${t.corrHexBadge}`}
            </span>
          )}
          {viewMode === 'auto' && (
            <span className="text-[10px] shrink-0 hidden md:inline" style={{ color: 'var(--text-muted)' }}>{effective}</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] shrink-0" style={{ color: 'var(--text-muted)' }}>
          {msg.truncated && (
            <span style={{ color: 'var(--danger)' }} title={t.payloadTruncatedTip}>
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
            aria-label={t.replay}
          >
            {replayed ? <Check className="w-3 h-3" /> : <RotateCcw className="w-3 h-3" />}
          </button>
          <button
            onClick={() => onCopy(msg.id, display)}
            className="transition hover:opacity-100 opacity-60"
            style={{ color: 'var(--accent)' }}
            aria-label={t.copy}
          >
            {copied ? <Check className="w-3 h-3" style={{ color: 'var(--success)' }} /> : <Copy className="w-3 h-3" />}
          </button>
          {/* The row is where the question arises, so the next moves live here rather
              than three panels away. */}
          <button
            onClick={() => onTrace(msg)}
            className="transition hover:opacity-100 opacity-60"
            style={{ color: 'var(--accent)' }}
            title={msg.correlationData || msg.correlationHex
              ? fill(t.traceFromCorrelation, { token: traceTokenFor(msg) })
              : fill(t.traceFromTopic, { topic: msg.topic })}
            aria-label={t.traceRun}
            data-testid={`trace-${msg.id}`}
          >
            <GitCompare className="w-3 h-3" />
          </button>
          <button
            onClick={() => onFilterTopic(msg.topic)}
            className="transition hover:opacity-100 opacity-60"
            style={{ color: 'var(--accent)' }}
            title={fill(t.feedFilterThisTopic, { topic: msg.topic })}
            aria-label={t.feedFilterThisTopicShort}
            data-testid={`feed-filter-${msg.id}`}
          >
            <Filter className="w-3 h-3" />
          </button>
          <button
            onClick={() => onSendAsRpc(msg)}
            disabled={!connected || msg.truncated}
            className="transition hover:opacity-100 opacity-60 disabled:opacity-25 disabled:cursor-not-allowed"
            style={{ color: 'var(--accent)' }}
            title={msg.truncated ? t.rpcSendTruncated : connected ? t.rpcSendHint : t.whyNotConnected}
            aria-label={t.rpcSend}
            data-testid={`rpc-send-${msg.id}`}
          >
            <Send className="w-3 h-3" />
          </button>
          <button
            onClick={() => {
              void copyToClipboard(mosquittoCommandText(mosquittoCommand(msg, broker))).then((ok) => {
                if (!ok) return;
                setCmdCopied(true);
                setTimeout(() => setCmdCopied(false), 1400);
              });
            }}
            className="transition hover:opacity-100 opacity-60"
            style={{ color: cmdCopied ? 'var(--success)' : 'var(--accent)' }}
            title={t.copyAsCommandHint}
            aria-label={t.copyAsCommand}
            data-testid={`copy-cmd-${msg.id}`}
          >
            {cmdCopied ? <Check className="w-3 h-3" /> : <Terminal className="w-3 h-3" />}
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

      {codecFailed && (
        <div className="flex items-start gap-1.5 text-[10px] font-mono mb-1.5" style={{ color: 'var(--bad)' }}>
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="break-words">{t.codecFailed}: {codec.error}</span>
        </div>
      )}
      {codec.pending && !codecFailed && (
        <div className="text-[10px] font-mono mb-1.5" style={{ color: 'var(--text-muted)' }}>{t.codecPending}</div>
      )}

      {rich ? (
        <div className="rounded-md border p-3 max-h-[24rem] overflow-y-auto" style={{ background: 'var(--bg-code)', borderColor: 'var(--code-border)' }}>
          {effective === 'md' ? <MarkdownView text={display} /> : <HtmlPreview source={display} />}
        </div>
      ) : effective === 'json' ? (
        <div className="rounded-md border p-2.5 max-h-[24rem] overflow-y-auto" style={{ background: 'var(--bg-code)', borderColor: 'var(--code-border)' }}>
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
          role={overflow ? 'button' : undefined}
          tabIndex={overflow ? 0 : undefined}
          aria-expanded={overflow ? expanded : undefined}
          onKeyDown={(e) => {
            if (!overflow || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            setExpanded((x) => !x);
          }}
          style={{ background: 'var(--bg-code)', borderColor: 'var(--code-border)', color: 'var(--code-text)' }}
        >
          {display}
          {overflow && !expanded && (
            <span className="block text-[11px] mt-1 opacity-60" style={{ color: 'var(--accent)' }}>{t.clickToExpand}</span>
          )}
        </pre>
      )}
    </div>
  );
}, (a, b) =>
  a.msg === b.msg && a.viewMode === b.viewMode && a.copied === b.copied &&
  a.replayed === b.replayed && a.connected === b.connected && a.codecScript === b.codecScript &&
  a.broker === b.broker);

export const MessageStream: React.FC<MessageStreamProps> = ({
  messages,
  onClearMessages,
  onClearRetained,
  onReplay,
  onQuickSubscribe,
  broker,
  onTrace,
  onSendAsRpc,
  connected,
  paused,
  pendingCount,
  feedDropped = 0,
  onTogglePaused,
  t,
}) => {
  // Display-only payload codec, persisted so a device format survives restarts.
  const [codecScript, setCodecScript] = usePersistentString('dropqtt_console_codec', '');
  const [codecOpen, setCodecOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // Measured: filtering 500 rows on every keystroke cost ~207 ms, so the box kept
  // up with the fingers while the list lagged one frame behind. The input stays on
  // `searchTerm`; only the list reads the deferred value.
  const deferredSearch = useDeferredValue(searchTerm);
  // Saved filters: field work is repetitive by nature, and retyping the same topic
  // pattern every session is the part people said they hated.
  const [filterPresets, setFilterPresets] = usePersistentState<string[]>('dropqtt_feed_filters', []);
  const [confirmPreset, setConfirmPreset] = useState<string | null>(null);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('auto');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [replayedId, setReplayedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [retainOpen, setRetainOpen] = useState(false);
  const [clearingRetain, setClearingRetain] = useState(false);
  // Armed state for the destructive clear: the first click asks, the second does it.
  const [armClear, setArmClear] = useState(false);
  // Field-level comparison of two feed rows. Firmware A/B and "what changed
  // between these two heartbeats" are the same question, and reading two JSON
  // blobs side by side is how people get it wrong.
  const [compareOn, setCompareOn] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const retainRef = useRef<HTMLDivElement>(null);
  const retainToggleRef = useRef<HTMLButtonElement>(null);
  const retainClearRef = useRef<HTMLButtonElement>(null);

  // Unique topics that currently hold a retained message (inbound or echoed outbound)
  const retainedTopics = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) if (m.retain) set.add(m.topic);
    return [...set].sort();
  }, [messages]);

  // Close the retained popover on outside click or Escape, and start inside it.
  // Escape also returns focus to the toggle: a keyboard user who just dismissed a
  // popover should not be left on the document body with no idea where they are.
  useEffect(() => {
    if (!retainOpen) return;
    const onDown = (e: MouseEvent) => {
      if (retainRef.current && !retainRef.current.contains(e.target as Node)) setRetainOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setRetainOpen(false);
      retainToggleRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    retainClearRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [retainOpen]);

  const handleExport = useCallback(async (format: ExportFormat) => {
    if (messages.length === 0) return;
    setExporting(format);
    try {
      const saved = await exportMessages(messages, format);
      if (saved) {
        setExportNote(fill(t.exportDone, { count: String(messages.length) }));
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
    } catch (e) {
      // Clearing retained messages is a broker-side write; a swallowed failure
      // here means stale retained state stays published while the UI says it went.
      toast.error(`${t.clearRetainFailed}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setClearingRetain(false);
    }
  }, [retainedTopics, onClearRetained, t]);

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

  // Exact topic, not a substring the user has to finish typing. The filter box is
  // plain text matching, so an exact topic is the narrowest thing it can hold.
  const handleFilterTopic = useCallback((topic: string) => setSearchTerm(topic), []);

  const handleSendAsRpc = useCallback(async (msg: MqttGenericMessage) => {
    try {
      await onSendAsRpc(msg);
    } catch (e) {
      toast.error(String(e));
    }
  }, [onSendAsRpc]);

  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      if (directionFilter !== 'all' && msg.direction !== directionFilter) return false;
      if (!deferredSearch.trim()) return true;
      const term = deferredSearch.toLowerCase();
      return (
        msg.topic.toLowerCase().includes(term) ||
        msg.payload.toLowerCase().includes(term) ||
        (msg.contentType ?? '').toLowerCase().includes(term)
      );
    });
  }, [messages, deferredSearch, directionFilter]);

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
              aria-label={t.filterTopic}
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
            aria-label={paused ? t.resumeFeed : t.pauseFeed}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] border transition ${
              paused ? 'chip-warn !py-1.5 font-semibold' : ''
            }`}
            style={paused ? undefined : { background: 'var(--bg-inset)', borderColor: 'var(--border-inset)', color: 'var(--text-secondary)' }}
          >
            {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            {paused ? (
              <span>{pendingCount > 0 ? `+${pendingCount}` : t.resumeFeed}</span>
            ) : (
              <span>{t.pauseFeed}</span>
            )}
          </button>

          <button
            onClick={() => {
              setCompareOn((v) => !v);
              setPicked([]);
            }}
            aria-pressed={compareOn}
            title={compareOn ? t.comparePickTwo : t.compareToggle}
            aria-label={t.compareToggle}
            data-testid="compare-toggle"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] border transition"
            style={
              compareOn
                ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)', borderColor: 'var(--accent)', color: 'var(--accent)' }
                : { background: 'var(--bg-inset)', borderColor: 'var(--border-inset)', color: 'var(--text-secondary)' }
            }
          >
            <GitCompare className="w-3 h-3" />
            <span>{t.compareToggle}</span>
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

          {/* Payload codec (display-only) */}
          <button
            type="button"
            onClick={() => setCodecOpen((v) => !v)}
            aria-expanded={codecOpen}
            title={t.codecHint}
            className="px-2 py-1 rounded text-[11px] flex items-center gap-1 transition inset-box"
            style={
              codecScript?.trim()
                ? { color: 'var(--accent)', borderColor: 'var(--accent)' }
                : { color: 'var(--text-secondary)' }
            }
          >
            <Code2 className="w-3 h-3" />
            <span>{codecScript?.trim() ? t.codecOn : t.codecOff}</span>
          </button>

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
              ref={retainToggleRef}
              onClick={() => setRetainOpen((x) => !x)}
              disabled={retainedTopics.length === 0}
              title={t.clearRetainedTitle}
              aria-label={t.clearRetainedTitle}
              aria-expanded={retainOpen}
              aria-controls="dropqtt-retained-popover"
              className={`relative p-1.5 rounded border transition ${
                retainedTopics.length > 0 ? 'chip-warn !p-1.5' : 'cursor-not-allowed opacity-40'
              }`}
              style={
                retainedTopics.length > 0
                  ? { background: 'transparent' }
                  : { background: 'var(--bg-inset)', borderColor: 'var(--border-inset)', color: 'var(--text-muted)' }
              }
            >
              <Pin className="w-3.5 h-3.5" />
              {retainedTopics.length > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
                  style={{ background: 'var(--warn)', color: 'var(--bg-code)' }}
                >
                  {retainedTopics.length}
                </span>
              )}
            </button>
            {retainOpen && retainedTopics.length > 0 && (
              <div
                id="dropqtt-retained-popover"
                role="group"
                aria-label={t.retainedOnTopics}
                className="absolute right-0 top-full mt-1.5 z-20 w-72 rounded-md border shadow-xl p-2.5 animate-fade-in" style={{ background: 'var(--bg-panel-solid)', borderColor: 'var(--border-panel)' }}>
                <div className="text-[11px] mb-1.5 px-1" style={{ color: 'var(--text-secondary)' }}>{t.retainedOnTopics}</div>
                <div className="max-h-40 overflow-y-auto space-y-0.5 mb-2">
                  {retainedTopics.map((tp) => (
                    <div key={tp} className="text-[11px] font-mono rounded px-1.5 py-0.5 truncate" style={{ color: 'var(--warn)', background: 'var(--warn-soft)', border: '1px solid var(--warn-border)' }}>
                      {tp}
                    </div>
                  ))}
                </div>
                <button
                  ref={retainClearRef}
                  onClick={handleClearRetained}
                  disabled={clearingRetain}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-bold disabled:opacity-50 transition border"
                  style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn-border)', color: 'var(--warn)' }}
                >
                  <Eraser className="w-3 h-3" />
                  <span>{clearingRetain ? t.clearingRetained : fill(t.clearAllRetained, { count: String(retainedTopics.length) })}</span>
                </button>
                <div className="text-[10px] mt-1.5 px-1" style={{ color: 'var(--text-muted)' }}>{t.retainClearNote}</div>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              // Two deliberate clicks: this throws away the whole visible feed, and
              // the same pattern already protects bridge-rule deletion.
              if (!armClear) {
                setArmClear(true);
                window.setTimeout(() => setArmClear(false), 4000);
                return;
              }
              setArmClear(false);
              onClearMessages();
            }}
            title={armClear ? t.clearMessagesConfirm : t.clearMessages}
            aria-label={armClear ? t.clearMessagesConfirm : t.clearMessages}
            data-testid="clear-messages"
            className="p-2 rounded border transition hover:opacity-100 opacity-60"
            style={
              armClear
                ? { background: 'var(--danger)', borderColor: 'var(--danger)', color: 'var(--accent-contrast)' }
                : { background: 'var(--bg-inset)', borderColor: 'var(--border-inset)', color: 'var(--danger)' }
            }
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {codecOpen && (
        <div className="px-3 py-2.5 space-y-2" style={{ background: 'var(--bg-inset)', borderBottom: '1px solid var(--border-panel)' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t.codecTitle}</span>
            {codecScript.trim() && (
              <button type="button" onClick={() => setCodecScript('')} className="text-[10px] underline opacity-70 hover:opacity-100" style={{ color: 'var(--danger)' }}>
                {t.codecClear}
              </button>
            )}
          </div>
          <textarea
            value={codecScript}
            onChange={(e) => setCodecScript(e.target.value)}
            spellCheck={false}
            aria-label={t.codecTitle}
            placeholder={'function transform(topic, payload) {\n  return JSON.parse(atob(payload)).reading;\n}'}
            className="field-input w-full h-24 font-mono text-[11px]"
          />
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{t.codecHint}</p>
        </div>
      )}

      {/* Export feedback note */}
      {exportNote && (
        <div className="px-3 py-1 text-[10px] animate-fade-in" style={{ background: 'var(--info-soft)', borderBottom: '1px solid var(--info-border)', color: 'var(--info)' }}>
          {exportNote}
        </div>
      )}

      {/* Frozen-feed hint bar */}
      {paused && (
        <div className="px-3 py-1 text-[10px] flex items-center justify-between" style={{ background: 'var(--warn-soft)', borderBottom: '1px solid var(--warn-border)', color: 'var(--warn)' }}>
          <span>{t.feedPaused}</span>
          {pendingCount > 0 && (
            <button onClick={onTogglePaused} className="font-semibold underline">
              {fill(t.flushPending, { count: String(pendingCount) })}
            </button>
          )}
        </div>
      )}

      {/* High-throughput feed drop notice (traffic stats remain exact) */}
      {feedDropped > 0 && (
        <div className="px-3 py-1 border-b text-[10px] font-mono flex items-center gap-1.5" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', borderColor: 'var(--border-inset)', color: 'var(--danger)' }}>
          <Activity className="w-3 h-3" />
          {fill(t.feedDroppedNotice, { n: feedDropped.toLocaleString() })}
        </div>
      )}

      {/* Saved filters. Field work repeats the same three patterns, and a filter you
          have to retype is a filter you stop using. */}
      <div className="px-3 py-1.5 flex items-center gap-1.5 flex-wrap text-[10px]" style={{ borderBottom: '1px solid var(--border-panel)' }}>
        <button
          type="button"
          onClick={() => {
            const value = searchTerm.trim();
            if (!value || filterPresets.includes(value)) return;
            setFilterPresets((prev) => [...prev, value].slice(-MAX_FILTER_PRESETS));
          }}
          disabled={!searchTerm.trim() || filterPresets.includes(searchTerm.trim())}
          title={!searchTerm.trim() ? t.filterSaveEmpty : filterPresets.includes(searchTerm.trim()) ? t.filterSaveDuplicate : t.filterSaveHint}
          className="px-1.5 py-0.5 rounded border inset-box transition hover:opacity-100 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: 'var(--text-secondary)' }}
          data-testid="filter-save"
        >
          {t.filterSave}
        </button>
        {filterPresets.length === 0 && (
          <span style={{ color: 'var(--text-muted)' }} data-testid="filter-presets-empty">{t.filterPresetsEmpty}</span>
        )}
        {filterPresets.map((preset) => (
          <span
            key={preset}
            className="chip chip-neutral font-mono max-w-[16rem]"
            data-testid={`filter-preset-${preset}`}
          >
            <button
              type="button"
              onClick={() => setSearchTerm(preset)}
              title={fill(t.filterApplyHint, { q: preset })}
              className="truncate"
              style={{ color: searchTerm === preset ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              {preset}
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirmPreset !== preset) {
                  setConfirmPreset(preset);
                  return;
                }
                setFilterPresets((prev) => prev.filter((x) => x !== preset));
                setConfirmPreset(null);
                if (searchTerm === preset) setSearchTerm('');
              }}
              title={confirmPreset === preset ? t.deleteConfirmAgain : t.filterRemove}
              aria-label={`${t.filterRemove} ${preset}`}
              className="ml-1 opacity-70 hover:opacity-100"
              style={{ color: confirmPreset === preset ? 'var(--bad)' : 'var(--text-muted)' }}
              data-testid={`filter-remove-${preset}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* The list holds the newest N and the rest is in History. A panel that
          quietly stops growing looks like a stopped broker. */}
      {messages.length >= MAX_MESSAGES && (
        <div
          className="px-3 py-1 border-b text-[10px] font-mono"
          data-testid="feed-cap-note"
          style={{ color: 'var(--text-muted)', background: 'var(--bg-inset)' }}
        >
          {fill(t.feedCapNote, { n: String(MAX_MESSAGES) })}
        </div>
      )}

      {/* Message feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filteredMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center">
            <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
              {messages.length === 0 ? t.noMessages : t.noMessagesFiltered}
            </span>
            {messages.length === 0 && (
              // An empty panel is the one screen that can teach the next step.
              <span className="text-[11px] max-w-sm" style={{ color: 'var(--text-muted)' }}>
                {t.noMessagesHint}
              </span>
            )}
            {/* Words are not a way forward. Each of these lands on a control that
                already exists, rather than opening a second copy of it. */}
            <div className="flex items-center gap-2 mt-1">
              {messages.length === 0 ? (
                <>
                  <button
                    type="button"
                    className="btn-ghost !px-2.5 !py-1 text-[11px]"
                    data-testid="empty-subscribe"
                    onClick={() => {
                      const el = document.querySelector<HTMLInputElement>('[data-testid=sub-topic-input]');
                      el?.scrollIntoView({ block: 'center' });
                      el?.focus();
                    }}
                  >
                    {t.emptyActionSubscribe}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !px-2.5 !py-1 text-[11px]"
                    data-testid="empty-bench"
                    title={connected ? undefined : t.replayDisabledDisconnected}
                    disabled={!connected}
                    onClick={() => {
                      document
                        .querySelector<HTMLButtonElement>('[data-testid=bench-toggle]')
                        ?.click();
                    }}
                  >
                    {t.emptyActionBench}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn-ghost !px-2.5 !py-1 text-[11px]"
                  data-testid="empty-clear-filter"
                  onClick={() => {
                    setSearchTerm('');
                    setDirectionFilter('all');
                  }}
                >
                  {t.emptyActionClearFilter}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
          {compareOn && picked.length < 2 && (
            <div className="text-[11px] px-2 py-1.5 inset-box" style={{ color: 'var(--text-muted)' }} data-testid="compare-hint">
              {t.comparePickTwo}
            </div>
          )}
          {compareOn && picked.length === 2 && (() => {
            const [left, right] = picked.map((id) => messages.find((m) => m.id === id)).filter(Boolean) as [typeof messages[number], typeof messages[number]];
            const fields = diffFields(left, right, {
              topic: t.cmpTopic,
              direction: t.cmpDirection,
              qos: t.qosLevel,
              retain: t.retain,
              contentType: t.contentTypeLabel,
              payloadFormat: t.payloadFormat,
              responseTopic: t.responseTopicLabel,
              correlation: t.correlationDataLabel,
              userProperties: t.cmpUserProps,
              payload: t.cmpPayload,
            });
            const payload = fields[fields.length - 1];
            const lines = payload.same ? null : diffLines(payload.left, payload.right);
            return (
              <div className="inset-box p-2.5 space-y-1.5 text-[11px] font-mono" data-testid="compare-panel">
                {fields.slice(0, -1).map((f) => (
                  <div key={f.field} className="flex gap-2">
                    <span className="w-28 shrink-0" style={{ color: 'var(--text-muted)' }}>{f.field}</span>
                    <span style={{ color: f.same ? 'var(--text-secondary)' : 'var(--danger)' }}>{f.left}</span>
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                    <span style={{ color: f.same ? 'var(--text-secondary)' : 'var(--accent)' }}>{f.right}</span>
                  </div>
                ))}
                <div className="pt-1" style={{ borderTop: '1px solid var(--border-inset)' }}>
                  <div style={{ color: 'var(--text-muted)' }}>{t.cmpPayload}</div>
                  {payload.same ? (
                    <div style={{ color: 'var(--text-secondary)' }}>=</div>
                  ) : lines ? (
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>
                      {lines.map((l, i) => (
                        <div
                          key={i}
                          style={{
                            color:
                              l.kind === 'same'
                                ? 'var(--text-secondary)'
                                : l.kind === 'added'
                                  ? 'var(--success)'
                                  : 'var(--danger)',
                          }}
                        >
                          {l.kind === 'same' ? '  ' : l.kind === 'added' ? '+ ' : '- '}
                          {l.text}
                        </div>
                      ))}
                    </pre>
                  ) : (
                    <div style={{ color: 'var(--warn)' }}>{t.compareTooLarge}</div>
                  )}
                </div>
              </div>
            );
          })()}
          {filteredMessages.map((msg) => (
            <div key={msg.id} className="flex items-start gap-1.5">
              {compareOn && (
                <button
                  type="button"
                  onClick={() =>
                    setPicked((prev) =>
                      prev.includes(msg.id) ? prev.filter((x) => x !== msg.id) : [...prev.slice(-1), msg.id],
                    )
                  }
                  aria-pressed={picked.includes(msg.id)}
                  aria-label={`${t.compareToggle} ${msg.topic}`}
                  data-testid={`pick-${msg.id}`}
                  className="mt-2 w-5 h-5 shrink-0 rounded border text-[10px] font-bold flex items-center justify-center"
                  style={
                    picked.includes(msg.id)
                      ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-contrast)' }
                      : { background: 'var(--bg-inset)', borderColor: 'var(--border-inset)', color: 'var(--text-muted)' }
                  }
                >
                  {picked.indexOf(msg.id) >= 0 ? picked.indexOf(msg.id) + 1 : '·'}
                </button>
              )}
              <div className="min-w-0 flex-1">
            <MessageRow
              msg={msg}
              viewMode={viewMode}
              copied={copiedId === msg.id}
              replayed={replayedId === msg.id}
              connected={connected}
              codecScript={codecScript}
              onCopy={handleCopy}
              onReplay={handleReplay}
              onQuickSubscribe={onQuickSubscribe}
              broker={broker}
              onTrace={onTrace}
              onSendAsRpc={handleSendAsRpc}
              onFilterTopic={handleFilterTopic}
              t={t}
            />
              </div>
            </div>
          ))}
          </>
        )}
        {filteredMessages.some((m) => m.truncated) && (
          <div className="text-[11px] text-center pb-1" style={{ color: 'var(--text-muted)' }}>{t.truncatedNote}</div>
        )}
      </div>
    </div>
  );
};
