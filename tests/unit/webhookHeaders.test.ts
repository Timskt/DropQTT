import { describe, expect, it } from 'vitest';
import {
  commitSinkSecrets,
  formatSinkHeaders,
  headerReferences,
  isSensitiveHeader,
  migrateWebhookHeaders,
  parseHeaderLines,
  planSinkSecrets,
  releasedReferences,
  StaleHeaderMark,
  STORED_HEADER_MARK,
  strippedSink,
} from '../../src/utils/webhookHeaders';
import { SecretKind, SecretStore } from '../../src/utils/secrets';
import { SecretStatus } from '../../src/types';

const stored: SecretStatus = { available: true, supported: true };
const locked: SecretStatus = { available: false, supported: true, reason: 'locked' };

/** Records every write and drop, with the namespace it was made in. */
function fakeStore(status: SecretStatus = stored, failOn?: (value: string) => string | null) {
  const values = new Map<string, string>();
  const dropped: string[] = [];
  const kinds: (SecretKind | undefined)[] = [];
  const store: SecretStore = {
    status: async () => status,
    put: async (reference, value, kind) => {
      kinds.push(kind);
      const error = failOn?.(value) ?? null;
      if (error) return error;
      values.set(reference, value);
      return null;
    },
    drop: async (reference) => {
      dropped.push(reference);
      values.delete(reference);
      return null;
    },
  };
  return { store, values, dropped, kinds };
}

const counter = () => {
  let n = 0;
  return () => `ref${++n}`;
};

describe('isSensitiveHeader', () => {
  it.each(['Authorization', 'cookie', 'X-Auth-Token', 'X-Api-Key', 'api_key', 'X-Hub-Signature-256', 'X-Secret', 'Key'])(
    'treats %s as a credential',
    (name) => expect(isSensitiveHeader(name)).toBe(true),
  );

  it.each(['Content-Type', 'Accept', 'X-Request-Id', 'Keyboard-Layout', 'Monkey'])('leaves %s visible', (name) =>
    expect(isSensitiveHeader(name)).toBe(false),
  );
});

describe('parseHeaderLines / formatSinkHeaders', () => {
  it('keeps the colon in a value and skips blank lines', () => {
    expect(parseHeaderLines('A: b:c\n\n  \nX-Id: 7')).toEqual([
      ['A', 'b:c'],
      ['X-Id', '7'],
    ]);
  });

  it('throws on a line with no name, so the form refuses rather than drops it', () => {
    expect(() => parseHeaderLines('Authorization Bearer abc')).toThrow();
    expect(() => parseHeaderLines(': value')).toThrow();
  });

  it('masks stored values and never needs to know them', () => {
    const text = formatSinkHeaders({ headers: [['Content-Type', 'text/plain']], secretHeaders: [['Authorization', 'r1']] });
    expect(text).toBe(`Content-Type: text/plain\nAuthorization: ${STORED_HEADER_MARK}`);
    expect(text).not.toContain('r1');
  });

  it('round-trips through the parser into a plan that keeps the reference', () => {
    const sink = { headers: [] as [string, string][], secretHeaders: [['Authorization', 'r1']] as [string, string][] };
    const plan = planSinkSecrets(sink, parseHeaderLines(formatSinkHeaders(sink)), stored, counter());
    expect(plan).toEqual({ headers: [], secretHeaders: [['Authorization', 'r1']], writes: [] });
  });
});

describe('planSinkSecrets', () => {
  it('moves a credential into a write and leaves ordinary headers plain', () => {
    const plan = planSinkSecrets(undefined, [['Content-Type', 'application/json'], ['Authorization', 'Bearer t0k']], stored, counter());
    expect(plan.headers).toEqual([['Content-Type', 'application/json']]);
    expect(plan.secretHeaders).toEqual([['Authorization', 'ref1']]);
    expect(plan.writes).toEqual([{ reference: 'ref1', value: 'Bearer t0k' }]);
  });

  it('mints a new reference when a stored value is typed over', () => {
    const plan = planSinkSecrets({ secretHeaders: [['Authorization', 'old']] }, [['Authorization', 'Bearer new']], stored, counter());
    expect(plan.secretHeaders).toEqual([['Authorization', 'ref1']]);
    expect(plan.writes).toEqual([{ reference: 'ref1', value: 'Bearer new' }]);
  });

  it('matches a kept mark case-insensitively', () => {
    const plan = planSinkSecrets({ secretHeaders: [['Authorization', 'r1']] }, [['authorization', STORED_HEADER_MARK]], stored);
    expect(plan.secretHeaders).toEqual([['authorization', 'r1']]);
  });

  it('refuses a mark whose name no longer points at a stored value', () => {
    const run = () => planSinkSecrets({ secretHeaders: [['Authorization', 'r1']] }, [['X-Token', STORED_HEADER_MARK]], stored);
    expect(run).toThrow(StaleHeaderMark);
    try {
      run();
    } catch (e) {
      expect((e as StaleHeaderMark).header).toBe('X-Token');
    }
  });

  it('keeps a new credential plain without a store, but keeps an old reference too', () => {
    const plan = planSinkSecrets(
      { secretHeaders: [['X-Api-Key', 'r1']] },
      [['Authorization', 'Bearer t'], ['X-Api-Key', STORED_HEADER_MARK]],
      locked,
      counter(),
    );
    expect(plan.headers).toEqual([['Authorization', 'Bearer t']]);
    expect(plan.secretHeaders).toEqual([['X-Api-Key', 'r1']]);
    expect(plan.writes).toEqual([]);
  });

  it('does not store an empty credential', () => {
    expect(planSinkSecrets(undefined, [['Authorization', '']], stored).writes).toEqual([]);
  });
});

