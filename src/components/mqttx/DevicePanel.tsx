import React, { useMemo, useState } from 'react';
import { Cpu } from 'lucide-react';
import { AssertionViolation, TopicStatRow } from '../../types';
import { fill, Translations } from '../../i18n';
import { buildTopicTree, nodesAtDepth } from '../../utils/topicTree';
import { formatBytes } from '../../utils/format';

interface DevicePanelProps {
  t: Translations;
  rows: TopicStatRow[];
  violations: AssertionViolation[];
  /** How long a violation stays on a card, in ms. */
  violationWindowMs?: number;
  nowSec?: number;
}

const DEPTHS = [1, 2, 3];

const ageOf = (lastSeenSec: number, nowSec: number, t: Translations): string => {
  const secs = Math.max(0, nowSec - lastSeenSec);
  if (secs < 5) return t.deviceNow;
  if (secs < 60) return fill(t.deviceSecondsAgo, { n: String(secs) });
  if (secs < 3600) return fill(t.deviceMinutesAgo, { n: String(Math.floor(secs / 60)) });
  return fill(t.deviceHoursAgo, { n: String(Math.floor(secs / 3600)) });
};

/**
 * The device view: IoT users think in gateways, not in topic strings, so this groups
 * the live traffic table into one card per topic prefix and puts the two numbers a
 * field engineer asks for first — is it talking now, and is it misbehaving.
 *
 * There is no device registry here and the card does not pretend otherwise: a "device"
 * is a prefix at the chosen depth, which is the only identity the wire offers us.
 * Everything on a card comes from counters that already exist (the traffic table's
 * per-topic aggregates and the assertion engine's recent verdicts); nothing is inferred.
 */
export const DevicePanel: React.FC<DevicePanelProps> = ({ t, rows, violations, violationWindowMs = 300_000, nowSec }) => {
  const [depth, setDepth] = useState(2);

  /**
   * "Now" is the newest observation in the table, not the wall clock: the panel is a
   * polled view, so ages read as "since the last thing we saw", which stays true when
   * the feed is stale and keeps render pure. An override exists for tests.
   */
  const now = useMemo(() => {
    if (nowSec !== undefined) return nowSec;
    return rows.reduce((m, r) => Math.max(m, r.lastSeen), 0);
  }, [nowSec, rows]);

  const devices = useMemo(() => nodesAtDepth(buildTopicTree(rows), depth), [rows, depth]);

  const recentViolations = useMemo(() => {
    const cutoff = now * 1000 - violationWindowMs;
    return violations.filter((v) => v.tsMs >= cutoff);
  }, [now, violations, violationWindowMs]);

  const violationsFor = (prefix: string): number =>
    recentViolations.filter((v) => v.topic === prefix || v.topic.startsWith(`${prefix}/`)).length;

  return (
    <div className="inset-box px-3 py-2.5 space-y-2" data-testid="device-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <Cpu className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t.deviceTitle}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {t.deviceHint}
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {t.deviceDepth}
          <select
            className="field-input text-[10px] font-mono"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            data-testid="device-depth"
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {fill(t.timelineDepthLevels, { n: String(d) })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {devices.length === 0 ? (
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }} data-testid="device-empty">
          {t.deviceEmpty}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="device-grid">
          {devices.map((node) => {
            const bad = violationsFor(node.path);
            const stale = now - node.agg.lastSeen > 60;
            return (
              <div
                key={node.path}
                className="rounded px-2.5 py-2 space-y-1"
                style={{ background: 'var(--bg-raised)', border: `1px solid ${bad > 0 ? 'var(--danger)' : 'var(--border-panel)'}` }}
                data-testid={`device-${node.path}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-mono truncate" style={{ color: 'var(--text-primary)' }} title={node.path}>
                    {node.path}
                  </span>
                  <span
                    className="ml-auto text-[10px] font-mono shrink-0"
                    style={{ color: bad > 0 ? 'var(--danger)' : stale ? 'var(--warning)' : 'var(--success)' }}
                    data-testid={`device-state-${node.path}`}
                  >
                    {bad > 0 ? fill(t.deviceViolating, { n: String(bad) }) : stale ? ageOf(node.agg.lastSeen, now, t) : t.deviceTalking}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  <span>{fill(t.deviceRate, { rate: node.agg.rate.toFixed(1), peak: String(node.agg.peakRate) })}</span>
                  <span>{fill(t.deviceVolume, { msgs: String(node.agg.count), bytes: formatBytes(node.agg.bytes) })}</span>
                </div>
                <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {fill(t.deviceMeta, { topics: String(node.agg.topics), last: ageOf(node.agg.lastSeen, now, t) })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }} data-testid="device-caveat">
        {t.deviceCaveat}
      </p>
    </div>
  );
};
