import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Trash2, Sparkles, Code2, CheckCircle2, Sliders, Eye, Columns2, Eraser, Timer, Square, Play } from 'lucide-react';
import { ConsolePublishParams, PubProperties, RunStatus } from '../../types';
import { Translations } from '../../i18n';
import { PAYLOAD_FORMATS, PayloadError, PayloadFormat, payloadToBytes } from '../../utils/payload';
import { renderTemplate, TEMPLATE_TOKENS } from '../../utils/template';
import { uint8ToBase64 } from '../../utils/cbor';
import { usePersistentState } from '../../hooks/usePersistentState';
import { useSchedules } from '../../hooks/useSchedules';
import { useObservedTopics } from '../../utils/topicStore';
import { HtmlPreview, MarkdownView } from './RichText';

interface MessagePublisherProps {
  onPublishMessage: (params: ConsolePublishParams) => Promise<void>;
  connected: boolean;
  isV5: boolean;
  t: Translations;
}

const JSON_TEMPLATE = JSON.stringify(
  {
    deviceId: 'edge-client-01',
    status: 'ONLINE',
    metrics: { cpu: 18.5, memMb: 420, tempC: 36.2 },
    timestamp: Date.now(),
  },
  null,
  2,
);

const MD_TEMPLATE = `## Device Report — edge-01

| metric | value | unit |
|--------|-------|------|
| cpu    | 18.5  | %    |
| mem    | 420   | MB   |

- **Status**: ONLINE
- Firmware: \`v2.4.1\`

> Alert: temperature trending up ✅
`;

const HTML_TEMPLATE = `<div style="font-family:sans-serif">
  <h3 style="margin:0">📦 Shipment #8291</h3>
  <p>State: <b style="color:#059669">delivered</b></p>
  <ul><li>12 crates</li><li>ETA 14:30 UTC</li></ul>
</div>`;

const DEFAULT_PAYLOADS: Record<string, string> = {
  json: JSON_TEMPLATE,
  text: 'Hello DropQTT',
  markdown: MD_TEMPLATE,
  html: HTML_TEMPLATE,
  cbor: '{\n  "sensorId": 42,\n  "tags": ["temp", "indoor"],\n  "value": 21.5\n}',
  base64: 'SGVsbG8gRHJvcFFUVA==',
  hex: '48 65 6c 6c 6f 20 44 72 6f 70 51 54 54',
};

interface PublisherDraft {
  topic: string;
  format: string;
  payloadByFormat: Record<string, string>;
  qos: number;
  retain: boolean;
}

