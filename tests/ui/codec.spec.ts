import { test, expect } from '@playwright/test';

/**
 * Console payload rendering: the user codec and SenML (RFC 8428). The QuickJS
 * sandbox itself is covered by Rust tests in transform.rs, and the SenML parser
 * by tests/unit/senml.test.ts; what matters here is the wiring — that the codec
 * substitutes *displayed* text, flags failures without hiding the payload, never
 * mutates what history/export/replay would send, and that a device pack is
 * auto-detected and rendered as a reading table.
 */
const boot = async (page: any) => {
  await page.addInitScript(() => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');

    const w = window as any;
    w.calls = [];
    const handlers = new Map<number, { event: string; cb: (e: any) => void }>();
    const byId = new Map<number, (e: any) => void>();
    let nextId = 1;

    /** Deliver to exactly the listeners registered for `event`. */
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
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'T' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ids') return w.subIds ?? {};
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return w.assertions ?? { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'get_broker_capabilities')
          return w.caps ?? { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state')
          return w.ackState ?? { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'schedule_list') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'bridge_test_transform') {
          // Mirrors transform.rs: string passes through, null drops, throw rejects.
          try {
            const fn = new Function(`${args.script}; return transform;`)();
            const out = fn(args.topic, atob(args.payloadBase64), 1, false);
            if (out === null || out === undefined) return { action: 'drop' };
            const text = typeof out === 'string' ? out : JSON.stringify(out);
            return { action: 'send', payload: text, bytes: text.length };
          } catch (e) {
            throw String(e);
          }
        }
        return null;
      },
    };
  });
  await page.goto('/');
  await page.waitForTimeout(700);
};

const row = (topic: string, text: string, id: string) => ({
  id, topic, payload: text, payloadLen: text.length,
  payloadBase64: Buffer.from(text, 'utf8').toString('base64'),
  truncated: false, qos: 1, retain: false,
  timestamp: '00:00:00.000', timestampMs: Date.now(), direction: 'in',
});

const seed = async (page: any, msg: any) => {
  await page.evaluate((m) => (window as any).__fire('mqtt-messages', { messages: [m], dropped: 0 }), msg);
  await expect(page.getByText(m_topic(msg))).toBeVisible();
};
const m_topic = (msg: any) => msg.topic;

const openCodec = async (page: any, script: string) => {
  await page.getByRole('button', { name: /Codec/ }).click();
  await page.getByLabel('Payload codec script (display only)').fill(script);
};

test('codec rewrites what is displayed for a matching row', async ({ page }) => {
  await boot(page);
  await seed(page, row('sensors/room1', '{"temperature":21.5,"device":"edge-1"}', 'm1'));
  await expect(page.getByText('21.5')).toBeVisible();

  await openCodec(page, 'function transform(topic, payload) { return "TEMP=" + JSON.parse(payload).temperature; }');
  await expect(page.getByText('TEMP=21.5')).toBeVisible();
});

test('a throwing codec keeps the payload visible and flags the failure', async ({ page }) => {
  await boot(page);
  await seed(page, row('sensors/room2', '{"temperature":9}', 'm2'));

  await openCodec(page, 'function transform() { throw new Error("boom"); }');

  await expect(page.getByText(/Codec failed/)).toBeVisible();
  // The raw payload must survive a broken lens, not vanish with it.
  await expect(page.getByText('temperature').first()).toBeVisible();
});

test('codec is display-only: replay still carries the original bytes', async ({ page }) => {
  await boot(page);
  const original = '{"temperature":21.5,"device":"edge-1"}';
  await seed(page, row('sensors/room3', original, 'm3'));
  await openCodec(page, 'function transform() { return "REDACTED"; }');
  await expect(page.getByText('REDACTED').first()).toBeVisible();

  await page.getByLabel('Replay this message').first().click();
  const publish = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === 'publish_console').at(-1));
  expect(Buffer.from(publish.args.params.payloadBase64, 'base64').toString('utf8')).toBe(original);
});

test('a SenML device pack auto-detects and renders as a reading table', async ({ page }) => {
  await boot(page);
  const senml = JSON.stringify([
    { bn: 'urn:dev:ops:esp32-1/', bt: 1_700_000_000, bu: 'Cel', n: 'temp', v: 21.5 },
    { n: 'humidity', u: '%RH', v: 43 },
  ]);
  await seed(page, { ...row('demo/senml', senml, 'm4'), contentType: 'application/senml+json' });

  // Auto view must pick SenML over plain JSON, so units and base names line up.
  await expect(page.getByText('urn:dev:ops:esp32-1/temp').first()).toBeVisible();
  await expect(page.getByText('Cel').first()).toBeVisible();
  await expect(page.getByText('urn:dev:ops:esp32-1/humidity').first()).toBeVisible();
});

test('ordinary JSON is not mistaken for SenML', async ({ page }) => {
  await boot(page);
  await seed(page, row('demo/plain', '{"temperature":21.5,"device":"edge-1"}', 'm5'));
  // The JSON tree must render, not a SenML table.
  await expect(page.getByText('temperature').first()).toBeVisible();
  await expect(page.getByText(/urn:dev/)).toHaveCount(0);
});
