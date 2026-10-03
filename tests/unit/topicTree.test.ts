import { describe, expect, it } from 'vitest';
import { buildTopicTree, flattenTree, leafPaths, sampleRates, sumSeries, TopicNode } from '../../src/utils/topicTree';
import type { TopicStatRow } from '../../src/types';

const row = (topic: string, over: Partial<TopicStatRow> = {}): TopicStatRow => ({
  topic, count: 10, bytes: 100, rate: 2, bytesRate: 20, peakRate: 5, peakBytesRate: 50, lastSeen: 1_000, ...over,
});

describe('buildTopicTree', () => {
  it('groups by slash and keeps a topic that is both a leaf and a branch', () => {
    const tree = buildTopicTree([
      row('devices/a/telemetry', { rate: 3 }),
      row('devices/b/telemetry', { rate: 4 }),
      row('devices', { rate: 1 }),
    ]);
    expect(tree).toHaveLength(1);
    const devices = tree[0];
    expect(devices.path).toBe('devices');
    expect(devices.leaf?.topic).toBe('devices');
    expect(devices.children.map((c) => c.path)).toEqual(['devices/a', 'devices/b']);
    // 1 + 3 + 4: the branch's own counters are not lost under its children.
    expect(devices.agg.rate).toBe(8);
    expect(devices.agg.topics).toBe(3);
  });

  it('adds current rates but takes the peak, because peaks are not simultaneous', () => {
    const tree = buildTopicTree([
      row('a/x', { rate: 2, peakRate: 9, lastSeen: 100, count: 5, bytes: 50 }),
      row('a/y', { rate: 3, peakRate: 7, lastSeen: 240, count: 6, bytes: 60 }),
    ]);
    const agg = tree[0].agg;
    expect(agg.rate).toBe(5);
    expect(agg.peakRate).toBe(9);
    expect(agg.lastSeen).toBe(240);
    expect(agg.count).toBe(11);
    expect(agg.bytes).toBe(110);
  });

  it('keeps wildcard and empty segments exactly as they arrived on the wire', () => {
    const tree = buildTopicTree([row('devices/+/telemetry'), row('a//b')]);
    expect(tree.map((n) => n.path)).toEqual(['a', 'devices']);
    const plus = tree[1].children[0];
    expect(plus.path).toBe('devices/+');
    expect(plus.children[0].path).toBe('devices/+/telemetry');
    // `a//b` really is a three-segment topic with an empty middle.
    expect(tree[0].children[0].children[0].path).toBe('a//b');
  });
});

describe('flattenTree and series', () => {
  const tree = () => buildTopicTree([row('a/1'), row('a/2'), row('b/1')]);

  it('shows only what the caller opened, so 400 device topics stay one row', () => {
    const flat = flattenTree(tree(), () => false);
    expect(flat.map((f) => f.node.path)).toEqual(['a', 'b']);
    expect(flat.every((f) => f.expandable)).toBe(true);
  });

  it('walks into the branches the caller opened', () => {
    const open = new Set(['a']);
    const flat = flattenTree(tree(), (n) => open.has(n.path));
    expect(flat.map((f) => f.node.path)).toEqual(['a', 'a/1', 'a/2', 'b']);
  });

  it('collects leaves under a branch', () => {
    const nodes = tree();
    expect(leafPaths(nodes[0])).toEqual(['a/1', 'a/2']);
    expect(leafPaths(nodes[0].children[0])).toEqual(['a/1']);
  });

  it('aligns series on the newest sample rather than the first', () => {
    expect(sumSeries([[9, 9], [1, 2, 3]])).toEqual([1, 11, 12]);
    expect(sumSeries([])).toEqual([]);
    expect(sumSeries([[], [4]])).toEqual([4]);
  });

  it('appends one sample per tick, caps the tail, and forgets vanished topics', () => {
    let series = sampleRates({}, [row('a', { rate: 1 }), row('b', { rate: 2 })], 3);
    expect(series).toEqual({ a: [1], b: [2] });
    series = sampleRates(series, [row('a', { rate: 3 }), row('b', { rate: 4 })], 3);
    series = sampleRates(series, [row('a', { rate: 5 }), row('b', { rate: 6 })], 3);
    expect(series.a).toEqual([1, 3, 5]);
    // The cap is a sliding window, not a truncation of the newest data.
    series = sampleRates(series, [row('a', { rate: 7 })], 3);
    expect(series.a).toEqual([3, 5, 7]);
    expect(series.b).toBeUndefined();
  });
});

/** The tree's own contract: a node is never both closed and showing children. */
describe('TopicNode shape', () => {
  it('reports depth from the root so indentation needs no arithmetic at render time', () => {
    const nodes: TopicNode[] = buildTopicTree([row('a/b/c')]);
    expect(nodes[0].depth).toBe(0);
    expect(nodes[0].children[0].depth).toBe(1);
    expect(nodes[0].children[0].children[0].depth).toBe(2);
    expect(nodes[0].children[0].children[0].segment).toBe('c');
  });
});
