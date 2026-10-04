import { test, expect } from '@playwright/test';

/**
 * Empty states are the only screen allowed to teach the next step, so these pin
 * that each one offers a control rather than a sentence — and that a filtered-empty
 * feed is not confused with a quiet one (the actions they offer are different).
 */
const boot = async (page: any, opts: { connected?: boolean; messages?: number } = {}) => {
  const { connected = true, messages = 0 } = opts;
  await page.addInitScript(
    ([exConnected, exMessages]) => {
      localStorage.setItem('dropqtt_lang', 'en');
      localStorage.setItem('dropqtt_theme', 'solaris');
      localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
      localStorage.setItem(
        'dropqtt_active_broker',
        JSON.stringify({
          host: '127.0.0.1', port: 18831, useTls: false, clientId: 'DropQTT_empty',
          keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: 5, cleanSession: true,
        }),
      );
      const w = window as any;
      w.published = [];
      const handlers = new Map<number, { event: string; cb: (e: any) => void }>();
      const byId = new Map<number, (e: any) => void>();
      let nextId = 1;
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: (cb: any) => {
          const id = nextId++;
          byId.set(id, cb);
          return id;
        },
        invoke: async (cmd: string, args: any = {}) => {
          if (cmd === 'plugin:event|listen') {
            const cb = byId.get(args.handler);
            if (cb) handlers.set(args.handler, { event: args.event, cb });
            return args.handler;
          }
          if (cmd === 'plugin:event|unlisten') return null;
          if (cmd === 'publish_console') {
            w.published.push(args.params);
            return null;
          }
          if (cmd === 'get_connection_status')
            return {
              connected: exConnected, brokerHost: '127.0.0.1', brokerPort: 18831, clientId: 'DropQTT_empty',
            };
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
          return null;
        },
      };
      // A quiet feed and a filtered-empty feed must be told apart, so the test can
      // push rows through the same event the app listens to.
      w.__seed = (n: number) => {
        const payload = {
          dropped: 0,
          messages: Array.from({ length: n }, (_, i) => ({
            id: `m${i}`, topic: 'devices/a/telemetry', payload: `{"seq":${i}}`, payloadLen: 9,
            payloadBase64: btoa(`{"seq":${i}}`), truncated: false, contentType: null,
            userProperties: [], qos: 1, retain: false, direction: 'in',
            timestamp: new Date(1_700_000_000_000 + i).toISOString(),
            timestamp_ms: 1_700_000_000_000 + i,
          })),
        };
        handlers.forEach((h) => {
          if (h.event === 'mqtt-messages') h.cb({ event: h.event, payload, id: 0 });
        });
      };
      void exMessages;
    },
    [connected, messages] as const,
  );
  await page.goto('/');
};

const filterInput = (page: any) => page.getByLabel('Search topic or payload content');

test('a quiet feed offers the two things that would fill it', async ({ page }) => {
  await boot(page);
  await expect(page.getByText('No MQTT messages recorded')).toBeVisible();
  await expect(page.getByTestId('empty-subscribe')).toBeVisible();
  await expect(page.getByTestId('empty-bench')).toBeEnabled();
  // Clearing filters is not an option when nothing is filtered — that would be noise.
  await expect(page.getByTestId('empty-clear-filter')).toHaveCount(0);
});

test('the subscribe action lands on the real subscription box, not a copy of it', async ({ page }) => {
  await boot(page);
  await page.getByTestId('empty-subscribe').click();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')))
    .toBe('sub-topic-input');
});

test('a load scenario can be started from the empty panel', async ({ page }) => {
  await boot(page);
  await page.getByTestId('empty-bench').click();
  // The bench lab is collapsed by default; the action opens the real one.
  await expect(page.getByTestId('bench-expect-rate')).toBeVisible();
});

test('with no connection the load action explains itself instead of doing nothing', async ({ page }) => {
  await boot(page, { connected: false });
  const button = page.getByTestId('empty-bench');
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', /Connect to a broker/);
});

test('a filtered-empty feed offers to drop the filter, and dropping it works', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__seed(3));
  await expect(page.locator('.msg-row')).toHaveCount(3);
  await filterInput(page).fill('nothing-matches-this');
  await expect(page.getByTestId('empty-clear-filter')).toBeVisible();
  await page.getByTestId('empty-clear-filter').click();
  await expect(page.locator('.msg-row')).toHaveCount(3);
});
