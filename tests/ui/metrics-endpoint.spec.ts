import { test, expect } from '@playwright/test';

/**
 * The Prometheus endpoint switch (review §3.4).
 *
 * What these pin is the part a Rust unit test cannot reach: that the panel shows the
 * backend's port and the backend's failure sentence, and that a listener never looks
 * "on" while nothing was bound. The exposition text itself is covered in
 * `src-tauri/src/metrics.rs`; the scrape against a live broker is proven by hand.
 */
const boot = async (
  page: any,
  opts: { metrics?: 'mocked' | 'absent' | 'busy' } = {},
) => {
  const mode = opts.metrics ?? 'mocked';
  await page.addInitScript(
    ([exMode]) => {
      localStorage.setItem('dropqtt_lang', 'en');
      localStorage.setItem('dropqtt_theme', 'solaris');
      localStorage.setItem('dropqtt_workspace_mode', 'ops');
      const w = window as any;
      w.hub = { enabled: false, port: 9464, minPort: 1024, calls: [], failWith: null };
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: (cb: any) => {
          const id = Math.random();
          w.__cbs = w.__cbs || new Map();
          w.__cbs.set(id, cb);
          return id;
        },
        invoke: async (cmd: string, args: any = {}) => {
          if (cmd === 'plugin:event|listen') return 1;
          if (cmd === 'plugin:event|unlisten') return null;
          if (cmd === 'get_connection_status')
            return { connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_metrics' };
          if (cmd === 'get_default_download_dir') return 'D:/Downloads';
          if (cmd === 'get_topic_stats_cap') return 5000;
          if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'list_transfers') return [];
          if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
          if (cmd === 'bridge_status' || cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
          if (cmd === 'bridge_outbox_state')
            return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
          if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
            return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
          if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
          if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
          if (cmd === 'get_broker_capabilities')
            return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
          if (cmd === 'get_subscription_ack_state')
            return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
          if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
          if (cmd === 'get_metrics_status') {
            // 'absent' is what every other spec gets by accident: an unmocked command
            // resolves with nothing. The card has to read as off, not as broken.
            if (exMode === 'absent') return undefined;
            return { enabled: w.hub.enabled, port: w.hub.port, minPort: w.hub.minPort };
          }
          if (cmd === 'set_metrics_endpoint') {
            w.hub.calls.push({ enabled: args.enabled, port: args.port });
            if (args.enabled && w.hub.failWith) return Promise.reject(w.hub.failWith);
            w.hub.enabled = args.enabled;
            if (args.enabled) w.hub.port = args.port;
            return { enabled: w.hub.enabled, port: w.hub.port, minPort: w.hub.minPort };
          }
          if (cmd === 'get_diagnostics_snapshot') {
            return {
              runtime: { appVersion: '0.9.0', os: 'windows', arch: 'x64', generatedAt: Date.now() },
              mqtt: {
                configured: true, connected: false, host: '127.0.0.1', port: 1883, clientId: 'DropQTT_metrics',
                useTls: false, useWebsocket: false, protocolVersion: 5, subscriptions: 0, incomingActive: 0,
                outgoingActive: 0, feedBuffered: 0, feedBufferCapacity: 500, feedDropped: 0, feedLost: 0,
                confirmTimeouts: 0, rpcPending: 0, rpcTimeouts: 0, subscriptionsRejected: 0,
                unsubscribesRejected: 0, acksUnattributed: 0, publishRejected: 0, topicStatsCount: 0,
                scheduledRuns: 0, benchRuns: 0, historyAvailable: true,
                history: { rows: 0, inbound: 0, outbound: 0, bytes: 0, oldestMs: null, newestMs: null, retentionDays: 0, prunedRows: 0 },
                downloadDir: 'D:/Downloads', downloadDirWritable: true, downloadDirError: null,
                feedFlush: { window: 0, totalCalls: 0, avgMs: 0, maxMs: 0 },
                feedLag: { window: 0, totalCalls: 0, avgMs: 0, maxMs: 0 },
                historyWrite: { window: 0, totalCalls: 0, avgMs: 0, maxMs: 0 },
                faultRules: 0, faultActions: 0, responderRules: 0,
                // The lifetime counters the endpoint exports as `_total`.
                receivedTotal: 4242, sentTotal: 111,
              },
              bridge: { totalConnections: 0, connectedConnections: 0, configuredRules: 0, enabledRules: 0, forwarded: 0, errors: 0, dropped: 0 },
              checks: [],
            };
          }
          return null;
        },
      };
    },
    [mode] as const,
  );
  await page.goto('/');
};

