import { test, expect } from '@playwright/test';

/**
 * The v5 fields added for protocol completeness (Payload Format Indicator,
 * Topic Alias, Session-Expiry-Interval, Will Delay / Will Content-Type) are all
 * "absent means something different from zero" properties, so the two things
 * worth pinning from the UI are: the value reaches the backend unchanged, and an
 * untouched field is not sent at all. Wire encoding itself is covered by
 * transport.rs unit tests and by the live mosquitto check in the iteration doc.
 */
const boot = async (page: any, protocolVersion: number) => {
  await page.addInitScript((pv: number) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_test',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: pv, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
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
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_test' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_broker_capabilities')
          return w.caps ?? { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state')
          return w.ackState ?? { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress') return [];
        if (cmd === 'rpc_list') return [];
        return null;
      },
    };
  }, protocolVersion);
  await page.goto('/');
};

const lastCall = async (page: any, cmd: string) =>
  (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === cmd).at(-1);

const openV5Props = async (page: any) => {
  await page.getByRole('button', { name: 'v5 props' }).click();
};

const msg = (over: any) => ({
  id: 'm1', topic: 'lab/v5', payload: 'hi', payloadLen: 2,
  payloadBase64: 'aGk=', truncated: false, qos: 1, retain: false,
  timestamp: '10:00:00.000', direction: 'in', ...over,
});

test('PFI and topic alias reach the backend exactly as chosen', async ({ page }) => {
  await boot(page, 5);
  await openV5Props(page);

  await page.getByPlaceholder('Topic alias').fill('7');
  await page.locator('select[title*="Payload Format Indicator"]').selectOption('1');
  await page.getByPlaceholder('test/topic').fill('lab/v5');
  await page.getByRole('button', { name: 'Publish Message' }).click();

  await expect
    .poll(async () => (await lastCall(page, 'publish_console'))?.args?.params?.properties)
    .toMatchObject({ payloadFormat: 1, topicAlias: 7 });
});

test('untouched optional properties stay absent, not zero', async ({ page }) => {
  await boot(page, 5);
  await openV5Props(page);
  await page.getByPlaceholder('test/topic').fill('lab/v5');
  await page.getByRole('button', { name: 'Publish Message' }).click();

  const props = (await lastCall(page, 'publish_console'))?.args?.params?.properties;
  expect(props.payloadFormat ?? null).toBeNull();
  expect(props.topicAlias ?? null).toBeNull();
});

test('a v3.1.1 link hides properties it cannot put on the wire', async ({ page }) => {
  await boot(page, 4);
  await expect(page.getByRole('button', { name: 'v5 props' })).toHaveCount(0);
});

test('the stream shows the payload format the publisher declared', async ({ page }) => {
  // The suite runs at 1020 px to cover a narrow window; this chip is `lg:inline`,
  // so it only exists at >=1024 px.
  await page.setViewportSize({ width: 1400, height: 900 });
  await boot(page, 5);
  await page.evaluate((m) =>
    (window as any).__fire('mqtt-messages', { messages: [m], dropped: 0 }),
    msg({ payloadFormat: 1 }),
  );
  await expect(page.getByTitle(/Payload Format Indicator/)).toBeVisible();

  await page.evaluate((m) =>
    (window as any).__fire('mqtt-messages', { messages: [m], dropped: 0 }),
    msg({ id: 'm2', topic: 'lab/v5b', payloadFormat: 0 }),
  );
  // Newest first, so address the value rather than the row position.
  await expect(page.getByText('BYTES', { exact: true })).toBeVisible();
});

test('session expiry and will properties only exist on a v5 profile', async ({ page }) => {
  await boot(page, 5);
  await page.getByRole('button', { name: 'MQTT Broker Settings' }).click();
  await page.getByLabel('MQTT Protocol Version').selectOption('5');

  await page.getByLabel('Session expiry (s)').fill('120');
  await page.getByLabel('Will delay (s)').fill('30');
  await page.getByLabel('Will content type').fill('application/json');
  await page.getByRole('button', { name: 'Save & Connect' }).click();

  await expect
    .poll(async () => (await lastCall(page, 'connect_broker'))?.args?.config)
    .toMatchObject({
      sessionExpirySecs: 120,
      willDelaySecs: 30,
      willContentType: 'application/json',
      protocolVersion: 5,
    });
});
