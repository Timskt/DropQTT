import { BrokerProfile } from '../types';

/**
 * The environment bundle: one text blob that describes a reproducible bench —
 * profiles (minus credentials), subscriptions and every rule set — so a setup can be
 * handed to a colleague or attached to a ticket instead of being retyped.
 *
 * Two rules are load-bearing:
 *
 * - **Credentials and machine-local paths never leave.** Anything named like a
 *   password, token, key or certificate is dropped, and webhook targets are emptied
 *   rather than truncated: a partial URL is still a URL, and this project's rule is
 *   that a target never appears in an exported file.
 * - **Import merges, it never replaces.** An entry whose id already exists locally is
 *   skipped and counted, because silently overwriting someone's live rule set is the
 *   one mistake a handoff tool must not make.
 */

export const BUNDLE_KIND = 'dropqtt.environment';
export const BUNDLE_VERSION = 1;

/** Field names that must never be exported, matched case-insensitively. */
const SECRET_KEY = /(password|passwd|secret|token|apikey|api_key|accesskey|privatekey|clientkey|keypass|cert|pem|cafile|keystore)/i;

export interface EnvironmentBundle {
  kind: typeof BUNDLE_KIND;
  version: number;
  exportedAt: string;
  profiles: BrokerProfile[];
  subscriptions: unknown[];
  bridgeRules: unknown[];
  silenceRules: unknown[];
  assertionRules: unknown[];
  faultRules: unknown[];
  responderRules: unknown[];
}

export interface BundleSections {
  profiles: BrokerProfile[];
  subscriptions: unknown[];
  bridgeRules: unknown[];
  silenceRules: unknown[];
  assertionRules: unknown[];
  faultRules: unknown[];
  responderRules: unknown[];
}

export const SECTION_KEYS = [
  'profiles',
  'subscriptions',
  'bridgeRules',
  'silenceRules',
  'assertionRules',
  'faultRules',
  'responderRules',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

const stripSecrets = (value: unknown, depth = 0): unknown => {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = stripSecrets(v, depth + 1);
  }
  return out;
};

/** A webhook target is replaced by an empty one and flagged, never partially kept. */
const redactWebhook = <T extends { webhook?: { url?: string; format?: string; headers?: unknown } }>(rule: T): T => {
  if (!rule.webhook) return rule;
  return {
    ...rule,
    webhook: { url: '', format: rule.webhook.format ?? 'json', headers: [] },
    webhookRedacted: true,
  };
};

export const buildEnvironmentBundle = (sections: BundleSections, exportedAt: string): string => {
  const bundle: EnvironmentBundle = {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    exportedAt,
    profiles: (sections.profiles ?? []).map((p) => stripSecrets(p) as BrokerProfile),
    subscriptions: (sections.subscriptions ?? []).map((s) => stripSecrets(s)),
    bridgeRules: (sections.bridgeRules ?? []).map((r) => stripSecrets(redactWebhook(r as never))),
    silenceRules: (sections.silenceRules ?? []).map((r) => stripSecrets(redactWebhook(r as never))),
    assertionRules: (sections.assertionRules ?? []).map((s) => stripSecrets(s)),
    faultRules: (sections.faultRules ?? []).map((s) => stripSecrets(s)),
    responderRules: (sections.responderRules ?? []).map((s) => stripSecrets(s)),
  };
  return JSON.stringify(bundle, null, 2);
};

export interface MergePlan {
  profiles: BrokerProfile[];
  subscriptions: unknown[];
  bridgeRules: unknown[];
  silenceRules: unknown[];
  assertionRules: unknown[];
  faultRules: unknown[];
  responderRules: unknown[];
  /** Per section: how many entries were skipped because the id already exists */
  skipped: Record<SectionKey, number>;
  /** Entries that carried no usable id and were dropped as junk */
  malformed: number;
  /** Rules whose webhook target was stripped on export and must be re-entered */
  webhookRedactions: number;
}

const emptySkipped = (): Record<SectionKey, number> => ({
  profiles: 0,
  subscriptions: 0,
  bridgeRules: 0,
  silenceRules: 0,
  assertionRules: 0,
  faultRules: 0,
  responderRules: 0,
});

