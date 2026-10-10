import { test, expect } from '@playwright/test';

/**
 * What one click on Connect costs.
 *
 * The complaint was a keychain prompt that kept coming back, twice per Connect: the
 * console opened its session and then, to fill the latency badge, opened a *second*
 * connection through `test_broker_connection` — and every read of the stored password
 * is one more prompt on macOS. The backend now waits for the CONNACK and returns its
 * handshake time, so these two assertions are the whole contract: one command, no
 * automatic probe, and the number still reaches the badge.
 *
 * The second case is the other half of the same complaint — an account without
 * permission. A refusal has to arrive as a reason on screen, not as a green chip that
 * drops a second later.
 */
const boot = async (page: any, refuse?: string) => {
  await page.addInitScript((reason: string | undefined) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_test',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: 3, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    // Set by the refusal case: the backend's new behavior is to answer a refused
    // CONNACK with an error instead of "task spawned".
    w.connectRefuse = reason;
    const handlers = new Map<number, { event: string; cb: (e: any) => void }>();
    const byId = new Map<number, (e: any) => void>();
    let nextId = 1;
    w.__fire = (event: string, payload: any) => {
      handlers.forEach((h) => {
        if (h.event === event) h.cb({ event, payload, id: 0 });
      });
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (cb: any) => {
        const id = nextId++;
        byId.set(id, cb);
        return id;
      },
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args });
        if (cmd === 'plugin:event|listen') {
          const cb = byId.get(args.handler);
          if (cb) handlers.set(args.handler, { event: args.event, cb });
          return args.handler;
        }
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'connect_broker') {
          if (w.connectRefuse) throw w.connectRefuse;
          return 23;
        }
        if (cmd === 'get_connection_status') {
          // Not connected, so the status bar offers Connect rather than Disconnect.
          return { connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_test' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ids') return {};
        if (cmd === 'get_subscription_ack_state') {
          return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        }
        if (cmd === 'get_broker_capabilities') {
          return { topicAliasMax: 0, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: false, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        }
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'bridge_status'
          || cmd === 'list_transfers' || cmd === 'schedule_list' || cmd === 'bench_progress'
          || cmd === 'rpc_list' || cmd === 'history_recent' || cmd === 'bridge_sync_rules'
          || cmd === 'silence_sync_rules' || cmd === 'silence_list' || cmd === 'silence_stats'
          || cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset'
          || cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset') {
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        }
        if (cmd === 'bridge_outbox_state') {
          return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
        }
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        return null;
      },
    };
  }, refuse);
  await page.goto('/');
};

const count = async (page: any, cmd: string) =>
  (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === cmd).length;

test('one Connect opens one session, not two', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Connect' }).click();

  // The badge is the proof the handshake time came back on the connect itself; waiting
  // for it also settles the sequence, so a probe would have been logged by now.
  await expect(page.getByTitle('Ping')).toHaveText('23ms', { timeout: 10_000 });
  expect(await count(page, 'connect_broker')).toBe(1);
  expect(await count(page, 'test_broker_connection')).toBe(0);
});

test('a refused connect names the reason instead of going green', async ({ page }) => {
  await boot(page, 'the broker refused this connection: not authorized (0x05)');
  await page.getByRole('button', { name: 'Connect' }).click();

  // The banner and the console's own error row both carry it, hence `first()`.
  await expect(page.getByText('not authorized (0x05)').first()).toBeVisible({ timeout: 10_000 });
  // One attempt: the retrying loop is what turned one ACL denial into a disconnect and
  // reconnect per second, so a second session open here would be the flap back again.
  expect(await count(page, 'connect_broker')).toBe(1);
  expect(await count(page, 'test_broker_connection')).toBe(0);
  // And no latency is claimed for a session that never existed.
  await expect(page.getByTitle('Ping')).toHaveText('PING');
});