const state = (page: any) => page.getByTestId('metrics-state');

test('the endpoint starts stopped and names the backend default port', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('metrics-card')).toBeVisible();
  await expect(state(page)).toHaveText('not listening');
  await expect(page.getByTestId('metrics-url')).toHaveCount(0);
  await expect(page.getByTestId('metrics-port')).toHaveValue('9464');
});

test('an unmocked status reads as off instead of broken', async ({ page }) => {
  // This is the state all the other specs boot in. If it painted an error, the whole
  // suite would be lying about the ops panel.
  await boot(page, { metrics: 'absent' });
  await expect(page.getByTestId('metrics-card')).toBeVisible();
  await expect(state(page)).toHaveText('not listening');
  await expect(page.getByTestId('metrics-error')).toHaveCount(0);
});

test('starting it asks the backend for the typed port and then quotes the URL', async ({ page }) => {
  await boot(page);
  await page.getByTestId('metrics-port').fill('19090');
  await page.getByTestId('metrics-toggle').click();
  await expect(state(page)).toHaveText('listening');
  await expect(page.getByTestId('metrics-url')).toHaveText('http://127.0.0.1:19090/metrics');
  const calls = await page.evaluate(() => (window as any).hub.calls);
  expect(calls).toEqual([{ enabled: true, port: 19090 }]);
});

test('a failed bind keeps the switch off and shows the backend sentence', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    (window as any).hub.failWith = 'could not listen on 127.0.0.1:9464: 拒绝访问。 (os error 10048)';
  });
  await page.getByTestId('metrics-toggle').click();
  await expect(page.getByTestId('metrics-error')).toContainText('os error 10048');
  // Nothing was bound, so the chip must not read listening even for a frame.
  await expect(state(page)).toHaveText('not listening');
});

test('a typed port needs an explicit apply before the listener moves', async ({ page }) => {
  await boot(page);
  await page.getByTestId('metrics-toggle').click();
  await expect(state(page)).toHaveText('listening');
  await page.getByTestId('metrics-port').fill('19091');
  await expect(page.getByTestId('metrics-apply')).toBeVisible();
  // While the draft differs the toggle is disabled, so the only way to move the
  // listener is Apply — a scrape cannot lose its target mid-poll.
  await expect(page.getByTestId('metrics-toggle')).toBeDisabled();
  await expect(page.getByTestId('metrics-toggle')).toHaveAttribute('title', /Apply the changed port first/);
  await page.getByTestId('metrics-apply').click();
  await expect(page.getByTestId('metrics-url')).toHaveText('http://127.0.0.1:19091/metrics');
  await expect(page.getByTestId('metrics-apply')).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).hub.calls);
  expect(calls.map((c: any) => c.port)).toEqual([9464, 19091]);
});

test('the port box enforces the floor the backend reported', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('metrics-port')).toHaveAttribute('min', '1024');
});

test('the copied scrape config carries the live port', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await page.getByTestId('metrics-port').fill('19092');
  await page.getByTestId('metrics-toggle').click();
  await expect(state(page)).toHaveText('listening');
  await page.getByTestId('metrics-copy-config').click();
  await expect
    .poll(async () => await page.evaluate(() => navigator.clipboard.readText()))
    .toContain("targets: ['127.0.0.1:19092']");
});

test('the legend lists only series that mean something alone', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await page.getByTestId('metrics-copy-legend').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('dropqtt_feed_lost_total');
  expect(text).toContain('dropqtt_check_status{id}');
});

test('the lifetime counters are on screen next to the resettable ones', async ({ page }) => {
  // The reason `_total` series exist: every other message count in this panel is
  // resettable, so none of them can answer "did traffic stop" on its own.
  await boot(page);
  await expect(page.getByText('Messages received')).toBeVisible();
  await expect(page.getByText('4,242')).toBeVisible();
  await expect(page.getByText('Messages sent')).toBeVisible();
  await expect(page.getByText('111')).toBeVisible();
});
