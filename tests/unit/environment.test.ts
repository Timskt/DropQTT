import { describe, expect, it } from 'vitest';
import {
  BUNDLE_KIND,
  BundleSections,
  SECTION_KEYS,
  buildEnvironmentBundle,
  parseEnvironmentBundle,
  planTotal,
} from '../../src/utils/environment';

const sections = (over: Partial<BundleSections> = {}): BundleSections => ({
  profiles: [
    {
      id: 'p1',
      name: 'lab',
      config: {
        host: '127.0.0.1',
        port: 1883,
        useTls: true,
        clientId: 'DropQTT_lab',
        username: 'svc',
        password: 'hunter2',
        keepAliveSecs: 60,
        defaultQos: 1,
        caCert: 'C:/secrets/ca.pem',
        clientKeyPem: '-----BEGIN KEY-----',
      },
    } as never,
  ],
  subscriptions: [],
  bridgeRules: [],
  silenceRules: [
    { id: 's1', name: 'hb', topicFilter: 'devices/+/hb', webhook: { url: 'https://hooks.example/x?token=abc', format: 'json', headers: [['Authorization', 'Bearer zzz']] } },
  ],
  assertionRules: [],
  faultRules: [],
  responderRules: [],
  ...over,
});

const emptyExisting = () => Object.fromEntries(SECTION_KEYS.map((k) => [k, []])) as Record<(typeof SECTION_KEYS)[number], unknown[]>;

const bundleOf = (over: Partial<BundleSections> = {}) => buildEnvironmentBundle(sections(over), '2026-10-03T20:00:00.000Z');

describe('buildEnvironmentBundle', () => {
  it('drops credentials and machine-local key material', () => {
    const text = bundleOf();
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('ca.pem');
    expect(text).not.toContain('BEGIN KEY');
    expect(text).not.toContain('password');
    expect(text).not.toContain('caCert');
    // The behaviour-defining fields stay, so the profile is still usable.
    expect(text).toContain('127.0.0.1');
    expect(text).toContain('svc');
  });

  it('empties a webhook target instead of truncating it', () => {
    const parsed = JSON.parse(bundleOf());
    const rule = parsed.silenceRules[0];
    expect(JSON.stringify(parsed)).not.toContain('hooks.example');
    expect(JSON.stringify(parsed)).not.toContain('Bearer');
    expect(rule.webhook.url).toBe('');
    expect(rule.webhook.headers).toEqual([]);
    // Flagged, so the person importing knows a target has to be typed again.
    expect(rule.webhookRedacted).toBe(true);
  });
});

describe('parseEnvironmentBundle', () => {
  it('refuses a paste that is not a bundle, without producing a plan', () => {
    expect(parseEnvironmentBundle('not json', emptyExisting())).toEqual({ ok: false, error: 'the bundle is not valid JSON' });
    const errorOf = (text: string) => {
      const r = parseEnvironmentBundle(text, emptyExisting());
      return r.ok === false ? r.error : '';
    };
    expect(errorOf(JSON.stringify({ kind: 'mqttx.settings', version: 1 }))).toContain('not a DropQTT environment bundle');
    expect(errorOf(JSON.stringify({ kind: BUNDLE_KIND, version: 99 }))).toContain('version 99');
    expect(errorOf(JSON.stringify({ kind: BUNDLE_KIND, version: 1, profiles: {} }))).toContain('profiles section is not a list');
  });

  it('skips ids that already exist and counts them per section', () => {
    const res = parseEnvironmentBundle(bundleOf(), { ...emptyExisting(), profiles: [{ id: 'p1' }], silenceRules: [{ id: 's1' }] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.profiles).toHaveLength(0);
    expect(res.plan.skipped.profiles).toBe(1);
    expect(res.plan.skipped.silenceRules).toBe(1);
    expect(planTotal(res.plan)).toBe(0);
  });

  it('counts a re-entered webhook target as something the importer must fix', () => {
    const res = parseEnvironmentBundle(bundleOf(), emptyExisting());
    if (!res.ok) throw new Error('should parse');
    expect(res.plan.webhookRedactions).toBe(1);
    expect(planTotal(res.plan)).toBe(2);
  });

  it('drops entries with no usable id rather than inventing one', () => {
    const text = JSON.stringify({ kind: BUNDLE_KIND, version: 1, subscriptions: [{ topic: 'a/b' }, { id: '  ' }, { id: 'ok' }] });
    const res = parseEnvironmentBundle(text, emptyExisting());
    if (!res.ok) throw new Error('should parse');
    expect(res.plan.subscriptions).toHaveLength(1);
    expect(res.plan.malformed).toBe(2);
  });

  it('treats a duplicate id inside one bundle as one entry, not two', () => {
    const text = JSON.stringify({ kind: BUNDLE_KIND, version: 1, responderRules: [{ id: 'r1' }, { id: 'r1' }] });
    const res = parseEnvironmentBundle(text, emptyExisting());
    if (!res.ok) throw new Error('should parse');
    expect(res.plan.responderRules).toHaveLength(1);
    expect(res.plan.skipped.responderRules).toBe(1);
  });
});
