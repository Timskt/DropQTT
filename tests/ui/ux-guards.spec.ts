import { test, expect } from '@playwright/test';

/**
 * Guards added after the second audit pass: the traffic table used to draw a
 * hard-wired 80 rows with no way to reach the rest of a 200k-topic table, and
 * deleting a bridge rule was one stray click away from destroying hours of
 * configuration.
 */
const boot = async (page: any, mode: string, extra: Record<string, any> = {}) => {
  await page.addInitScript(([m, ex]) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', m);
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_guards',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: 5, cleanSession: true,
      }),
    );
    if (ex.rules) localStorage.setItem('dropqtt_bridge_rules', JSON.stringify(ex.rules));
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
      transformCallback: (cb: any) => { const id = nextId++; byId.set(id, cb); return id; },
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args });
        if (cmd === 'plugin:event|listen') {
          const cb = byId.get(args.handler);
          if (cb) handlers.set(args.handler, { event: args.event, cb });
          return args.handler;
        }
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'get_connection_status') return { connected: ex.connected !== false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_guards' };
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ids') return w.subIds ?? {};
        if (cmd === 'get_broker_capabilities')
          return w.caps ?? { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state')
          return w.ackState ?? { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'bridge_status' || cmd === 'list_transfers' || cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'get_topic_stats') return ex.rows ?? [];
        if (cmd === 'get_broker_sys') return [];
        if (cmd === 'get_diagnostics_snapshot') return null;
        return null;
      },
    };
  }, [mode, extra] as const);
  await page.goto('/');
};

const manyRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    topic: `lab/t/${String(i).padStart(3, '0')}`,
    count: n - i,
    bytes: (n - i) * 100,
    rate: n - i,
    peakRate: n - i,
    bytesRate: (n - i) * 10,
    lastSeen: Math.floor(Date.now() / 1000),
  }));

const rule = {
  id: 'r-1', name: 'Telemetry forward', sourceConn: 'a', sourceFilter: 'sensors/#', sourceQos: 1,
  targetConn: 'b', targetKind: 'mqtt', topicMode: 'same', enabled: true,
};

test('a long traffic table can be filtered instead of truncated at 80 rows', async ({ page }) => {
  await boot(page, 'mqttx', { rows: manyRows(95) });
  const filter = page.getByLabel('filter topics');
  await expect(filter).toBeVisible();
  // 95 tracked topics, 80 drawn: the tail is announced, not silently dropped
  await expect(page.getByText('15 more low-rate topics hidden')).toBeVisible();
  await expect(page.getByText('lab/t/001')).toBeVisible();

  await filter.fill('lab/t/09');
  await expect(page.getByText('lab/t/090')).toBeVisible();
  await expect(page.getByText('lab/t/094')).toBeVisible();
  await expect(page.getByText('lab/t/001')).toBeHidden();
  // only 5 rows match, so the cap no longer hides anything
  await expect(page.getByText('more low-rate topics hidden')).toBeHidden();
});

test('no filter box is added when everything already fits', async ({ page }) => {
  await boot(page, 'mqttx', { rows: manyRows(20) });
  await expect(page.getByLabel('filter topics')).toBeHidden();
  await expect(page.getByText('lab/t/001')).toBeVisible();
});

test('deleting a bridge rule takes two deliberate clicks', async ({ page }) => {
  await boot(page, 'bridge', { rules: [rule] });
  const del = page.getByLabel('Delete rule');
  await expect(del).toBeVisible();
  await del.click();
  // first click arms it and changes the affordance, but does not touch the set
  await expect(page.getByLabel('click again to confirm')).toBeVisible();
  const syncsAfterOne = (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'bridge_sync_rules').length;
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_bridge_rules') || '[]'));
  expect(stored).toHaveLength(1);

  await page.getByLabel('click again to confirm').click();
  await expect
    .poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_bridge_rules') || '[]'))).length)
    .toBe(0);
  const syncsAfterTwo = (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'bridge_sync_rules').length;
  expect(syncsAfterTwo).toBeGreaterThan(syncsAfterOne);
});

test('the arm state lapses so a stale second click cannot delete an unrelated rule', async ({ page }) => {
  await boot(page, 'bridge', { rules: [rule, { ...rule, id: 'r-2', name: 'Second rule' }] });
  await page.getByLabel('Delete rule').first().click();
  await expect(page.getByLabel('click again to confirm')).toHaveCount(1);
  // the other row still asks for its own confirmation
  await expect(page.getByLabel('Delete rule')).toHaveCount(1);
  await page.getByLabel('Delete rule').first().click();
  await expect(page.getByLabel('click again to confirm')).toHaveCount(1, { timeout: 6000 });
});

test('throwing away the feed takes two deliberate clicks', async ({ page }) => {
  await boot(page, 'mqttx');
  const clear = page.getByTestId('clear-messages');
  await expect(clear).toHaveAttribute('aria-label', 'Clear Messages');
  await clear.click();
  // The first click only arms: the label changes so the state is readable, not
  // just coloured.
  await expect(clear).toHaveAttribute('aria-label', 'click again to clear this list');
  await clear.click();
  await expect(clear).toHaveAttribute('aria-label', 'Clear Messages');
});

