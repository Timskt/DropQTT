import { test, expect } from '@playwright/test';

/**
 * Delivery audit over stored history. The assertions here are mostly about what the panel
 * is *not* allowed to say: a hole in stored sequence numbers must not be dressed up as
 * proof the broker dropped a packet, latency must not be invented when the publisher
 * carries no send stamp, and a clock that runs backwards must not be averaged into p95.
 */
const seqRow = (ts: number, seq: number, over: Record<string, unknown> = {}) => {
  const payload = { seq, ...over };
  return {
    id: `s${ts}`,
    ts,
    topic: 'line/1/counts',
    payload: JSON.stringify(payload),
    payloadBase64: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
    payloadLen: JSON.stringify(payload).length,
    qos: 1,
    retain: false,
    contentType: 'application/json',
    properties: { userProperties: [] },
    truncated: false,
    direction: 'in',
  };
};

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
            return { connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_audit' };
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

const audit = async (page: any, seqPath = 'seq', timePath = '') => {
  await page.getByTestId('audit-seq-path').fill(seqPath);
  if (timePath) await page.getByTestId('audit-time-path').fill(timePath);
  await page.getByTestId('audit-run').click();
};

test('a hole in the sequence is reported, and immediately reframed as a storage statement', async ({ page }) => {
  await boot(page, [seqRow(1_000, 1), seqRow(2_000, 2), seqRow(3_000, 5)]);
  await audit(page);
  await expect(page.getByTestId('audit-missing')).toContainText('2 missing');
  await expect(page.getByTestId('audit-row').first()).toContainText('seq 1–5 · held 3/5');
  // The caveat is not conditional on finding a problem; it is what makes the number honest.
  await expect(page.getByTestId('audit-caveat')).toBeVisible();
});

test('duplicates and reordering get their own counts', async ({ page }) => {
  await boot(page, [seqRow(1_000, 10), seqRow(2_000, 11), seqRow(3_000, 9), seqRow(4_000, 11)]);
  await audit(page);
  await expect(page.getByTestId('audit-row').first()).toContainText('1 duplicated');
  await expect(page.getByTestId('audit-row').first()).toContainText('1 out of order');
});

test('latency is measured only when the publisher carries a send stamp', async ({ page }) => {
  // Three samples with latencies 100/200/300: p50 is the middle one by definition rather
  // than by whatever a two-element array happens to round to.
  await boot(page, [seqRow(1_100, 1, { sentAt: 1_000 }), seqRow(1_200, 2, { sentAt: 1_000 }), seqRow(1_300, 3, { sentAt: 1_000 })]);
  await audit(page, 'seq');
  await expect(page.getByTestId('audit-nolatency')).toBeVisible();
  await expect(page.getByTestId('audit-latency')).toHaveCount(0);

  await audit(page, 'seq', 'sentAt');
  await expect(page.getByTestId('audit-latency').first()).toContainText('p50 200ms · p95 300ms · max 300ms');
  await expect(page.getByTestId('audit-nolatency')).toHaveCount(0);
});

test('a clock that runs backwards is counted separately instead of polluting the percentiles', async ({ page }) => {
  await boot(page, [seqRow(1_000, 1, { sentAt: 1_500 }), seqRow(2_000, 2, { sentAt: 1_000 })]);
  await audit(page, 'seq', 'sentAt');
  await expect(page.getByTestId('audit-row').first()).toContainText('1 clock-skewed');
  await expect(page.getByTestId('audit-latency').first()).toContainText('p50 1000ms');
});

test('unreadable rows are counted, and the ones inside the span are called out', async ({ page }) => {
  const junk = { ...seqRow(2_000, 0), payload: 'heartbeat', payloadBase64: Buffer.from('heartbeat').toString('base64') };
  await boot(page, [seqRow(1_000, 1), junk, seqRow(3_000, 2)]);
  await audit(page);
  await expect(page.getByTestId('audit-unusable')).toContainText('1 unreadable · 1 inside the span');
});

test('a window with no sequence numbers says there is nothing to audit, and how many it tried', async ({ page }) => {
  await boot(page, [seqRow(1_000, 1), seqRow(2_000, 2)]);
  await audit(page, 'meta.n');
  await expect(page.getByTestId('audit-nothing')).toBeVisible();
  await expect(page.getByTestId('audit-row')).toHaveCount(0);
  // It must also say the rows were not empty, just unreadable at that path -- otherwise a
  // typo in the sequence path and a genuinely silent topic look identical.
  await expect(page.getByTestId('audit-unusable')).toContainText('2 unreadable');
});
