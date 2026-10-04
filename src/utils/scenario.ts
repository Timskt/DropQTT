import { AssertionRule, BenchExpect, BenchProgress, ResponderRule, SilenceRule, SubOptions } from '../types';

/**
 * An acceptance scenario: the whole rig needed to answer "does this fleet behave",
 * saved as one file.
 *
 * Everything it composes already exists and already persists as a whole set pushed
 * from the frontend — subscriptions, responder rules, assertions, silence watchdogs,
 * one bench spec. A scenario is not a new engine; it is those five sets in an
 * envelope, plus a verdict that states which bar was set and which was met.
 *
 * Redaction is part of the format, not an export option. A silence rule carries a
 * webhook URL, and a scenario file is meant to be attached to a ticket or handed to
 * another engineer; an alert endpoint is nobody's business but the owner's. The URL
 * and its headers are dropped on the way in, and the apply plan says the rule came
 * back without one rather than pretending it is intact.
 */

export const SCENARIO_FORMAT = 'dropqtt-scenario/1';
export const SCENARIO_EXTENSION = 'dqscn';

export interface ScenarioSubscription {
  topic: string;
  qos: number;
  options: SubOptions;
}

export interface Scenario {
  kind: 'scenario';
  format: string;
  name: string;
  note?: string;
  createdAt?: string;
  subscriptions: ScenarioSubscription[];
  responders: ResponderRule[];
  assertions: AssertionRule[];
  /** Webhook targets removed; the rest of the watchdog is the useful half. */
  silence: Omit<SilenceRule, 'webhook'>[];
  bench?: BenchSpec0;
}

/** `BenchSpec` without its identity, which belongs to the run, not the scenario. */
export type BenchSpec0 = Omit<import('../types').BenchSpec, 'id'>;

export interface CollectInput {
  name: string;
  note?: string;
  subscriptions: { topic: string; qos: number; options?: SubOptions }[];
  responders: ResponderRule[];
  assertions: AssertionRule[];
  silence: SilenceRule[];
  bench?: BenchSpec0;
}

const subOptions = (s: { qos: number; options?: SubOptions }): SubOptions =>
  s.options ?? { qos: s.qos, noLocal: false, retainAsPublished: false, retainHandling: 0 };

export function collectScenario(input: CollectInput, at: string): Scenario {
  return {
    kind: 'scenario',
    format: SCENARIO_FORMAT,
    name: input.name.trim() || 'Untitled scenario',
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    createdAt: at,
    subscriptions: input.subscriptions.map((s) => ({ topic: s.topic, qos: s.qos, options: subOptions(s) })),
    responders: input.responders.map((r) => ({ ...r })),
    assertions: input.assertions.map((a) => ({ ...a })),
    silence: input.silence.map(({ webhook: _webhook, ...rest }) => rest),
    ...(input.bench ? { bench: { ...input.bench } } : {}),
  };
}

export function serializeScenario(scenario: Scenario): string {
  return `${JSON.stringify(scenario, null, 2)}\n`;
}

export class ScenarioError extends Error {}

export function parseScenario(text: string): Scenario {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ScenarioError('the file is not valid JSON');
  }
  const doc = raw as Partial<Scenario>;
  if (!doc || typeof doc !== 'object') throw new ScenarioError('the file holds no scenario object');
  if (doc.kind !== 'scenario') throw new ScenarioError('no scenario marker — is this a .dqscn file?');
  if (doc.format !== SCENARIO_FORMAT) {
    throw new ScenarioError(`written by another format ("${String(doc.format ?? 'none')}"); this build reads ${SCENARIO_FORMAT}`);
  }
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const scenario: Scenario = {
    kind: 'scenario',
    format: SCENARIO_FORMAT,
    name: typeof doc.name === 'string' && doc.name.trim() ? doc.name : 'Untitled scenario',
    ...(typeof doc.note === 'string' && doc.note.trim() ? { note: doc.note } : {}),
    ...(typeof doc.createdAt === 'string' ? { createdAt: doc.createdAt } : {}),
    subscriptions: list<ScenarioSubscription>(doc.subscriptions).filter((s) => typeof s?.topic === 'string' && s.topic.length > 0),
    responders: list<ResponderRule>(doc.responders).filter((r) => typeof r?.id === 'string' && typeof r?.trigger === 'string'),
    assertions: list<AssertionRule>(doc.assertions).filter((a) => typeof a?.id === 'string' && typeof a?.filter === 'string'),
    silence: list<Omit<SilenceRule, 'webhook'>>(doc.silence).filter((s) => typeof s?.id === 'string' && typeof s?.topicFilter === 'string'),
  };
  if (doc.bench && typeof doc.bench === 'object') scenario.bench = doc.bench;
  if (
    scenario.subscriptions.length === 0 &&
    scenario.responders.length === 0 &&
    scenario.assertions.length === 0 &&
    scenario.silence.length === 0 &&
    !scenario.bench
  ) {
    throw new ScenarioError('the scenario parsed fine but holds nothing to apply');
  }
  return scenario;
}

