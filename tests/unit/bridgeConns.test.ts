import { describe, expect, it } from 'vitest';
import { BridgeRule, bridgeRuleDefaults } from '../../src/types';
import {
  DEFAULT_CONNECTIONS,
  connsInCycles,
  nextConnId,
  rulesUsing,
} from '../../src/utils/bridgeConns';

const rule = (over: Partial<BridgeRule>): BridgeRule => ({
  id: over.id ?? 'r1',
  name: over.name ?? 'r1',
  sourceConn: 'src',
  sourceFilter: 'a/#',
  sourceQos: 1,
  targetConn: 'dst',
  topicMode: 'source',
  prefixFrom: '',
  prefixTo: '',
  qosMode: 'source',
  fixedQos: 0,
  retainMode: 'source',
  forwardProps: false,
  enabled: true,
  ...bridgeRuleDefaults,
  ...over,
} as BridgeRule);

describe('nextConnId', () => {
  it('takes the first free number rather than the largest plus one', () => {
    // Deleting `c2` from {c1,c2,c3} and then adding one must not skip a hole and grow
    // the id space forever.
    expect(nextConnId(['c1', 'c3'])).toBe('c2');
    expect(nextConnId(['src', 'dst'])).toBe('c1');
    expect(nextConnId([])).toBe('c1');
  });

  it('never collides with the ids every existing rule set already uses', () => {
    expect(nextConnId(['src', 'dst', 'c1'])).toBe('c2');
    expect(DEFAULT_CONNECTIONS.map((c) => c.id)).toEqual(['src', 'dst']);
  });
});

describe('rulesUsing', () => {
  const rules = [
    rule({ id: 'a', sourceConn: 'src', targetConn: 'dst' }),
    rule({ id: 'b', sourceConn: 'c3', targetConn: 'src' }),
    rule({ id: 'c', sourceConn: 'dst', targetKind: 'http', targetConn: '' }),
  ];

  it('finds a connection named on either side of a rule', () => {
    expect(rulesUsing(rules, 'src').map((r) => r.id)).toEqual(['a', 'b']);
    expect(rulesUsing(rules, 'dst').map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('does not count an HTTP sink as using a connection it cannot name', () => {
    // A rule whose target is a webhook keeps `targetConn` from an earlier life; blocking
    // on it would make a connection impossible to remove for no reason.
    expect(rulesUsing(rules, 'c3').map((r) => r.id)).toEqual(['b']);
    expect(rulesUsing([rule({ id: 'h', targetKind: 'http', targetConn: 'ghost' })], 'ghost')).toHaveLength(0);
  });
});

describe('connsInCycles', () => {
  it('names the connections a loop passes through', () => {
    const rules = [
      rule({ id: 'a', sourceConn: 'src', targetConn: 'dst' }),
      rule({ id: 'b', sourceConn: 'dst', targetConn: 'src' }),
    ];
    expect(connsInCycles(rules)).toEqual(['dst', 'src']);
  });

  it('says nothing about a chain that never comes back', () => {
    const rules = [
      rule({ id: 'a', sourceConn: 'src', targetConn: 'dst' }),
      rule({ id: 'b', sourceConn: 'dst', targetConn: 'c3' }),
    ];
    expect(connsInCycles(rules)).toEqual([]);
  });

  it('follows a loop longer than two hops', () => {
    const rules = [
      rule({ id: 'a', sourceConn: 'src', targetConn: 'dst' }),
      rule({ id: 'b', sourceConn: 'dst', targetConn: 'c3' }),
      rule({ id: 'c', sourceConn: 'c3', targetConn: 'src' }),
    ];
    expect(connsInCycles(rules)).toEqual(['c3', 'dst', 'src']);
  });

  it('ignores disabled rules and HTTP sinks', () => {
    const rules = [
      rule({ id: 'a', sourceConn: 'src', targetConn: 'dst', enabled: false }),
      rule({ id: 'b', sourceConn: 'dst', targetConn: 'src' }),
      rule({ id: 'c', sourceConn: 'dst', targetKind: 'http', targetConn: '' }),
    ];
    // Only the enabled MQTT edge dst→src exists, and one edge cannot close a loop.
    expect(connsInCycles(rules)).toEqual([]);
  });

  it('leaves a same-connection rule out, because the backend guards that one directly', () => {
    expect(connsInCycles([rule({ id: 'a', sourceConn: 'src', targetConn: 'src' })])).toEqual([]);
  });
});
