import { test, expect } from '@playwright/test';

/**
 * Shared subscriptions are the consumer-side scaling story in MQTT5, and the
 * whole point is invisible arithmetic: the broker hands each message to one
 * member of the group. Two things can go wrong in a client UI, so both are
 * pinned here -- composing `$share/<group>/<filter>` correctly on the way out,
 * and showing which group a live subscription belongs to on the way in.
 */
const boot = async (page: any, protocolVersion: number, seedSubs?: unknown[]) => {
  await page.addInitScript(([pv, subs]) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_share',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: pv, cleanSession: true,
      }),
    );
    if (subs) localStorage.setItem('dropqtt_subscriptions', JSON.stringify(subs));
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
        w.calls.push({ cmd, args });
        if (cmd === 'plugin:event|listen') {
          const cb = byId.get(args.handler);
          if (cb) handlers.set(args.handler, { event: args.event, cb });
          return args.handler;
        }
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'get_connection_status') return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_share' };
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return args?.topic ? 0 : {};
        if (cmd === 'get_subscription_ids') return w.subIds ?? {};
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return w.assertions ?? { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'get_broker_capabilities')
          return w.caps ?? { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state')
          return w.ackState ?? { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers' || cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        return null;
      },
    };
  }, [protocolVersion, seedSubs] as const);
  await page.goto('/');
};

const lastCall = async (page: any, cmd: string) =>
  (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === cmd).at(-1);

test('v5 offers a shared group and composes the filter for the broker', async ({ page }) => {
  await boot(page, 5);
  await page.getByPlaceholder(/Topic Pattern/).fill('lab/shared/#');
  await page.getByLabel('Shared subscription').check();
  await page.getByLabel('Shared group').fill('consumers');
  await page.getByRole('button', { name: /Subscribe/ }).first().click();

  const call = await lastCall(page, 'subscribe_topic');
  expect(call?.args?.topic).toBe('$share/consumers/lab/shared/#');
});

test('an empty group name cannot produce a half-built share filter', async ({ page }) => {
  await boot(page, 5);
  await page.getByPlaceholder(/Topic Pattern/).fill('lab/x');
  await page.getByLabel('Shared subscription').check();
  await page.getByRole('button', { name: /Subscribe/ }).first().click();
  expect(await lastCall(page, 'subscribe_topic')).toBeFalsy();
});

test('a live shared subscription says which group it belongs to', async ({ page }) => {
  await boot(page, 5, [
    { topic: '$share/workers/edge/+/telemetry', qos: 1, color: '#10b981', options: { qos: 1, noLocal: false, retainAsPublished: false, retainHandling: 0 } },
  ]);
  await expect(page.getByText('$share/workers/edge/+/telemetry')).toBeVisible();
  await expect(page.getByText('share group workers')).toBeVisible();
});

test('v3.1.1 does not offer a mechanism the protocol does not have', async ({ page }) => {
  await boot(page, 3);
  await expect(page.getByLabel('Shared subscription')).toBeHidden();
  await page.getByPlaceholder(/Topic Pattern/).fill('lab/plain');
  await page.getByRole('button', { name: /Subscribe/ }).first().click();
  const call = await lastCall(page, 'subscribe_topic');
  // v3 has no wire equivalent, so nothing beyond topic+qos may be sent.
  expect(call?.args?.topic).toBe('lab/plain');
  expect(call?.args?.options).toBeUndefined();
});
