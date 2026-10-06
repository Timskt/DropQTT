import { invoke } from '@tauri-apps/api/core';
import { AssertionRule, BenchExpect, ResponderRule, SilenceRule, SubOptions } from '../types';
import { Translations } from '../i18n';

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
  /** The claim's stable id, so a list key never depends on a translated label. */
  id: string;
  claim: string;
  actual: string;
  state: VerdictState;
}

/**
 * The judgement itself lives in `scenario.rs`, behind `scenario_verdict`.
 *
 * It used to be here, in TypeScript, and that was a real hazard rather than a
 * tidiness one: the number a person read on screen and the exit code a pipeline read
 * were produced by two implementations of the same three rules, and the first change
 * to either would make them disagree quietly. What is left below is presentation --
 * which label a claim wears, and how its numbers are phrased.
 */
export interface Claim {
  id: string;
  state: VerdictState;
  actual?: number;
  limit?: number;
  /** Only for the assertion claim: `[matched, violated, unevaluable]`. */
  counts?: [number, number, number];
}

export interface Verdict {
  claims: Claim[];
  overall: VerdictState;
}

export interface Measurement {
  sent: number;
  acked: number;
  rate: number;
  p99Ms?: number | null;
  /** False while a run is still going: a rate over 200 ms is a sample, not a verdict. */
  settled: boolean;
}

export interface VerdictRequest {
  expect?: BenchExpect | null;
  measurement?: Measurement | null;
  assertions?: { matched: number; passed: number; violated: number; unevaluable: number } | null;
  refused?: number;
}

/** `null` means "this host has no backend", which a browser preview is. */
export async function judgeScenario(request: VerdictRequest): Promise<Verdict | null> {
  try {
    return await invoke<Verdict>('scenario_verdict', { request });
  } catch {
    return null;
  }
}

export interface ReportRequest extends VerdictRequest {
  name: string;
  note?: string;
  /** One label per claim, positionally, in the reader's language. */
  labels: string[];
  words: { fail: string; unknown: string };
  format: 'json' | 'junit';
}

/** The report text, rendered by the backend from evidence rather than from claims. */
export async function renderScenarioReport(input: ReportRequest): Promise<string | null> {
  const { name, note, labels, words, format, ...evidence } = input;
  try {
    return await invoke<string>('scenario_report', {
      request: {
        evidence,
        name,
        ...(note ? { note } : {}),
        generatedAt: new Date().toISOString(),
        labels,
        words,
        format,
      },
    });
  } catch {
    return null;
  }
}

/** Which translation a claim id wears. Two ids share the rate label on purpose: "not
 *  run" and "no bar" are the same claim seen from two directions. */
const CLAIM_LABEL: Record<string, keyof Translations> = {
  minRate: 'scenarioClaimRate',
  maxP99Ms: 'scenarioClaimP99',
  maxLost: 'scenarioClaimLost',
  assertions: 'scenarioClaimAssertions',
  refusedSubscriptions: 'scenarioClaimRefused',
  noBarSet: 'scenarioClaimRate',
  notRun: 'scenarioClaimRate',
};

export function claimLabel(id: string, t: Translations): string {
  const key = CLAIM_LABEL[id];
  // An id this build does not know wears its own name rather than another claim's: a
  // verdict under the wrong heading is worse than one under an untranslated one.
  return key ? String(t[key]) : id;
}

/** Numbers stay numbers on the wire; only the phrasing is local. */
export function claimActual(claim: Claim, t: Translations): string {
  if (claim.counts) {
    const [matched, violated, unevaluable] = claim.counts;
    return `${violated} violated, ${unevaluable} unevaluable of ${matched} matched`;
  }
  if (claim.id === 'notRun') return t.scenarioNotRun;
  if (claim.id === 'noBarSet') return t.scenarioNoBar;
  // A refusal has no bar beside it: the number of them is the whole statement.
  if (claim.id === 'refusedSubscriptions') return `${claim.actual ?? 0}`;
  if (claim.actual === undefined) {
    return claim.limit === undefined ? t.scenarioUnknown : `no measurement, bar was ${claim.limit}`;
  }
  if (claim.id === 'maxP99Ms' && claim.limit !== undefined) {
    return `${claim.actual} ms / ${claim.limit} ms`;
  }
  return claim.limit === undefined ? `${claim.actual}` : `${claim.actual} / ${claim.limit}`;
}

export const claimLines = (claims: Claim[], t: Translations): VerdictLine[] =>
  claims.map((claim) => ({
    id: claim.id,
    claim: claimLabel(claim.id, t),
    actual: claimActual(claim, t),
    state: claim.state,
  }));

export function scenarioFileName(name: string): string {
  const safe = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `dropqtt-scenario-${safe || 'untitled'}.${SCENARIO_EXTENSION}`;
}

export function reportFileName(name: string, ext: string): string {
  const safe = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `dropqtt-verdict-${safe || 'untitled'}.${ext}`;
}
