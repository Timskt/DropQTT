import { describe, expect, it } from 'vitest';
import {
  applyPlan,
  collectScenario,
  parseScenario,
  Scenario,
  ScenarioError,
  scenarioFileName,
  scenarioVerdict,
  serializeScenario,
} from '../../src/utils/scenario';
import type { BenchProgress, SilenceRule } from '../../src/types';

const silence = (id: string): SilenceRule => ({
  id,
  name: `watch ${id}`,
  topicFilter: `devices/${id}/#`,
  timeoutSec: 30,
  cooldownSec: 60,
  enabled: true,
  webhook: { url: 'https://alerts.example.com/hook?token=sekret', format: 'json', headers: [['Authorization', 'Bearer x']] },
});

const words = {
  v3Responders: (n: number) => `${n} responder rules need MQTT5`,
  strippedWebhooks: (n: number) => `${n} watchdogs lost their endpoint`,
  noBar: (name: string) => `${name} sets no acceptance bar`,
};

const verdictWords = {
  rate: 'rate', p99: 'p99', lost: 'lost', violations: 'violations',
  refused: 'refused subs', notRun: 'not run', noBar: 'no bar set',
};

const base = {
  name: 'Fleet acceptance',
  subscriptions: [{ topic: 'devices/#', qos: 1, options: { qos: 1, noLocal: false, retainAsPublished: false, retainHandling: 0 } }],
  responders: [
    { id: 'r1', name: 'echo', trigger: 'lab/rpc/#', replyTopic: 'lab/reply', replyPayload: '{}', qos: 1, retain: false, delayMs: 0, maxPerSec: 0, enabled: true },
  ],
  assertions: [{ id: 'a1', filter: 'devices/#', field: 'json' as const, op: 'lt' as const, expected: '80', enabled: true, label: 'temp' }],
  silence: [silence('gw-7')],
};

describe('collectScenario', () => {
  it('keeps the rig and drops the alert endpoint', () => {
    const s = collectScenario({ ...base, note: '  ' }, '2026-10-04T00:00:00.000Z');
    expect(s.name).toBe('Fleet acceptance');
    expect(s.note).toBeUndefined();
    expect(s.silence[0].topicFilter).toBe('devices/gw-7/#');
    expect(s.silence[0].timeoutSec).toBe(30);
    expect((s.silence[0] as Record<string, unknown>).webhook).toBeUndefined();
  });

  it('writes no URL, token or header into the serialized file', () => {
    const text = serializeScenario(collectScenario(base, '2026-10-04T00:00:00.000Z'));
    expect(text).not.toContain('alerts.example.com');
    expect(text).not.toContain('sekret');
    expect(text).not.toContain('Authorization');
    expect(text).not.toContain('Bearer');
  });
});

describe('parseScenario', () => {
  it('round-trips what collect wrote', () => {
    const text = serializeScenario(collectScenario(base, '2026-10-04T00:00:00.000Z'));
    const back = parseScenario(text);
    expect(back.subscriptions.map((s) => s.topic)).toEqual(['devices/#']);
    expect(back.responders).toHaveLength(1);
    expect(back.assertions).toHaveLength(1);
    expect(back.silence).toHaveLength(1);
    expect(back.bench).toBeUndefined();
  });

  it('refuses a file that is not a scenario, with a reason', () => {
    expect(() => parseScenario('nope')).toThrowError(ScenarioError);
    expect(() => parseScenario('nope')).toThrow(/not valid JSON/);
    expect(() => parseScenario(JSON.stringify({ format: 'dropqtt-scenario/1' }))).toThrow(/is this a \.dqscn/);
    expect(() => parseScenario(JSON.stringify({ kind: 'scenario', format: 'dropqtt-scenario/2' }))).toThrow(/another format/);
    expect(() =>
      parseScenario(JSON.stringify({ kind: 'scenario', format: 'dropqtt-scenario/1', name: 'empty' })),
    ).toThrow(/holds nothing to apply/);
  });

  it('drops malformed entries rather than failing the whole scenario', () => {
    const doc = {
      kind: 'scenario',
      format: 'dropqtt-scenario/1',
      name: 'x',
      subscriptions: [{ topic: 'ok/#', qos: 1 }, { qos: 1 }, null],
      responders: [{ id: 'r' }],
      silence: [],
      assertions: [],
    };
    const back = parseScenario(JSON.stringify(doc));
    expect(back.subscriptions.map((s) => s.topic)).toEqual(['ok/#']);
    expect(back.responders).toHaveLength(0);
  });
});

