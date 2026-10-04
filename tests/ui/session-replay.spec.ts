import { test, expect } from '@playwright/test';
import { parseCapture } from '../../src/utils/capture';

/**
 * Session replay: a captured .dqrec published back through the console's own path.
 * These pin the three things that would otherwise be silent lies — that a replay
 * starts without a connection, that a v3 session quietly sends v5 fields it cannot
 * carry, and that one rejected message aborts the rest of the recording.
 */
const header = {
  kind: 'header',
  format: 'dropqtt-capture/1',
  createdAt: '2026-10-04T00:00:00.000Z',
  count: 3,
  spanMs: 200,
  inbound: 2,
  outbound: 1,
  topics: ['devices/a/telemetry', 'devices/a/cmd'],
};

const evIn = (t: number, payload: string, over: Record<string, unknown> = {}) => ({
  t,
  ts: 1_000 + t,
  topic: 'devices/a/telemetry',
  payloadBase64: Buffer.from(payload, 'utf8').toString('base64'),
  payloadLen: payload.length,
  qos: 1,
  retain: false,
  direction: 'in',
  ...over,
});

const EVENTS = [
  evIn(0, '{"r":1}'),
  evIn(100, '{"r":2}', {
    retain: true,
    qos: 2,
    props: { contentType: 'application/json', responseTopic: 'devices/a/reply', correlationData: 'c-1', userProperties: [['trace', 'x']] },
  }),
  {
    t: 200,
    ts: 1_200,
    topic: 'devices/a/cmd',
    payloadBase64: Buffer.from('{"open":true}', 'utf8').toString('base64'),
    payloadLen: 12,
    qos: 0,
    retain: false,
    direction: 'out',
  },
];

const FILE_TEXT = [header, ...EVENTS].map((o) => JSON.stringify(o)).join('\n') + '\n';

const boot = async (page: any, opts: { connected?: boolean; protocol?: number; text?: string | null; failAt?: number; mode?: string; rows?: any[] } = {}) => {
  const { connected = true, protocol = 5, text = FILE_TEXT, failAt = -1, mode = 'mqttx', rows = [] } = opts;
  await page.addInitScript(
    ([exConnected, exProtocol, exText, exFailAt, exMode, exRows]) => {
      localStorage.setItem('dropqtt_lang', 'en');
      localStorage.setItem('dropqtt_theme', 'solaris');
      localStorage.setItem('dropqtt_workspace_mode', exMode);
      localStorage.setItem(
        'dropqtt_active_broker',
        JSON.stringify({
          host: '127.0.0.1', port: 18831, useTls: false, useWebsocket: false, clientId: 'DropQTT_replay',
          keepAliveSecs: 30, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: exProtocol, cleanSession: true,
        }),
      );
      const w = window as any;
      w.published = [];
      w.failAt = exFailAt;
      w.text = exText;
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
          if (cmd === 'plugin:event|listen') return 1;
          if (cmd === 'plugin:event|unlisten') return null;
          if (cmd === 'plugin:dialog|open') return 'C:/captures/site-a.dqrec';
          if (cmd === 'plugin:dialog|save') return 'C:/captures/exported.dqrec';
          if (cmd === 'plugin:fs|write_text_file') {
            // plugin-fs hands the body over as bytes; rebuild the text whatever
            // shape the argument arrives in, so the test reads the file itself.
            const a: any = args || {};
            const raw = a.contents ?? a;
            const bytes: number[] = typeof raw === 'string' ? Array.from(raw).map((c) => c.charCodeAt(0)) : Object.values(raw);
            w.written = { path: a.path ?? null, keys: Object.keys(a).slice(0, 6).join(','), text: String.fromCharCode(...bytes) };
            return null;
          }
          if (cmd === 'read_capture_file') {
            if (typeof w.text !== 'string') throw new Error('the file is empty');
            return w.text;
          }
          if (cmd === 'publish_console') {
            // Counted by attempt, not by what landed: a rejected publish must not make
            // every later one look rejected too.
            w.attempt = (w.attempt ?? 0) + 1;
            if (w.failAt === w.attempt - 1) throw new Error('topic is not authorized');
            w.published.push(args.params);
            return null;
          }
          if (cmd === 'get_connection_status')
            return { connected: exConnected, brokerHost: '127.0.0.1', brokerPort: 18831, clientId: 'DropQTT_replay' };
          if (cmd === 'get_default_download_dir') return 'D:/Downloads';
          if (cmd === 'get_topic_stats_cap') return 5000;
          if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'list_transfers') return [];
          if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
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
            return { rows: exRows.length, inbound: exRows.length, outbound: 0, oldestTs: 1_000, newestTs: 1_200 };
          if (cmd === 'query_history') return exRows;
          if (cmd === 'history_series' || cmd === 'history_topics') return [];
          if (cmd === 'history_trace')
            return { hits: [], summary: { count: 0, topics: [], firstMs: null, lastMs: null, inbound: 0, outbound: 0, correlations: [], truncated: false } };
          if (cmd === 'history_timeline')
            return { entities: [], windowStartMs: 0, windowEndMs: 0, gapMs: 30_000, depth: 2, entitiesDropped: 0, rowsScanned: 0, truncated: false };
          return null;
        },
      };
    },
    [connected, protocol, text, failAt, mode, rows] as const,
);
  await page.goto('/');
};

const published = (page: any) => page.evaluate(() => (window as any).published);

const load = async (page: any) => {
  await page.getByTestId('replay-load').click();
  await expect(page.getByTestId('replay-summary')).toBeVisible();
};