export interface ApplyPlan {
  subscriptions: { topic: string; qos: number; options: SubOptions }[];
  responders: ResponderRule[];
  assertions: AssertionRule[];
  /** Watchdogs without their endpoints; the panel has to say which ones. */
  silence: Omit<SilenceRule, 'webhook'>[];
  bench?: BenchSpec0;
  /** Plain-language notes about what applying this will not do. */
  skipped: string[];
}

/**
 * What the frontend should write into each store, and — more importantly — the
 * honest list of what cannot be applied. A plan that silently drops the alert
 * endpoint of a watchdog is the same class of lie as a disabled button with no reason.
 */
export function applyPlan(scenario: Scenario, isV5: boolean, words: {
  v3Responders: (n: number) => string;
  strippedWebhooks: (n: number) => string;
  noBar: (name: string) => string;
}): ApplyPlan {
  const skipped: string[] = [];
  const responders = isV5 ? scenario.responders : [];
  if (!isV5 && scenario.responders.length > 0) skipped.push(words.v3Responders(scenario.responders.length));
  if (scenario.silence.length > 0) skipped.push(words.strippedWebhooks(scenario.silence.length));
  if (scenario.bench && !scenario.bench.expect) skipped.push(words.noBar(scenario.name));
  return {
    subscriptions: scenario.subscriptions,
    responders,
    assertions: scenario.assertions,
    silence: scenario.silence,
    ...(scenario.bench ? { bench: scenario.bench } : {}),
    skipped,
  };
}

export type VerdictState = 'pass' | 'fail' | 'unknown';

export interface VerdictLine {
  claim: string;
  actual: string;
  state: VerdictState;
}

/**
 * The verdict is the point of the feature: MQTTX-style simulators draw curves, this
 * has to say passed or failed. So a bar that was never set reports `unknown`, not
 * `pass` — "no evidence either way" must not be able to read as a green light.
 */
export function scenarioVerdict(input: {
  progress?: BenchProgress;
  assertionStats?: { matched: number; passed: number; violated: number; unevaluable: number };
  rejectedSubs?: number;
  expect?: BenchExpect;
}, words: {
  rate: string;
  p99: string;
  lost: string;
  violations: string;
  refused: string;
  notRun: string;
  noBar: string;
}): VerdictLine[] {
  const lines: VerdictLine[] = [];
  const p = input.progress;
  const e = input.expect;
  if (!p) {
    lines.push({ claim: words.rate, actual: words.notRun, state: 'unknown' });
  } else if (!e) {
    lines.push({ claim: words.rate, actual: words.noBar, state: 'unknown' });
  } else {
    const lost = p.sent - p.observed;
    if (e.minRate !== undefined && e.minRate !== null) {
      lines.push({
        claim: words.rate,
        actual: `${Math.round(p.rate)} / ${e.minRate}`,
        state: p.rate >= e.minRate ? 'pass' : 'fail',
      });
    }
    if (e.maxP99Ms !== undefined && e.maxP99Ms !== null) {
      const p99 = p.latency?.p99Ms ?? 0;
      lines.push({ claim: words.p99, actual: `${p99} ms / ${e.maxP99Ms} ms`, state: p99 <= e.maxP99Ms ? 'pass' : 'fail' });
    }
    if (e.maxLost !== undefined && e.maxLost !== null) {
      lines.push({ claim: words.lost, actual: `${lost} / ${e.maxLost}`, state: lost <= e.maxLost ? 'pass' : 'fail' });
    }
  }
  const a = input.assertionStats;
  if (a) {
    lines.push({
      claim: words.violations,
      actual: `${a.violated} violated, ${a.unevaluable} unevaluable of ${a.matched} matched`,
      // Nothing matched means no rule ever ran against a message, which is the same
      // absence of evidence as an unset bar — it must not read as a pass.
      state: a.violated > 0 ? 'fail' : a.unevaluable > 0 || a.matched === 0 ? 'unknown' : 'pass',
    });
  }
  if (input.rejectedSubs && input.rejectedSubs > 0) {
    lines.push({ claim: words.refused, actual: `${input.rejectedSubs}`, state: 'fail' });
  }
  return lines;
}

export function scenarioFileName(name: string): string {
  const safe = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `dropqtt-scenario-${safe || 'untitled'}.${SCENARIO_EXTENSION}`;
}
