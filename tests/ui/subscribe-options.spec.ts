import { test, expect } from '@playwright/test';

/**
 * MQTT5 subscription options are wire-level, so the UI must only offer them on
 * a v5 connection and must carry them through to the backend registry (which is
 * what replays subscriptions after every CONNACK).
 */
const boot = async (page: any, protocolVersion: number) => {
  await page.addInitScript((pv: number) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_test',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: pv, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args });
        if (cmd === 'get_connection_status') {
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_test' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'test_broker_connection') return 10;
        // Mirror the real contract: these always return collections, never null.
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ids') return w.subIds ?? {};
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return w.assertions ?? { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'get_broker_capabilities')
          return w.caps ?? { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state')
          return w.ackState ?? { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'schedule_list') return [];
        if (cmd === 'rpc_list') return [];
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        return null;
      },
    };
  }, protocolVersion);
  await page.goto('/');
};

test('v5 connection exposes subscription options and sends them to the backend', async ({ page }) => {
  await boot(page, 5);
  await page.getByRole('button', { name: 'v5', exact: true }).click();

  await page.getByLabel('No Local').check();
  await page.getByLabel('Retain Handling').selectOption('2');
  await page.getByPlaceholder(/Topic Pattern/).fill('sensors/lab/#');
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();

  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'subscribe_topic').at(-1),
    )
    .toMatchObject({
      args: {
        topic: 'sensors/lab/#',
        options: { noLocal: true, retainAsPublished: false, retainHandling: 2 },
      },
    });

  // The chip must show what was actually requested, not just the topic.
  await expect(page.getByText('noLocal · retainHandling=2')).toBeVisible();
});

test('v3.1.1 connection hides options it cannot honour', async ({ page }) => {
  await boot(page, 3);
  await expect(page.getByRole('button', { name: 'v5', exact: true })).toHaveCount(0);

  await page.getByPlaceholder(/Topic Pattern/).fill('sensors/legacy/#');
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'subscribe_topic').at(-1),
    )
    .toMatchObject({ args: { topic: 'sensors/legacy/#', options: undefined } });
});
