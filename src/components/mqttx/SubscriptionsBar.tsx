import React, { useState } from 'react';
import { Plus, Radio, X, RotateCcw } from 'lucide-react';
import { TopicSubscription } from '../../types';
import { Translations } from '../../i18n';

interface SubscriptionsBarProps {
  subscriptions: TopicSubscription[];
  onAddSubscription: (topic: string, qos: number, color?: string) => void;
  onRemoveSubscription: (topic: string) => void;
  /** Topic filter -> inbound publish hit count (backend-maintained) */
  hitStats: Record<string, number>;
  onResetStats: () => void;
  connected: boolean;
  t: Translations;
}

const COLOR_PALETTE = ['#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6'];

export const SubscriptionsBar: React.FC<SubscriptionsBarProps> = ({
  subscriptions,
  onAddSubscription,
  onRemoveSubscription,
  hitStats,
  onResetStats,
  connected,
  t,
}) => {
  const [topicInput, setTopicInput] = useState('');
  const [qos, setQos] = useState<number>(0);
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0]);

  const totalHits = Object.values(hitStats).reduce((a, b) => a + b, 0);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicInput.trim()) return;
    onAddSubscription(topicInput.trim(), qos, selectedColor);
    setTopicInput('');
    // Cycle to next color
    const nextIdx = (COLOR_PALETTE.indexOf(selectedColor) + 1) % COLOR_PALETTE.length;
    setSelectedColor(COLOR_PALETTE[nextIdx]);
  };

  return (
    <div className="panel p-4 space-y-3.5 font-mono">
      <div className="flex items-center justify-between text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
        <span className="flex items-center space-x-1.5">
          <Radio className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
          <span>{t.subscriptions} ({subscriptions.length})</span>
          {totalHits > 0 && (
            <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>
              · {t.hitTotal.replace('{count}', String(totalHits))}
            </span>
          )}
        </span>
        {totalHits > 0 && (
          <button
            onClick={onResetStats}
            title={t.resetStats}
            className="flex items-center gap-1 text-[11px] font-normal transition hover:opacity-100 opacity-60"
            style={{ color: 'var(--accent)' }}
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t.resetStats}</span>
          </button>
        )}
      </div>

      {/* Add Subscription Form */}
      <form onSubmit={handleAdd} className="flex flex-wrap md:flex-nowrap items-center gap-2.5">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder={t.topicPattern}
            className="field-input w-full"
            style={{ color: 'var(--success)' }}
          />
        </div>

        <select
          value={qos}
          onChange={(e) => setQos(Number(e.target.value))}
          className="field-input px-2.5"
        >
          <option value={0}>QoS 0</option>
          <option value={1}>QoS 1</option>
          <option value={2}>QoS 2</option>
        </select>

        {/* Color picker pills */}
        <div className="flex items-center space-x-1 px-1.5 inset-box py-1.5">
          {COLOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setSelectedColor(color)}
              className="w-3.5 h-3.5 rounded-full transition"
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
          disabled={!topicInput.trim()}
          title={connected ? undefined : t.connectFirst}
          className="btn-accent px-3.5 py-2 font-semibold flex items-center space-x-1"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t.subscribe}</span>
        </button>
      </form>

      {/* Active Subscriptions Chips */}
      <div className="flex flex-wrap gap-2 pt-1 min-h-[36px] items-center">
        {subscriptions.length === 0 ? (
          <div className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
            {t.noSubscriptions}
          </div>
        ) : (
          subscriptions.map((sub) => (
            <div
              key={sub.topic}
              className="flex items-center space-x-2 px-3 py-1.5 inset-box text-xs shadow-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: sub.color || '#10b981' }}
              />
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{sub.topic}</span>
              <span className="text-[11px] px-1 py-0.5 inset-box font-mono" style={{ color: 'var(--text-muted)' }}>
                QoS {sub.qos}
              </span>
              <span
                className={`chip ${
                  (hitStats[sub.topic] ?? 0) > 0 ? 'chip-ok' : 'chip-neutral'
                }`}
                title={t.hitCount}
              >
                {(hitStats[sub.topic] ?? 0).toLocaleString()} ↓
              </span>
              <button
                onClick={() => onRemoveSubscription(sub.topic)}
                title={t.unsubscribe}
                className="p-0.5 transition hover:opacity-100 opacity-50 ml-1"
                style={{ color: 'var(--danger)' }}
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
