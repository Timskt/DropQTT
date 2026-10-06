import { describe, expect, it } from 'vitest';
import {
  countCoveredPasswords,
  countExposedPasswords,
  migrateStoredSecrets,
  newSecretRef,
  withoutStoredSecrets,
  MigrationReport,
  SecretStore,
} from '../../src/utils/secrets';
import { SecretStatus } from '../../src/types';

const stored: SecretStatus = { available: true, supported: true };
const missing: SecretStatus = { available: false, supported: false };

/** A store that records what it was given, so a test can read it back. */
function fakeStore(status: SecretStatus = stored, failWith?: string) {
  const values = new Map<string, string>();
  const store: SecretStore & { values: Map<string, string> } = {
    status: async () => status,
    put: async (reference, value) => {
      if (failWith) return failWith;
      values.set(reference, value);
      return null;
    },
    values,
  };
  return store;
}

function fakeDisk(initial: Record<string, unknown>) {
  const data = new Map<string, string>();
  for (const [key, value] of Object.entries(initial)) data.set(key, JSON.stringify(value));
  return {
    read: (key: string) => data.get(key) ?? null,
    write: (key: string, value: string) => {
      data.set(key, value);
    },
    parse: (key: string) => JSON.parse(data.get(key) ?? 'null'),
    raw: data,
  };
}

describe('withoutStoredSecrets', () => {
  it('drops a password the reference already covers', () => {
    const out = withoutStoredSecrets({ host: 'x', secretRef: 'r1', password: 'hunter2' });
    expect(out).toEqual({ host: 'x', secretRef: 'r1' });
  });

  it('keeps a password that has no reference, because deleting it would lose it', () => {
    const out = withoutStoredSecrets({ host: 'x', password: 'legacy' });
    expect(out).toEqual({ host: 'x', password: 'legacy' });
  });

  it('reaches the config nested inside a profile and inside a remembered endpoint map', () => {
    const profiles = withoutStoredSecrets([
      { id: 'p1', name: 'Lab', config: { host: 'a', secretRef: 'r1', password: 'x' } },
      { id: 'p2', name: 'Home', config: { host: 'b', password: 'keep' } },
    ]);
    expect(profiles[0].config).toEqual({ host: 'a', secretRef: 'r1' });
    expect(profiles[1].config.password).toBe('keep');

    const remember = withoutStoredSecrets({
      source: { host: 'a', secretRef: 'r9', password: 'gone' },
      sink: { host: 'b' },
    });
    expect(remember.source).toEqual({ host: 'a', secretRef: 'r9' });
    expect(remember.sink).toEqual({ host: 'b' });
  });

  it('returns a new object rather than editing the caller state', () => {
    const original = { host: 'x', secretRef: 'r1', password: 'hunter2' };
    withoutStoredSecrets(original);
    expect(original.password).toBe('hunter2');
  });

  it('leaves non-objects alone', () => {
    expect(withoutStoredSecrets(7)).toBe(7);
    expect(withoutStoredSecrets('a')).toBe('a');
    expect(withoutStoredSecrets(null)).toBe(null);
  });
});

describe('counting what is on disk', () => {
  it('separates a bare password from one a reference covers', () => {
    expect(countExposedPasswords({ password: 'p' })).toBe(1);
    expect(countExposedPasswords({ password: 'p', secretRef: 'r' })).toBe(0);
    expect(countCoveredPasswords({ password: 'p', secretRef: 'r' })).toBe(1);
    expect(countCoveredPasswords({ password: 'p' })).toBe(0);
  });

  it('walks arrays and nested configs', () => {
    const value = {
      profiles: [{ config: { password: 'a' } }, { config: { password: 'b', secretRef: 'r' } }],
    };
    expect(countExposedPasswords(value)).toBe(1);
    expect(countCoveredPasswords(value)).toBe(1);
  });

  it('does not treat an empty password as exposed', () => {
    expect(countExposedPasswords({ password: '' })).toBe(0);
  });
});

