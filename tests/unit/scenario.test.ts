import { describe, expect, it, vi } from 'vitest';
import {
  applyPlan,
  claimLines,
  collectScenario,
  parseScenario,
  reportFileName,
  Scenario,
  ScenarioError,
  scenarioFileName,
  serializeScenario,
  VerdictLine,
} from '../../src/utils/scenario';
import type { Claim } from '../../src/utils/scenario';
import { en } from '../../src/i18n/locales/en';
import type { SilenceRule } from '../../src/types';

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

/**
 * The judgement itself is `scenario.rs`'s, and it is tested there -- what is left in
 * TypeScript is the phrasing, so that is what these pin. A claim id the app does not
 * know must not borrow another claim's label: a verdict wearing the wrong words is
 * still a verdict nobody can act on.
 */
describe('claim presentation', () => {
  const line = (claim: Claim): VerdictLine => claimLines([claim], en)[0];

  it('keeps the numbers the backend sent and phrases the bars it set', () => {
    expect(line({ id: 'minRate', state: 'pass', actual: 42, limit: 40 })).toMatchObject({
      claim: en.scenarioClaimRate, actual: '42 / 40', state: 'pass',
    });
    expect(line({ id: 'maxP99Ms', state: 'fail', actual: 900, limit: 25 }).actual).toBe('900 ms / 25 ms');
    expect(line({ id: 'maxLost', state: 'pass', actual: 2, limit: 5 }).actual).toBe('2 / 5');
    expect(line({ id: 'assertions', state: 'fail', counts: [10, 1, 2] }).actual)
      .toBe('1 violated, 2 unevaluable of 10 matched');
    expect(line({ id: 'refusedSubscriptions', state: 'fail', actual: 2, limit: 0 }).actual).toBe('2');
  });

  it('distinguishes a bar that was never set from one nobody measured', () => {
    expect(line({ id: 'noBarSet', state: 'unknown' }).actual).toBe(en.scenarioNoBar);
    expect(line({ id: 'notRun', state: 'unknown' }).actual).toBe(en.scenarioNotRun);
  });

  it('says there was no sample rather than inventing a zero for a missing one', () => {
    expect(line({ id: 'maxP99Ms', state: 'fail', limit: 25 }).actual).toContain('no measurement');
  });

  it('keeps the claim id as the list key, so two rate claims cannot collide', () => {
    const lines = claimLines(
      [{ id: 'noBarSet', state: 'unknown' }, { id: 'notRun', state: 'unknown' }],
      en,
    );
    expect(lines.map((l) => l.id)).toEqual(['noBarSet', 'notRun']);
    expect(new Set(lines.map((l) => l.claim)).size).toBe(1);
  });

  it('falls back to the raw id rather than borrowing a label it does not have', () => {
    expect(line({ id: 'someFutureClaim', state: 'unknown' }).claim).toBe('someFutureClaim');
  });
});

describe('the backend call the panel depends on', () => {
  it('reads a host without a backend as "no verdict", not as a crash', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: () => Promise.reject(new Error('not a tauri host')),
    }));
    const { judgeScenario: judge } = await import('../../src/utils/scenario');
    expect(await judge({ assertions: { matched: 1, passed: 1, violated: 0, unevaluable: 0 } })).toBeNull();
    vi.doUnmock('@tauri-apps/api/core');
  });
});

describe('scenario file naming', () => {
  it('makes a shareable name out of anything the user typed', () => {
    expect(scenarioFileName('Nightly / Fleet Acceptance!')).toBe('dropqtt-scenario-nightly-fleet-acceptance.dqscn');
    expect(scenarioFileName('   ')).toBe('dropqtt-scenario-untitled.dqscn');
  });
});

describe('report file naming', () => {
  // The report *content* is rendered by `scenario.rs` now, and tested there: one
  // writer means the file the app leaves behind and the file the CLI prints cannot
  // drift apart. What stays here is the name the save dialog suggests.
  it('names a report after the scenario, for both formats', () => {
    expect(reportFileName('Gate A', 'xml')).toBe('dropqtt-verdict-gate-a.xml');
    expect(reportFileName('Gate A', 'json')).toBe('dropqtt-verdict-gate-a.json');
    expect(reportFileName('***', 'json')).toBe('dropqtt-verdict-untitled.json');
  });
});
