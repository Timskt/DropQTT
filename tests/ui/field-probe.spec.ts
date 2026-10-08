import { test, expect } from '@playwright/test';

/**
 * Field-level value forensics: "when did this field change and what was it before".
 * What these pin is the difference between a history chart and a truthful one -- a field
 * that stopped being reported, a window full of payloads that are not JSON, and forty
 * minutes of silence must each announce themselves rather than be smoothed over.
 */
const hrow = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  topic: 'devices/a/telemetry',
  payload: '{"temp":{"c":21}}',
  payloadBase64: Buffer.from('{"temp":{"c":21}}', 'utf8').toString('base64'),
  payloadLen: 18,
  qos: 1,
  retain: false,
  contentType: 'application/json',
  properties: { userProperties: [] },
  truncated: false,
  direction: 'in',
  ts: 1_000,
  ...over,
});

const temp = (ts: number, c: number) => hrow({ id: `t${ts}`, ts, payload: JSON.stringify({ temp: { c } }) });

const boot = async (page: any, rows: any[]) => {
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
            return { connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_fp' };
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
            return { rows: exRows.length, inbound: exRows.length, outbound: 0, oldestTs: 1_000, newestTs: 61_000, lostRows: 0, retentionDays: 0, prunedRows: 0 };
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

const probe = async (page: any, path: string) => {
  await page.getByTestId('field-probe-path').fill(path);
  await page.getByTestId('field-probe-run').click();
};

test('an unexamined field says it has not been examined', async ({ page }) => {
  await boot(page, [temp(1_000, 21)]);
  await expect(page.getByTestId('field-probe')).toBeVisible();
  await expect(page.getByTestId('field-probe').getByText('Type a field path to inspect its history')).toBeVisible();
});

test('a path resolves to the last value, its as-of time, and the transition that produced it', async ({ page }) => {
  await boot(page, [temp(1_000, 21), temp(2_000, 21), temp(61_000, 25)]);
  await probe(page, 'temp.c');
  await expect(page.getByTestId('field-probe-last')).toHaveText('25');
  await expect(page.getByTestId('field-probe-coverage')).toContainText('3 with field');
  const change = page.getByTestId('field-probe').locator('div', { hasText: 'devices/a/telemetry' }).last();
  await expect(change).toContainText('21');
  await expect(change).toContainText('25');
});

test('a window with no such field is reported as absence of data, not as a constant', async ({ page }) => {
  await boot(page, [temp(1_000, 21), temp(2_000, 22)]);
  await probe(page, 'temp.h');
  await expect(page.getByTestId('field-probe-never')).toBeVisible();
  // Absent field renders neither a chart nor a last value -- the point is that nothing here
  // is allowed to read as "the value stayed at whatever it was".
  await expect(page.getByTestId('field-chart')).toHaveCount(0);
  await expect(page.getByTestId('field-probe-last')).toHaveCount(0);
  await expect(page.getByTestId('field-probe-coverage')).toContainText('0 with field');
});

test('payloads that are not JSON and rows stored truncated are counted where the user can see them', async ({ page }) => {
  await boot(page, [
    temp(1_000, 21),
    hrow({ id: 'txt', ts: 2_000, payload: 'firmware heartbeat' }),
    hrow({ id: 'cut', ts: 3_000, payload: '{"temp":{"c":', truncated: true }),
    temp(4_000, 24),
  ]);
  await probe(page, 'temp.c');
  const cov = page.getByTestId('field-probe-coverage');
  await expect(cov).toContainText('2 with field');
  await expect(cov).toContainText('1 not JSON');
  await expect(cov).toContainText('1 truncated');
});

test('silence is drawn as a break instead of a flat line through it', async ({ page }) => {
  await boot(page, [temp(1_000, 21), temp(11_000, 21), temp(21_000, 21), temp(601_000, 21)]);
  await probe(page, 'temp.c');
  await expect(page.getByTestId('field-gap')).toContainText('580s');
  await expect(page.getByTestId('field-probe-nochange')).toBeVisible();
});

test('a non-numeric field is listed by distinct value instead of being faked as a chart', async ({ page }) => {
  await boot(page, [
    hrow({ id: 'a', ts: 1_000, payload: '{"mode":"auto"}' }),
    hrow({ id: 'b', ts: 2_000, payload: '{"mode":"manual"}' }),
    hrow({ id: 'c', ts: 3_000, payload: '{"mode":"auto"}' }),
  ]);
  await probe(page, 'mode');
  await expect(page.getByTestId('field-chart')).toHaveCount(0);
  await expect(page.getByTestId('field-probe').getByText('"auto" ×2')).toBeVisible();
  await expect(page.getByTestId('field-probe').getByText('"manual" ×1')).toBeVisible();
});

test('paths found by the comparison can be clicked straight into the field probe', async ({ page }) => {
  await boot(page, [temp(1_000, 21), temp(61_000, 25)]);
  await page.locator('.history-row', { hasText: '"c":21' }).first().click();
  await page.getByTestId('history-compare-btn').click();
  await page.locator('.history-row', { hasText: '"c":25' }).first().click();
  await page.getByTestId('history-compare-btn').click();
  await expect(page.getByTestId('message-diff')).toBeVisible();

  const chip = page.getByTestId('field-probe-suggest', { hasText: 'temp.c' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByTestId('field-probe-last')).toHaveText('25');
});
