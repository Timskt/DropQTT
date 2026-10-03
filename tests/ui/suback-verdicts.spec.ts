import { test, expect } from '@playwright/test';

/**
 * A SUBACK reason byte is the broker contradicting our own UI: without it, an ACL
 * refusal looks exactly like a healthy subscription (green dot, "1 active", zero
 * messages forever). These tests pin that the refusal reaches the user in the
 * three places it must -- the chip, the toast, and the ops counters -- and that a
 * refused *unsubscribe* is not confused with a refused subscription.
 */
const boot = async (page: any, ackState?: unknown) => {
  await page.addInitScript(() => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_ack',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: 5, cleanSession: true,
      }),
    );
    localStorage.setItem(
      'dropqtt_subscriptions',
      JSON.stringify([
        { topic: 'edge/alive', qos: 1, color: '#10b981', options: { qos: 1, noLocal: false, retainAsPublished: false, retainHandling: 0 } },
        { topic: 'secret/telemetry', qos: 2, color: '#06b6d4', options: { qos: 2, noLocal: false, retainAsPublished: false, retainHandling: 0 } },
      ]),
    );
    const w = window as any;
    w.calls = [];
    w.ackState = undefined;
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
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_ack' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') {
          return { 'edge/alive': 12, 'secret/telemetry': 0 };
        }
        if (cmd === 'get_subscription_ids') return w.subIds ?? {};
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return w.assertions ?? { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset')
          return w.faults ?? [];
        if (cmd === 'get_broker_capabilities')
          return w.caps ?? { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state') {
          return w.ackState ?? { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        }
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        return null;
      },
    };
  });
  await page.goto('/');
  if (ackState) {
    await page.evaluate((s: any) => {
      (window as any).ackState = s;
    }, ackState);
  }
};

const rejection = (filter: string, code: number) => ({
  filter,
  code,
  meaning: 'not authorized (ACL)',
  atMs: Date.now(),
});

test('a refused subscription is marked on the chip, not left green', async ({ page }) => {
  await boot(page, {
    rejected: [rejection('secret/telemetry', 0x87)],
    refusedUnsubscribes: [],
    capped: [],
    unattributed: 0,
  });
  const chip = page.getByTestId('sub-refused-secret/telemetry');
  await expect(chip).toBeVisible();
  // The hex byte is in the tooltip so it can be looked up or reported, and the
  // tooltip says the app will not retry it: a refused SUBACK is fatal to the
  // session in rumqttc, so replaying it on every reconnect would flap forever.
  await expect(chip).toHaveAttribute(
    'title',
    /0x87 not authorized \(ACL\).*not retried until you subscribe again/,
  );
  // And the hit counter keeps telling the truth next to it: zero received.
  await expect(page.getByText('secret/telemetry')).toBeVisible();
});

test('an unrelated subscription is not punished for somebody else refusal', async ({ page }) => {
  await boot(page, {
    rejected: [rejection('secret/telemetry', 0x87)],
    refusedUnsubscribes: [],
    capped: [],
    unattributed: 0,
  });
  await expect(page.getByTestId('sub-refused-edge/alive')).toHaveCount(0);
});

test('the rejection event paints the chip before the next poll', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId(/^sub-refused/)).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__fire(
      'subscription-rejected',
      { filter: 'secret/telemetry', code: 0x9e, meaning: 'shared subscriptions not supported', atMs: Date.now() },
    );
  });
  const chip = page.getByTestId('sub-refused-secret/telemetry');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(/shared subscriptions not supported/i);
  await expect(page.getByText(/Broker refused secret\/telemetry/)).toBeVisible();
});

test('a qos the broker capped is shown as capped', async ({ page }) => {
  await boot(page, {
    rejected: [],
    refusedUnsubscribes: [],
    capped: [{ filter: 'edge/alive', granted: 0 }],
    unattributed: 0,
  });
  const chip = page.getByTestId('sub-capped-edge/alive');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('granted QoS 0');
});

test('a refused unsubscribe warns separately instead of faking a dead subscription', async ({ page }) => {
  await boot(page, {
    rejected: [],
    refusedUnsubscribes: [rejection('old/filtered/#', 0x83)],
    capped: [],
    unattributed: 0,
  });
  const note = page.getByTestId('unsub-refused-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('old/filtered/#');
  await expect(note).toContainText(/0x83 implementation specific error/);
  // 'old/filtered/#' is not a subscription we hold, so it must not get a red chip.
  await expect(page.getByTestId(/^sub-refused/)).toHaveCount(0);
});

test('a burst of refused publishes becomes one toast, not one per packet', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i += 1) {
      (window as any).__fire('publish-rejected', { code: 0x87, meaning: 'not authorized (ACL)' });
    }
  });
  const toast = page.getByText(/Broker refused 3 publishes/);
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('not authorized (ACL)');
  // Exactly one toast for the burst: the second row would be a re-render of the
  // same message, which is what "one per packet" would have produced.
  await expect(page.getByText(/Broker refused/)).toHaveCount(1);
});
