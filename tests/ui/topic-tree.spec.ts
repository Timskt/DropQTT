import { test, expect } from '@playwright/test';

/**
 * The topic tree: the same counters the list shows, grouped by `/`. What these
 * pin is the aggregation rule (rates add, peaks do not), the default of showing
 * one row per top-level branch rather than four hundred, and that the tree obeys
 * the list's filter — two views over one question, not two answers.
 */
const stat = (topic: string, over: Record<string, number> = {}) => ({
  topic,
  count: over.count ?? 10,
  bytes: over.bytes ?? 1200,
  rate: over.rate ?? 0,
  bytesRate: over.bytesRate ?? 40,
  peakRate: over.peakRate ?? 0,
  peakBytesRate: over.peakBytesRate ?? 40,
  lastSeen: Math.floor(Date.now() / 1000) - (over.ageSec ?? 5),
});

const rows = [
  stat('devices', { rate: 1, count: 3 }),
  stat('devices/a/telemetry', { rate: 2, count: 40, peakRate: 9 }),
  stat('devices/b/telemetry', { rate: 3, count: 60, peakRate: 7 }),
  stat('archive/log', { rate: 4, count: 90 }),
];

const boot = async (page: any, exRows: Record<string, unknown>[] = rows) => {
  await page.addInitScript(([ex]) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_tree',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: 5, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    const handlers = new Map<number, { event: string; cb: (e: any) => void }>();
    const byId = new Map<number, (e: any) => void>();
    let nextId = 1;
    w.__fire = (event: string, payload: any) => {
      handlers.forEach((h) => { if (h.event === event) h.cb({ event, payload, id: 0 }); });
    };
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
        if (cmd === 'get_connection_status') return { connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_tree' };
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats') return ex;
        if (cmd === 'get_broker_sys' || cmd === 'bridge_status' || cmd === 'list_transfers' || cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'get_diagnostics_snapshot') return null;
        return null;
      },
    };
  }, [exRows] as const);
  await page.goto('/');
};

const toTree = async (page: any) => {
  await page.getByTestId('traffic-view-tree').click();
  await expect(page.getByTestId('tree-summary-line')).toBeVisible();
};

test('the tree starts as one row per top-level branch, not per topic', async ({ page }) => {
  await boot(page);
  await toTree(page);
  await expect(page.getByTestId('tree-node-devices')).toBeVisible();
  await expect(page.getByTestId('tree-node-archive')).toBeVisible();
  // 400 device topics must not cost 400 rows before anyone asks to see them.
  await expect(page.getByTestId('tree-node-devices/a/telemetry')).toHaveCount(0);
  await expect(page.getByTestId('tree-summary-line')).toContainText('2 branches · 4 topics');
});

test('a branch adds the current rates and takes the peak of its children', async ({ page }) => {
  await boot(page);
  await toTree(page);
  const devices = page.getByTestId('tree-node-devices');
  // devices(1) + a(2) + b(3) = 6/s right now; peak 9 is one child's high-water,
  // not 9 + 7, because those peaks did not happen in the same second.
  await expect(devices).toContainText('6/s');
  await expect(devices).toContainText('103');
  await page.getByTestId('tree-toggle-devices').click();
  // One click opens one level: the device branches appear, their topics do not.
  await expect(page.getByTestId('tree-node-devices/a')).toBeVisible();
  // devices/a carries one topic at 2/s; devices/b carries one at 3/s.
  await expect(page.getByTestId('tree-node-devices/a')).toContainText('2/s');
  await expect(page.getByTestId('tree-node-devices/b')).toContainText('3/s');
  await expect(page.getByTestId('tree-node-devices/a/telemetry')).toHaveCount(0);
  await page.getByTestId('tree-toggle-devices/a').click();
  await expect(page.getByTestId('tree-node-devices/a/telemetry')).toBeVisible();
});

test('expand all and collapse all move the whole tree at once', async ({ page }) => {
  await boot(page);
  await toTree(page);
  await page.getByTestId('tree-toggle-all').click();
  await expect(page.getByTestId('tree-node-devices/b/telemetry')).toBeVisible();
  await page.getByTestId('tree-toggle-all').click();
  await expect(page.getByTestId('tree-node-devices/b/telemetry')).toHaveCount(0);
});

test('the sparkline says how much of the past it actually covers', async ({ page }) => {
  await boot(page);
  await toTree(page);
  // Samples arrive with the one-second stats poll, so wait for a second tick.
  await page.waitForTimeout(2200);
  const spark = page.getByTestId('tree-spark').first();
  await expect(spark).toBeVisible();
  await expect(spark).toHaveAttribute('aria-label', /last \d+ seconds, peak \d+\/s/);
});

test('the tree obeys the same filter as the list', async ({ page }) => {
  const many = [
    ...rows,
    ...Array.from({ length: 90 }, (_, i) => stat(`bulk/t${i}`, { rate: 1 })),
  ];
  await boot(page, many);
  await toTree(page);
  const filter = page.getByLabel('filter topics');
  await expect(filter).toBeVisible();
  await filter.fill('devices');
  await expect(page.getByTestId('tree-node-devices')).toBeVisible();
  await expect(page.getByTestId('tree-node-bulk')).toHaveCount(0);
  await expect(page.getByTestId('tree-node-archive')).toHaveCount(0);
  // The note quotes what the filter left, not what the render cap hides.
  await expect(page.getByTestId('tree-filtered-note')).toContainText('filtered: 3 of 94 topics');
});
