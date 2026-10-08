import { SecretStatus, WebhookSink } from '../types';
import { newSecretRef } from './secretRef';
import type { SecretStore } from './secrets';

/**
 * Webhook header values that are credentials (`Authorization: Bearer …`, API keys)
 * get the same treatment as broker passwords: the value goes to the OS credential
 * store, and the rule keeps `secretHeaders: [name, reference]`. The backend loads the
 * value when the rule set is synced; nothing here ever reads one back.
 *
 * Only *sensitive-looking* names are moved. `Content-Type: application/json` in the
 * keychain would make every rule edit a keychain write for no gain, and would hide a
 * value the user needs to see to debug a 415.
 */

/** The names a credential usually travels under; a case-insensitive substring match,
 *  so `X-Auth-Token` and `X-Api-Key` count, and a bare `-Key` suffix does too. */
const SENSITIVE_HEADER = /authorization|cookie|token|secret|password|passwd|signature|api[-_]?key|(^|-)key$/i;

export const isSensitiveHeader = (name: string): boolean => SENSITIVE_HEADER.test(name.trim());

/**
 * What the editor shows in place of a stored value. Not valid in an HTTP header (it
 * is not ASCII), so if it ever escaped into a request the backend would refuse it
 * rather than send it.
 */
export const STORED_HEADER_MARK = '••••••';

/** "Name: value" lines -> rows; a malformed line throws, and callers turn that into
 *  the form error rather than a partial save. */
export const parseHeaderLines = (text: string): [string, string][] =>
  text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const colon = line.indexOf(':');
      if (colon < 1) throw new Error('invalid header line');
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    });

