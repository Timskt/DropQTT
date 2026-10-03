import { test, expect } from '@playwright/test';

/**
 * Message assertions turn the console from "watch traffic" into "judge traffic".
 * The grammar lives in Rust on purpose, so the UI's job is to (a) show the parser's
 * rejection instead of saving a rule that would silently never fire, (b) report what
 * the backend has actually armed -- which is not the same list when a sync failed --
 * and (c) put the verdict on the row it belongs to, in words as well as colour.
 */
const boot = async (page: any, opts: { rules?: any[]; snapshot?: any } = {}) => {
  await page.addInitScript((seed: any) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem('dropqtt_assertion_rules', JSON.stringify(seed.rules ?? []));
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_assert',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: 5, cleanSession: true,
      }),
    );
    localStorage.setItem(
      'dropqtt_subscriptions',
      JSON.stringify([{ topic: 'sensors/#', qos: 1, color: '#10b981', options: { noLocal: false, retainAsPublished: false, retainHandling: 0 } }]),
    );
    const w = window as any;
    w.calls = [];
    w.assertions = seed.snapshot ?? null;
    const handlers = new Map<number, { event: string; cb: (e: any) => void }>();
    const byId = new Map<number, (e: any) => void>();
    let nextId = 1;
    w.__fire = (event: string, payload: any) => {
      handlers.forEach((h) => {
        if (h.event === event) h.cb({ event, payload, id: 0 });
      });
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (cb: any) => {
        const id = nextId++;
        byId.set(id, cb);
        return id;
      },
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args });
        if (cmd === 'plugin:event|listen') {
          const cb = byId.get(args.handler);
          if (cb) handlers.set(args.handler, { event: args.event, cb });
          return args.handler;
        }
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'get_connection_status') {
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_assert' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ids') return {};
        if (cmd === 'get_broker_capabilities')
          return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset')
          return w.faults ?? [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset')
          return w.responder ?? [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state') {
          // The backend's own account. A rejected sync leaves the previous
          // snapshot in place, which is exactly what the panel must show.
          return w.assertions ?? { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: (args.rules ?? []).length, recent: [] };
        }
        if (cmd === 'assertions_reset') {
          // Reset zeroes the tallies and keeps the rules, which is the claim under
          // test -- so the mock has to do exactly that, not hand back the seed.
          w.assertions = {
            stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 },
            rules: w.assertions?.rules ?? (args.rules ?? []).length,
            recent: [],
          };
          return w.assertions;
        }
        if (cmd === 'assertions_parse_rule') {
          // A thin stand-in for the Rust grammar, but faithful on the two points the
          // UI depends on: an unparseable line comes back as an error, and a numeric
          // operator with a non-numeric right side is refused rather than saved.
          const predicate = String(args.predicate ?? '').trim();
          const filter = String(args.filter ?? '').trim();
          if (!predicate) throw new Error('the predicate is empty');
          if (!filter) throw new Error('an assertion needs a topic filter');
          const word = /^(\S+)\s+(exists|missing)$/.exec(predicate);
          const neg = /^(\S+)\s+(!contains|contains)\s+(.+)$/.exec(predicate);
          const sym = /^(\S+)\s*(<=|>=|!=|==|!~|~|<|>|=)\s*(.*)$/.exec(predicate);
          let field: any, op: string, expected = '';
          if (word) {
            field = word[1].startsWith('$.') ? { json: word[1] } : 'payload';
            op = word[2] === 'exists' ? 'present' : 'absent';
          } else if (neg) {
            field = neg[1].startsWith('$.') ? { json: neg[1] } : 'payload';
            op = neg[2] === 'contains' ? 'contains' : 'notContains';
            expected = neg[3];
            if (typeof field === 'object') throw new Error('use == or != for a JSON value; contains is for text fields');
          } else if (sym) {
            field = sym[1].startsWith('$.') ? { json: sym[1] } : 'payload';
            op = sym[2];
            expected = sym[3];
            if (['<', '<=', '>', '>='].includes(op) && !Number.isFinite(Number(expected)))
              throw new Error('this comparison needs a number on the right');
          } else {
            throw new Error(`'${predicate}' is not a field this can judge`);
          }
          return {
            id: args.id,
            filter,
            field,
            op,
            expected,
            enabled: true,
            label: String(args.label ?? ''),
            text: predicate,
          };
        }
        return null;
      },
    };
  }, { rules: opts.rules, snapshot: opts.snapshot });
  await page.goto('/');
};

const snap = (over: any = {}) => ({
  stats: { matched: 12, passed: 9, violated: 2, unevaluable: 1 },
  rules: 2,
  recent: [
    { msgId: 'm1', topic: 'sensors/room1', ruleId: 'as_1', expr: '$.tempC < 80', outcome: 'violated', tsMs: 1760000000000 },
  ],
  ...over,
});

const rule = (over: any = {}) => ({
  id: 'as_1',
  filter: 'sensors/#',
  field: { json: '$.tempC' },
  op: 'lt',
  expected: '80',
  enabled: true,
  label: 'gateway heat',
  text: '$.tempC < 80',
  ...over,
});

const feed = async (page: any, message: any) => {
  await page.evaluate((m) => (window as any).__fire('mqtt-messages', { messages: [m], dropped: 0 }), message);
};

