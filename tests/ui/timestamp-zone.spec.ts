import { test, expect } from '@playwright/test';

/**
 * Every timestamp this app writes down has to arrive with its zone attached.
 *
 * The screen renders local wall-clock, the files render UTC, and the export paths
 * used to name themselves four different ways — one bare `Date.now()`, one full
 * ISO, one sliced ISO. A file called `dropqtt-environment-1791504000000.json`
 * tells the reader nothing about when it was taken, and a local time with no zone
 * is a measurement with the units left off.
 */
const boot = async (page: any) => {
  await page.addInitScript(() => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'history');
    const now = Date.now();
    const rows = [
      {
        id: 'r1', topic: 'devices/gw1/telemetry', payload: '{"v":1}', payloadBase64: 'eyJ2IjoxfQ==',
        payloadLen: 7, truncated: false, qos: 1, retain: false, direction: 'in', ts: now - 1000,
        properties: { userProperties: [], responseTopic: null, correlationData: null },
      },
    ];
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
        if (cmd === 'get_subscription_ids') return {};
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
        if (cmd === 'get_broker_capabilities')
          return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'history_stats') return { rows: 1, inbound: 1, outbound: 0, oldestTs: now - 60_000, newestTs: now - 1000 };
        if (cmd === 'query_history') return rows;
        if (cmd === 'history_series') return [{ bucket: Math.floor((now - 1000) / args.bucketMs) * args.bucketMs, count: 1 }];
        if (cmd === 'history_topics') return [{ topic: 'devices/gw1/telemetry', count: 1, inbound: 1, outbound: 0, bytes: 7, firstTs: now - 1000, lastTs: now - 1000 }];
        if (cmd === 'history_retained') return [];
        if (cmd === 'bridge_sync_rules' || cmd === 'bridge_status') return [];
        if (cmd === 'bridge_outbox_state') return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
        if (cmd === 'schedule_list') return [];
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'plugin:dialog|save') return 'D:/exports/file';
        return null;
      },
    };
  });
  await page.goto('/');
};

const savedNames = (page: any) =>
  page.evaluate(() =>
    (window as any).calls
      .filter((c: any) => c.cmd === 'plugin:dialog|save')
      // The dialog plugin hands the request over as { options: { defaultPath } }.
      .map((c: any) => c.args?.options?.defaultPath ?? ''),
  );

const STAMPED = /^dropqtt-(messages|capture)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.(json|csv|dqrec)$/;

test('the panel says which zone its times are in', async ({ page }) => {
  await boot(page);
  const note = page.getByTestId('history-zone-note');
  await expect(note).toBeVisible({ timeout: 20_000 });
  const text = await note.innerText();
  // The offset is the machine's own, so the assertion is about the sentence
  // carrying a zone at all -- a bare "times are local" would still be ambiguous.
  expect(text).toMatch(/UTC[+-]\d{2}:\d{2}/);
  expect(text).toMatch(/files export UTC/);
});

test('exports name their timestamp in UTC instead of four private formats', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('history-results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect
    .poll(async () => (await savedNames(page)).some((n: string) => STAMPED.test(n.split(/[\\/]/).pop() ?? '')), { timeout: 20_000 })
    .toBe(true);
  await page.getByTestId('history-capture').click();
  await expect
    .poll(async () => {
      const names = (await savedNames(page)).map((n: string) => n.split(/[\\/]/).pop() ?? '');
      return names.filter((n: string) => STAMPED.test(n)).length;
    }, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
});
