import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Trash2, Sparkles, Code2, CheckCircle2, Sliders, Eye, Columns2, Eraser } from 'lucide-react';
import { ConsolePublishParams, PubProperties } from '../../types';
import { Translations } from '../../i18n';
import { PAYLOAD_FORMATS, PayloadError, PayloadFormat, payloadToBytes } from '../../utils/payload';
import { uint8ToBase64 } from '../../utils/cbor';
import { usePersistentState } from '../../hooks/usePersistentState';
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

  // Live byte count of the encoded payload
  const byteLen = useMemo(() => {
    try {
      return payloadToBytes(format as PayloadFormat, payload).length;
    } catch {
      return -1;
    }
  }, [format, payload]);

  const previewKind = format === 'markdown' ? 'md' : format === 'html' ? 'html' : format === 'json' ? 'json' : null;
  const canPreview = previewKind !== null;

  const doPublish = async () => {
    if (!topic.trim() || !connected || isPublishing) return;
    setIsPublishing(true);
    setErrorText(null);
    try {
      const bytes = payloadToBytes(format as PayloadFormat, payload);
      const props: PubProperties = {
        contentType: contentType.trim() || PAYLOAD_FORMATS.find((f) => f.id === format)?.contentType,
        userProperties: userProps.filter(([k]) => k.trim().length > 0),
        messageExpiry: messageExpiry.trim() ? Number(messageExpiry) : undefined,
      };
      await onPublishMessage({
        topic: topic.trim(),
        payloadBase64: uint8ToBase64(bytes),
        qos,
        retain,
        properties: props,
      });
      setSuccessToast(true);
      setTimeout(() => setSuccessToast(false), 2000);
      // Track recently used topics (dedup, most-recent-first, cap 8)
      setRecentTopics((prev) => [topic.trim(), ...prev.filter((tp) => tp !== topic.trim())].slice(0, 8));
    } catch (err) {
      setErrorText(err instanceof PayloadError ? err.message : String(err));
    } finally {
      setIsPublishing(false);
    }
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
            {recentTopics.map((tp) => (
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
              className="rounded bg-slate-900 border-slate-700 focus:ring-0"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span>{t.retain}</span>
          </label>
        </div>

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

        {/* Editor + optional live preview */}
        <div className={canPreview && layout === 'split' ? 'grid grid-cols-1 lg:grid-cols-2 gap-2' : 'space-y-2'}>
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
              style={{ background: 'var(--bg-code)', color: '#d3dae6', minHeight: '12rem' }}
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
