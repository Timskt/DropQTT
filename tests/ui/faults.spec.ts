import { test, expect } from '@playwright/test';

/**
 * Fault injection is the generator behind every "failures must be visible" claim in
 * this app, so the parts the UI is responsible for are the parts that keep it honest:
 * the counts come from the side that performed the action, an armed set announces
 * itself, and a rule that would inject nothing is refused before it can be mistaken
 * for protection.
 */
const boot = async (page: any, opts: { rules?: any[]; stats?: any[] } = {}) => {
  await page.addInitScript((seed: any) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem('dropqtt_fault_rules', JSON.stringify(seed.rules ?? []));
    localStorage.setItem('dropqtt_assertion_rules', '[]');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_faults',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: 5, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    w.faults = seed.stats ?? null;
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
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_faults' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
        if (cmd === 'get_broker_capabilities')
          return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset')
          return w.responder ?? [];
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'faults_sync_rules') {
          // Mirror the Rust validator: a rule with nothing set is refused whole, so
          // the UI cannot present an armed-looking list that injects nothing.
          for (const r of args.rules ?? []) {
            const any = r.dropPct > 0 || r.delayMs > 0 || r.duplicatePct > 0 || r.corruptPct > 0 || r.badCorrelationPct > 0;
            if (!any) throw new Error(`${r.name || r.filter}: nothing to inject`);
            if (r.badCorrelationPct > 0 && r.direction === 'outbound')
              throw new Error(`${r.name || r.filter}: correlation damage applies to inbound traffic only`);
          }
          w.faults = (args.rules ?? []).map((r: any) => w.faults?.find((f: any) => f.id === r.id)
            ?? { id: r.id, name: r.name, filter: r.filter, enabled: r.enabled, counts: { seen: 0, dropped: 0, delayed: 0, duplicated: 0, corrupted: 0, misCorrelated: 0 } });
          return w.faults;
        }
        if (cmd === 'faults_stats') return w.faults ?? [];
        if (cmd === 'faults_reset') {
          w.faults = (w.faults ?? []).map((f: any) => ({ ...f, counts: { seen: 0, dropped: 0, delayed: 0, duplicated: 0, corrupted: 0, misCorrelated: 0 } }));
          return w.faults;
        }
        return null;
      },
    };
  }, { rules: opts.rules, stats: opts.stats });
  await page.goto('/');
};

const rule = (over: any = {}) => ({
  id: 'fl_1',
  name: 'flaky gateway',
  filter: 'sensors/#',
  direction: 'inbound',
  enabled: true,
  dropPct: 25,
  delayMs: 0,
  duplicatePct: 0,
  corruptPct: 0,
  badCorrelationPct: 0,
  ...over,
});

const stats = (over: any = {}) => ({
  id: 'fl_1',
  name: 'flaky gateway',
  filter: 'sensors/#',
  enabled: true,
  counts: { seen: 8, dropped: 2, delayed: 0, duplicated: 0, corrupted: 0, misCorrelated: 0 },
  ...over,
});

const lastSync = (page: any) => page.evaluate(() => {
  const calls = (window as any).calls.filter((c: any) => c.cmd === 'faults_sync_rules');
  return calls.length ? calls[calls.length - 1].args.rules : null;
});

test.describe('fault injection', () => {
  test('an armed set says out loud that the losses may be ours', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await expect(page.getByTestId('faults-warning')).toContainText('may be ours');
    await expect(page.getByTestId('faults-armed')).toHaveText('1/1');
  });

  test('a disabled rule is counted as unarmed and shows no warning', async ({ page }) => {
    await boot(page, { rules: [rule({ enabled: false })], stats: [stats({ enabled: false })] });
    await expect(page.getByTestId('faults-armed')).toHaveText('0/1');
    await expect(page.getByTestId('faults-warning')).toHaveCount(0);
  });

  test('the counts come from the side that performed the action', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await expect(page.getByTestId('fault-counts-fl_1')).toContainText('seen 8 · dropped 2');
  });

  test('a new rule is valid on arrival so adding one cannot disarm the set', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await page.getByTestId('faults-add').click();
    const rulesAfter = await lastSync(page);
    expect(rulesAfter).toHaveLength(2);
    expect(rulesAfter[1].dropPct).toBe(25);
    // The previously armed rule is still in the pushed set, not replaced by junk.
    expect(rulesAfter[0].id).toBe('fl_1');
  });

  test('zeroing every knob is refused where it is typed, not on sync', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await page.getByTestId('fault-drop-fl_1').fill('0');
    await expect(page.getByTestId('faults-error')).toContainText('Set at least one rate or delay');
    const pushed = await lastSync(page);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].dropPct).toBe(25);
  });

  test('editing the filter pushes the whole set, as everywhere else in this app', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await page.getByTestId('fault-filter-fl_1').fill('devices/+/telemetry');
    const pushed = await lastSync(page);
    expect(pushed[0].filter).toBe('devices/+/telemetry');
  });

  test('correlation damage on an outbound-only rule is refused by the backend', async ({ page }) => {
    await boot(page, { rules: [rule({ direction: 'outbound', badCorrelationPct: 50 })] });
    // The mock mirrors the Rust rule, so this is the real rejection path surfacing.
    await expect(page.getByTestId('faults-error')).toContainText('correlation damage applies to inbound traffic only');
  });

  test('reset zeroes the tallies without disarming the rule', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await expect(page.getByTestId('fault-counts-fl_1')).toContainText('seen 8');
    await page.getByTestId('faults-reset').click();
    await expect(page.getByTestId('fault-counts-fl_1')).toContainText('seen 0 · dropped 0');
    await expect(page.getByTestId('faults-armed')).toHaveText('1/1');
  });

  test('deleting a rule takes two deliberate clicks', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await page.getByTestId('fault-delete-fl_1').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_fault_rules') || '[]'))).toHaveLength(1);
    await page.getByTestId('fault-delete-fl_1').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_fault_rules') || '[]'))).toHaveLength(0);
  });

  test('an empty panel says what is missing in terms of what it is for', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('faults-empty')).toContainText('No faults armed');
  });
});
