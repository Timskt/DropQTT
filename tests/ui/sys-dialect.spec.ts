import { test, expect } from '@playwright/test';

/**
 * The $SYS panel used to guess metrics by substring, which showed the wrong row
 * when two topics contained the same word and nothing at all on a broker with a
 * different tree. It now reads a named layout, and says out loud when it has no
 * verified one — an empty panel with a green header is what made the old version
 * useless on EMQX.
 */
const MOSQUITTO_ROWS = [
  ['$SYS/broker/version', 'mosquitto version 2.0.15'],
  ['$SYS/broker/uptime', '12 seconds'],
  ['$SYS/broker/clients/connected', '2'],
  ['$SYS/broker/messages/received', '104'],
  ['$SYS/broker/messages/sent', '88'],
  ['$SYS/broker/load/messages/received/1min', '0.14'],
  ['$SYS/broker/retained messages/count', '3'],
  ['$SYS/broker/subscriptions/count', '5'],
  ['$SYS/broker/bytes/received', '4096'],
  ['$SYS/broker/bytes/sent', '8192'],
];

const boot = async (page: any, rows: string[][]) => {
  await page.addInitScript((r) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_sys',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: 5, cleanSession: true,
      }),
    );
    const w = window as any;
    w.sysRows = r;
    w.calls = [];
    const byId = new Map<number, (e: any) => void>();
    let nextId = 1;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (cb: any) => {
        const id = nextId++;
        byId.set(id, cb);
        return id;
      },
      invoke: async (cmd: string) => {
        w.calls.push({ cmd });
        if (cmd === 'get_connection_status') {
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_sys' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_broker_capabilities') return null;
        if (cmd === 'get_subscription_ack_state') {
          return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        }
        if (cmd === 'get_broker_sys') {
          return (w.sysRows as string[][]).map(([topic, value]) => ({ topic, value, lastSeen: 0 }));
        }
        if (cmd === 'get_topic_stats') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        return null;
      },
    };
  }, rows);
  await page.goto('/');
};

test('a broker whose layout we read gets its real metrics', async ({ page }) => {
  await boot(page, MOSQUITTO_ROWS);
  const panel = page.locator('div.panel', { has: page.getByText('Broker Monitor ($SYS)') });
  await expect(panel.getByText('Mosquitto').first()).toBeVisible();
  await expect(panel.getByText('104').first()).toBeVisible();
  await expect(panel.getByTestId('sys-no-dialect')).toHaveCount(0);
  // The uptime card is the one a substring guess used to confuse with load rows.
  await expect(panel.getByText('12 seconds')).toBeVisible();
});

test('an unknown layout is announced instead of an empty panel', async ({ page }) => {
  await boot(page, [
    ['$SYS/broker/version', 'emqx 5.0.26'],
    ['$SYS/emqx/sys/uptime', '3600'],
  ]);
  const note = page.getByTestId('sys-no-dialect');
  await expect(note).toBeVisible();
  await expect(note).toContainText('EMQX');
  await expect(note).toContainText('No verified $SYS layout');
});

test('a tree with only one matching topic is not claimed', async ({ page }) => {
  await boot(page, [['$SYS/broker/version', 'mosquitto version 2.0.15']]);
  await expect(page.getByTestId('sys-no-dialect')).toBeVisible();
});