test('an empty share group says what is missing instead of doing nothing', async ({ page }) => {
  await boot(page, 'mqttx');
  await page.getByPlaceholder(/Topic Pattern/).fill('edge/telemetry');
  await page.getByLabel('Shared subscription').check();
  await page.getByRole('button', { name: /Subscribe/ }).first().click();
  await expect(page.getByTestId('sub-share-error')).toBeVisible();
  await expect(page.getByTestId('sub-share-error')).toHaveText('enter a share group name first');
  // Nothing may have been sent to the backend while the filter was incomplete.
  expect(await page.evaluate(() => (window as any).calls.filter((c) => c.cmd === 'subscribe_topic').length)).toBe(0);
  await page.getByLabel('Shared group').fill('workers');
  await expect(page.getByTestId('sub-share-error')).toHaveCount(0);
  await page.getByRole('button', { name: /Subscribe/ }).first().click();
  const call = await page.evaluate(() => {
    const c = (window as any).calls.filter((x) => x.cmd === 'subscribe_topic').pop();
    return c ? c.args.topic : null;
  });
  expect(call).toBe('$share/workers/edge/telemetry');
});

test('two feed rows can be compared field by field', async ({ page }) => {
  await boot(page, 'mqttx');
  // The feed is event-driven, so the rows are delivered the way the real backend
  // delivers them rather than by poking component state.
  await page.evaluate(() => {
    const mk = (id: string, topic: string, qos: number, body: string) => ({
      id,
      topic,
      payload: body,
      payloadLen: body.length,
      payloadBase64: btoa(body),
      truncated: false,
      qos,
      retain: false,
      timestamp: '10:00:00.000',
      timestampMs: Date.now(),
      direction: 'in',
    });
    // __fire wraps the payload itself, so this is the FeedBatch shape directly.
    (window as any).__fire('mqtt-messages', {
      messages: [
        mk('m1', 'edge/telemetry', 1, '{"temp":21,"fan":true}'),
        mk('m2', 'edge/telemetry', 2, '{"temp":24,"fan":true}'),
      ],
      dropped: 0,
    });
  });
  await expect(page.getByText('edge/telemetry').first()).toBeVisible();
  await page.getByTestId('compare-toggle').click();
  await expect(page.getByTestId('compare-hint')).toBeVisible();
  await page.getByTestId('pick-m1').click();
  await page.getByTestId('pick-m2').click();
  const panel = page.getByTestId('compare-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('QoS');
  // Only the payload line differs here, and it must be marked as such.
  await expect(panel).toContainText('+ ');
  await expect(panel).toContainText('- ');
});

test('the retained popover opens by keyboard, moves focus inside, and Escape hands it back', async ({ page }) => {
  await boot(page, 'mqttx');
  await page.evaluate(() => {
    (window as any).__fire('mqtt-messages', {
      messages: [
        {
          id: 'r1', topic: 'device/online', payload: '1', payloadLen: 1,
          payloadBase64: btoa('1'), truncated: false, qos: 0, retain: true,
          timestamp: '10:00:00.000', timestampMs: Date.now(), direction: 'in',
        },
      ],
      dropped: 0,
    });
  });

  const toggle = page.getByRole('button', { name: 'Retained message manager' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus();
  await page.keyboard.press('Enter');

  const popover = page.getByRole('group', { name: 'Retained messages on these topics' });
  await expect(popover).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // Focus has to move inside. A popover that can only be reached by mouse leaves a
  // keyboard user standing on the toggle with nothing Tab reaches.
  await expect(popover.getByRole('button', { name: /Clear retained on 1 topics/ })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test('a disabled control says which condition it is stuck on', async ({ page }) => {
  await boot(page, 'mqttx', { connected: false });
  const publish = page.getByRole('button', { name: /Publish Message/ });
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveAttribute('title', /Not connected to a broker/);
});

test('an unsubmitted search box is the reason export is dead', async ({ page }) => {
  await boot(page, 'history');
  await page.getByRole('textbox').fill('sensor');
  const json = page.getByRole('button', { name: 'JSON', exact: true });
  await expect(json).toBeDisabled();
  await expect(json).toHaveAttribute('title', /unsubmitted text/);
});

test('the feed says when it is only showing the newest window', async ({ page }) => {
  await boot(page, 'mqttx');
  await page.evaluate(() => {
    const mk = (i: number) => ({
      id: `m${i}`, topic: `bench/row/${i}`, payload: String(i), payloadLen: String(i).length,
      payloadBase64: btoa(String(i)), truncated: false, qos: 0, retain: false,
      timestamp: '10:00:00.000', timestampMs: Date.now(), direction: 'in',
    });
    (window as any).__fire('mqtt-messages', { messages: Array.from({ length: 502 }, (_, i) => mk(i)), dropped: 0 });
  });
  await expect(page.getByTestId('feed-cap-note')).toHaveText(/Showing the newest 500; older rows are in History/);
  // A panel below the cap must not claim it is truncated.
  await boot(page, 'mqttx');
  await expect(page.getByTestId('feed-cap-note')).toHaveCount(0);
});
