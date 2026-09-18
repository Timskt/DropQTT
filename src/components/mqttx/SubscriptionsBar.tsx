import React, { useState } from 'react';
import { Plus, Radio, X } from 'lucide-react';
import { TopicSubscription } from '../../types';
import { Translations } from '../../i18n';

interface SubscriptionsBarProps {
  subscriptions: TopicSubscription[];
  onAddSubscription: (topic: string, qos: number, color?: string) => void;
  onRemoveSubscription: (topic: string) => void;
  connected: boolean;
  t: Translations;
}

const COLOR_PALETTE = ['#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6'];

export const SubscriptionsBar: React.FC<SubscriptionsBarProps> = ({
  subscriptions,
  onAddSubscription,
  onRemoveSubscription,
  connected,
  t,
}) => {
  const [topicInput, setTopicInput] = useState('');
  const [qos, setQos] = useState<number>(0);
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicInput.trim() || !connected) return;
    onAddSubscription(topicInput.trim(), qos, selectedColor);
    setTopicInput('');
    // Cycle to next color
    const nextIdx = (COLOR_PALETTE.indexOf(selectedColor) + 1) % COLOR_PALETTE.length;
    setSelectedColor(COLOR_PALETTE[nextIdx]);
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded font-mono p-3 space-y-3">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
        <span className="flex items-center space-x-1.5">
          <Radio className="w-3.5 h-3.5 text-emerald-400" />
          <span>{t.subscriptions} ({subscriptions.length})</span>
        </span>
      </div>

      {/* Add Subscription Form */}
      <form onSubmit={handleAdd} className="flex flex-wrap md:flex-nowrap items-center gap-2">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder={t.topicPattern}
            className="w-full bg-slate-950 border border-slate-700/80 focus:border-emerald-500 rounded px-3 py-1.5 text-xs text-emerald-300 font-mono focus:outline-none transition"
          />
        </div>

        <select
          value={qos}
          onChange={(e) => setQos(Number(e.target.value))}
          className="bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
        >
          <option value={0}>QoS 0</option>
          <option value={1}>QoS 1</option>
          <option value={2}>QoS 2</option>
        </select>

        {/* Color picker pills */}
        <div className="flex items-center space-x-1 px-1 bg-slate-950/80 border border-slate-800 rounded py-1">
          {COLOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setSelectedColor(color)}
              className="w-3.5 h-3.5 rounded-full border border-slate-700 transition"
              style={{
                backgroundColor: color,
                outline: selectedColor === color ? '2px solid white' : 'none',
                outlineOffset: '1px',
              }}
            />
          ))}
        </div>

        <button
          type="submit"
          disabled={!connected || !topicInput.trim()}
          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded text-xs font-semibold flex items-center space-x-1 transition shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t.subscribe}</span>
        </button>
      </form>

      {/* Active Subscriptions Chips */}
      <div className="flex flex-wrap gap-2 pt-1 min-h-[32px] items-center">
        {subscriptions.length === 0 ? (
          <div className="text-[11px] text-slate-500 italic">
            {t.noSubscriptions}
          </div>
        ) : (
          subscriptions.map((sub) => (
            <div
              key={sub.topic}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-slate-300 shadow-sm"
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: sub.color || '#10b981' }}
              />
              <span className="font-semibold text-slate-200">{sub.topic}</span>
              <span className="text-[10px] px-1 py-0.2 rounded bg-slate-900 border border-slate-700 text-slate-400 font-mono">
                QoS {sub.qos}
              </span>
              <button
                onClick={() => onRemoveSubscription(sub.topic)}
                title={t.unsubscribe}
                className="p-0.5 text-slate-500 hover:text-rose-400 transition ml-1"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
