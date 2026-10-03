import { test, expect } from '@playwright/test';

/**
 * Scheduled publishing is executed by the Rust scheduler, not a webview timer.
 * What the UI therefore has to get right is narrow but load-bearing: hand the
 * whole draft over verbatim (template included), render backend state rather
 * than a local counter, and keep control of runs it can no longer see inside.
 */
const boot = async (page: any) => {
  await page.addInitScript(() => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_test',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: 4, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    /** Stands in for the backend registry so the test can advance a run. */
    w.__runs = [];
    w.__setSent = (id: string, sent: number) => {
      const row = w.__runs.find((r: any) => r.id === id);
      if (row) row.sent = sent;
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args });
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
        if (cmd === 'schedule_list') return w.__runs.map((r: any) => ({ ...r }));
        if (cmd === 'schedule_start') {
          const s = args.spec;
          w.__runs.push({
            id: s.id, topic: s.topic, format: s.format, intervalMs: s.intervalMs,
            count: s.count, qos: s.qos, retain: s.retain, sent: 0, errors: 0,
            status: 'running', startedAtMs: Date.now(),
          });
          return null;
        }
        if (cmd === 'schedule_stop') {
          const row = w.__runs.find((r: any) => r.id === args.id);
          if (row) row.status = 'stopped';
          return null;
        }
        if (cmd === 'schedule_clear_finished') {
          w.__runs = w.__runs.filter((r: any) => r.status === 'running');
          return 1;
        }
        return null;
      },
    };
  });
  await page.goto('/');
};

const openScheduler = (page: any) =>
  page.getByRole('button', { name: 'Auto Publish' }).click();

const setCadence = async (page: any, ms: number, count: number) => {
  // Located by label on purpose: the console workspace has other number inputs
  // (the bench lab), and a positional locator silently filled those instead.
  await page.getByLabel('Interval (ms)', { exact: true }).fill(String(ms));
  await page.getByLabel('Count', { exact: true }).fill(String(count));
};

test('start hands the whole draft, template included, to the backend', async ({ page }) => {
  await boot(page);
  await openScheduler(page);

  await page.getByPlaceholder('test/topic').fill('devices/pump01/telemetry');
  await page.getByPlaceholder('{"key": "value"}').fill('{"seq":${counter},"at":${timestamp}}');
  // A templated JSON payload is valid once rendered, which is what both send
  // paths do; the editor must not flag it.
  await expect(page.getByText('⚠ invalid')).toHaveCount(0);
  await setCadence(page, 250, 12);
  await page.getByLabel('Retain').check();

  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'schedule_start').at(-1),
    )
    .toMatchObject({
      args: {
        spec: {
          topic: 'devices/pump01/telemetry',
          payload: '{"seq":${counter},"at":${timestamp}}',
          format: 'json',
          intervalMs: 250,
          count: 12,
          qos: 0,
          retain: true,
          properties: { contentType: 'application/json', userProperties: [] },
        },
      },
    });

  // The timer is no longer in the webview, so starting a schedule must not look
  // like a one-shot manual publish.
  const manual = (await page.evaluate(() => (window as any).calls)).filter(
    (c: any) => c.cmd === 'publish_console',
  );
  expect(manual).toHaveLength(0);
});

test('the run list renders backend progress, not a local count', async ({ page }) => {
  await boot(page);
  await openScheduler(page);
  await page.getByPlaceholder('test/topic').fill('devices/fan/rt');
  await setCadence(page, 250, 12);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.getByTitle('devices/fan/rt')).toBeVisible();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await expect(page.getByText('Sent 0')).toBeVisible();
  await expect(page.getByText('250 ms · QoS 0 · json')).toBeVisible();

  // Advance the backend between polls: the panel has to follow it.
  await page.evaluate(() => (window as any).__setSent((window as any).__runs[0].id, 7));
  await expect(page.getByText('Sent 7 / 12')).toBeVisible();

  const id = await page.evaluate(() => (window as any).__runs[0].id);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'schedule_stop').at(-1),
    )
    .toMatchObject({ args: { id } });
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
});

test('a run that failed in the backend shows its error and can be cleared', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    (window as any).__runs.push({
      id: 'sch-old', topic: 'devices/broken/telemetry', format: 'hex', intervalMs: 1000,
      count: 0, qos: 0, retain: false, sent: 4, errors: 5, status: 'failed',
      lastError: 'hex payload must be an even number of hex digits', startedAtMs: Date.now() - 9000,
    });
  });
  await openScheduler(page);

  await expect(page.getByTitle('devices/broken/telemetry')).toBeVisible();
  await expect(page.getByText('Failed', { exact: true })).toBeVisible();
  await expect(page.getByText('hex payload must be an even number of hex digits')).toBeVisible();

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).some((c: any) => c.cmd === 'schedule_clear_finished'),
    )
    .toBe(true);
  await expect(page.getByTitle('devices/broken/telemetry')).toHaveCount(0);
});

test('a running schedule stays visible on the toggle after the panel closes', async ({ page }) => {
  await boot(page);
  await openScheduler(page);
  await page.getByPlaceholder('test/topic').fill('devices/lamp/state');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTitle('devices/lamp/state')).toBeVisible();

  await openScheduler(page);
  await expect(page.getByTitle('devices/lamp/state')).toHaveCount(0);
  // The badge is how the user finds the run again: it is backend state, so it
  // survives closing the panel (and, in the real app, leaving the workspace).
  await expect(page.locator('button:has-text("Auto Publish") span.animate-pulse')).toHaveCount(1);
});

test('CBOR is refused up front because the backend cannot encode it', async ({ page }) => {
  await boot(page);
  await openScheduler(page);
  await page.getByPlaceholder('test/topic').fill('devices/cbor/data');
  await page.getByTitle('Format: CBOR').click();

  await expect(page.getByText('CBOR payloads cannot be scheduled')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();

  const started = (await page.evaluate(() => (window as any).calls)).filter(
    (c: any) => c.cmd === 'schedule_start',
  );
  expect(started).toHaveLength(0);
});

test('a fleet draft carries the device width to the backend', async ({ page }) => {
  await boot(page);
  await openScheduler(page);
  await page.getByPlaceholder('test/topic').fill('site/${device}/telemetry');
  await page.getByPlaceholder('{"key": "value"}').fill('{"d":${device}}');
  await setCadence(page, 250, 12);
  await page.getByLabel('Devices', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'schedule_start').at(-1),
    )
    .toMatchObject({
      args: {
        spec: {
          topic: 'site/${device}/telemetry',
          payload: '{"d":${device}}',
          count: 12,
          devices: 12,
        },
      },
    });
});
