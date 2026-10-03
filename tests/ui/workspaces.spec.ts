import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'history');
    const now = Date.now();
    const rows = [
      { id: 'partial', topic: 'sensor/partial', payload: 'prefix', payloadBase64: 'cHJlZml4', payloadLen: 100000, truncated: true },
      { id: 'empty', topic: 'sensor/empty', payload: '', payloadBase64: '', payloadLen: 0, truncated: false },
      { id: 'rpc', topic: 'rpc/request', payload: 'hello', payloadBase64: 'aGVsbG8=', payloadLen: 5, truncated: false },
    ].map((r) => ({ ...r, qos: 1, retain: false, direction: 'in', ts: now - 1000, properties: { userProperties: [['device', 'edge']], responseTopic: 'rpc/reply', correlationData: '42' } }));
    const w = window as any;
    w.calls = [];
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args });
        if (cmd === 'get_connection_status') return { connected: true, brokerHost: 'localhost', brokerPort: 1883, clientId: 'test' };
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
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
          return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'history_stats') return { rows: 3, inbound: 3, outbound: 0, oldestTs: now - 60_000, newestTs: now - 1000 };
        if (cmd === 'query_history') return rows.filter((r) => r.topic.includes(args.search));
        if (cmd === 'history_series') return [{ bucket: Math.floor((now - 1000) / args.bucketMs) * args.bucketMs, count: 3 }];
        if (cmd === 'history_topics')
          return w.topics ?? [
            { topic: 'sensor/partial', count: 1234, inbound: 1200, outbound: 34, bytes: 987654, firstTs: now - 60_000, lastTs: now - 1000 },
            { topic: 'rpc/request', count: 3, inbound: 2, outbound: 1, bytes: 15, firstTs: now - 50_000, lastTs: now - 2000 },
          ];
        if (cmd === 'set_history_retention') return null;
        if (cmd === 'bridge_status') return [];
        if (cmd === 'schedule_list') return [];
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'plugin:dialog|save') return 'D:/exports/capture.json';
        if (cmd === 'test_broker_connection') return 10;
        return null;
      },
    };
  });
  await page.goto('/');
});

test('history prevents partial replay and preserves empty and MQTT5 messages', async ({ page }) => {
  // Scoped to the result list: the by-topic strip above also names these topics.
  const results = page.getByTestId('history-results');
  await results.getByRole('button', { name: /sensor\/partial/ }).click();
  await expect(page.getByRole('button', { name: 'Resend', exact: true })).toBeDisabled();
  await results.getByRole('button', { name: /sensor\/empty/ }).click();
  await expect(page.getByRole('button', { name: 'Resend', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Resend', exact: true }).click();
  await results.getByRole('button', { name: /rpc\/request/ }).click();
  await page.getByRole('button', { name: 'HEX', exact: true }).click();
  await expect(page.locator('pre')).toContainText('68 65 6c 6c 6f');
  await page.getByRole('button', { name: 'Resend', exact: true }).click();
  const publishes = await page.evaluate(() => (window as any).calls.filter((c: any) => c.cmd === 'publish_console'));
  expect(publishes[0].args.params.payloadBase64).toBe('');
  expect(publishes[1].args.params.properties.responseTopic).toBe('rpc/reply');
  await page.screenshot({ path: 'test-results/history-solaris.png', fullPage: true });
});

test('history uses identical filters for the list and chart and exports the selection', async ({ page }) => {
  const results = page.getByTestId('history-results');
  await page.getByRole('textbox').fill('rpc');
  await page.getByRole('button', { name: '5m', exact: true }).click();
  await expect(results.getByRole('button', { name: /sensor\/partial/ })).toHaveCount(0);
  await expect(results.getByRole('button', { name: /rpc\/request/ })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).calls);
  const query = calls.filter((c: any) => c.cmd === 'query_history').at(-1).args;
  const series = calls.filter((c: any) => c.cmd === 'history_series').at(-1).args;
  expect(series).toMatchObject({ topic: query.search, direction: query.direction, sinceMs: query.sinceMs, untilMs: query.untilMs });
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  // The save dialog and the file write resolve asynchronously through the plugin layer.
  await expect
    .poll(async () => await page.evaluate(() => (window as any).calls.some((c: any) => c.cmd === 'plugin:fs|write_text_file')), { timeout: 10_000 })
    .toBe(true);
});

test('webhook recipes create editable rules without a target broker', async ({ page }) => {
  await page.getByRole('button', { name: /Bridge/ }).first().click();
  await page.getByRole('button', { name: /Telemetry to business API/ }).click();
  await expect(page.getByLabel('Forwarding target')).toHaveValue('http');
  await expect(page.getByLabel('Webhook URL')).toHaveValue('http://localhost:8080/events');
  await page.getByLabel('Webhook URL').fill('https://example.com/events');
  await page.getByLabel('Headers (one Name: value per line)').fill('Authorization: Bearer local-secret');
  await page.getByRole('button', { name: 'Add Rule', exact: true }).click();
  await expect(page.getByText('https://example.com/events').first()).toBeVisible();
  const rules = await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_bridge_rules') || '[]'));
  expect(rules[0]).toMatchObject({ targetKind: 'http', sourceFilter: 'sensors/+/telemetry', webhook: { format: 'json' } });
  await page.screenshot({ path: 'test-results/bridge-solaris.png', fullPage: true });
});

test('default and minimum windows keep content inside the viewport', async ({ page }) => {
  for (const width of [1020, 850]) {
    await page.setViewportSize({ width, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('combobox', { name: 'Saved Profiles' })).toBeVisible();
  }
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgb(9, 11, 16)');
});

test('history reads per topic and prunes by age, not only by row count', async ({ page }) => {
  await expect(page.getByTestId('history-topics')).toBeVisible();
  const noisy = page.getByTestId('history-topic-sensor/partial');
  await expect(noisy).toContainText('sensor/partial');
  await expect(noisy).toContainText('1,234');
  // The tooltip carries the split a triage question actually needs: which
  // direction, how many bytes, and when the topic last spoke.
  await expect(noisy).toHaveAttribute('title', /bytes|B .*\d\d:\d\d/);

  await page.getByTestId('history-topic-rpc/request').click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'query_history').at(-1).args.search,
    )
    .toBe('rpc/request');

  await page.getByTestId('history-retention').fill('30');
  await page.getByTestId('history-retention-apply').click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'set_history_retention').at(-1),
    )
    .toMatchObject({ args: { days: 30 } });
});

test('the retention control starts from the policy the store reports, not from zero', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).topics = [];
  });
  await page.reload();
  await expect(page.getByTestId('history-retention')).toHaveValue('0');
});
