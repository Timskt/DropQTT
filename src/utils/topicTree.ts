import type { TopicStatRow } from '../types';

/**
 * Topic tree over the per-topic counters the backend already keeps.
 *
 * The list view answers "which single topic is loudest"; a fleet of
 * `devices/<id>/telemetry` answers it with four hundred rows that differ only in
 * the middle. Grouping by `/` turns those into one branch with one number, which
 * is the question people actually ask at a site.
 */

export interface TopicAgg {
  count: number;
  bytes: number;
  /** Messages in the last completed second, summed over the branch */
  rate: number;
  /**
   * The highest rate any single topic in the branch reached. Deliberately a max
   * and not a sum: two topics peaking at different seconds did not peak together,
   * and adding their peaks would invent a burst that never happened.
   */
  peakRate: number;
  /** Unix seconds of the newest message anywhere in the branch */
  lastSeen: number;
  /** How many observed topics sit at or below this node */
  topics: number;
}

export interface TopicNode {
  /** Full topic path this node stands for */
  path: string;
  /** The label under its parent, exactly as it appeared on the wire */
  segment: string;
  depth: number;
  /** Counters of the topic that is precisely this path, when it was seen */
  leaf: TopicStatRow | null;
  agg: TopicAgg;
  children: TopicNode[];
}

const emptyAgg = (): TopicAgg => ({ count: 0, bytes: 0, rate: 0, peakRate: 0, lastSeen: 0, topics: 0 });

function aggregate(node: TopicNode): TopicAgg {
  const agg = emptyAgg();
  if (node.leaf) {
    agg.count = node.leaf.count;
    agg.bytes = node.leaf.bytes;
    agg.rate = node.leaf.rate;
    agg.peakRate = node.leaf.peakRate;
    agg.lastSeen = node.leaf.lastSeen;
    agg.topics = 1;
  }
  for (const child of node.children) {
    const sub = aggregate(child);
    agg.count += sub.count;
    agg.bytes += sub.bytes;
    agg.rate += sub.rate;
    agg.peakRate = Math.max(agg.peakRate, sub.peakRate);
    agg.lastSeen = Math.max(agg.lastSeen, sub.lastSeen);
    agg.topics += sub.topics;
  }
  node.agg = agg;
  return agg;
}

export function buildTopicTree(rows: TopicStatRow[]): TopicNode[] {
  const root: TopicNode = { path: '', segment: '', depth: -1, leaf: null, agg: emptyAgg(), children: [] };
  const index = new Map<string, TopicNode>();
  index.set('', root);
  // Sorted so siblings read the same way on every refresh, and so a parent that
  // is also a topic keeps its own counters while still showing its children.
  for (const row of [...rows].sort((a, b) => a.topic.localeCompare(b.topic))) {
    let parent = root;
    let path = '';
    for (const [i, segment] of row.topic.split('/').entries()) {
      path = i === 0 ? segment : `${path}/${segment}`;
      let node = index.get(path);
      if (!node) {
        node = { path, segment, depth: i, leaf: null, agg: emptyAgg(), children: [] };
        index.set(path, node);
        parent.children.push(node);
      }
      parent = node;
    }
    parent.leaf = row;
  }
  aggregate(root);
  return root.children;
}

export interface FlatNode {
  node: TopicNode;
  expandable: boolean;
}

/**
 * Depth-first order, stopping at branches the caller keeps closed. The predicate
 * rather than a set of hidden paths, because a tree that grows while traffic
 * flows needs "new branches start closed" to be the default.
 */
export function flattenTree(nodes: TopicNode[], isOpen: (node: TopicNode) => boolean): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (list: TopicNode[]) => {
    for (const node of list) {
      const expandable = node.children.length > 0;
      out.push({ node, expandable });
      if (expandable && isOpen(node)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function leafPaths(node: TopicNode): string[] {
  if (node.children.length === 0) return node.leaf ? [node.path] : [];
  return node.children.flatMap(leafPaths);
}

/**
 * Element-wise sum, aligned on the newest sample. Series start when a topic is
 * first seen, so left-aligning them would compare a topic's first second with
 * the branch's tenth.
 */
export function sumSeries(list: number[][]): number[] {
  const n = list.reduce((max, s) => Math.max(max, s.length), 0);
  const out = new Array<number>(n).fill(0);
  for (const s of list) {
    const offset = n - s.length;
    for (let i = 0; i < s.length; i += 1) out[i + offset] += s[i];
  }
  return out;
}

/**
 * Append this tick's rate to every topic's series, keeping the last `cap`
 * samples. A topic that leaves the table (reset, or evicted by the tracking cap)
 * leaves the map with it, so a branch cannot keep drawing a topic that is gone.
 */
export function sampleRates(
  prev: Record<string, number[]>,
  rows: TopicStatRow[],
  cap: number,
): Record<string, number[]> {
  const next: Record<string, number[]> = {};
  for (const row of rows) {
    const tail = prev[row.topic] ?? [];
    next[row.topic] = [...tail, row.rate].slice(-cap);
  }
  return next;
}
