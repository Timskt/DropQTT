import { test, expect } from '@playwright/test';

/**
 * Guards added after the second audit pass: the traffic table used to draw a
 * hard-wired 80 rows with no way to reach the rest of a 200k-topic table, and
 * deleting a bridge rule was one stray click away from destroying hours of
 * configuration.
 */
const boot = async (page: any, mode: string, extra: Record<string, any> = {}) => {
  await page.addInitScript(([m, ex]) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', m);
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_guards',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: 5, cleanSession: true,
      }),
    );
    if (ex.rules) localStorage.setItem('dropqtt_bridge_rules', JSON.stringify(ex.rules));
    const w = window as any;
    w.calls = [];
    const handlers = new Map<number, { event: string; cb: (e: any) => void }>();
    const byId = new Map<number, (e: any) => void>();
    let nextId = 1;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (cb: any) => { const id = nextId++; byId.set(id, cb); return id; },
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args });
        if (cmd === 'plugin:event|listen') {
          const cb = byId.get(args.handler);
          if (cb) handlers.set(args.handler, { event: args.event, cb });
          return args.handler;
        }
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'get_connection_status') return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_guards' };
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'bridge_status' || cmd === 'list_transfers' || cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'get_topic_stats') return ex.rows ?? [];
        if (cmd === 'get_broker_sys') return [];
        if (cmd === 'get_diagnostics_snapshot') return null;
        return null;
      },
    };
  }, [mode, extra] as const);
  await page.goto('/');
};

const manyRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    topic: `lab/t/${String(i).padStart(3, '0')}`,
    count: n - i,
    bytes: (n - i) * 100,
    rate: n - i,
    peakRate: n - i,
    bytesRate: (n - i) * 10,
    lastSeen: Math.floor(Date.now() / 1000),
  }));

const rule = {
  id: 'r-1', name: 'Telemetry forward', sourceConn: 'a', sourceFilter: 'sensors/#', sourceQos: 1,
  targetConn: 'b', targetKind: 'mqtt', topicMode: 'same', enabled: true,
};

test('a long traffic table can be filtered instead of truncated at 80 rows', async ({ page }) => {
  await boot(page, 'mqttx', { rows: manyRows(95) });
  const filter = page.getByLabel('filter topics');
  await expect(filter).toBeVisible();
  // 95 tracked topics, 80 drawn: the tail is announced, not silently dropped
  await expect(page.getByText('15 more low-rate topics hidden')).toBeVisible();
  await expect(page.getByText('lab/t/001')).toBeVisible();

  await filter.fill('lab/t/09');
  await expect(page.getByText('lab/t/090')).toBeVisible();
  await expect(page.getByText('lab/t/094')).toBeVisible();
  await expect(page.getByText('lab/t/001')).toBeHidden();
  // only 5 rows match, so the cap no longer hides anything
  await expect(page.getByText('more low-rate topics hidden')).toBeHidden();
});

test('no filter box is added when everything already fits', async ({ page }) => {
  await boot(page, 'mqttx', { rows: manyRows(20) });
  await expect(page.getByLabel('filter topics')).toBeHidden();
  await expect(page.getByText('lab/t/001')).toBeVisible();
});

test('deleting a bridge rule takes two deliberate clicks', async ({ page }) => {
  await boot(page, 'bridge', { rules: [rule] });
  const del = page.getByLabel('Delete rule');
  await expect(del).toBeVisible();
  await del.click();
  // first click arms it and changes the affordance, but does not touch the set
  await expect(page.getByLabel('click again to confirm')).toBeVisible();
  const syncsAfterOne = (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'bridge_sync_rules').length;
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_bridge_rules') || '[]'));
  expect(stored).toHaveLength(1);

  await page.getByLabel('click again to confirm').click();
  await expect
    .poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_bridge_rules') || '[]'))).length)
    .toBe(0);
  const syncsAfterTwo = (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'bridge_sync_rules').length;
  expect(syncsAfterTwo).toBeGreaterThan(syncsAfterOne);
});

test('the arm state lapses so a stale second click cannot delete an unrelated rule', async ({ page }) => {
  await boot(page, 'bridge', { rules: [rule, { ...rule, id: 'r-2', name: 'Second rule' }] });
  await page.getByLabel('Delete rule').first().click();
  await expect(page.getByLabel('click again to confirm')).toHaveCount(1);
  // the other row still asks for its own confirmation
  await expect(page.getByLabel('Delete rule')).toHaveCount(1);
  await page.getByLabel('Delete rule').first().click();
  await expect(page.getByLabel('click again to confirm')).toHaveCount(1, { timeout: 6000 });
});
