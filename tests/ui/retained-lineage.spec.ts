import { test, expect } from '@playwright/test';

/**
 * The retained ledger: what the broker is still handing to new subscribers, and
 * how long ago that was.
 *
 * The three cases this pins are the three ways the view could lie:
 * - rendering "no retained values" when the backend never answered (absence of
 *   evidence presented as evidence of absence),
 * - calling a deletion a stale value, and
 * - burying the zombie at the bottom of a newest-first list.
 */
const boot = async (page: any, retained: unknown, mode: 'ok' | 'empty' | 'down' = 'ok') => {
  await page.addInitScript(
    ([kept, how]) => {
      localStorage.setItem('dropqtt_lang', 'en');
      localStorage.setItem('dropqtt_theme', 'solaris');
      localStorage.setItem('dropqtt_workspace_mode', 'history');
      const now = Date.now();
      const rows = [
        {
          id: 'h1', topic: 'devices/gw1/state', payload: 'online', payloadBase64: 'b25saW5l', payloadLen: 6,
          truncated: false, qos: 1, retain: true, direction: 'in', ts: now - 1000,
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
          if (cmd === 'get_subscription_ack_state')
            return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
          if (cmd === 'history_stats') return { rows: 1, inbound: 1, outbound: 0, oldestTs: now - 60_000, newestTs: now - 1000 };
          if (cmd === 'query_history') return rows;
          if (cmd === 'history_series') return [{ bucket: Math.floor((now - 1000) / args.bucketMs) * args.bucketMs, count: 1 }];
          if (cmd === 'history_topics') return [{ topic: 'devices/gw1/state', count: 1, inbound: 1, outbound: 0, bytes: 6, firstTs: now - 1000, lastTs: now - 1000 }];
          if (cmd === 'history_retained') {
            if (how === 'down') throw new Error('no backend');
            return kept;
          }
          if (cmd === 'bridge_sync_rules' || cmd === 'bridge_status') return [];
          if (cmd === 'bridge_outbox_state')
            return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
          if (cmd === 'schedule_list') return [];
          if (cmd === 'get_topic_stats_cap') return 5000;
          if (cmd === 'plugin:dialog|save') return 'D:/exports/x.json';
          return null;
        },
      };
    },
    [retained, mode] as const,
  );
  await page.goto('/');
};

const lineage = (topic: string, over: Record<string, unknown> = {}) => ({
  topic,
  versions: 1,
  firstTs: Date.now() - 400_000_000,
  lastTs: Date.now() - 400_000_000,
  payload: '{"mode":"auto"}',
  payloadB64: 'eyJtb2RlIjoiYXV0byJ9',
  payloadLen: 15,
  truncated: false,
  cleared: false,
  stale: false,
  ...over,
});

test('the zombie is on top and the ledger says what it cannot see', async ({ page }) => {
  await boot(page, [
    lineage('cfg/fresh/mode', { stale: false, lastTs: Date.now() - 60_000, versions: 3 }),
    lineage('cfg/legacy/mode', { stale: true, lastTs: Date.now() - 30 * 86_400_000, versions: 1 }),
    // A deletion is not stale: the store only ages a value that is still live.
    lineage('cfg/setup/ssid', { cleared: true, stale: false, payload: '', payloadLen: 0, lastTs: Date.now() - 5 * 86_400_000 }),
  ]);
  const card = page.getByTestId('retained-card');
  await expect(card).toBeVisible({ timeout: 20_000 });

  const rows = card.getByTestId('retained-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toHaveAttribute('data-state', 'stale');
  await expect(rows.first().getByText('cfg/legacy/mode')).toBeVisible();
  // A deletion is a terminal state, not an old value.
  await expect(card.getByTestId('retained-row').filter({ hasText: 'cfg/setup/ssid' })).toHaveAttribute('data-state', 'cleared');
  // The bound on the claim is stated even when there is something to show.
  await expect(card.getByTestId('retained-caveat')).toBeVisible();
});

test('a ledger the backend never answered is not reported as an empty broker', async ({ page }) => {
  await boot(page, [], 'down');
  const card = page.getByTestId('retained-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId('retained-unavailable')).toContainText('need the desktop backend');
  await expect(card.getByTestId('retained-empty')).toHaveCount(0);
});

test('an empty ledger still carries its caveat', async ({ page }) => {
  await boot(page, [], 'empty');
  const card = page.getByTestId('retained-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId('retained-empty')).toBeVisible();
  // "Nothing recorded" is a statement about our observation, so the caveat has to
  // stay next to it rather than only appearing when there is a list to qualify.
  await expect(card.getByTestId('retained-caveat')).toBeVisible();
});

test('the stale bar is a question the backend actually gets asked', async ({ page }) => {
  await boot(page, [lineage('cfg/legacy/mode', { stale: true })]);
  const card = page.getByTestId('retained-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  const asked = async () =>
    page.evaluate(() => (window as any).calls.filter((c: any) => c.cmd === 'history_retained').map((c: any) => c.args.staleAfterDays));
  expect(await asked()).toContain(7);
  await card.getByTestId('retained-bar').selectOption('30');
  await expect
    .poll(async () => (await asked()).includes(30), { timeout: 20_000 })
    .toBe(true);
});
