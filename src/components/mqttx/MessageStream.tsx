import React, { useState } from 'react';
import { Search, Trash2, Copy, Check, ArrowDownRight, ArrowUpRight, Code2, AlignLeft, Binary } from 'lucide-react';
import { MqttGenericMessage } from '../../types';
import { Translations } from '../../i18n';

interface MessageStreamProps {
  messages: MqttGenericMessage[];
  onClearMessages: () => void;
  t: Translations;
}

type ViewMode = 'json' | 'raw' | 'hex';
type DirectionFilter = 'all' | 'in' | 'out';

export const MessageStream: React.FC<MessageStreamProps> = ({
  messages,
  onClearMessages,
  t,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('json');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredMessages = messages.filter((msg) => {
    if (directionFilter !== 'all' && msg.direction !== directionFilter) {
      return false;
    }
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return msg.topic.toLowerCase().includes(term) || msg.payload.toLowerCase().includes(term);
  });

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const formatPayload = (raw: string, mode: ViewMode) => {
    if (mode === 'json') {
      try {
        const parsed = JSON.parse(raw);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return raw;
      }
    }
    if (mode === 'hex') {
      // Hex representation of string bytes
      let hex = '';
      for (let i = 0; i < raw.length; i++) {
        const h = raw.charCodeAt(i).toString(16).padStart(2, '0');
        hex += h + ' ';
        if ((i + 1) % 16 === 0) hex += '\n';
      }
      return hex.trim();
    }
    return raw;
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded font-mono flex flex-col h-[400px] overflow-hidden">
      {/* Toolbar */}
      <div className="p-2.5 bg-slate-950/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center space-x-2 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t.filterTopic}
              className="w-full bg-slate-900 border border-slate-700/80 rounded pl-8 pr-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Direction Filter */}
          <div className="flex items-center space-x-1 bg-slate-900 border border-slate-800 rounded p-0.5">
            <button
              onClick={() => setDirectionFilter('all')}
              className={`px-2 py-0.5 rounded text-[10px] transition ${
                directionFilter === 'all' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.allDirections}
            </button>
            <button
              onClick={() => setDirectionFilter('in')}
              className={`px-2 py-0.5 rounded text-[10px] transition ${
                directionFilter === 'in' ? 'bg-emerald-950 text-emerald-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              IN
            </button>
            <button
              onClick={() => setDirectionFilter('out')}
              className={`px-2 py-0.5 rounded text-[10px] transition ${
                directionFilter === 'out' ? 'bg-cyan-950 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              OUT
            </button>
          </div>
        </div>

        {/* View Mode & Clear */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1 bg-slate-900 border border-slate-800 rounded p-0.5">
            <button
              onClick={() => setViewMode('json')}
              title={t.formatJson}
              className={`px-2 py-0.5 rounded text-[10px] flex items-center space-x-1 transition ${
                viewMode === 'json' ? 'bg-cyan-950 text-cyan-300 font-semibold' : 'text-slate-400'
              }`}
            >
              <Code2 className="w-3 h-3" />
              <span>JSON</span>
            </button>
            <button
              onClick={() => setViewMode('raw')}
              title={t.formatRaw}
              className={`px-2 py-0.5 rounded text-[10px] flex items-center space-x-1 transition ${
                viewMode === 'raw' ? 'bg-cyan-950 text-cyan-300 font-semibold' : 'text-slate-400'
              }`}
            >
              <AlignLeft className="w-3 h-3" />
              <span>RAW</span>
            </button>
            <button
              onClick={() => setViewMode('hex')}
              title={t.formatHex}
              className={`px-2 py-0.5 rounded text-[10px] flex items-center space-x-1 transition ${
                viewMode === 'hex' ? 'bg-cyan-950 text-cyan-300 font-semibold' : 'text-slate-400'
              }`}
            >
              <Binary className="w-3 h-3" />
              <span>HEX</span>
            </button>
          </div>

          <button
            onClick={onClearMessages}
            title={t.clearMessages}
            className="p-1 rounded bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-rose-400 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Message Feed List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2 space-y-2">
        {filteredMessages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-500 text-xs italic">
            {messages.length === 0 ? 'No MQTT messages recorded yet.' : 'No messages matching current search filter.'}
          </div>
        ) : (
          filteredMessages.map((msg) => {
            const isOut = msg.direction === 'out';
            const formatted = formatPayload(msg.payload, viewMode);
            const isCopied = copiedId === msg.id;

            return (
              <div key={msg.id} className="pt-2 text-xs group">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center space-x-2 truncate max-w-[80%]">
                    {/* Direction Chip */}
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-bold border flex items-center space-x-0.5 ${
                        isOut
                          ? 'bg-cyan-950/60 text-cyan-300 border-cyan-800'
                          : 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                      }`}
                    >
                      {isOut ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                      <span>{isOut ? 'OUT' : 'IN'}</span>
                    </span>

                    {/* Topic Badge */}
                    <span className="font-semibold text-slate-200 truncate bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {msg.topic}
                    </span>

                    {/* QoS & Retain */}
                    <span className="text-[10px] text-slate-500">QoS {msg.qos}</span>
                    {msg.retain && (
                      <span className="text-[9px] px-1 py-0.2 bg-amber-950/60 border border-amber-800 text-amber-300 rounded">
                        RETAIN
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 text-[10px] text-slate-500">
                    <span>{msg.payloadLen} B</span>
                    <span>{msg.timestamp}</span>
                    <button
                      onClick={() => handleCopy(msg.id, msg.payload)}
                      title={t.copy}
                      className="text-slate-500 hover:text-cyan-400 transition"
                    >
                      {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                {/* Payload Body */}
                <div className="bg-slate-950/90 rounded p-2 border border-slate-800/80 overflow-x-auto text-[11px] font-mono text-slate-300 whitespace-pre leading-relaxed">
                  {formatted}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