/** The editor text for one sink: plain headers as they are, stored ones masked. */
export const formatSinkHeaders = (sink: Pick<WebhookSink, 'headers' | 'secretHeaders'> | undefined): string =>
  [
    ...(sink?.headers ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(sink?.secretHeaders ?? []).map(([k]) => `${k}: ${STORED_HEADER_MARK}`),
  ].join('\n');

export interface SinkSecretPlan {
  headers: [string, string][];
  secretHeaders: [string, string][];
  /** Values to put in the store before the rule that points at them is saved. */
  writes: { reference: string; value: string }[];
}

/** Thrown when a masked line no longer matches a stored value, e.g. its name changed. */
export class StaleHeaderMark extends Error {
  constructor(readonly header: string) {
    super(`the stored value for ${header} is not available under that name`);
  }
}

/**
 * Split the edited rows into plain headers, kept references, and new values to store.
 * Pure: the caller does the writes, so a failed one can leave the rule untouched.
 *
 * Without a usable store a new value stays a plain header -- the same honest fallback
 * the broker password takes -- but an existing reference is kept, because dropping it
 * would lose a credential that may well resolve again once the keychain is unlocked.
 */
export function planSinkSecrets(
  previous: Pick<WebhookSink, 'secretHeaders'> | undefined,
  rows: [string, string][],
  status: SecretStatus,
  mint: () => string = newSecretRef,
): SinkSecretPlan {
  const known = new Map((previous?.secretHeaders ?? []).map(([name, ref]) => [name.toLowerCase(), ref]));
  const plan: SinkSecretPlan = { headers: [], secretHeaders: [], writes: [] };
  for (const [name, value] of rows) {
    if (value === STORED_HEADER_MARK) {
      const ref = known.get(name.toLowerCase());
      if (!ref) throw new StaleHeaderMark(name);
      plan.secretHeaders.push([name, ref]);
    } else if (status.available && value && isSensitiveHeader(name)) {
      const reference = mint();
      plan.writes.push({ reference, value });
      plan.secretHeaders.push([name, reference]);
    } else {
      plan.headers.push([name, value]);
    }
  }
  return plan;
}

/**
 * Store every planned value, or none: a write that fails halfway takes back the ones
 * that already landed, so a refused save leaves no orphan behind it.
 */
export async function commitSinkSecrets(store: SecretStore, plans: SinkSecretPlan[]): Promise<string | null> {
  const done: string[] = [];
  for (const { reference, value } of plans.flatMap((p) => p.writes)) {
    const error = await store.put(reference, value, 'webhook');
    if (error) {
      await Promise.all(done.map((r) => store.drop?.(r, 'webhook')));
      return error;
    }
    done.push(reference);
  }
  return null;
}

type SinkBearing = { webhook?: Partial<WebhookSink>; targets?: Partial<WebhookSink>[] };

/** Every header reference a set of rules points at. */
export const headerReferences = (rules: readonly SinkBearing[]): Set<string> =>
  new Set(
    rules.flatMap((r) =>
      [r.webhook, ...(r.targets ?? [])].flatMap((s) => (s?.secretHeaders ?? []).map(([, ref]) => ref)),
    ),
  );

/** References nothing points at any more -- deleted rules, replaced values, imports. */
export const releasedReferences = (before: Set<string>, after: Set<string>): string[] =>
  [...before].filter((ref) => !after.has(ref));

/** A sink as it may travel to another machine: built fresh rather than spread, so a
 *  field added to the sink later cannot ride along by accident. */
export const strippedSink = (sink: Partial<WebhookSink> | undefined): WebhookSink => ({
  url: '',
  format: sink?.format === 'raw' ? 'raw' : 'json',
  headers: [],
});

/** Storage keys whose rules carry webhook sinks. */
export const WEBHOOK_BEARING_KEYS = ['dropqtt_bridge_rules', 'dropqtt_silence_rules'] as const;

export interface HeaderMigrationReport {
  moved: number;
  failed: string[];
}

/**
 * The one-time move for rules saved before headers had a store: every sensitive plain
 * header becomes a reference. Same shape as `migrateStoredSecrets` -- a failed write
 * leaves that header exactly as it was, still usable, with the reason reported.
 */
export async function migrateWebhookHeaders(
  store: SecretStore,
  read: (key: string) => string | null,
  write: (key: string, value: string) => void,
): Promise<HeaderMigrationReport> {
  const report: HeaderMigrationReport = { moved: 0, failed: [] };
  if (!(await store.status()).available) return report;
  for (const key of WEBHOOK_BEARING_KEYS) {
    const raw = read(key);
    if (!raw) continue;
    let rules: unknown;
    try {
      rules = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(rules)) continue;
    let movedHere = 0;
    const next = [];
    for (const rule of rules as SinkBearing[]) {
      const moveSink = async (sink: Partial<WebhookSink> | undefined) => {
        if (!sink || !Array.isArray(sink.headers)) return sink;
        const headers: [string, string][] = [];
        const secretHeaders: [string, string][] = [...(sink.secretHeaders ?? [])];
        for (const [name, value] of sink.headers) {
          if (!isSensitiveHeader(name) || !value) {
            headers.push([name, value]);
            continue;
          }
          const reference = newSecretRef();
          const error = await store.put(reference, value, 'webhook');
          if (error) {
            report.failed.push(error);
            headers.push([name, value]);
          } else {
            secretHeaders.push([name, reference]);
            movedHere += 1;
          }
        }
        return { ...sink, headers, ...(secretHeaders.length ? { secretHeaders } : {}) };
      };
      const webhook = await moveSink(rule?.webhook);
      // One at a time: a keychain that prompts must not be asked eight times at once.
      let targets = rule?.targets;
      if (Array.isArray(rule?.targets)) {
        targets = [];
        for (const sink of rule.targets) targets.push((await moveSink(sink)) as Partial<WebhookSink>);
      }
      next.push(rule && typeof rule === 'object' ? { ...rule, ...(webhook ? { webhook } : {}), ...(targets ? { targets } : {}) } : rule);
    }
    if (movedHere > 0) write(key, JSON.stringify(next));
    report.moved += movedHere;
  }
  return report;
}