describe('applyPlan', () => {
  const scenario = collectScenario(base, '2026-10-04T00:00:00.000Z');

  it('applies everything on a v5 session but still names the lost endpoints', () => {
    const plan = applyPlan(scenario, true, words);
    expect(plan.responders).toHaveLength(1);
    expect(plan.skipped).toEqual(['1 watchdogs lost their endpoint']);
  });

  it('refuses to install responders a 3.1.1 session cannot drive, and says so', () => {
    const plan = applyPlan(scenario, false, words);
    expect(plan.responders).toEqual([]);
    expect(plan.skipped).toContain('1 responder rules need MQTT5');
  });

  it('a scenario with traffic but no acceptance bar is reported, not counted as passing', () => {
    const withBench: Scenario = { ...scenario, bench: { topics: ['devices/a'], rate: 10, size: 32, qos: 1, retain: false, durationSec: 5 } };
    expect(applyPlan(withBench, true, words).skipped).toContain('Fleet acceptance sets no acceptance bar');
    const barred: Scenario = { ...withBench, bench: { ...withBench.bench!, expect: { minRate: 5 } } };
    expect(applyPlan(barred, true, words).skipped).not.toContain('Fleet acceptance sets no acceptance bar');
  });
});

describe('scenarioVerdict', () => {
  const progress = (over: Partial<BenchProgress> = {}): BenchProgress => ({
    id: 'b1', topics: ['devices/a'], rate: 42, size: 32, qos: 1, retain: false,
    sent: 100, acked: 100, nacked: 0, noSubscribers: 0, observed: 98, elapsedMs: 2_000,
    status: 'finished', latency: { samples: 100, dropped: 0, p50Ms: 4, p95Ms: 9, p99Ms: 12, maxMs: 20, meanMs: 5 },
    mirror: true, ...over,
  });

  it('grades each bar that was set, and never invents one that was not', () => {
    const lines = scenarioVerdict(
      { progress: progress(), expect: { minRate: 40, maxP99Ms: 25, maxLost: 5 }, assertionStats: { matched: 10, passed: 10, violated: 0, unevaluable: 0 }, rejectedSubs: 0 },
      verdictWords,
    );
    expect(lines.map((l) => [l.claim, l.actual, l.state])).toEqual([
      ['rate', '42 / 40', 'pass'],
      ['p99', '12 ms / 25 ms', 'pass'],
      ['lost', '2 / 5', 'pass'],
      ['violations', '0 violated, 0 unevaluable of 10 matched', 'pass'],
    ]);
  });

  it('reports a missed bar as fail, not as a rounded pass', () => {
    const lines = scenarioVerdict({ progress: progress({ rate: 12, latency: { ...progress().latency, p99Ms: 900 } }), expect: { minRate: 40, maxP99Ms: 25 } }, verdictWords);
    expect(lines.find((l) => l.claim === 'rate')?.state).toBe('fail');
    expect(lines.find((l) => l.claim === 'p99')?.state).toBe('fail');
  });

  it('an unset bar is unknown, and so is a run that never happened', () => {
    expect(scenarioVerdict({ progress: progress() }, verdictWords)[0]).toMatchObject({ state: 'unknown', actual: 'no bar set' });
    expect(scenarioVerdict({}, verdictWords)[0]).toMatchObject({ state: 'unknown', actual: 'not run' });
  });

  it('rules that could not be evaluated are not a pass', () => {
    const of = (stats: { matched: number; passed: number; violated: number; unevaluable: number }) =>
      scenarioVerdict({ assertionStats: stats }, verdictWords).find((l) => l.claim === 'violations');
    expect(of({ matched: 4, passed: 2, violated: 0, unevaluable: 2 })?.state).toBe('unknown');
    expect(of({ matched: 4, passed: 1, violated: 1, unevaluable: 0 })?.state).toBe('fail');
    expect(of({ matched: 4, passed: 4, violated: 0, unevaluable: 0 })?.state).toBe('pass');
    // Nothing matched means no rule ever ran against a message: absence of evidence,
    // not a clean sheet.
    expect(of({ matched: 0, passed: 0, violated: 0, unevaluable: 0 })?.state).toBe('unknown');
  });

  it('a refused subscription fails the scenario even when the traffic looks fine', () => {
    const lines = scenarioVerdict({ progress: progress(), expect: { minRate: 1 }, rejectedSubs: 2 }, verdictWords);
    expect(lines.at(-1)).toMatchObject({ claim: 'refused subs', actual: '2', state: 'fail' });
  });
});

describe('scenario file naming', () => {
  it('makes a shareable name out of anything the user typed', () => {
    expect(scenarioFileName('Nightly / Fleet Acceptance!')).toBe('dropqtt-scenario-nightly-fleet-acceptance.dqscn');
    expect(scenarioFileName('   ')).toBe('dropqtt-scenario-untitled.dqscn');
  });
});
