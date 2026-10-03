import React, { useMemo, useState } from 'react';
import { formatBytes, relativeFromNow } from '../../utils/format';
import { ChevronRight, ListTree, Minus, Plus } from 'lucide-react';
import { TopicStatRow } from '../../types';
import { Translations, fill } from '../../i18n';
import { buildTopicTree, flattenTree, leafPaths, sumSeries, TopicNode } from '../../utils/topicTree';

interface TopicTreePanelProps {
  /** Already filtered by whatever the list view is filtered by */
  rows: TopicStatRow[];
  /** Per-topic rate samples, one per stats tick (~1 s) */
  series: Record<string, number[]>;
  nowSec: number;
  t: Translations;
}

/** A tree deeper than this is a paste mistake, not a topic namespace. */
const MAX_RENDERED_NODES = 300;

const Sparkline: React.FC<{ values: number[]; color: string; label: string }> = ({ values, color, label }) => {
  const W = 68;
  const H = 14;
  const max = Math.max(1, ...values);
  if (values.length < 2) {
    return <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>···</span>;
  }
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 1 - (v / max) * (H - 2)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} data-testid="tree-spark">
      <title>{label}</title>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
};

/**
 * The topic tree: the same counters the list shows, grouped by `/` so a fleet of
 * `devices/<id>/telemetry` reads as one branch. A branch's rate is the sum of its
 * children right now; its peak is the highest any single child reached, because
 * two topics peaking in different seconds did not peak together.
 */
export const TopicTreePanel: React.FC<TopicTreePanelProps> = ({ rows, series, nowSec, t }) => {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildTopicTree(rows), [rows]);
  // Nothing is open by default: the point of the tree is that 400 device topics
  // are one row until you ask to see them. The summary line says what is there,
  // and one click (or Expand all) goes deeper.
  const isNodeOpen = (node: TopicNode) => open.has(node.path);
  const flat = useMemo(() => flattenTree(tree, (node) => open.has(node.path)), [tree, open]);
  const shown = flat.slice(0, MAX_RENDERED_NODES);
  const anyClosed = flat.some((f) => f.expandable && !open.has(f.node.path));

  const branchSeries = (node: TopicNode) =>
    sumSeries(leafPaths(node).map((path) => series[path] ?? []));

  const toggleAll = () => {
    if (anyClosed) {
      const all = new Set<string>();
      const walk = (list: TopicNode[]) => list.forEach((n) => {
        if (n.children.length) { all.add(n.path); walk(n.children); }
      });
      walk(tree);
      setOpen(all);
    } else {
      setOpen(new Set());
    }
  };

  if (rows.length === 0) {
    return <div className="px-3 py-6 text-center text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{t.noTraffic}</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid var(--border-inset)' }}>
        <span className="text-[10px] font-mono flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }} data-testid="tree-summary-line">
          <ListTree className="w-3 h-3" />
          {fill(t.treeSummary, { branches: String(tree.length), topics: String(rows.length) })}
        </span>
        <button
          type="button"
          onClick={toggleAll}
          className="text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1"
          style={{ color: 'var(--text-muted)', background: 'var(--bg-code)' }}
          data-testid="tree-toggle-all"
        >
          {anyClosed ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          {anyClosed ? t.treeExpandAll : t.treeCollapseAll}
        </button>
      </div>
      <ul>
        {shown.map(({ node, expandable }) => {
          const isOpen = isNodeOpen(node);
          const hot = node.agg.rate > 0;
          const spark = branchSeries(node);
          return (
            <li key={node.path} data-testid={`tree-node-${node.path}`}>
              <div
                className="flex items-center gap-2 py-1 pr-3 text-[11px] font-mono"
                style={{ paddingLeft: 8 + node.depth * 14, background: node.leaf ? undefined : 'transparent' }}
              >
                {expandable ? (
                  <button
                    type="button"
                    onClick={() => setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(node.path)) next.delete(node.path); else next.add(node.path);
                      return next;
                    })}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? t.treeCollapse : t.treeExpand} ${node.path}`}
                    className="shrink-0 p-0.5 rounded"
                    style={{ color: 'var(--text-muted)' }}
                    data-testid={`tree-toggle-${node.path}`}
                  >
                    <ChevronRight className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <span
                  className="truncate min-w-0 flex-1 select-text"
                  style={{
                    color: node.leaf ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: expandable ? 600 : 400,
                  }}
                  title={node.path}
                >
                  {node.segment}
                  {expandable && (
                    <span className="ml-1.5 text-[9px]" style={{ color: 'var(--text-muted)' }}>
                      {node.agg.topics}
                    </span>
                  )}
                </span>
                <Sparkline
                  values={spark}
                  color={hot ? 'var(--accent)' : 'var(--text-muted)'}
                  label={fill(t.treeSparkline, { n: String(spark.length), max: String(Math.max(0, ...spark)) })}
                />
                <span className="w-14 text-right shrink-0" style={{ color: hot ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {node.agg.rate > 0 ? `${node.agg.rate}/s` : '—'}
                </span>
                <span className="w-12 text-right shrink-0" style={{ color: 'var(--text-secondary)' }}>
                  {node.agg.count.toLocaleString()}
                </span>
                <span className="w-16 text-right shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {formatBytes(node.agg.bytes)}
                </span>
                <span className="w-10 text-right shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {relativeFromNow(node.agg.lastSeen, nowSec)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {flat.length > shown.length && (
        <div className="px-3 py-1.5 text-[10px] font-mono" style={{ color: 'var(--warning)' }} data-testid="tree-cap-note">
          {fill(t.treeMore, { n: String(flat.length - shown.length) })}
        </div>
      )}
      <div className="px-3 py-1.5 text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {t.treeHint}
      </div>
    </div>
  );
};
