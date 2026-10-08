import { test, expect } from '@playwright/test';

/**
 * The TLS material inspector in settings. What is pinned here is mostly about silence:
 * TLS switched on with no files chosen must state which trust store it will fall back to,
 * an unknown finding code must still be visible, and a missing backend must say it is
 * missing rather than render an empty panel that reads like a clean bill of health.
 */
const cert = (over: Record<string, unknown> = {}) => ({
  subject: 'CN=broker.test, O=DropQTT',
  issuer: 'CN=DropQTT Test CA, O=DropQTT',
  serial: '12ab',
  signature_algorithm: '1.2.840.113549.1.1.11',
  not_before_secs: 1_791_451_990,
  not_after_secs: 1_814_888_790,
  days_left: 270,
  verdict: 'valid',
  is_ca: false,
  san_dns: ['broker.test', '*.test'],
  san_ip: ['127.0.0.1'],
  hostname_match: true,
  hostname_matched_by: 'broker.test',
  cn_would_match_but_san_rules: false,
  ...over,
});

const MATERIAL = {
  tlsCaPath: 'C:/tls/ca.pem',
  tlsClientCertPath: 'C:/tls/client.pem',
  tlsClientKeyPath: 'C:/tls/client.key',
};

const boot = async (page: any, reply: any, material: boolean = true) => {
  await page.addInitScript(
    ([exReply, exMaterial]) => {
      localStorage.setItem('dropqtt_lang', 'en');
      localStorage.setItem('dropqtt_theme', 'solaris');
      localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
      localStorage.setItem(
        'dropqtt_active_broker',
        JSON.stringify({
          host: 'broker.test', port: 8883, useTls: true, clientId: 'DropQTT_tls',
          keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
          protocolVersion: 5, cleanSession: true,
          ...(exMaterial ? exMaterial : {}),
        }),
      );
      const w = window as any;
      w.tlsReply = exReply;
      const handlers = new Map<number, { event: string; cb: (e: any) => void }>();
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
        invoke: async (cmd: string, args: any = {}) => {
          if (cmd === 'plugin:event|listen') {
            const cb = byId.get(args.handler);
            if (cb) handlers.set(args.handler, { event: args.event, cb });
            return args.handler;
          }
          if (cmd === 'plugin:event|unlisten') return null;
          if (cmd === 'inspect_tls_material') return w.tlsReply;
          if (cmd === 'get_connection_status')
            return { connected: false, brokerHost: 'broker.test', brokerPort: 8883, clientId: 'DropQTT_tls' };
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
          if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
          if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
          if (cmd === 'bridge_outbox_state')
            return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
          if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
          if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
          return null;
        },
      };
    },
    [reply, material ? MATERIAL : null] as const,
  );
  await page.goto('/');
  await page.getByRole('button', { name: /Settings/ }).first().click();
};

const inspect = async (page: any) => {
  await page.getByTestId('tls-inspect').click();
};

test('TLS on with no files chosen says which trust store gets used', async ({ page }) => {
  await boot(page, [], null);
  await expect(page.getByTestId('tls-material')).toBeVisible();
  await expect(page.getByTestId('tls-no-material')).toContainText('system trust store');
});

test('inspection renders verdicts, roles and problems as sentences', async ({ page }) => {
  await boot(page, [
    {
      path: 'C:/tls/ca.pem',
      readable: true,
      certs: [cert({ is_ca: true, subject: 'CN=DropQTT Test CA', verdict: 'expiring_soon', days_left: 12 })],
      problems: [],
    },
    {
      path: 'C:/tls/client.pem',
      readable: true,
      certs: [],
      problems: ['caSlotHoldsLeaf', 'cnOnlyMatch'],
    },
  ]);
  await inspect(page);

  const slots = page.getByTestId('tls-slot');
  await expect(slots).toHaveCount(2);
  await expect(slots.first()).toContainText('CA');
  await expect(slots.first()).toContainText('expires in 12 days');
  await expect(slots.first()).toContainText('broker.test, *.test, 127.0.0.1');
  await expect(slots.nth(1)).toContainText('the CA slot holds a leaf certificate');
  await expect(slots.nth(1)).toContainText('clients ignore CN once SANs exist');
});

test('a finding the frontend does not know still shows up', async ({ page }) => {
  await boot(page, [{ path: '/x/ca.pem', readable: true, certs: [], problems: ['brandNewFinding'] }]);
  await inspect(page);
  // Better a raw code on screen than a problem rendered as nothing at all.
  await expect(page.getByTestId('tls-problem')).toContainText('brandNewFinding');
});

test('without the backend it admits it checked nothing', async ({ page }) => {
  await boot(page, null);
  await inspect(page);
  await expect(page.getByTestId('tls-unavailable')).toContainText('desktop backend');
  await expect(page.getByTestId('tls-slot')).toHaveCount(0);
});

test('an expired certificate is stated as expired, not merely coloured', async ({ page }) => {
  await boot(page, [
    { path: '/x/leaf.pem', readable: true, certs: [cert({ verdict: 'expired', days_left: -3 })], problems: ['expired'] },
  ]);
  await inspect(page);
  await expect(page.getByTestId('tls-cert')).toContainText('expired 3 days ago');
});
