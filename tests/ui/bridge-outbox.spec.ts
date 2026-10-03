import { test, expect } from '@playwright/test';

/**
 * The webhook outbox: what the bridge panel says when a delivery failed and the
 * payload is still on this machine. These tests pin the three things a queue can
 * get wrong on screen — hiding work that exists, offering a destructive cleanup
 * with one click, and quoting an attempt cap the backend does not use.
 */
const rule = {
  id: 'r-1', name: 'Telemetry to API', sourceConn: 'src', sourceFilter: 'sensors/#', sourceQos: 1,
  targetConn: '', targetKind: 'http', topicMode: 'same', enabled: true,
  webhook: { url: 'http://127.0.0.1:9/missing', format: 'json', headers: [] },
};
const other = { ...rule, id: 'r-2', name: 'Broker to broker', targetKind: 'mqtt', targetConn: 'dst', webhook: undefined };

const emptyCounts = { pending: 0, dead: 0, delivered: 0, retries: 0 };

/** A complete bridge_outbox_state payload with one field changed. */
const state = (over: Record<string, any> = {}) => ({
  counts: emptyCounts,
  error: null,
  preview: [] as [string, string, number, string][],
  maxAttempts: 8,
  ...over,
});

const boot = async (page: any, outbox: Record<string, any> = state(), stats: Record<string, any> = {}) => {
  await page.addInitScript(([exOutbox, exStats, exRules]) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'bridge');
    localStorage.setItem('dropqtt_bridge_rules', JSON.stringify(exRules));
    const w = window as any;
    w.outbox = exOutbox;
    w.stats = exStats;
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
          return { connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_outbox' };
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ids') return {};
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'list_transfers') return [];
        if (cmd === 'get_broker_capabilities')
          return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_diagnostics_snapshot') return null;
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'bridge_status') return [{ id: 'src', connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'src' }];
        if (cmd === 'bridge_stats') return w.stats;
        if (cmd === 'bridge_outbox_state')
          return w.outbox ?? { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
        if (cmd === 'bridge_outbox_flush' || cmd === 'bridge_outbox_drop') return 3;
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'silence_sync_rules' || cmd === 'silence_state') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        return null;
      },
    };
  }, [outbox, stats, [rule, other]] as const);
  await page.goto('/');
};

const callArgs = async (page: any, cmd: string) =>
  page.evaluate((c: string) => {
    const matches = (window as any).calls.filter((x: any) => x.cmd === c);
    return matches.map((m: any) => m.args);
  }, cmd);

test('a queue that has never been used takes no space in the panel', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('outbox-panel')).toHaveCount(0);
  // The command is still polled — the panel cannot know the queue is empty without
  // asking, and a restart must not make owed deliveries look like zero.
  expect((await callArgs(page, 'bridge_outbox_state')).length).toBeGreaterThan(0);
});

test('queued work names the counts it is holding and retries on demand', async ({ page }) => {
  await boot(page, state({
    counts: { pending: 2, dead: 0, delivered: 5, retries: 4 },
    preview: [['r-1', 'sensors/temp', 1, '502 bad gateway']],
  }));
  const panel = page.getByTestId('outbox-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('queued 2');
  await expect(panel).toContainText('recovered 5');
  await expect(panel).toContainText('Telemetry to API · sensors/temp · attempt 1/8 · 502 bad gateway');
  // The preview is evidence, not a payload dump.
  await expect(panel).not.toContainText('webhookUrl');

  await page.getByTestId('outbox-flush').click();
  await expect.poll(async () => (await callArgs(page, 'bridge_outbox_flush')).length).toBeGreaterThan(0);
  expect((await callArgs(page, 'bridge_outbox_flush'))[0]).toEqual({ ruleId: null });
});

test('the retry button for one rule only retries that rule', async ({ page }) => {
  await boot(
    page,
    state({ counts: { pending: 2, dead: 0, delivered: 0, retries: 2 }, preview: [['r-1', 'sensors/temp', 1, 'timeout']] }),
    { 'r-1': { forwarded: 0, errors: 1, dropped: 0, lastTopic: 'sensors/temp', queued: 2, dead: 0 } },
  );
  await expect(page.getByTestId('outbox-queued-r-1')).toHaveText('⧗ 2');
  // The other rule has nothing queued, so it must not grow a dead control.
  await expect(page.getByTestId('outbox-retry-r-2')).toHaveCount(0);
  await page.getByTestId('outbox-retry-r-1').click();
  await expect.poll(async () => (await callArgs(page, 'bridge_outbox_flush')).length).toBeGreaterThan(0);
  expect((await callArgs(page, 'bridge_outbox_flush'))[0]).toEqual({ ruleId: 'r-1' });
});

test('discarding dead letters takes two deliberate clicks', async ({ page }) => {
  await boot(
    page,
    state({ counts: { pending: 0, dead: 1, delivered: 0, retries: 8 }, preview: [['r-1', 'sensors/temp', 8, 'connection refused']] }),
    { 'r-1': { forwarded: 0, errors: 8, dropped: 0, lastTopic: 'sensors/temp', queued: 0, dead: 1 } },
  );
  const drop = page.getByTestId('outbox-drop-dead');
  await expect(drop).toContainText('Drop dead letters');
  await expect(page.getByTestId('outbox-dead-r-1')).toHaveText('✕ 1');
  await drop.click();
  // Arming changes the label; nothing has been thrown away yet.
  await expect(drop).toContainText('Confirm discard');
  expect((await callArgs(page, 'bridge_outbox_drop')).length).toBe(0);
  await drop.click();
  await expect.poll(async () => (await callArgs(page, 'bridge_outbox_drop')).length).toBeGreaterThan(0);
});

test('a queue that could not be opened says retries are off instead of showing a clean zero', async ({ page }) => {
  await boot(page, state({ error: 'outbox schema: disk is unreadable' }));
  const panel = page.getByTestId('outbox-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('outbox-error')).toHaveText('Retries are off: outbox schema: disk is unreadable');
  // No point offering to retry work that cannot even be counted.
  await expect(page.getByTestId('outbox-flush')).toHaveCount(0);
  await expect(page.getByTestId('outbox-drop-dead')).toHaveCount(0);
});

test('the hint quotes the cap the backend actually uses', async ({ page }) => {
  await boot(page, state({ counts: { pending: 1, dead: 0, delivered: 0, retries: 0 }, maxAttempts: 11 }));
  await expect(page.getByTestId('outbox-panel')).toContainText('after 11 attempts');
});