const idOf = (entry: unknown): string | null => {
  if (!entry || typeof entry !== 'object') return null;
  const id = (entry as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id : null;
};

/**
 * Parse pasted bundle text against the ids already in use. Returns either a merge
 * plan or a one-line reason — never a partial plan, so a malformed paste cannot
 * half-apply.
 */
export const parseEnvironmentBundle = (
  text: string,
  existing: Record<SectionKey, unknown[]>,
): { ok: true; plan: MergePlan } | { ok: false; error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'the bundle is not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'the bundle is not an object' };
  const bundle = parsed as Partial<EnvironmentBundle>;
  if (bundle.kind !== BUNDLE_KIND) return { ok: false, error: `not a DropQTT environment bundle (kind: ${String(bundle.kind ?? 'missing')})` };
  if (bundle.version !== BUNDLE_VERSION) {
    return { ok: false, error: `bundle version ${String(bundle.version)} is not supported (this build reads version ${BUNDLE_VERSION})` };
  }
  const plan: MergePlan = {
    profiles: [],
    subscriptions: [],
    bridgeRules: [],
    silenceRules: [],
    assertionRules: [],
    faultRules: [],
    responderRules: [],
    skipped: emptySkipped(),
    malformed: 0,
    webhookRedactions: 0,
  };
  for (const key of SECTION_KEYS) {
    const incoming = bundle[key];
    if (incoming !== undefined && !Array.isArray(incoming)) {
      return { ok: false, error: `the ${key} section is not a list` };
    }
    const taken = new Set(
      (existing[key] ?? []).map(idOf).filter((x): x is string => x !== null),
    );
    for (const entry of incoming ?? []) {
      const id = idOf(entry);
      if (!id) {
        plan.malformed += 1;
        continue;
      }
      if (taken.has(id)) {
        plan.skipped[key] += 1;
        continue;
      }
      taken.add(id);
      (plan[key] as unknown[]).push(entry);
      const webhook = (entry as { webhookRedacted?: unknown }).webhookRedacted;
      if (webhook === true) plan.webhookRedactions += 1;
    }
  }
  return { ok: true, plan };
};

/** Total entries a plan would add, so a button can say what "Merge" means. */
export const planTotal = (plan: MergePlan): number =>
  SECTION_KEYS.reduce((sum, key) => sum + (plan[key] as unknown[]).length, 0);

/**
 * Every section lives in localStorage under its own key, and each owning hook reads
 * that key when it mounts. The bundle therefore reads and writes the same place
 * rather than reaching into six components' state — which is also why a merge is
 * followed by a reload: the reload is what makes every owner re-read consistently.
 */
export const SECTION_STORAGE: Record<SectionKey, string> = {
  profiles: 'dropqtt_broker_profiles',
  subscriptions: 'dropqtt_subscriptions',
  bridgeRules: 'dropqtt_bridge_rules',
  silenceRules: 'dropqtt_silence_rules',
  assertionRules: 'dropqtt_assertion_rules',
  faultRules: 'dropqtt_fault_rules',
  responderRules: 'dropqtt_responder_rules',
};

const readSection = (storageKey: string): unknown[] => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export const collectPersistedSections = (): BundleSections => ({
  profiles: readSection(SECTION_STORAGE.profiles) as BrokerProfile[],
  subscriptions: readSection(SECTION_STORAGE.subscriptions),
  bridgeRules: readSection(SECTION_STORAGE.bridgeRules),
  silenceRules: readSection(SECTION_STORAGE.silenceRules),
  assertionRules: readSection(SECTION_STORAGE.assertionRules),
  faultRules: readSection(SECTION_STORAGE.faultRules),
  responderRules: readSection(SECTION_STORAGE.responderRules),
});

/** Append the plan to what is already stored. Existing entries are never rewritten. */
export const mergePersistedSections = (plan: MergePlan): void => {
  for (const key of SECTION_KEYS) {
    const added = plan[key] as unknown[];
    if (added.length === 0) continue;
    const storageKey = SECTION_STORAGE[key];
    try {
      localStorage.setItem(storageKey, JSON.stringify([...readSection(storageKey), ...added]));
    } catch {
      // A quota or privacy-mode failure leaves the previous settings in place, which
      // is the only acceptable outcome here; the reload will show what survived.
    }
  }
};
