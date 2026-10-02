import React, { useMemo, useState } from 'react';
import { Plus, Radio, X, RotateCcw, SlidersHorizontal, Users } from 'lucide-react';
import { SubOptions, TopicSubscription, subOptionsDefaults } from '../../types';
import { Translations } from '../../i18n';
import { ackHex, describeAck } from '../../utils/ackReason';
import type { SubscriptionAck } from '../../hooks/useSubscriptionStats';
import { useObservedTopics } from '../../utils/topicStore';

interface SubscriptionsBarProps {
  subscriptions: TopicSubscription[];
  onAddSubscription: (topic: string, qos: number, color?: string, options?: SubOptions) => void;
  onRemoveSubscription: (topic: string) => void;
  /** Topic filter -> inbound publish hit count (backend-maintained) */
  hitStats: Record<string, number>;
  /** What the broker actually said about each filter (SUBACK verdicts) */
  ack: SubscriptionAck;
  onResetStats: () => void;
  connected: boolean;
  /** v5 subscription options have no v3.1.1 wire equivalent. */
  isV5: boolean;
  t: Translations;
}

const COLOR_PALETTE = ['#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6'];

export const SubscriptionsBar: React.FC<SubscriptionsBarProps> = ({
  subscriptions,
  onAddSubscription,
  onRemoveSubscription,
  hitStats,
  ack,
  onResetStats,
  connected,
  isV5,
  t,
}) => {
  const [topicInput, setTopicInput] = useState('');
  const [qos, setQos] = useState<number>(0);
  const [opts, setOpts] = useState<SubOptions>(subOptionsDefaults(0));
  const [showOptions, setShowOptions] = useState(false);
  const [sharedOn, setSharedOn] = useState(false);
  const [shareGroup, setShareGroup] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0]);
  const observedTopics = useObservedTopics();
  // Suggest live topics not already subscribed (drop trailing segment into a filter later)
  const topicSuggestions = useMemo(
    () =>
      observedTopics
        .filter((tp) => !subscriptions.some((s) => s.topic === tp))
        .slice(0, 40),
    [observedTopics, subscriptions],
  );

  const totalHits = Object.values(hitStats).reduce((a, b) => a + b, 0);

  /** `$share/<group>/<filter>` -> the group, for display only. */
  const shareGroupOf = (topic: string): string | null => {
    const m = /^\$share\/([^/]+)\/(.+)$/.exec(topic);
    return m ? m[1] : null;
  };

  const composedTopic = (): string => {
    const raw = topicInput.trim();
    if (isV5 && sharedOn && shareGroup.trim()) return `$share/${shareGroup.trim()}/${raw}`;
    return raw;
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const topic = composedTopic();
    if (!topicInput.trim()) return;
    if (sharedOn && !shareGroup.trim()) return;
    onAddSubscription(topic, qos, selectedColor, isV5 ? { ...opts, qos } : undefined);
    setTopicInput('');
    // Cycle to next color
    const nextIdx = (COLOR_PALETTE.indexOf(selectedColor) + 1) % COLOR_PALETTE.length;
    setSelectedColor(COLOR_PALETTE[nextIdx]);
  };

  // A refused filter is the one case where the broker contradicts the green dot.
  const refusalNote = (topic: string): { label: string; detail: string } | null => {
    const r = ack.rejected[topic];
    if (!r) return null;
    const label = describeAck(r.code, 'sub', t);
    const detail = [
      `${ackHex(r.code)} ${label}`,
      t.subQuarantinedHint,
      r.reasonString ? `broker: ${r.reasonString}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return { label, detail };
  };

  const activeFlags = (o?: SubOptions) =>
    o ? [o.noLocal && 'noLocal', o.retainAsPublished && 'retainAsPublished', o.retainHandling !== 0 && `retainHandling=${o.retainHandling}`].filter(Boolean) : [];

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
            list="dropqtt-observed-topics"
            className="field-input w-full"
            style={{ color: 'var(--success)' }}
          />
          <datalist id="dropqtt-observed-topics">
            {topicSuggestions.map((tp) => (
              <option key={tp} value={tp} />
            ))}
          </datalist>
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

        {isV5 && (
          <label
            className="flex items-center gap-1.5 text-[11px] cursor-pointer"
            style={{ color: sharedOn ? 'var(--accent)' : 'var(--text-muted)' }}
            title={t.subShareHint}
            htmlFor="dropqtt-sub-share"
          >
            <Users className="w-3.5 h-3.5" />
            <span>{t.subShareToggle}</span>
            <input
              type="checkbox"
              id="dropqtt-sub-share"
              checked={sharedOn}
              onChange={(e) => setSharedOn(e.target.checked)}
              className="w-3 h-3"
            />
          </label>
        )}
        {isV5 && sharedOn && (
          <input
            type="text"
            id="dropqtt-sub-share-group"
            value={shareGroup}
            onChange={(e) => setShareGroup(e.target.value)}
            placeholder="consumers"
            aria-label={t.subShareGroup}
            className="field-input w-28 text-[11px]"
            style={{ color: 'var(--success)' }}
          />
        )}

        {isV5 && (
          <button
            type="button"
            onClick={() => setShowOptions((v) => !v)}
            aria-expanded={showOptions}
            title={t.subV5Options}
            className="btn-ghost !px-2 flex items-center gap-1 text-[11px]"
            style={{ color: showOptions || activeFlags({ ...opts, qos }).length ? 'var(--accent)' : undefined }}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>v5</span>
            {activeFlags({ ...opts, qos }).length > 0 && (
              <span className="text-[10px]">({activeFlags({ ...opts, qos }).length})</span>
            )}
          </button>
        )}

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

      {isV5 && showOptions && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-md border text-[11px]" style={{ borderColor: 'var(--border-panel)', background: 'var(--bg-inset)' }}>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={opts.noLocal} onChange={(e) => setOpts((o) => ({ ...o, noLocal: e.target.checked }))} />
            <span style={{ color: 'var(--text-secondary)' }}>
              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>No Local</span>
              <span className="block" style={{ color: 'var(--text-muted)' }}>{t.subNoLocalHint}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={opts.retainAsPublished} onChange={(e) => setOpts((o) => ({ ...o, retainAsPublished: e.target.checked }))} />
            <span style={{ color: 'var(--text-secondary)' }}>
              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>Retain As Published</span>
              <span className="block" style={{ color: 'var(--text-muted)' }}>{t.subRetainAsPublishedHint}</span>
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{t.subRetainHandling}</span>
            <select className="field-input w-full !py-1" value={opts.retainHandling} onChange={(e) => setOpts((o) => ({ ...o, retainHandling: Number(e.target.value) }))}>
              <option value={0}>{t.subRetainHandling0}</option>
              <option value={1}>{t.subRetainHandling1}</option>
              <option value={2}>{t.subRetainHandling2}</option>
            </select>
          </label>
        </div>
      )}

      {ack.refusedUnsubscribes.length > 0 && (
        <div
          className="text-[11px] px-2 py-1.5 rounded inset-box"
          style={{ color: 'var(--warn)' }}
          data-testid="unsub-refused-note"
        >
          {ack.refusedUnsubscribes
            .map((r) => `${r.filter} (${ackHex(r.code)} ${describeAck(r.code, 'unsub', t)})`)
            .join(' · ')}
        </div>
      )}

      {/* Active Subscriptions Chips */}
      <div className="flex flex-wrap gap-2 pt-1 min-h-[36px] items-center">
        {subscriptions.length === 0 ? (
          <div className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
            {t.noSubscriptions}
          </div>
        ) : (
          subscriptions.map((sub) => {
            const refusal = refusalNote(sub.topic);
            const capped = ack.capped[sub.topic];
            return (
            <div
              key={sub.topic}
              className="flex items-center space-x-2 px-3 py-1.5 inset-box text-xs shadow-sm"
              style={{
                color: 'var(--text-secondary)',
                outline: refusal ? '1px solid var(--danger)' : 'none',
              }}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: refusal ? 'var(--danger)' : sub.color || '#10b981' }}
              />
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{sub.topic}</span>
              {shareGroupOf(sub.topic) && (
                <span
                  className="text-[10px] px-1 py-0.5 chip chip-info font-mono"
                  title={t.subShareHint}
                >
                  {t.subShareChip.replace('{name}', shareGroupOf(sub.topic) as string)}
                </span>
              )}
              <span className="text-[11px] px-1 py-0.5 inset-box font-mono" style={{ color: 'var(--text-muted)' }}>
                QoS {sub.qos}
                {capped !== undefined && <span> → {capped}</span>}
              </span>
              {refusal && (
                <span
                  className="text-[10px] px-1 py-0.5 chip font-mono"
                  data-testid={`sub-refused-${sub.topic}`}
                  style={{ background: 'var(--danger)', color: 'var(--accent-contrast)' }}
                  title={refusal.detail}
                >
                  {t.subRejectedChip.replace('{reason}', refusal.label)}
                </span>
              )}
              {!refusal && capped !== undefined && (
                <span
                  className="text-[10px] px-1 py-0.5 chip chip-info font-mono"
                  data-testid={`sub-capped-${sub.topic}`}
                  title={t.subDowngradedToast
                    .replace('{topic}', sub.topic)
                    .replace('{qos}', String(capped))}
                >
                  {t.ackCodeGrantedQos.replace('{qos}', String(capped))}
                </span>
              )}
              {activeFlags(sub.options).length > 0 && (
                <span
                  className="text-[10px] px-1 py-0.5 chip chip-info font-mono"
                  title={activeFlags(sub.options).join(', ')}
                >
                  {activeFlags(sub.options).join(' · ')}
                </span>
              )}
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
            );
          })
        )}
      </div>
    </div>
  );
};
