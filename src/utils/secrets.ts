import { invoke } from '@tauri-apps/api/core';
import { SecretStatus } from '../types';

/**
 * Where a broker password lives once it is saved.
 *
 * `password` used to be serialized straight into localStorage, which on Windows is a
 * plaintext directory the user's whole account can read. Now the secret goes to the OS
 * credential store through `secrets.rs` and what stays in storage is a random,
 * meaningless reference. Three pieces keep that true:
 *
 * - **`withoutStoredSecrets`** is the writer: a config that carries a reference has no
 *   business carrying a password, so the pair is never persisted together.
 * - **`migrateStoredSecrets`** is the one-time move for storage written before this
 *   existed. It runs before React mounts, because a hook that read the plaintext first
 *   would faithfully write it back again.
 * - **The commands have no read.** Nothing here can ask the store for a value, so
 *   nothing here can accidentally put one back.
 *
 * A machine with no usable credential store (a browser tab, a locked keychain, a Linux
 * box without Secret Service) is *not* silently downgraded: the plaintext stays where
 * it was and `SecretStatus` says why, which is what the Settings dialog then shows.
 */

/** Storage keys that can hold a broker config, and therefore a password. */
export const SECRET_BEARING_KEYS = [
  'dropqtt_active_broker',
  'dropqtt_broker_profiles',
  'dropqtt_bridge_remember',
] as const;

/** Bumped when stored shapes change; see `dropqtt_schema_version`. */
export const SCHEMA_VERSION = 1;

const SCHEMA_KEY = 'dropqtt_schema_version';

interface CarriesSecret {
  password?: unknown;
  secretRef?: unknown;
}

const hasReference = (value: unknown): value is CarriesSecret & { secretRef: string } =>
  !!value && typeof value === 'object' && typeof (value as CarriesSecret).secretRef === 'string';

/** A password a reference already covers is a copy, and copies go to disk. */
const dropCoveredPassword = <T>(value: T, depth = 0): T => {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => dropCoveredPassword(item, depth + 1)) as unknown as T;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...record };
  if (hasReference(out) && typeof out.password === 'string' && out.password.length > 0) {
    delete out.password;
  }
  for (const [key, child] of Object.entries(record)) {
    if (child && typeof child === 'object') out[key] = dropCoveredPassword(child, depth + 1);
  }
  return out as T;
};

/**
 * Sanitizer for `usePersistentState`: strips the plaintext from anything that has a
 * keyring reference, and leaves everything else exactly as it was -- so a machine
 * without a store keeps working instead of losing its password.
 */
export const withoutStoredSecrets = <T>(value: T): T => dropCoveredPassword(value);

/** True when no stored string in this value looks like a password with no reference. */
export const countExposedPasswords = (value: unknown): number => countPasswords(value, 'exposed');

/** Passwords that are sitting in storage even though a reference already covers them. */
export const countCoveredPasswords = (value: unknown): number => countPasswords(value, 'covered');

const countPasswords = (value: unknown, which: 'exposed' | 'covered', depth = 0): number => {
  if (depth > 4 || !value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countPasswords(item, which, depth + 1), 0);
  }
  const record = value as Record<string, unknown>;
  const held = typeof record.password === 'string' && record.password.length > 0;
  const referenced = typeof record.secretRef === 'string';
  const mine = held && (which === 'exposed' ? !referenced : referenced);
  return (mine ? 1 : 0) + Object.values(record).reduce<number>((sum, child) => sum + countPasswords(child, which, depth + 1), 0);
};

/**
 * An opaque id for one credential. It is not a secret and says nothing about which
 * broker it belongs to; the backend prefixes it with its own namespace before it
 * reaches the store, and validates it against `[A-Za-z0-9_-]`.
 */
export function newSecretRef(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
  return random.slice(0, 16);
}

/**
 * What the backend says about the credential store. A host with no backend at all --
 * a browser tab, a Playwright page -- is reported as *unsupported* rather than as an
 * error, because that is what it is, and the UI then keeps its promise about where the
 * password goes instead of showing a stack trace.
 */
const NO_BACKEND: SecretStatus = { available: false, supported: false, reason: undefined };

export async function readSecretStatus(): Promise<SecretStatus> {
  try {
    const status = await invoke<SecretStatus>('secret_status');
    return status && typeof status.available === 'boolean' ? status : NO_BACKEND;
  } catch {
    return NO_BACKEND;
  }
}

