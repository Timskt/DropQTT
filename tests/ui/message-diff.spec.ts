import { test, expect } from '@playwright/test';

/**
 * Comparing two stored messages. What these pin is the difference between a diff that
 * informs and a diff that flatters: a JSON payload has to answer with the *field* that
 * moved, a byte-identical pair has to say so instead of rendering an empty panel that
 * looks like a bug, and a truncated row must never be allowed to imply "these two
 * messages are the same" when only their stored prefixes are the same.
 */
const hrow = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  topic: 'devices/a/telemetry',
  payload: '{"tempC":21,"fw":"1.2.0"}',
  payloadBase64: Buffer.from('{"tempC":21,"fw":"1.2.0"}', 'utf8').toString('base64'),
  payloadLen: 26,
  qos: 1,
  retain: false,
  contentType: 'application/json',
  properties: { userProperties: [] },
  truncated: false,
  direction: 'in',
  ts: 1_000,
  ...over,
});

const ROWS = [
  hrow(),
  hrow({ id: 'r2', payload: '{"tempC":25,"fw":"1.2.0"}', ts: 61_000 }),
];

const boot = async (page: any, rows: any[] = ROWS) => {
  await page.addInitScript(
    ([exRows]) => {
      localStorage.setItem('dropqtt_lang', 'en');
      localStorage.setItem('dropqtt_theme', 'solaris');
      localStorage.setItem('dropqtt_workspace_mode', 'history');
      const w = window as any;
      w.rows = exRows;
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: (cb: any) => {
          const id = Math.random();
          w.__cbs = w.__cbs || new Map();
          w.__cbs.set(id, cb);
          return id;
        },
        invoke: async (cmd: string) => {
          if (cmd === 'plugin:event|listen') return 1;
          if (cmd === 'plugin:event|unlisten') return null;
          if (cmd === 'get_connection_status')
            return { connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_diff' };
          if (cmd === 'get_default_download_dir') return 'D:/Downloads';
          if (cmd === 'get_topic_stats_cap') return 5000;
          if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
          if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'list_transfers') return [];
          if (cmd === 'bridge_status' || cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
          if (cmd === 'bridge_outbox_state')
            return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
          if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
            return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
          if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
          if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
          if (cmd === 'get_broker_capabilities')
            return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
          if (cmd === 'get_subscription_ack_state')
            return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
          if (cmd === 'history_stats')
            return { rows: exRows.length, inbound: 1, outbound: 1, oldestTs: 1_000, newestTs: 61_000, lostRows: 0, retentionDays: 0, prunedRows: 0 };
          if (cmd === 'query_history') return w.rows;
          if (cmd === 'history_series' || cmd === 'history_topics') return [];
          if (cmd === 'history_trace')
            return { hits: [], summary: { count: 0, topics: [], firstMs: null, lastMs: null, inbound: 0, outbound: 0, correlations: [], truncated: false } };
          if (cmd === 'history_timeline')
            return { entities: [], windowStartMs: 0, windowEndMs: 0, gapMs: 30_000, depth: 2, entitiesDropped: 0, rowsScanned: 0, truncated: false };
          return null;
        },
      };
    },
    [rows] as const,
  );
  await page.goto('/');
  await expect(page.getByTestId('history-results')).toBeVisible();
};

const expand = async (page: any, needle: string) => {
  await page.locator('.history-row', { hasText: needle }).first().click();
};

const pickCompare = async (page: any, needle: string) => {
  await expand(page, needle);
  await page.getByTestId('history-compare-btn').click();
};

test('picking a second message opens a diff that names the field that moved', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('message-diff')).toHaveCount(0);

  await pickCompare(page, '"tempC":21');
  await expect(page.getByTestId('compare-waiting')).toBeVisible();
  await expect(page.getByTestId('message-diff')).toHaveCount(0);

  await pickCompare(page, '"tempC":25');
  const card = page.getByTestId('message-diff');
  await expect(card).toBeVisible();
  await expect(card.getByText('tempC')).toBeVisible();
  await expect(card.getByText('21')).toBeVisible();
  await expect(card.getByText('25')).toBeVisible();
  // Two different payloads must never be allowed to read as "byte-identical", and the
  // change count has to be the one thing that proves the panel is comparing, not decorating.
  await expect(card.getByText('byte-identical')).toHaveCount(0);
  await expect(card.getByText('1 changed')).toBeVisible();
  // The gap between the two stored messages is part of the answer, not decoration.
  await expect(card.getByText('60s apart')).toBeVisible();
});

test('both rows stay marked so it is obvious which two are being compared', async ({ page }) => {
  await boot(page);
  await pickCompare(page, '"tempC":21');
  await pickCompare(page, '"tempC":25');
  await expect(page.getByTestId('compare-slot')).toHaveText(['A', 'B']);
});

test('byte-identical payloads are stated as identical instead of an empty panel', async ({ page }) => {
  await boot(page, [hrow(), hrow({ id: 'r2', ts: 9_000 })]);
  await pickCompare(page, '"tempC":21');
  // Both rows preview the same text, so pick the second one by its own row index.
  await page.locator('.history-row').nth(1).click();
  await page.getByTestId('history-compare-btn').click();
  await expect(page.getByTestId('message-diff').getByText('The two payloads are byte-identical')).toBeVisible();
});

test('a truncated row cannot claim the messages matched', async ({ page }) => {
  await boot(page, [hrow(), hrow({ id: 'r2', payload: '{"tempC":21,"fw":"1.2.0"}', truncated: true, ts: 9_000 })]);
  await pickCompare(page, '"tempC":21');
  await page.locator('.history-row').nth(1).click();
  await page.getByTestId('history-compare-btn').click();
  await expect(page.getByTestId('diff-unreliable')).toBeVisible();
  await expect(page.getByTestId('diff-unreliable')).toContainText('stored truncated');
});

test('carrier differences are listed apart from payload differences', async ({ page }) => {
  await boot(page, [
    hrow(),
    hrow({ id: 'r2', payload: '{"tempC":21,"fw":"1.2.0"}', qos: 0, retain: true, direction: 'out', ts: 9_000 }),
  ]);
  await pickCompare(page, '"tempC":21');
  await page.locator('.history-row').nth(1).click();
  await page.getByTestId('history-compare-btn').click();
  const meta = page.getByTestId('message-diff').getByText('Carrier fields');
  await expect(meta).toBeVisible();
  await expect(meta.locator('..')).toContainText('qos');
  await expect(meta.locator('..')).toContainText('retain');
  // Same bytes, so the payload side must report nothing changed.
  await expect(page.getByTestId('message-diff').getByText('The two payloads are byte-identical')).toBeVisible();
});

test('clearing the pair takes the diff away again', async ({ page }) => {
  await boot(page);
  await pickCompare(page, '"tempC":21');
  await pickCompare(page, '"tempC":25');
  await expect(page.getByTestId('message-diff')).toBeVisible();
  await page.getByTestId('diff-clear').click();
  await expect(page.getByTestId('message-diff')).toHaveCount(0);
  await expect(page.getByTestId('compare-slot')).toHaveCount(0);
});