const msg = (over: any) => ({
  id: 'm1',
  topic: 'sensors/room1',
  payload: '{"tempC":95}',
  payloadLen: 12,
  payloadBase64: 'eyJ0ZW1wQyI6OTV9',
  truncated: false,
  qos: 1,
  retain: false,
  timestamp: '10:00:00.000',
  timestampMs: 1760000000000,
  direction: 'in',
  matchedFilters: ['sensors/#'],
  subscriptionIds: [],
  ...over,
});

const syncCalls = (page: any) =>
  page.evaluate(() => (window as any).calls.filter((c: any) => c.cmd === 'assertions_sync_rules').length);

test.describe('message assertions', () => {
  test('the armed count is what the backend reports, not what the page holds', async ({ page }) => {
    // A rejected sync means localStorage can hold five rules while Rust has two
    // armed. Showing the local number would claim judgement nobody is exercising.
    await boot(page, { rules: [rule(), rule({ id: 'as_2' }), rule({ id: 'as_3' }), rule({ id: 'as_4' }), rule({ id: 'as_5' })], snapshot: snap({ rules: 2 }) });
    await expect(page.getByTestId('assertions-armed')).toHaveText('2/5');
  });

  test('the tallies and the recent violations come from the judging side', async ({ page }) => {
    await boot(page, { rules: [rule()], snapshot: snap() });
    await expect(page.getByTestId('assertions-stats')).toContainText('12');
    await expect(page.getByTestId('assertions-stats')).toContainText('9');
    await expect(page.getByTestId('assertion-violation-as_1')).toContainText('$.tempC < 80');
  });

  test('a predicate the parser refuses is quoted back and never saved', async ({ page }) => {
    await boot(page);
    await page.getByTestId('assertions-add').click();
    await page.getByLabel('Topic filter').fill('sensors/#');
    await page.getByTestId('assertions-predicate').fill('$.tempC <> 80');
    await expect(page.getByTestId('assertions-save')).toBeEnabled();
    await page.getByTestId('assertions-save').click();
    await expect(page.getByTestId('assertions-error')).toContainText('needs a number on the right');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_assertion_rules') || '[]'))).toHaveLength(0);
  });

  test('a rule that parses is stored with the line as typed', async ({ page }) => {
    await boot(page);
    await page.getByTestId('assertions-add').click();
    await page.getByLabel('Topic filter').fill('sensors/#');
    await page.getByTestId('assertions-predicate').fill('$.tempC  <  80');
    await page.getByTestId('assertions-save').click();
    await expect(page.getByTestId('assertions-armed')).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_assertion_rules') || '[]'));
    expect(stored).toHaveLength(1);
    // The canonical form would be `Json("$.tempC") Lt 80`; the user's spacing is
    // what the list has to show, because that is what they will edit next.
    expect(stored[0].text).toBe('$.tempC  <  80');
    await expect(page.getByTestId(/^assertion-expr-/)).toContainText('$.tempC  <  80');
    expect(await syncCalls(page)).toBeGreaterThanOrEqual(2);
  });

  test('a judged row is marked in words, and unreadable is not a pass', async ({ page }) => {
    await boot(page, { rules: [rule()] });
    await feed(page, msg({ assertion: { outcome: 'violated', ruleId: 'as_1', label: 'gateway heat', expr: '$.tempC < 80', rules: 1 } }));
    const chip = page.getByTestId('assertion-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('$.tempC < 80');
    expect(await chip.getAttribute('title')).toContain('Violated');
    await feed(page, msg({ id: 'm2', assertion: { outcome: 'unevaluable', ruleId: 'as_1', label: '', expr: '$.tempC < 80', rules: 3 } }));
    // Newest row is on top, so the second feed is now the first chip and the
    // violated one has moved down.
    const second = page.getByTestId('assertion-chip').first();
    expect(await second.getAttribute('title')).toContain('Unreadable');
    expect(await second.getAttribute('title')).toContain('(3 rules');
    expect(await page.getByTestId('assertion-chip').nth(1).getAttribute('title')).toContain('Violated');
  });

  test('deleting a rule takes two deliberate clicks', async ({ page }) => {
    await boot(page, { rules: [rule()] });
    await page.getByTestId('assertion-delete-as_1').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_assertion_rules') || '[]'))).toHaveLength(1);
    await page.getByTestId('assertion-delete-as_1').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_assertion_rules') || '[]'))).toHaveLength(0);
  });

  test('reset clears the tallies and keeps the rules armed', async ({ page }) => {
    await boot(page, { rules: [rule()], snapshot: snap({ rules: 1 }) });
    await expect(page.getByTestId('assertions-stats')).toContainText('12');
    await page.getByTestId('assertions-reset').click();
    const reset = await page.evaluate(() => (window as any).calls.some((c: any) => c.cmd === 'assertions_reset'));
    expect(reset).toBe(true);
    await expect(page.getByTestId('assertions-stats')).toContainText(/Judged\s*0/);
    // The rules are still armed; only the account of what was judged is gone.
    await expect(page.getByTestId('assertions-armed')).toHaveText('1/1');
  });

  test('an empty panel says what to add, not that there is nothing', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('assertions-empty')).toContainText('No assertions yet');
    await expect(page.getByTestId('assertions-no-violations')).toBeVisible();
  });
});
