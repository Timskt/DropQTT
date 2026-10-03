import { test, expect } from '@playwright/test';

/**
 * The feed row as a workbench: the moves a row should offer live on the row.
 * These pin the four actions (trace, filter-to-topic, send-as-request, copy as
 * command), that a dead one says why, and that sending a row as a request gives
 * it a fresh correlation instead of reusing the one it arrived with.
 */
const row = (over: Record<string, unknown>) => ({
  id: 'm1',
  topic: 'devices/edge-1/telemetry',
  payload: '{"temp":21}',
  payloadLen: 11,
  payloadBase64: Buffer.from('{"temp":21}', 'utf8').toString('base64'),
  truncated: false,
  qos: 1,
  retain: false,
  timestamp: '10:00:00.000',
  timestampMs: Date.now(),
  direction: 'in',
  ...over,
});

const boot = async (
  page: any,
  opts: { connected?: boolean; rows?: Record<string, unknown>[]; waitId?: string } = {},
) => {
  const rows = opts.rows ?? [
    row({ id: 'm1', correlationData: 'c-7', correlationHex: '632d37', responseTopic: 'devices/edge-1/reply' }),
    row({ id: 'm2', topic: 'archive/log', payload: 'flush', payloadLen: 5, payloadBase64: Buffer.from('flush').toString('base64') }),
  ];
  const waitId = opts.waitId ?? 'trace-m1';
  await page.addInitScript(([ex]) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 18831, useTls: false, clientId: 'DropQTT_wb',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: 5, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    const handlers = new Map<number, { event: string; cb: (e: any) => void }>();
    const byId = new Map<number, (e: any) => void>();
    let nextId = 1;
    w.__fire = (event: string, payload: any) => {
      handlers.forEach((h) => { if (h.event === event) h.cb({ event, payload, id: 0 }); });
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
        if (cmd === 'get_connection_status')
          return { connected: ex.connected, brokerHost: '127.0.0.1', brokerPort: 18831, clientId: 'DropQTT_wb' };
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'bridge_status') return [];
        if (cmd === 'list_transfers' || cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'bridge_outbox_state')
          return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
        if (cmd === 'get_broker_capabilities')
          return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
        if (cmd === 'history_stats') return { rows: 2, inbound: 1, outbound: 1, oldestTs: 1, newestTs: 2, lostRows: 0, retentionDays: 0, prunedRows: 0 };
        if (cmd === 'query_history' || cmd === 'history_series' || cmd === 'history_topics') return [];
        if (cmd === 'history_trace')
          return {
            hits: [{
              id: 'm1', topic: 'devices/edge-1/telemetry', payload: '{"temp":21}',
              payloadBase64: 'eyJ0ZW1wIjoyMX0=', payloadLen: 11,
              qos: 1, retain: false, contentType: null,
              properties: { userProperties: [], correlationData: 'c-7' },
              truncated: false, direction: 'in', ts: 1000, matchedBy: 'correlation',
            }],
            summary: {
              count: 1, topics: ['devices/edge-1/telemetry'], firstMs: 1000, lastMs: 1000,
              inbound: 1, outbound: 0, correlations: ['632d37'], truncated: false,
            },
          };
        if (cmd === 'rpc_request') return { id: 'call-1', state: 'pending' };
        if (cmd === 'get_diagnostics_snapshot') return null;
        return null;
      },
    };
    navigator.clipboard?.writeText?.('');
  }, [{ connected: opts.connected !== false, rows }] as const);
  await page.goto('/');
  await page.evaluate((messages: unknown[]) => {
    (window as any).__fire('mqtt-messages', { messages, dropped: 0 });
  }, rows);
  await expect(page.getByTestId(waitId)).toBeVisible();
};

const calls = (page: any, cmd: string) =>
  page.evaluate((c: string) => (window as any).calls.filter((x: any) => x.cmd === c).map((x: any) => x.args), cmd);

test('a feed row offers its own next moves', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('trace-m1')).toHaveAttribute('title', 'trace c-7: this request and its answer');
  // A row with no correlation traces its topic, and says that is what it does.
  await expect(page.getByTestId('trace-m2')).toHaveAttribute('title', 'trace archive/log: everything on this topic');
  await expect(page.getByTestId('rpc-send-m1')).toBeEnabled();
  await expect(page.getByTestId('copy-cmd-m1')).toBeEnabled();
});

test('a row that was cut short cannot be sent on as a request', async ({ page }) => {
  await boot(page, {
    rows: [row({ id: 'm3', truncated: true, payload: '{"temp":2', payloadLen: 4096 })],
    waitId: 'rpc-send-m3',
  });
  const send = page.getByTestId('rpc-send-m3');
  await expect(send).toBeDisabled();
  await expect(send).toHaveAttribute('title', /not the whole request/);
});

test('only-this-topic narrows the feed to the exact topic', async ({ page }) => {
  await boot(page);
  await expect(page.getByText('devices/edge-1/telemetry')).toBeVisible();
  await page.getByTestId('feed-filter-m2').click();
  await expect(page.getByText('devices/edge-1/telemetry')).toHaveCount(0);
  await expect(page.getByText('archive/log')).toBeVisible();
});

test('tracing from a row lands on the history trace already run', async ({ page }) => {
  await boot(page);
  await page.getByTestId('trace-m1').click();
  await expect(page.getByTestId('trace-token')).toHaveValue('c-7');
  await expect(page.getByTestId('trace-summary')).toContainText('1 hops');
  // The hand-off is consumed, so reloading history does not replay the click.
  const traces = await calls(page, 'history_trace');
  expect(traces).toHaveLength(1);
});

test('sending a row as a request gives it a fresh correlation', async ({ page }) => {
  await boot(page);
  await page.getByTestId('rpc-send-m1').click();
  const sent = await calls(page, 'rpc_request');
  expect(sent).toHaveLength(1);
  const spec = sent[0].spec;
  expect(spec.topic).toBe('devices/edge-1/telemetry');
  expect(spec.payloadBase64).toBe(Buffer.from('{"temp":21}', 'utf8').toString('base64'));
  expect(spec.responseTopic).toBe('devices/edge-1/reply');
  // The row arrived with c-7; reusing it would pair this send with that answer.
  expect(spec.correlationData).not.toBe('c-7');
  expect(spec.correlationData).toMatch(/^dq-/);
});

test('copy as command puts a runnable mosquitto_pub on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  await page.getByTestId('copy-cmd-m1').click();
  const raw = await page.evaluate(() => navigator.clipboard.readText());
  // The command is copied with shell line continuations, and the clipboard turns
  // them into CRLF on Windows; what matters is the one command the shell runs.
  const text = raw.replace(/\\\r?\n/g, ' ').replace(/\s+/g, ' ');
  expect(text).toContain('mosquitto_pub -V mqttv5');
  expect(text).toContain("-h '127.0.0.1'");
  expect(text).toContain("-t 'devices/edge-1/telemetry' -q 1");
  expect(text).toContain("-D publish correlation-data 'c-7'");
  expect(text).toContain("-D publish response-topic 'devices/edge-1/reply'");
});