describe('commitSinkSecrets', () => {
  it('writes every planned value in the webhook namespace', async () => {
    const { store, values, kinds } = fakeStore();
    const plans = [
      { headers: [], secretHeaders: [], writes: [{ reference: 'a', value: '1' }] },
      { headers: [], secretHeaders: [], writes: [{ reference: 'b', value: '2' }] },
    ];
    expect(await commitSinkSecrets(store, plans)).toBeNull();
    expect([...values]).toEqual([['a', '1'], ['b', '2']]);
    expect(kinds).toEqual(['webhook', 'webhook']);
  });

  it('takes back what landed when a later write is refused', async () => {
    const { store, values, dropped } = fakeStore(stored, (v) => (v === '2' ? 'keychain locked' : null));
    const plans = [{ headers: [], secretHeaders: [], writes: [{ reference: 'a', value: '1' }, { reference: 'b', value: '2' }, { reference: 'c', value: '3' }] }];
    expect(await commitSinkSecrets(store, plans)).toBe('keychain locked');
    expect(dropped).toEqual(['a']);
    expect(values.size).toBe(0);
  });
});

describe('headerReferences / releasedReferences', () => {
  const rules = [
    { webhook: { secretHeaders: [['Authorization', 'r1']] as [string, string][] }, targets: [{ secretHeaders: [['X-Key', 'r2']] as [string, string][] }] },
    { webhook: { headers: [] as [string, string][] } },
  ];

  it('collects references from the primary sink and every target', () => {
    expect([...headerReferences(rules)].sort()).toEqual(['r1', 'r2']);
  });

  it('reports only the references nothing points at any more', () => {
    const after = headerReferences([rules[0]].map((r) => ({ ...r, targets: [] })));
    expect(releasedReferences(headerReferences(rules), after)).toEqual(['r2']);
  });
});

describe('strippedSink', () => {
  it('keeps only the format, so no reference or header travels', () => {
    const out = strippedSink({ url: 'https://h/x?token=1', format: 'raw', headers: [['A', 'b']], secretHeaders: [['Authorization', 'r1']] });
    expect(out).toEqual({ url: '', format: 'raw', headers: [] });
    expect(strippedSink(undefined)).toEqual({ url: '', format: 'json', headers: [] });
  });
});

describe('migrateWebhookHeaders', () => {
  const disk = (initial: Record<string, unknown>) => {
    const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
    return {
      read: (k: string) => data.get(k) ?? null,
      write: (k: string, v: string) => void data.set(k, v),
      parse: (k: string) => JSON.parse(data.get(k) ?? 'null'),
    };
  };
  const bridge = [
    {
      id: 'b1',
      webhook: { url: 'https://h/a', format: 'json', headers: [['Content-Type', 'application/json'], ['Authorization', 'Bearer A']] },
      targets: [{ url: 'https://h/b', format: 'json', headers: [['X-Api-Key', 'K']] }],
    },
  ];
  const silence = [{ id: 's1', webhook: { url: 'https://h/c', format: 'json', headers: [['Cookie', 'sid=1']] } }];

  it('moves only credentials, from every sink of both rule kinds', async () => {
    const d = disk({ dropqtt_bridge_rules: bridge, dropqtt_silence_rules: silence });
    const { store, values } = fakeStore();
    expect(await migrateWebhookHeaders(store, d.read, d.write)).toEqual({ moved: 3, failed: [] });
    const [rule] = d.parse('dropqtt_bridge_rules');
    expect(rule.webhook.headers).toEqual([['Content-Type', 'application/json']]);
    expect(rule.webhook.secretHeaders[0][0]).toBe('Authorization');
    expect(rule.targets[0].headers).toEqual([]);
    expect(d.parse('dropqtt_silence_rules')[0].webhook.secretHeaders[0][0]).toBe('Cookie');
    expect([...values.values()].sort()).toEqual(['Bearer A', 'K', 'sid=1']);
    expect(JSON.stringify([d.parse('dropqtt_bridge_rules'), d.parse('dropqtt_silence_rules')])).not.toMatch(/Bearer A|sid=1|"K"/);
  });

  it('leaves a header plaintext and usable when its write is refused', async () => {
    const d = disk({ dropqtt_bridge_rules: bridge });
    const { store } = fakeStore(stored, (v) => (v === 'K' ? 'denied' : null));
    expect(await migrateWebhookHeaders(store, d.read, d.write)).toEqual({ moved: 1, failed: ['denied'] });
    expect(d.parse('dropqtt_bridge_rules')[0].targets[0].headers).toEqual([['X-Api-Key', 'K']]);
  });

  it('touches nothing without a usable store', async () => {
    const d = disk({ dropqtt_bridge_rules: bridge });
    const before = d.read('dropqtt_bridge_rules');
    const { store, kinds } = fakeStore(locked);
    expect(await migrateWebhookHeaders(store, d.read, d.write)).toEqual({ moved: 0, failed: [] });
    expect(d.read('dropqtt_bridge_rules')).toBe(before);
    expect(kinds).toEqual([]);
  });

  it('skips storage it cannot read instead of throwing', async () => {
    const d = disk({});
    d.write('dropqtt_bridge_rules', '{not json');
    const { store } = fakeStore();
    expect(await migrateWebhookHeaders(store, d.read, d.write)).toEqual({ moved: 0, failed: [] });
  });
});