const formatBytes = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(2)} KB`);

const RUN_STATUS_COLOR: Record<RunStatus, string> = {
  running: 'var(--success)',
  completed: 'var(--accent)',
  failed: 'var(--danger)',
  stopped: 'var(--text-muted)',
};

const RUN_STATUS_LABEL: Record<RunStatus, (t: Translations) => string> = {
  running: (t) => t.scheduleRunNow,
  completed: (t) => t.scheduleRunDone,
  failed: (t) => t.scheduleRunFailed,
  stopped: (t) => t.scheduleRunStopped,
};

export const MessagePublisher: React.FC<MessagePublisherProps> = ({
  onPublishMessage,
  connected,
  isV5,
  t,
}) => {
  // Draft survives restarts; recent topics feed the autocomplete dropdown
  const [draft, setDraft] = usePersistentState<PublisherDraft>('dropqtt_console_draft', {
    topic: 'test/topic',
    format: 'json',
    payloadByFormat: DEFAULT_PAYLOADS,
    qos: 0,
    retain: false,
  });
  const [recentTopics, setRecentTopics] = usePersistentState<string[]>('dropqtt_recent_topics', []);
  const observedTopics = useObservedTopics();
  // Autocomplete = manually-published (recent) ∪ live broker traffic (observed)
  const topicSuggestions = useMemo(
    () => Array.from(new Set([...recentTopics, ...observedTopics])).slice(0, 60),
    [recentTopics, observedTopics],
  );

  const [format, setFormat] = useState<string>(draft.format);
  const [payloadByFormat, setPayloadByFormat] = useState<Record<string, string>>({
    ...DEFAULT_PAYLOADS,
    ...draft.payloadByFormat,
  });
  const [topic, setTopic] = useState(draft.topic);
  const [qos, setQos] = useState<number>(draft.qos);
  const [retain, setRetain] = useState<boolean>(draft.retain);

  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [successToast, setSuccessToast] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [layout, setLayout] = useState<'code' | 'split' | 'preview'>('code');

  // MQTT v5 properties
  const [showProps, setShowProps] = useState(false);
  const [contentType, setContentType] = useState('');
  const [messageExpiry, setMessageExpiry] = useState<string>('');
  const [userProps, setUserProps] = useState<[string, string][]>([]);
  const [responseTopic, setResponseTopic] = useState('');
  const [correlationData, setCorrelationData] = useState('');

  // Scheduled publishing is driven by the backend; these are just the parameters
  // for the next run the user starts.
  const [showLoop, setShowLoop] = useState(false);
  const [schedIntervalMs, setSchedIntervalMs] = usePersistentState<number>(
    'dropqtt_console_schedule_interval',
    2000,
  );
  const [schedCount, setSchedCount] = usePersistentState<number>(
    'dropqtt_console_schedule_count',
    0, // 0 = until stopped
  );
  const {
    runs,
    lastError: scheduleError,
    start: startRun,
    stop: stopRun,
    stopAll: stopAllRuns,
    clearFinished: clearFinishedRuns,
  } = useSchedules(true);
  const runningCount = runs.filter((r) => r.status === 'running').length;
  // Manual sends count up locally; each scheduled run counts in the backend.
  const counterRef = useRef(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const payload = payloadByFormat[format] ?? '';
  const setPayload = (text: string) => setPayloadByFormat((prev) => ({ ...prev, [format]: text }));

  // Persist draft (debounced via effect batching; cheap enough for localStorage)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDraft((prev) =>
        prev.topic === topic &&
        prev.format === format &&
        prev.qos === qos &&
        prev.retain === retain &&
        prev.payloadByFormat === payloadByFormat
          ? prev
          : { topic, format, payloadByFormat, qos, retain },
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [topic, format, payloadByFormat, qos, retain, setDraft]);

  // Live byte count of the encoded payload. Rendered with a probe first because
  // both send paths substitute `${...}` before encoding — checking the raw
  // template text flagged every templated JSON payload as invalid.
  const byteLen = useMemo(() => {
    try {
      return payloadToBytes(format as PayloadFormat, renderTemplate(payload, 1)).length;
    } catch {
      return -1;
    }
  }, [format, payload]);

  const previewKind = format === 'markdown' ? 'md' : format === 'html' ? 'html' : format === 'json' ? 'json' : null;
  const canPreview = previewKind !== null;

  // The v5 property set the current editor state describes. Shared by the manual
  // send and by a new scheduled run so both publish identically.
  const buildProps = useCallback(
    (): PubProperties => ({
      contentType:
        contentType.trim() || PAYLOAD_FORMATS.find((f) => f.id === format)?.contentType,
      userProperties: userProps.filter(([k]) => k.trim().length > 0),
      messageExpiry: messageExpiry.trim() ? Number(messageExpiry) : undefined,
      responseTopic: responseTopic.trim() || undefined,
      correlationData: correlationData.trim() || undefined,
    }),
    [contentType, format, messageExpiry, responseTopic, correlationData, userProps],
  );

  // Core send: renders ${...} template tokens against the running counter.
  // Returns true on success so both manual and loop callers can react.
  const publishNow = useCallback(async (increment = false): Promise<boolean> => {
    if (!topic.trim() || !connected) return false;
    if (increment) counterRef.current += 1;
    try {
      const rendered = renderTemplate(payload, counterRef.current);
      const bytes = payloadToBytes(format as PayloadFormat, rendered);
      const props = buildProps();
      await onPublishMessage({
        topic: topic.trim(),
        payloadBase64: uint8ToBase64(bytes),
        qos,
        retain,
        properties: props,
      });
      setRecentTopics((prev) => [topic.trim(), ...prev.filter((tp) => tp !== topic.trim())].slice(0, 8));
      return true;
    } catch (err) {
      setErrorText(err instanceof PayloadError ? err.message : String(err));
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, connected, payload, format, buildProps, qos, retain]);

  const doPublish = async () => {
    if (!topic.trim() || !connected || isPublishing) return;
    setIsPublishing(true);
    setErrorText(null);
    const ok = await publishNow();
    if (ok) {
      setSuccessToast(true);
      setTimeout(() => setSuccessToast(false), 2000);
    }
    setIsPublishing(false);
  };

  // The backend refuses cadences outside its window; mirroring the floor here
  // keeps a typed value from bouncing back as an error.
  const MIN_SCHEDULE_MS = 50;
  const scheduleUnsupported = format === 'cbor';

  const startLoop = async () => {
    if (!topic.trim() || !connected || scheduleUnsupported) return;
    setErrorText(null);
    try {
      await startRun({
        id: `sch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        topic: topic.trim(),
        payload,
        format,
        intervalMs: Math.max(MIN_SCHEDULE_MS, Math.round(schedIntervalMs) || MIN_SCHEDULE_MS),
        count: Math.max(0, Math.round(schedCount) || 0),
        qos,
        retain,
        properties: buildProps(),
      });
      setShowLoop(true);
    } catch (err) {
      setErrorText(err instanceof PayloadError ? err.message : String(err));
    }
  };

  // Insert a template token at the textarea cursor.
  const insertToken = (token: string) => {
    const el = textareaRef.current;
    if (!el) {
      setPayload(payload + token);
      return;
    }
    const start = el.selectionStart ?? payload.length;
    const end = el.selectionEnd ?? payload.length;
    const next = payload.slice(0, start) + token + payload.slice(end);
    setPayload(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    await doPublish();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      doPublish();
    }
  };

  const formatJson = () => {
    try {
      setPayload(JSON.stringify(JSON.parse(payload), null, 2));
      setErrorText(null);
    } catch (err) {
      setErrorText(String(err));
    }
  };

  const insertTemplate = () => {
    if (format === 'json' || format === 'cbor') setPayload(JSON_TEMPLATE);
    else if (format === 'markdown') setPayload(MD_TEMPLATE);
    else if (format === 'html') setPayload(HTML_TEMPLATE);
  };

  return (
    <div className="panel p-4 space-y-3.5">
      <div className="flex items-center justify-between text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
        <span className="flex items-center space-x-1.5">
          <Send className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          <span>{t.publisher}</span>
        </span>

        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => setShowLoop((v) => !v)}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[10px] transition ${showLoop ? 'font-semibold' : 'opacity-70'}`}
            style={{ borderColor: runningCount > 0 ? 'var(--success)' : 'var(--border-panel)', color: runningCount > 0 ? 'var(--success)' : 'var(--accent)' }}
            title={t.autoPublish}
          >
            <Timer className="w-3 h-3" />
            <span>{t.autoPublish}</span>
            {runningCount > 0 && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--success)' }} />}
            {runningCount > 1 && <span className="font-mono">{runningCount}</span>}
          </button>
          {isV5 && (
            <button
              type="button"
              onClick={() => setShowProps((v) => !v)}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[10px] transition ${showProps ? 'font-semibold' : 'opacity-70'}`}
              style={{ borderColor: 'var(--border-panel)', color: 'var(--accent)' }}
              title={t.v5Properties}
            >
              <Sliders className="w-3 h-3" />
              <span>v5 props</span>
            </button>
          )}
          {successToast && (
            <span className="flex items-center space-x-1 text-[10px] animate-fade-in" style={{ color: 'var(--success)' }}>
              <CheckCircle2 className="w-3 h-3" />
              <span>{t.publishSuccess}</span>
            </span>
          )}
        </div>
      </div>

      <form onSubmit={handlePublish} className="space-y-3">
        {/* Topic & QoS & Retain Row */}
        <div className="flex flex-wrap md:flex-nowrap items-center gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="test/topic"
            list="dropqtt-recent-topics"
            className="field-input flex-1 min-w-[180px]"
          />
          <datalist id="dropqtt-recent-topics">
            {topicSuggestions.map((tp) => (
              <option key={tp} value={tp} />
            ))}
          </datalist>

          {/* Payload format selector (MQTTX-style) */}
          <div className="flex items-center inset-box p-0.5 flex-wrap">
            {PAYLOAD_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                className={`px-2.5 py-1.5 rounded text-[11px] transition ${
                  format === f.id ? 'font-semibold' : 'opacity-60 hover:opacity-100'
                }`}
                style={
                  format === f.id
                    ? { background: 'var(--accent)', color: 'var(--accent-contrast)' }
                    : { color: 'var(--text-secondary)' }
                }
                title={`${t.payloadFormat}: ${f.label}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            value={qos}
            onChange={(e) => setQos(Number(e.target.value))}
            className="field-input"
          >
            <option value={0}>QoS 0</option>
            <option value={1}>QoS 1</option>
            <option value={2}>QoS 2</option>
          </select>

          <label
            className="flex items-center space-x-1.5 px-2 py-1.5 inset-box text-xs cursor-pointer select-none"
            style={{ color: 'var(--text-secondary)' }}
          >
            <input
              type="checkbox"
              checked={retain}
              onChange={(e) => setRetain(e.target.checked)}
              className="rounded focus:ring-0"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span>{t.retain}</span>
          </label>
        </div>

        {/* Scheduled publish: parameters for the next backend run + live registry */}
        {showLoop && (
          <div className="inset-box p-3 space-y-2.5 animate-fade-in">
            <div className="flex flex-wrap items-end gap-3 text-[11px]">
              <div>
                <label htmlFor="dropqtt-schedule-interval" className="block mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {t.publishInterval}
                </label>
                <input
                  id="dropqtt-schedule-interval"
                  type="number" min={MIN_SCHEDULE_MS} step={50} value={schedIntervalMs}
                  onChange={(e) => setSchedIntervalMs(Math.max(MIN_SCHEDULE_MS, Number(e.target.value) || MIN_SCHEDULE_MS))}
                  className="field-input w-24"
                />
              </div>
              <div>
                <label htmlFor="dropqtt-schedule-count" className="block mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {t.publishCount}
                </label>
                <input
                  id="dropqtt-schedule-count"
                  type="number" min={0} step={1} value={schedCount}
                  onChange={(e) => setSchedCount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="field-input w-20"
                  title={t.publishCountHint}
                />
              </div>
              <button
                type="button"
                onClick={startLoop}
                disabled={!connected || !topic.trim() || scheduleUnsupported}
                className="btn-accent flex items-center gap-1.5 !py-1.5"
                title={scheduleUnsupported ? t.scheduleUnsupported : undefined}
              >
                <Play className="w-3 h-3" /><span>{t.startPublish}</span>
              </button>
              {runningCount > 0 && (
                <button
                  type="button"
                  onClick={() => void stopAllRuns()}
                  className="btn-ghost flex items-center gap-1.5 !py-1.5"
                  style={{ color: 'var(--danger)' }}
                >
                  <Square className="w-3 h-3" /><span>{t.scheduleStopAll}</span>
                </button>
              )}
              <div className="ml-auto text-right text-[10px]" style={{ color: 'var(--text-muted)' }}>
                <div>{t.templateTokens}: {'${counter} ${timestamp} ${uuid} ${random}'}</div>
              </div>
            </div>

            <div className="text-[10px] leading-relaxed" style={{ color: scheduleUnsupported ? 'var(--warning)' : 'var(--text-muted)' }}>
              {scheduleUnsupported ? t.scheduleUnsupported : t.scheduleNote}
            </div>

            <div className="space-y-1">
              {runs.length === 0 && (
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.scheduleEmpty}</div>
              )}
              {runs.map((r) => (
                <div key={r.id} className="space-y-0.5">
                  <div className="flex items-center gap-2 text-[10px]">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: RUN_STATUS_COLOR[r.status] }}
                    />
                    <span className="font-mono truncate" style={{ color: 'var(--text-primary)' }} title={r.topic}>
                      {r.topic}
                    </span>
                    <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {r.intervalMs} ms · QoS {r.qos}
                      {r.retain ? ' · retain' : ''} · {r.format}
                    </span>
                    <span className="ml-auto font-mono shrink-0" style={{ color: 'var(--text-secondary)' }}>
                      {t.published} {r.sent}
                      {r.count > 0 ? ` / ${r.count}` : ''}
                    </span>
                    <span className="shrink-0" style={{ color: RUN_STATUS_COLOR[r.status] }}>
                      {RUN_STATUS_LABEL[r.status](t)}
                    </span>
                    {r.status === 'running' && (
                      <button
                        type="button"
                        onClick={() => void stopRun(r.id)}
                        className="shrink-0 opacity-70 hover:opacity-100"
                        title={t.stopPublish}
                      >
                        <Square className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {r.lastError && (
                    <div className="pl-3.5 text-[10px] break-all" style={{ color: 'var(--danger)' }}>
                      {r.lastError}
                    </div>
                  )}
                </div>
              ))}
              {runs.some((r) => r.status !== 'running') && (
                <button
                  type="button"
                  onClick={() => void clearFinishedRuns()}
                  className="text-[10px] underline opacity-60 hover:opacity-100"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {t.clear}
                </button>
              )}
              {scheduleError && (
                <div role="alert" className="text-[10px]" style={{ color: 'var(--danger)' }}>
                  {scheduleError}
                </div>
              )}
            </div>
          </div>
        )}

        {/* MQTT v5 properties panel */}
        {isV5 && showProps && (
          <div className="inset-box p-3 space-y-2.5 text-xs animate-fade-in">
            <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {t.v5Properties}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                type="text"
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                placeholder={`${t.contentTypeLabel} (e.g. application/json)`}
                className="field-input text-[11px]"
              />
              <input
                type="number"
                value={messageExpiry}
                onChange={(e) => setMessageExpiry(e.target.value)}
                placeholder={`${t.messageExpiryLabel} (default: broker)`}
                className="field-input text-[11px]"
                min={0}
              />
            </div>
            {/* Request/Response (RPC) properties */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                type="text"
                value={responseTopic}
                onChange={(e) => setResponseTopic(e.target.value)}
                placeholder={t.responseTopicLabel}
                className="field-input text-[11px]"
                title={t.responseTopicHint}
              />
              <input
                type="text"
                value={correlationData}
                onChange={(e) => setCorrelationData(e.target.value)}
                placeholder={t.correlationDataLabel}
                className="field-input text-[11px]"
                title={t.correlationDataHint}
              />
            </div>
            {userProps.map(([k, v], idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={k}
                  placeholder={t.propertyKey}
                  onChange={(e) =>
                    setUserProps((prev) => prev.map((p, i) => (i === idx ? [e.target.value, p[1]] : p)))
                  }
                  className="field-input text-[11px] flex-1"
                />
                <input
                  type="text"
                  value={v}
                  placeholder={t.propertyValue}
                  onChange={(e) =>
                    setUserProps((prev) => prev.map((p, i) => (i === idx ? [p[0], e.target.value] : p)))
                  }
                  className="field-input text-[11px] flex-1"
                />
                <button
                  type="button"
                  onClick={() => setUserProps((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-1 opacity-60 hover:opacity-100 transition"
                  style={{ color: 'var(--danger)' }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setUserProps((prev) => [...prev, ['', '']])}
              className="px-2 py-1 rounded text-[10px] border transition opacity-80 hover:opacity-100"
              style={{ borderColor: 'var(--border-panel)', color: 'var(--accent)' }}
            >
              + {t.addProperty}
            </button>
          </div>
        )}

        {/* Editor toolbar */}
        <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <span className="flex items-center gap-2">
            <span>
              {t.payload}
              {format !== 'text' && ` (${format.toUpperCase()})`}
            </span>
            <span
              className="px-1.5 py-0.5 rounded border text-[11px] font-mono"
              style={{
                borderColor: byteLen < 0 ? 'var(--danger)' : 'var(--border-inset)',
                color: byteLen < 0 ? 'var(--danger)' : 'var(--text-muted)',
              }}
              title={t.payload}
            >
              {byteLen < 0 ? '⚠ invalid' : formatBytes(byteLen)}
            </span>
            {errorText && <span style={{ color: 'var(--danger)' }}>— {errorText}</span>}
          </span>
          <div className="flex items-center space-x-2">
            {canPreview && (
              <div className="flex items-center inset-box p-0.5">
                {(['code', 'split', 'preview'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLayout(l)}
                    title={l === 'split' ? `${t.preview} / ${t.payload}` : l === 'preview' ? t.preview : t.payload}
                    className="px-2 py-1 rounded text-[11px] transition"
                    style={
                      layout === l
                        ? { background: 'var(--accent)', color: 'var(--accent-contrast)' }
                        : { color: 'var(--text-secondary)' }
                    }
                  >
                    {l === 'code' ? <Code2 className="w-3 h-3" /> : l === 'split' ? <Columns2 className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={insertTemplate}
              className="flex items-center space-x-1 transition opacity-70 hover:opacity-100"
              title={t.payloadFormat}
            >
              <Sparkles className="w-3 h-3" />
              <span>Template</span>
            </button>
            {(format === 'json' || format === 'cbor') && (
              <>
                <span>•</span>
                <button
                  type="button"
                  onClick={formatJson}
                  className="flex items-center space-x-1 transition opacity-70 hover:opacity-100"
                >
                  <Code2 className="w-3 h-3" />
                  <span>Prettify</span>
                </button>
              </>
            )}
            <span>•</span>
            <button
              type="button"
              onClick={() => setPayload('')}
              className="transition opacity-70 hover:opacity-100"
              style={{ color: 'var(--danger)' }}
              title={t.clearMessages}
            >
              <Eraser className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Template-variable insert chips (substituted at publish time) */}
        <div className="flex items-center flex-wrap gap-1.5 text-[10px]">
          <span style={{ color: 'var(--text-muted)' }}>{t.templateTokens}:</span>
          {TEMPLATE_TOKENS.map((tk) => (
            <button
              key={tk.token}
              type="button"
              onClick={() => insertToken(tk.token)}
              title={tk.desc}
              className="px-1.5 py-0.5 rounded border font-mono transition hover:opacity-100 opacity-80"
              style={{ borderColor: 'var(--border-inset)', color: 'var(--accent)', background: 'var(--bg-inset)' }}
            >
              {tk.token}
            </button>
          ))}
        </div>

        {/* Editor + optional live preview */}
        <div className={canPreview && layout === 'split' ? 'workspace-split' : 'space-y-2'}>
          {(layout === 'code' || layout === 'split') && (
            <textarea
              ref={textareaRef}
              rows={9}
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                format === 'hex'
                  ? '48 65 6c 6c 6f'
                  : format === 'base64'
                  ? 'SGVsbG8='
                  : format === 'markdown'
                  ? '# Hello **world**'
                  : '{"key": "value"}'
              }
              className="w-full field-input resize-y text-xs leading-relaxed"
              style={{ background: 'var(--bg-code)', color: 'var(--code-text)', minHeight: '12rem' }}
            />
          )}

          {canPreview && layout !== 'code' && (
            <div
              className="inset-box p-3 overflow-y-auto text-[13px]"
              style={{ background: layout === 'split' ? 'var(--bg-panel-solid)' : 'var(--bg-inset)', minHeight: layout === 'split' ? '14rem' : '12rem', maxHeight: '28rem' }}
            >
              {previewKind === 'md' && <MarkdownView text={payload} />}
              {previewKind === 'html' && <HtmlPreview source={payload} />}
              {previewKind === 'json' && (
                <pre className="text-[11px] font-mono whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(payload), null, 2);
                    } catch {
                      return '⚠ invalid JSON';
                    }
                  })()}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] opacity-60" style={{ color: 'var(--text-muted)' }}>
            {t.sendHint}
          </span>
          <button
            type="submit"
            disabled={!connected || !topic.trim() || isPublishing}
            className="btn-accent flex items-center space-x-2"
          >
            <Send className={`w-3.5 h-3.5 ${isPublishing ? 'animate-spin' : ''}`} />
            <span>{isPublishing ? 'Publishing...' : t.publish}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
