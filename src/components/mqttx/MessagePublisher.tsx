import React, { useState } from 'react';
import { Send, Code2, Sparkles, Trash2, CheckCircle2 } from 'lucide-react';
import { Translations } from '../../i18n';

interface MessagePublisherProps {
  onPublishMessage: (topic: string, payload: string, qos: number, retain: boolean) => Promise<void>;
  connected: boolean;
  t: Translations;
}

export const MessagePublisher: React.FC<MessagePublisherProps> = ({
  onPublishMessage,
  connected,
  t,
}) => {
  const [topic, setTopic] = useState('test/topic');
  const [payload, setPayload] = useState('{\n  "msg": "Hello DropQTT",\n  "timestamp": ' + Date.now() + '\n}');
  const [qos, setQos] = useState<number>(0);
  const [retain, setRetain] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [successToast, setSuccessToast] = useState<boolean>(false);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || !connected || isPublishing) return;

    setIsPublishing(true);
    try {
      await onPublishMessage(topic.trim(), payload, qos, retain);
      setSuccessToast(true);
      setTimeout(() => setSuccessToast(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsPublishing(false);
    }
  };

  const insertJsonTemplate = () => {
    setPayload(JSON.stringify({
      deviceId: 'edge-client-01',
      status: 'ONLINE',
      metrics: {
        cpu: 18.5,
        memMb: 420,
        tempC: 36.2
      },
      timestamp: Date.now()
    }, null, 2));
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(payload);
      setPayload(JSON.stringify(parsed, null, 2));
    } catch {
      // not valid json, ignore
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded font-mono p-3 space-y-3">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
        <span className="flex items-center space-x-1.5">
          <Send className="w-3.5 h-3.5 text-cyan-400" />
          <span>{t.publisher}</span>
        </span>

        {successToast && (
          <span className="flex items-center space-x-1 text-emerald-400 text-[10px] animate-fade-in">
            <CheckCircle2 className="w-3 h-3" />
            <span>{t.publishSuccess}</span>
          </span>
        )}
      </div>

      <form onSubmit={handlePublish} className="space-y-2.5">
        {/* Topic & QoS & Retain Row */}
        <div className="flex flex-wrap md:flex-nowrap items-center gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="test/topic"
            className="flex-1 bg-slate-950 border border-slate-700/80 focus:border-cyan-500 rounded px-3 py-1.5 text-xs text-cyan-300 font-mono focus:outline-none transition"
          />

          <select
            value={qos}
            onChange={(e) => setQos(Number(e.target.value))}
            className="bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
          >
            <option value={0}>QoS 0</option>
            <option value={1}>QoS 1</option>
            <option value={2}>QoS 2</option>
          </select>

          <label className="flex items-center space-x-1.5 px-2 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={retain}
              onChange={(e) => setRetain(e.target.checked)}
              className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
            />
            <span>{t.retain}</span>
          </label>
        </div>

        {/* Payload Helper Buttons */}
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>{t.payload}:</span>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={insertJsonTemplate}
              className="text-slate-400 hover:text-cyan-400 flex items-center space-x-1 transition"
            >
              <Sparkles className="w-3 h-3" />
              <span>JSON Template</span>
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={formatJson}
              className="text-slate-400 hover:text-cyan-400 flex items-center space-x-1 transition"
            >
              <Code2 className="w-3 h-3" />
              <span>Prettify</span>
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => setPayload('')}
              className="text-slate-400 hover:text-rose-400 transition"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Textarea */}
        <textarea
          rows={4}
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          placeholder='{"key": "value"}'
          className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded p-2.5 text-xs text-slate-200 font-mono focus:outline-none resize-y transition"
        />

        {/* Action button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!connected || !topic.trim() || isPublishing}
            className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded text-xs font-semibold flex items-center space-x-2 transition shadow-sm"
          >
            <Send className={`w-3.5 h-3.5 ${isPublishing ? 'animate-spin' : ''}`} />
            <span>{isPublishing ? 'Publishing...' : t.publish}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