test('no capture, no claims: the panel says where a recording comes from', async ({ page }) => {
  await boot(page, { text: null });
  await expect(page.getByTestId('replay-panel')).toBeVisible();
  await expect(page.getByTestId('replay-empty')).toContainText('.dqrec');
  expect(await published(page)).toHaveLength(0);
});

test('loading names the file and counts it the way the header does', async ({ page }) => {
  await boot(page);
  await load(page);
  const line = page.getByTestId('replay-summary');
  await expect(line).toContainText('site-a.dqrec');
  await expect(line).toContainText('3 events · 0.2s span · 2 topics · 2 in / 1 out');
});

test('the default queue is the inbound traffic, because that is the device', async ({ page }) => {
  await boot(page);
  await load(page);
  await expect(page.getByTestId('replay-start')).toContainText('Replay 2');
  await page.getByTestId('replay-start').click();
  await expect.poll(async () => (await published(page)).length).toBe(2);
  const sent = await published(page);
  expect(sent[0]).toMatchObject({ topic: 'devices/a/telemetry', qos: 1, retain: false });
  expect(sent[1]).toMatchObject({
    topic: 'devices/a/telemetry',
    qos: 2,
    retain: true,
    properties: { responseTopic: 'devices/a/reply', correlationData: 'c-1', contentType: 'application/json' },
  });
  expect(sent[1].payloadBase64).toBe(Buffer.from('{"r":2}', 'utf8').toString('base64'));
});

test('everything-as-recorded includes the outbound row too', async ({ page }) => {
  await boot(page);
  await load(page);
  await page.getByTestId('replay-which').selectOption('both');
  await expect(page.getByTestId('replay-start')).toContainText('Replay 3');
  await page.getByTestId('replay-start').click();
  await expect.poll(async () => (await published(page)).length).toBe(3);
  expect((await published(page))[2].topic).toBe('devices/a/cmd');
});

test('a v3 session says which fields it cannot carry, and does not send them', async ({ page }) => {
  await boot(page, { protocol: 3 });
  await load(page);
  await expect(page.getByTestId('replay-v3-note')).toBeVisible();
  await page.getByTestId('replay-start').click();
  await expect.poll(async () => (await published(page)).length).toBe(2);
  const second = (await published(page))[1];
  expect(second.properties.responseTopic).toBeFalsy();
  expect(second.properties.correlationData).toBeFalsy();
  expect(second.properties.userProperties).toEqual([]);
  // The payload still goes: dropping fields is the session's limit, not a reason to stall.
  expect(second.topic).toBe('devices/a/telemetry');
});

test('a rejected message is counted and the rest of the recording still runs', async ({ page }) => {
  await boot(page, { failAt: 0 });
  await load(page);
  await page.getByTestId('replay-start').click();
  await expect(page.getByTestId('replay-result')).toContainText('1/2 sent, 1 failed');
  expect(await published(page)).toHaveLength(1);
  await expect(page.getByTestId('replay-error')).toContainText('topic is not authorized');
});

test('replay refuses to start with no connection, and says why on the button', async ({ page }) => {
  await boot(page, { connected: false });
  await load(page);
  const start = page.getByTestId('replay-start');
  await expect(start).toBeDisabled();
  await expect(start).toHaveAttribute('title', /Connect to a broker/);
  expect(await published(page)).toHaveLength(0);
});

test('a file that is not a capture is refused with the reason, not a spinner', async ({ page }) => {
  await boot(page, { text: '{"kind":"header","format":"dropqtt-capture/2"}\n{}\n' });
  await page.getByTestId('replay-load').click();
  await expect(page.getByTestId('replay-error')).toContainText('another format');
  await expect(page.getByTestId('replay-summary')).toHaveCount(0);
});

test('what History exports, Replay reads back — the round trip is the feature', async ({ page }) => {
  const rows = [
    {
      id: 'r1', topic: 'devices/a/telemetry', payload: '{"r":1}',
      payloadBase64: Buffer.from('{"r":1}', 'utf8').toString('base64'), payloadLen: 7,
      qos: 1, retain: false, properties: { userProperties: [] }, truncated: false,
      direction: 'in', ts: 1_200,
    },
    {
      id: 'r2', topic: 'devices/a/cmd', payload: '{"open":true}',
      payloadBase64: Buffer.from('{"open":true}', 'utf8').toString('base64'), payloadLen: 12,
      qos: 0, retain: false,
      properties: { userProperties: [['trace', 'x']], responseTopic: 'devices/a/reply', correlationData: 'c-1' },
      truncated: false, direction: 'out', ts: 1_000,
    },
  ];
  await boot(page, { mode: 'history', rows });
  await page.getByTestId('history-capture').click();
  // plugin-fs hands the body over as a byte array, which is what the mock decodes;
  // the path is not observable through it, so the content is what gets pinned here.
  const written = await page.evaluate(() => (window as any).written ?? { text: '' });
  expect(written.text.length).toBeGreaterThan(0);

  // Read it back with the same parser the replay screen uses.
  const parsed = parseCapture(written.text);
  expect(parsed.header.count).toBe(2);
  expect(parsed.header.topics).toEqual(['devices/a/cmd', 'devices/a/telemetry']);
  expect(parsed.events.map((e) => e.t)).toEqual([0, 200], 'oldest first, offsets from it');
  expect(parsed.events[0].props?.responseTopic).toBe('devices/a/reply');
  expect(parsed.events[0].props?.userProperties).toEqual([['trace', 'x']]);
  // The claim the format makes: no address, no credentials, whatever the rows held.
  expect(written.text).not.toContain('127.0.0.1');
  expect(written.text).not.toMatch(/"broker"/);
});
