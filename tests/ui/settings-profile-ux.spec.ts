import { test, expect } from '@playwright/test';

/**
 * Two things the settings dialog got wrong for the owner.
 *
 * One: it read the stored broker password as soon as it opened, to answer "is this
 * reference still in the keychain". On macOS that read *is* an authorization prompt, so
 * opening settings to look at a port number interrupted for the login keychain password.
 * The check is now a button, and the assertion is that nothing reads the secret unless
 * asked.
 *
 * Two: there was no way to change a saved profile. The chip row offered "load" and
 * "delete"; the only save control appended, so fixing a typo in a saved broker left the
 * stale entry on the list. `secret_status` still runs on open — it probes a key that is
 * never written, which answers "is there a store" without touching anyone's password.
 */
const PROFILES = [
  { id: 'p-emqx', name: 'EMQX Public', config: { host: 'broker.emqx.io', port: 1883, useTls: false, clientId: 'DropQTT_a', keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: 4, cleanSession: true } },
  { id: 'p-prod', name: 'Production', config: { host: 'iot.example.com', port: 31883, useTls: false, clientId: 'DropQTT_b', keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: 5, cleanSession: true, secretRef: 'a1b2c3' } },
];

const boot = async (page: any) => {
  await page.addInitScript((exProfiles: unknown) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem('dropqtt_broker_profiles', JSON.stringify(exProfiles));
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: 'iot.example.com', port: 31883, useTls: false, clientId: 'DropQTT_b',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: 5, cleanSession: true, secretRef: 'a1b2c3',
      }),
    );
    const w = window as any;
    w.calls = [];
    const handlers = new Map<number, { event: string; cb: (e: any) => void }>();
    const byId = new Map<number, (e: any) => void>();
    let nextId = 1;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (cb: any) => { const id = nextId++; byId.set(id, cb); return id; },
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push(cmd);
        if (cmd === 'plugin:event|listen') {
          const cb = byId.get(args.handler);
          if (cb) handlers.set(args.handler, { event: args.event, cb });
          return args.handler;
        }
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'secret_status') return { available: true, supported: true };
        if (cmd === 'secret_exists') return true;
        if (cmd === 'get_connection_status')
          return { connected: false, brokerHost: 'iot.example.com', brokerPort: 31883, clientId: 'DropQTT_b' };
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ids') return {};
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
        if (cmd === 'get_broker_capabilities')
          return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'bridge_outbox_state')
          return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        return null;
      },
    };
  }, PROFILES);
  await page.goto('/');
  await page.getByRole('button', { name: /Settings/ }).first().click();
};

const calls = (page: any, cmd: string) =>
  page.evaluate((c: string) => (window as any).calls.filter((x: string) => x === c).length, cmd);

test('opening settings does not read the stored password', async ({ page }) => {
  await boot(page);
  // The dialog is open, the reference is shown as kept in the keychain, and the store
  // was never asked for the value — that ask is what produced the prompt.
  await expect(page.getByLabel('Password (Optional)')).toHaveAttribute('placeholder', /Stored in the keyring/i);
  expect(await calls(page, 'secret_exists')).toBe(0);
  expect(await calls(page, 'secret_status')).toBeGreaterThan(0);

  // Asked for explicitly, it still answers: the stale-reference check is worth a click.
  await page.getByRole('button', { name: /Ask the keychain whether this password is still stored/ }).click();
  await expect.poll(() => calls(page, 'secret_exists')).toBe(1);
});

test('a saved profile can be changed without leaving a copy behind', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Edit Production' }).click();
  await expect(page.getByText('Editing profile · Production')).toBeVisible();

  await page.getByLabel('Broker Host / IP').fill('iot2.example.com');
  await page.getByRole('button', { name: 'Update Profile' }).click();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_broker_profiles') || '[]'));
  expect(stored).toHaveLength(2);
  expect(stored.find((p: any) => p.id === 'p-prod').config.host).toBe('iot2.example.com');
  // The untouched one is untouched.
  expect(stored.find((p: any) => p.id === 'p-emqx').config.port).toBe(1883);
});

test('a public preset is a starting point, never an overwrite', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Edit Production' }).click();
  await page.getByRole('button', { name: 'HiveMQ Public' }).click();
  // Loading a shared broker means the next save is a new entry, so the button has to
  // stop saying "Update".
  await expect(page.getByRole('button', { name: 'Save as Preset Profile' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update Profile' })).toHaveCount(0);
});
