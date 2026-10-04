import { test, expect } from '@playwright/test';

/**
 * The device view (§8.1.3): one card per topic prefix, fed only by counters that
 * already exist. These pin the two claims the view must not overstate — that a
 * prefix is a device (it is not; the card says what it is), and that a violation
 * from five minutes ago still counts as one now.
 */
const stat = (topic: string, over: Record<string, unknown> = {}) => ({
  topic,
  count: 10,
  bytes: 100,
  rate: 2,
  bytesRate: 20,
  peakRate: 5,
  peakBytesRate: 50,
  lastSeen: 1_700_000_000,
  ...over,
});

const boot = async (page: any, opts: { rows?: unknown[]; violations?: unknown[] } = {}) => {
  const { rows = [], violations = [] } = opts;
  await page.addInitScript(
    ([exRows, exViolations]) => {
      localStorage.setItem('dropqtt_lang', 'en');
      localStorage.setItem('dropqtt_theme', 'solaris');
      localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
      localStorage.setItem(
        'dropqtt_active_broker',
        JSON.stringify({
          host: '127.0.0.1', port: 18831, useTls: false, clientId: 'DropQTT_dev',
          keepAliveSecs: 30, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: 5, cleanSession: true,
        }),
      );
      const w = window as any;
      w.rows = exRows;
      w.violations = exViolations;
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: (cb: any) => {
          const id = Math.random();
          (w as any).__cbs = (w as any).__cbs || new Map();
          (w as any).__cbs.set(id, cb);
          return id;
        },
        invoke: async (cmd: string) => {
          if (cmd === 'plugin:event|listen') return 1;
          if (cmd === 'plugin:event|unlisten') return null;
          if (cmd === 'get_connection_status')
            return { connected: true, brokerHost: '127.0.0.1', brokerPort: 18831, clientId: 'DropQTT_dev' };
          if (cmd === 'get_default_download_dir') return 'D:/Downloads';
          if (cmd === 'get_topic_stats_cap') return 5000;
          if (cmd === 'get_topic_stats') return w.rows;
          if (cmd === 'get_broker_sys' || cmd === 'list_transfers') return [];
          if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
          if (cmd === 'bridge_status' || cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
          if (cmd === 'bridge_outbox_state')
            return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
          if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
            return { stats: { matched: 4, passed: 3, violated: 1, unevaluable: 0 }, rules: 1, recent: w.violations };
          if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
          if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
          if (cmd === 'get_broker_capabilities')
            return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
          if (cmd === 'get_subscription_ack_state')
            return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
          if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
          return null;
        },
      };
    },
    [rows, violations] as const,
  );
  await page.goto('/');
};

test('no traffic means no invented devices', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('device-panel')).toBeVisible();
  await expect(page.getByTestId('device-empty')).toBeVisible();
  await expect(page.getByTestId('device-caveat')).toContainText('no device registry');
});

test('one card per prefix, with the subtree aggregated', async ({ page }) => {
  await boot(page, {
    rows: [
      stat('devices/gw-7/telemetry', { count: 10, rate: 2 }),
      stat('devices/gw-7/status', { count: 5, rate: 1 }),
      stat('devices/gw-8/telemetry', { count: 20, rate: 4 }),
    ],
  });
  await expect(page.getByTestId('device-devices/gw-8')).toBeVisible();
  await expect(page.getByTestId('device-devices/gw-7')).toContainText('15 msgs');
  await expect(page.getByTestId('device-devices/gw-7')).toContainText('3.0/s · peak 5/s');
  // Busiest first: gw-8 leads on rate.
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="device-devices/"]')).map((e) => e.getAttribute('data-testid')),
  );
  expect(order[0]).toBe('device-devices/gw-8');
});

test('the depth control regroups without losing a shallow topic', async ({ page }) => {
  await boot(page, { rows: [stat('devices/gw-7/telemetry'), stat('alerts', { rate: 1 })] });
  await expect(page.getByTestId('device-devices/gw-7')).toBeVisible();
  await expect(page.getByTestId('device-alerts')).toBeVisible();
  await page.getByTestId('device-depth').selectOption('1');
  await expect(page.getByTestId('device-devices')).toBeVisible();
  await expect(page.getByTestId('device-alerts')).toBeVisible();
});

test('a fresh violation marks the card; an old one does not', async ({ page }) => {
  const now = Date.now();
  await boot(page, {
    rows: [stat('devices/gw-7/telemetry', { lastSeen: Math.floor(now / 1000) })],
    violations: [
      { msgId: 'v1', topic: 'devices/gw-7/telemetry', ruleId: 'r1', expr: '$.tempC < 80', outcome: 'violated', tsMs: now - 1000 },
      { msgId: 'v2', topic: 'devices/gw-7/telemetry', ruleId: 'r1', expr: '$.tempC < 80', outcome: 'violated', tsMs: now - 3_600_000 },
    ],
  });
  await expect(page.getByTestId('device-state-devices/gw-7')).toContainText('1 violation(s)');
});
