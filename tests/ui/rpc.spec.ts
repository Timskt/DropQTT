import { test, expect } from '@playwright/test';

/**
 * Request/response pairing lives in Rust; what the UI owes the user is (a) a
 * publish that opts in becomes a request with the fields the backend needs,
 * (b) the answer or its absence shows up as a terminal row with the measured
 * round trip, and (c) the weaker "paired by order" claim stays visible.
 * The mock below is a small faithful registry so rows behave like the real one.
 */
const boot = async (page: any) => {
  await page.addInitScript(() => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_rpc',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: 5, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    w.rpcRows = [];
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
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_rpc' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ids') return w.subIds ?? {};
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return w.assertions ?? { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset')
          return w.faults ?? [];
        if (cmd === 'get_broker_capabilities')
          return w.caps ?? { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state')
          return w.ackState ?? { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress') return [];
        if (cmd === 'rpc_list') return w.rpcRows;
        if (cmd === 'rpc_request') {
          const s = args.spec;
          const call = {
            id: 'call-' + w.rpcRows.length,
            requestTopic: s.topic,
            responseTopic: s.responseTopic || 'dropqtt/rpc/auto0000',
            correlation: s.correlationData || 'auto-corr',
            sentAtMs: Date.now(),
            timeoutMs: s.timeoutMs,
            state: 'pending',
            rttMs: null,
            reply: null,
            pairedByPosition: false,
          };
          w.rpcRows = [call, ...w.rpcRows];
          return call;
        }
        if (cmd === 'rpc_clear_finished') {
          const before = w.rpcRows.length;
          w.rpcRows = w.rpcRows.filter((c: any) => c.state === 'pending');
          return before - w.rpcRows.length;
        }
        return null;
      },
    };
  });
  await page.goto('/');
};

const lastCall = async (page: any, cmd: string) =>
  (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === cmd).at(-1);

const openV5Props = async (page: any) => {
  await page.getByRole('button', { name: 'v5 props' }).click();
};

const setPayload = async (page: any, text: string) => {
  await page.locator('textarea').first().fill(text);
};

test('await-reply is offered only where MQTT5 can carry it', async ({ page }) => {
  await boot(page);
  await openV5Props(page);
  await expect(page.getByLabel('Await reply')).toBeVisible();
});

test('an opted-in publish becomes a request carrying the chosen response fields', async ({ page }) => {
  await boot(page);
  await openV5Props(page);
  await setPayload(page, '{"cmd":"ping"}');
  await page.getByLabel('Await reply').check();
  await page.locator('#dropqtt-rpc-timeout').fill('2500');
  await page.getByPlaceholder('Response Topic').fill('dev/reply');
  await page.getByPlaceholder('Correlation Data').fill('c-7');
  await page.getByRole('button', { name: 'Publish Message' }).click();
  const call = await lastCall(page, 'rpc_request');
  expect(call).toBeTruthy();
  expect(call.args.spec).toMatchObject({
    topic: expect.any(String),
    responseTopic: 'dev/reply',
    correlationData: 'c-7',
    timeoutMs: 2500,
  });
  expect(call.args.spec.payloadBase64).toBeTruthy();
  // The plain publish path must not also fire, or the request is sent twice.
  expect(await lastCall(page, 'publish_console')).toBeFalsy();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
});

test('a matched reply shows the round trip and exposes the body', async ({ page }) => {
  await boot(page);
  await openV5Props(page);
  await setPayload(page, '{"q":"ping"}');
  await page.getByLabel('Await reply').check();
  await page.getByPlaceholder('Response Topic').fill('dev/reply');
  await page.getByRole('button', { name: 'Publish Message' }).click();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();

  await page.evaluate(() => {
    const w = window as any;
    const call = { ...w.rpcRows[0], state: 'resolved', rttMs: 37, pairedByPosition: false,
      reply: { topic: 'dev/reply', payloadBase64: 'cG9uZw==', payloadLen: 4, qos: 1, retain: false,
        correlationData: null, contentType: null, timestampMs: Date.now() } };
    w.rpcRows = [call, ...w.rpcRows.slice(1)];
    w.__fire('rpc-event', { kind: 'resolved', call });
  });
  const row = page.getByText('Round trip 37 ms');
  await expect(row).toBeVisible();
  await expect(row).toContainText('4 B');
  await page.getByTitle('Reply body').click();
  await expect(page.getByText('pong')).toBeVisible();
});

test('a reply paired without correlation data is labelled as the weaker match', async ({ page }) => {
  await boot(page);
  await openV5Props(page);
  await setPayload(page, '{"q":"ping"}');
  await page.getByLabel('Await reply').check();
  await page.getByRole('button', { name: 'Publish Message' }).click();
  await page.evaluate(() => {
    const w = window as any;
    const call = { ...w.rpcRows[0], state: 'resolved', rttMs: 5, pairedByPosition: true,
      reply: { topic: 'dropqtt/rpc/auto0000', payloadBase64: 'cG9uZw==', payloadLen: 4, qos: 0, retain: false,
        correlationData: null, contentType: null, timestampMs: Date.now() } };
    w.rpcRows = [call, ...w.rpcRows.slice(1)];
    w.__fire('rpc-event', { kind: 'resolved', call });
  });
  await expect(page.getByText('paired by order')).toBeVisible();
});

test('no answer becomes a terminal row that clear can remove', async ({ page }) => {
  await boot(page);
  await openV5Props(page);
  await setPayload(page, '{"q":"ping"}');
  await page.getByLabel('Await reply').check();
  await page.getByRole('button', { name: 'Publish Message' }).click();
  await page.evaluate(() => {
    const w = window as any;
    const call = { ...w.rpcRows[0], state: 'timeout' };
    w.rpcRows = [call, ...w.rpcRows.slice(1)];
    w.__fire('rpc-event', { kind: 'timeout', call });
  });
  await expect(page.getByText('No reply', { exact: true })).toBeVisible();

  await page.getByTitle('Clear finished').click();
  const call = await lastCall(page, 'rpc_clear_finished');
  expect(call).toBeTruthy();
  await expect(page.getByText('No reply', { exact: true })).toHaveCount(0, { timeout: 5000 });
});

test('a request that was never opted in stays an ordinary publish', async ({ page }) => {
  await boot(page);
  await openV5Props(page);
  await setPayload(page, '{"q":"plain"}');
  await page.getByRole('button', { name: 'Publish Message' }).click();
  expect(await lastCall(page, 'rpc_request')).toBeFalsy();
  expect((await lastCall(page, 'publish_console'))).toBeTruthy();
  await expect(page.getByText('No requests yet')).toBeVisible();
});
