import { test, expect } from '@playwright/test';

/**
 * MQTT5 lets the client label a subscription and the broker echo that label on
 * every delivery it matched. That turns "which subscription did this arrive
 * through" from our guess into the broker's statement -- so the two claims have
 * to look different in the UI, and a locally matched row must never dress itself
 * up as broker-confirmed.
 */
const boot = async (page: any, subs: any[], ids: Record<string, number> = {}) => {
  await page.addInitScript((seed: any) => {
    const initialSubs = seed.subs;
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_subscriptions',
      JSON.stringify(initialSubs),
    );
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_subid',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: 5, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    w.subIds = seed.ids;
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
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_subid' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return { 'sensors/#': 3 };
        if (cmd === 'get_subscription_ids') return w.subIds ?? {};
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return w.assertions ?? { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset')
          return w.faults ?? [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset')
          return w.responder ?? [];
        if (cmd === 'get_broker_capabilities')
          return w.caps ?? { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state')
          return w.ackState ?? { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'bridge_outbox_state') return w.outbox ?? { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
        if (cmd === 'bridge_outbox_flush' || cmd === 'bridge_outbox_drop') return 0;
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        return null;
      },
    };
  }, { subs, ids });
  await page.goto('/');
};

const sub = (topic: string, options: any = {}) => ({
  topic,
  qos: options.qos ?? 1,
  color: '#10b981',
  options: { noLocal: false, retainAsPublished: false, retainHandling: 0, ...options },
});

const feed = async (page: any, message: any) => {
  await page.evaluate((m) => (window as any).__fire('mqtt-messages', { messages: [m], dropped: 0 }), message);
};

const msg = (over: any) => ({
  id: 'm1',
  topic: 'sensors/room1/temp',
  payload: 'hi',
  payloadLen: 2,
  payloadBase64: 'aGk=',
  truncated: false,
  qos: 1,
  retain: false,
  timestamp: '10:00:00.000',
  direction: 'in',
  ...over,
});

test.beforeEach(async ({ page }) => {
  // The match chip is a `lg` breakpoint element, and the default 1020 px viewport
  // sits one pixel below it.
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('a broker-tagged delivery names the subscription it says carried it', async ({ page }) => {
  await boot(page, [sub('sensors/#')]);
  await feed(page, msg({ matchedFilters: ['sensors/#'], subscriptionIds: [3] }));

  const chip = page.getByTestId('matched-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('sensors/#');
  await expect(chip).toHaveAttribute('title', /broker said it matched/);
});

test('a locally matched delivery does not claim the broker said so', async ({ page }) => {
  await boot(page, [sub('sensors/#')]);
  await feed(page, msg({ matchedFilters: ['sensors/#'] }));

  const chip = page.getByTestId('matched-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('title', /the broker sent no Subscription Identifier/);
  await expect(chip).not.toHaveAttribute('title', /broker said it matched/);
});

test('several matches show the first and count the rest', async ({ page }) => {
  await boot(page, [sub('sensors/#'), sub('sensors/+/temp')], {
    'sensors/#': 3,
    'sensors/+/temp': 4,
  });
  await feed(
    page,
    msg({ matchedFilters: ['sensors/#', 'sensors/room1/temp'], subscriptionIds: [3, 4] }),
  );
  const chip = page.getByTestId('matched-chip');
  await expect(chip).toHaveText('⌕ sensors/# +1');
  await expect(chip).toHaveAttribute('title', /sensors\/#, sensors\/room1\/temp/);
});

test('an outbound publish claims no subscription match', async ({ page }) => {
  await boot(page, [sub('sensors/#')], { 'sensors/#': 3 });
  await feed(page, msg({ direction: 'out', matchedFilters: [], subscriptionIds: [] }));
  await expect(page.getByTestId('matched-chip')).toHaveCount(0);
});

test('the subscription list says whose counts come from the broker', async ({ page }) => {
  await boot(page, [sub('sensors/#'), sub('bare/telemetry')], { 'sensors/#': 3 });
  const labelled = page.getByTestId('sub-flags-sensors/#');
  await expect(labelled).toHaveText('id #3');
  // A filter with no identifier has its hits counted here, and must not look
  // broker-confirmed.
  await expect(page.getByTestId('sub-flags-bare/telemetry')).toHaveCount(0);
});