describe('newSecretRef', () => {
  it('produces the characters the backend accepts', () => {
    for (let i = 0; i < 50; i += 1) {
      const reference = newSecretRef();
      expect(reference).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newSecretRef()));
    expect(seen.size).toBe(200);
  });
});

describe('migrateStoredSecrets', () => {
  it('moves every plaintext password and leaves only a reference', async () => {
    const disk = fakeDisk({
      'dropqtt_active_broker': { host: 'a', password: 'active-pass' },
      'dropqtt_broker_profiles': [
        { id: 'p1', name: 'Lab', config: { host: 'b', password: 'profile-pass' } },
      ],
      'dropqtt_bridge_remember': { source: { host: 'c', password: 'bridge-pass' } },
    });
    const store = fakeStore();
    const report = await migrateStoredSecrets(store, disk.read, disk.write);

    expect(report).toEqual({ moved: 3, failed: [], skipped: false });
    expect(disk.parse('dropqtt_active_broker')).toEqual({ host: 'a', secretRef: expect.any(String) });
    expect(countExposedPasswords(disk.parse('dropqtt_broker_profiles'))).toBe(0);
    expect(countExposedPasswords(disk.parse('dropqtt_bridge_remember'))).toBe(0);
    expect([...store.values.values()].sort()).toEqual(['active-pass', 'bridge-pass', 'profile-pass']);
  });

  it('refuses to start when there is no store to move into', async () => {
    const disk = fakeDisk({ 'dropqtt_active_broker': { host: 'a', password: 'still-here' } });
    const report = await migrateStoredSecrets(fakeStore(missing), disk.read, disk.write);
    expect(report).toEqual({ moved: 0, failed: [], skipped: true });
    expect(disk.parse('dropqtt_active_broker').password).toBe('still-here');
  });

  it('keeps the password when the store rejects it, instead of leaving a dangling reference', async () => {
    const disk = fakeDisk({ 'dropqtt_active_broker': { host: 'a', password: 'keep-me' } });
    const store = fakeStore(stored, 'the credential store is locked');
    const report = await migrateStoredSecrets(store, disk.read, disk.write);
    expect(report.moved).toBe(0);
    expect(report.failed).toEqual(['the credential store is locked']);
    expect(disk.parse('dropqtt_active_broker')).toEqual({ host: 'a', password: 'keep-me' });
  });

  it('is a no-op on already-migrated storage, and does not rewrite it', async () => {
    const disk = fakeDisk({ 'dropqtt_active_broker': { host: 'a', secretRef: 'r1' } });
    const before = disk.read('dropqtt_active_broker');
    const report = await migrateStoredSecrets(fakeStore(), disk.read, disk.write);
    expect(report.moved).toBe(0);
    expect(disk.read('dropqtt_active_broker')).toBe(before);
  });

  it('clears a stale copy that a reference already covers', async () => {
    const disk = fakeDisk({ 'dropqtt_active_broker': { host: 'a', secretRef: 'r1', password: 'leftover' } });
    const report = await migrateStoredSecrets(fakeStore(), disk.read, disk.write);
    expect(report.moved).toBe(0);
    expect(disk.parse('dropqtt_active_broker')).toEqual({ host: 'a', secretRef: 'r1' });
  });

  it('survives a key that holds junk, rather than taking the boot down with it', async () => {
    const disk = fakeDisk({});
    disk.raw.set('dropqtt_broker_profiles', 'not json at all');
    const report: MigrationReport = await migrateStoredSecrets(fakeStore(), disk.read, disk.write);
    expect(report.moved).toBe(0);
    expect(disk.read('dropqtt_broker_profiles')).toBe('not json at all');
  });

  it('migrates only what it knows can hold a password', async () => {
    const disk = fakeDisk({ 'dropqtt_assertion_rules': [{ password: 'elsewhere' }] });
    const report = await migrateStoredSecrets(fakeStore(), disk.read, disk.write);
    expect(report.moved).toBe(0);
    expect(disk.parse('dropqtt_assertion_rules')[0].password).toBe('elsewhere');
  });
});
