import { test, expect } from '@playwright/test';

/**
 * A CONNACK is the broker telling us what it will refuse. If the UI still offers
 * QoS 2 or a retain flag after that, the user finds out by having a publish fail
 * (or, because rumqttc treats some refusals as fatal, by losing the session), so
 * these tests pin that the announcement actually reaches the controls.
 */
const CAPS = {
  topicAliasMax: 10,
  maxQos: 1,
  retainAvailable: false,
  wildcardAvailable: true,
  sharedAvailable: false,
  subscriptionIdsAvailable: false,
  receiveMax: 5,
  maxPacketSize: 4096,
  serverKeepAlive: 45,
  sessionExpiry: 120,
  assignedClientId: 'server-picked-id',
  responseInformation: 'probe/response',
  serverReference: null,
};

const boot = async (page: any, caps: unknown, draft?: Record<string, unknown>) => {
  await page.addInitScript(([c, d]) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    if (d) {
      localStorage.setItem(
        'dropqtt_console_draft',
        JSON.stringify({ topic: 'probe/topic', format: 'json', payloadByFormat: { json: '{}' }, ...d }),
      );
    }
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 18832, useTls: false, clientId: 'DropQTT_caps',
        keepAliveSecs: 60, defaultQos: 2, baseTopic: 'dropqtt', protocolVersion: 5, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    w.caps = c;
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
        w.calls.push({ cmd, args });
        if (cmd === 'plugin:event|listen') {
          const cb = byId.get(args.handler);
          if (cb) handlers.set(args.handler, { event: args.event, cb });
          return args.handler;
        }
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'get_connection_status') {
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 18832, clientId: 'DropQTT_caps' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_broker_capabilities') return w.caps;
        if (cmd === 'get_subscription_ack_state') {
          return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        }
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        return null;
      },
    };
  }, [caps, draft]);
  await page.goto('/');
};

test('a QoS the broker will not accept cannot even be chosen', async ({ page }) => {
  await boot(page, CAPS);
  const qos = page.getByLabel(/Quality of Service/).first();
  await expect(qos.locator('option[value="2"]')).toBeDisabled();
  await expect(qos.locator('option[value="1"]')).toBeEnabled();
  await expect(qos).toHaveAttribute('title', /broker accepts up to QoS 1/);
});

test('a saved draft above the ceiling warns instead of failing on publish', async ({ page }) => {
  // The realistic case: QoS 2 was chosen yesterday against a broker that has
  // since said "maximum-qos 1". The control cannot be clicked into an illegal
  // state, so the warning has to come from the loaded value.
  await boot(page, CAPS, { qos: 2, retain: true });
  await expect(page.getByTestId('cap-warning')).toContainText('broker accepts up to QoS 1');
  await expect(page.getByTestId('cap-warning')).toContainText('retain unavailable');
});

test('retain is unavailable when the broker said so', async ({ page }) => {
  await boot(page, CAPS);
  const retain = page.getByLabel(/Message Publisher Retain/).first();
  await expect(retain).toBeDisabled();
});

test('shared subscriptions are not offered to a broker that cannot route them', async ({ page }) => {
  await boot(page, CAPS);
  const toggle = page.getByLabel('Shared subscription');
  await expect(toggle).toBeDisabled();
  await expect(page.locator('label[for="dropqtt-sub-share"]')).toHaveAttribute(
    'title',
    /does not support shared subscriptions/,
  );
});

test('no announcement means nothing is restricted', async ({ page }) => {
  await boot(page, null);
  await expect(page.getByLabel(/Quality of Service/).first().locator('option[value="2"]')).toBeEnabled();
  await expect(page.getByLabel(/Message Publisher Retain/).first()).toBeEnabled();
  await expect(page.getByLabel('Shared subscription')).toBeEnabled();
  await expect(page.getByTestId('cap-warning')).toHaveCount(0);
});

test('the ops panel shows what the broker announced', async ({ page }) => {
  await boot(page, CAPS);
  await page.getByRole('button', { name: /Ops & Diagnostics/ }).click();
  const caps = page.getByTestId('broker-caps');
  await expect(caps).toBeVisible();
  await expect(caps).toContainText('packet size');
  await expect(caps).toContainText('not supported');
  await expect(caps).toContainText('4.0 KB');
  await expect(caps).toContainText('server-picked-id');
});