/** `null` on success, otherwise the reason, which is safe to put on screen. */
export async function writeSecret(reference: string, value: string): Promise<string | null> {
  try {
    await invoke('secret_put', { reference, value });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function dropSecret(reference: string): Promise<string | null> {
  try {
    await invoke('secret_delete', { reference });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function hasSecret(reference: string): Promise<boolean | null> {
  try {
    return await invoke<boolean>('secret_exists', { reference });
  } catch {
    return null;
  }
}

export interface SecretStore {
  status: () => Promise<SecretStatus>;
  put: (reference: string, value: string) => Promise<string | null>;
}

export interface MigrationReport {
  /** Configs whose password moved into the credential store. */
  moved: number;
  /** Configs that still hold a plaintext password, with the reason. */
  failed: string[];
  /** True when this host has no credential store to move anything into. */
  skipped: boolean;
}

/**
 * Move every plaintext `password` in the secret-bearing keys into the credential store
 * and leave only a reference behind. Injected `read`/`write` so the whole thing is
 * testable without a browser, and injected `store` so a test can stand in for the OS.
 */
export async function migrateStoredSecrets(
  store: SecretStore,
  read: (key: string) => string | null,
  write: (key: string, value: string) => void,
): Promise<MigrationReport> {
  const report: MigrationReport = { moved: 0, failed: [], skipped: false };
  const status = await store.status();
  if (!status.available) {
    report.skipped = true;
    return report;
  }
  for (const key of SECRET_BEARING_KEYS) {
    const raw = read(key);
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const attempts = countExposedPasswords(parsed) > 0 ? await moveWithin(parsed, store) : [];
    const movedHere = attempts.filter((a) => !a.error).length;
    for (const attempt of attempts) {
      // A failed write leaves that config exactly as it was: still plaintext, still
      // usable, now with a reason on screen. A dangling reference would be worse.
      if (attempt.error) report.failed.push(attempt.error);
    }
    report.moved += movedHere;
    // Rewrite only when something actually changed -- covered passwords are stale
    // copies of what the store already holds, and they go the same way.
    if (movedHere > 0 || countCoveredPasswords(parsed) > 0) {
      write(key, JSON.stringify(dropCoveredPassword(parsed)));
    }
  }
  return report;
}

interface MoveAttempt {
  error: string | null;
}

/** Mutates the parsed value in place, filling in references as it goes. */
async function moveWithin(node: unknown, store: SecretStore, depth = 0): Promise<MoveAttempt[]> {
  if (depth > 4 || !node || typeof node !== 'object') return [];
  if (Array.isArray(node)) {
    const all: MoveAttempt[] = [];
    for (const item of node) all.push(...(await moveWithin(item, store, depth + 1)));
    return all;
  }
  const record = node as Record<string, unknown>;
  const config = record as CarriesSecret;
  const attempts: MoveAttempt[] = [];
  if (typeof config.password === 'string' && config.password.length > 0 && typeof config.secretRef !== 'string') {
    const reference = newSecretRef();
    const error = await store.put(reference, config.password);
    if (error) {
      attempts.push({ error });
    } else {
      record.secretRef = reference;
      attempts.push({ error: null });
    }
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === 'object') attempts.push(...(await moveWithin(child, store, depth + 1)));
  }
  return attempts;
}

/** Stamp the storage schema so later migrations know what disk holds. */
export function readSchemaVersion(read: (key: string) => string | null): number {
  const raw = read(SCHEMA_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function writeSchemaVersion(write: (key: string, value: string) => void): void {
  write(SCHEMA_KEY, String(SCHEMA_VERSION));
}

/** The real store, talking to the backend. */
export const credentialStore: SecretStore = {
  status: readSecretStatus,
  put: writeSecret,
};

/** The two storage calls every migration and every hook needs, from one place. */
export const localStorageRead = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const localStorageWrite = (key: string, value: string): void => {
  localStorage.setItem(key, value);
};

/**
 * Run whatever the stored data needs before any hook reads it. Awaited by `main.tsx`,
 * with a deadline: a credential store that hangs must delay the credential, never the
 * application.
 */
export async function migrateBeforeRender(timeoutMs = 4000): Promise<MigrationReport> {
  const work = migrateStoredSecrets(credentialStore, localStorageRead, localStorageWrite).catch((e: unknown) => ({
    moved: 0,
    failed: [String(e)],
    skipped: false,
  }));
  const deadline = new Promise<MigrationReport>((resolve) => {
    setTimeout(
      () => resolve({ moved: 0, failed: [`the credential store did not answer within ${timeoutMs}ms`], skipped: true }),
      timeoutMs,
    );
  });
  const report = await Promise.race([work, deadline]);
  // The stamp says "this storage has been through every migration up to SCHEMA_VERSION",
  // so it goes down whether or not there was anything to move.
  writeSchemaVersion(localStorageWrite);
  bootReport = report;
  return report;
}

/**
 * What the startup move did, for exactly one reader. Settings asks when it opens:
 * a migration the user never hears about is a change to their secrets that nobody
 * approved, and a failed one has to be visible while there is still a password field
 * to re-type into.
 */
let bootReport: MigrationReport | null = null;

export const takeBootReport = (): MigrationReport | null => {
  const report = bootReport;
  bootReport = null;
  return report;
};
