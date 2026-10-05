import { test, expect } from '@playwright/test';

/**
 * The message trace: one token, every topic and both directions, oldest first.
 * What these pin is the distinction the view exists to make — a correlation match
 * is the same message, a topic or payload match merely mentions it — and the
 * claims the panel must not make silently: a truncated list, several requests
 * under one token, and an empty window.
 */
const hit = (id: string, topic: string, direction: string, ts: number, matchedBy: string, payload = '{"v":1}') => ({
  id,
  topic,
  payload,
  payloadBase64: Buffer.from(payload, 'utf8').toString('base64'),
  payloadLen: payload.length,
  qos: 1,
  retain: false,
  contentType: null,
  properties: { userProperties: [], responseTopic: null, correlationData: matchedBy === 'correlation' ? 'c-7' : null },
  truncated: false,
  direction,
  ts,
  matchedBy,
});

const emptyResult = {
  hits: [],
  summary: { count: 0, topics: [], firstMs: null, lastMs: null, inbound: 0, outbound: 0, correlations: [], truncated: false },
};

const boot = async (page: any, trace: Record<string, any> = emptyResult) => {
  await page.addInitScript(([exTrace]) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'history');
    const w = window as any;
    w.trace = exTrace;
    w.calls = [];
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (cb: any) => {
        const id = Math.random();
        (w as any).__cbs = (w as any).__cbs || new Map();
        (w as any).__cbs.set(id, cb);
        return id;
      },
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args });
        if (cmd === 'plugin:event|listen') return 1;
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'get_connection_status')
          return { connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_trace' };
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
          return { rows: 2, inbound: 1, outbound: 1, oldestTs: 1_000, newestTs: 2_500, lostRows: 0, retentionDays: 0, prunedRows: 0 };
        if (cmd === 'query_history') return [];
        if (cmd === 'history_series' || cmd === 'history_topics') return [];
        if (cmd === 'history_trace') return w.trace;
        return null;
      },
    };
  }, [trace] as const);
  await page.goto('/');
};

const runTrace = async (page: any, token: string) => {
  await page.getByTestId('trace-token').fill(token);
  await page.getByTestId('trace-run').click();
};

const story = {
  hits: [
    hit('h1', 'lab/rpc/request', 'out', 1_000, 'correlation'),
    hit('h2', 'devices/edge-7/state', 'in', 1_800, 'topic', '{"temp":21}'),
    hit('h3', 'lab/rpc/reply', 'in', 2_500, 'correlation', '{"pong":true}'),
  ],
  summary: {
    count: 3, topics: ['lab/rpc/request', 'devices/edge-7/state', 'lab/rpc/reply'],
    firstMs: 1_000, lastMs: 2_500, inbound: 2, outbound: 1, correlations: ['632d37'], truncated: false,
  },
};

test('a trace lists one token life oldest first and says how each hop joined', async ({ page }) => {
  await boot(page, story);
  await runTrace(page, 'c-7');
  const result = page.getByTestId('trace-result');
  await expect(result).toBeVisible();
  await expect(page.getByTestId('trace-summary')).toHaveText('3 hops · 3 topics · 2 in / 1 out · 1s end to end');
  // Reading order is the point: a request that appears after its reply is a bug.
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="trace-hop-"]')).map((e) => e.getAttribute('data-testid')),
  );
  expect(order).toEqual(['trace-hop-h1', 'trace-hop-h2', 'trace-hop-h3']);
  await expect(page.getByTestId('trace-hop-h1')).toContainText('same message');
  await expect(page.getByTestId('trace-hop-h2')).toContainText('topic match');
  // Several claims, one honest summary line about the difference.
  await expect(page.getByTestId('trace-result')).toContainText('Bridge forwards and webhook deliveries are not in this timeline');
  // One correlation key is one conversation, so no warning.
  await expect(page.getByTestId('trace-multi')).toHaveCount(0);
});

test('a token covering several requests says so instead of blending them', async ({ page }) => {
  await boot(page, {
    ...story,
    summary: { ...story.summary, correlations: ['632d37', '632d38', '632d39'] },
  });
  await runTrace(page, 'c-7');
  await expect(page.getByTestId('trace-multi')).toHaveText('3 different correlation keys — this token covers several requests, not one conversation');
});

test('a trace that stopped short says it stopped', async ({ page }) => {
  await boot(page, { ...story, summary: { ...story.summary, truncated: true } });
  await runTrace(page, 'c-7');
  await expect(page.getByTestId('trace-truncated')).toHaveText('showing the first 500 hops; more were found');
});

test('an empty window is reported as empty, not as a broken tool', async ({ page }) => {
  await boot(page, emptyResult);
  await runTrace(page, 'no-such-device');
  await expect(page.getByTestId('trace-empty')).toHaveText('nothing recorded in this window mentions that token');
  // Nothing to export when there is nothing to read.
  await expect(page.getByTestId('trace-export')).toHaveCount(0);
});

test('the trace button says what it is waiting for', async ({ page }) => {
  await boot(page);
  const run = page.getByTestId('trace-run');
  await expect(run).toBeDisabled();
  await expect(run).toHaveAttribute('title', 'type a deviceId or correlation value to follow');
  await page.getByTestId('trace-token').fill('edge-7');
  await expect(run).toBeEnabled();
  await expect(run).toHaveAttribute('title', /oldest first/);
});

test('a hop opens its payload, and the export is offered only over real hops', async ({ page }) => {
  await boot(page, story);
  await runTrace(page, 'c-7');
  await expect(page.getByTestId('trace-export')).toBeVisible();
  // The shareable form says what it removes, because that is the whole reason to
  // hand a trace to somebody else.
  await expect(page.getByTestId('trace-export-html')).toHaveAttribute(
    'title',
    /broker address scrubbed/,
  );
  // The viewer's format switch only exists once the hop is opened.
  await expect(page.getByRole('button', { name: 'BASE64', exact: true })).toHaveCount(0);
  await page.getByTestId('trace-hop-h3').getByRole('button').click();
  await expect(page.getByRole('button', { name: 'BASE64', exact: true })).toBeVisible();
});

test('an empty trace offers nothing to share', async ({ page }) => {
  await boot(page, emptyResult);
  await runTrace(page, 'ghost-device');
  await expect(page.getByTestId('trace-export-html')).toHaveCount(0);
});
