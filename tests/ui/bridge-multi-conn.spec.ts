import { test, expect } from '@playwright/test';

/**
 * More than two bridge connections.
 *
 * The backend has always keyed connections by an arbitrary id; the panel drew two cards
 * and two dropdowns that pushed each other around when one changed, which is what made
 * "one source, one target" look like the product. These pin the things that only show up
 * once a third connection exists: a rule naming the same connection on both sides, a
 * connection that cannot be forgotten while a rule still points at it, and a loop whose
 * hop cap cannot travel the link it closes.
 */
const mqttRule = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', name: 'Plant floor up', sourceConn: 'src', sourceFilter: 'plant/#', sourceQos: 1,
  targetConn: 'dst', targetKind: 'mqtt', topicMode: 'same', enabled: true,
  ...over,
});

const boot = async (
  page: any,
  connections: Record<string, any>[],
  rules: Record<string, any>[],
  remember: Record<string, any> = {},
) => {
  await page.addInitScript(([exConns, exRules, exRemember]) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'bridge');
    localStorage.setItem('dropqtt_bridge_rules', JSON.stringify(exRules));
    localStorage.setItem('dropqtt_bridge_conns', JSON.stringify(exConns));
    localStorage.setItem('dropqtt_bridge_remember', JSON.stringify(exRemember));
    const w = window as any;
    w.calls = [];
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (cb: any) => {
        const id = Math.random();
        w.__cbs = w.__cbs || new Map();
        w.__cbs.set(id, cb);
        return id;
      },
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args });
        if (cmd === 'plugin:event|listen') return 1;
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'get_connection_status')
          return { connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_multi' };
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ids') return {};
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'list_transfers') return [];
        if (cmd === 'get_broker_capabilities')
          return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'bridge_status')
          return exConns.map((c: any) => ({ id: c.id, connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: c.id, error: null }));
        if (cmd === 'bridge_stats') return {};
        if (cmd === 'bridge_outbox_state')
          return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'silence_sync_rules' || cmd === 'silence_state') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        return null;
      },
    };
  }, [connections, rules, remember] as const);
  await page.goto('/');
};

const THREE = [
  { id: 'src', label: '' },
  { id: 'dst', label: '' },
  { id: 'c3', label: 'Plant floor' },
];

const calls = async (page: any, cmd: string) =>
  page.evaluate((c: string) => (window as any).calls.filter((x: any) => x.cmd === c).map((m: any) => m.args), cmd);

test('every connection gets its own card, named by the user', async ({ page }) => {
  await boot(page, THREE, [mqttRule()]);
  await expect(page.getByText('Plant floor up')).toBeVisible();
  // Each card carries both the user's name and the generated id, because the id is what
  // the rules reference — hiding it would make a three-connection panel unreadable.
  for (const id of ['src', 'dst', 'c3']) {
    await expect(page.getByLabel(`Connection name · ${id}`)).toBeVisible();
  }
  await expect(page.getByLabel('Connection name · c3')).toHaveValue('Plant floor');
  await expect(page.getByLabel('Connection name · src')).toHaveValue('');
});

test('adding a connection takes the first free id', async ({ page }) => {
  await boot(page, THREE, []);
  await page.getByRole('button', { name: /Add connection/ }).click();
  await expect(page.getByLabel('Connection name · c1')).toBeVisible();
});

test('a rule may name the same connection on both sides', async ({ page }) => {
  await boot(page, THREE, []);
  await page.getByRole('button', { name: 'Add Rule' }).first().click();
  await page.getByLabel('Rule name (e.g. Sensors to cloud)').fill('Rewrite in place');
  await page.getByLabel(/Topic filters, one per line/).fill('plant/#');
  // `c3` on both sides: the option list has to be the connections that exist rather than
  // the two names the panel used to offer, and choosing one must not push the other side
  // onto its partner the way the old pair did.
  await page.getByLabel('Forwarding Rules · Source').selectOption('c3');
  await page.getByLabel('Forwarding target').selectOption('c3');
  await page.getByRole('button', { name: 'Add Rule' }).last().click();

  const synced = (await calls(page, 'bridge_sync_rules')).at(-1) as any;
  const saved = synced.rules.find((r: any) => r.name === 'Rewrite in place');
  expect(saved).toMatchObject({ sourceConn: 'c3', targetConn: 'c3' });
});

test('a connection a rule still uses cannot be forgotten', async ({ page }) => {
  await boot(page, THREE, [mqttRule({ sourceConn: 'c3' })]);
  const blocked = page.getByTestId('conn-remove-c3');
  await expect(blocked).toBeDisabled();
  await expect(blocked).toHaveAttribute('title', 'Rules still use this connection');

  // An unreferenced one is removable, but only after a second deliberate click — and the
  // arm lapses on its own, so this asserts the armed state immediately rather than after
  // a poll that could outlive the 4-second window it exists to test. The accessible name
  // changes when the action does, which is why the test addresses the button by id.
  const spare = page.getByTestId('conn-remove-src');
  await expect(spare).toHaveAttribute('aria-label', 'Forget this connection');
  await spare.click();
  await expect(spare).toHaveAttribute('aria-label', 'click again to confirm', { timeout: 1500 });
  await spare.click();
  await expect(page.getByLabel('Connection name · src')).toHaveCount(0);
});

test('a loop closing over a 3.1.1 link says the cap cannot travel it', async ({ page }) => {
  const cfg = (host: string, protocolVersion: number) => ({
    host, port: 1883, useTls: false, clientId: 'DropQTT_x', keepAliveSecs: 60, defaultQos: 1,
    baseTopic: 'dropqtt', protocolVersion, cleanSession: true,
  });
  await boot(
    page,
    THREE,
    [mqttRule({ id: 'a', sourceConn: 'src', targetConn: 'dst' }), mqttRule({ id: 'b', name: 'Back', sourceConn: 'dst', targetConn: 'src' })],
    { src: cfg('127.0.0.1', 3), dst: cfg('127.0.0.1', 5) },
  );
  await expect(page.getByText(/form a forwarding loop/)).toBeVisible();

  // Both links carry the marker, so there is nothing to warn about.
  await boot(page, THREE, [mqttRule({ id: 'a' }), mqttRule({ id: 'b', name: 'Back', sourceConn: 'dst', targetConn: 'src' })],
    { src: cfg('127.0.0.1', 5), dst: cfg('127.0.0.1', 5) });
  await expect(page.getByText(/form a forwarding loop/)).toHaveCount(0);
});
