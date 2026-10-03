import { test, expect } from '@playwright/test';

/**
 * The environment bundle is the handoff path: export a bench, or paste one in.
 * What the UI has to get right is that a paste is *checked before it is applied* —
 * an unparseable or foreign bundle must say why and leave the merge disabled, and an
 * id that already exists must be skipped rather than silently overwriting a live rule.
 * The redaction rules themselves (no passwords, no webhook targets) are pure and
 * covered in tests/unit/environment.test.ts.
 */
const boot = async (page: any, seed: Record<string, unknown> = {}) => {
  await page.addInitScript((data: any) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'ops');
    localStorage.setItem('dropqtt_active_broker', JSON.stringify({
      host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_env',
      keepAliveSecs: 60, defaultQos: 1, protocolVersion: 5, cleanSession: true,
    }));
    for (const [key, value] of Object.entries(data.items ?? {})) {
      localStorage.setItem(key, JSON.stringify(value));
    }
    const w = window as any;
    w.calls = [];
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
        w.calls.push({ cmd, args });
        if (cmd === 'plugin:event|listen') {
          const cb = byId.get(args.handler);
          if (cb) handlers.set(args.handler, { event: args.event, cb });
          return args.handler;
        }
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'get_connection_status') {
          return { connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_env' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
        if (cmd === 'get_broker_capabilities')
          return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'get_diagnostics_snapshot') {
          return {
            runtime: { appVersion: '0.9.0', os: 'windows', arch: 'x86_64', generatedAt: Date.now() },
            mqtt: {
              configured: true, connected: false, host: '127.0.0.1', port: 1883, clientId: 'DropQTT_env',
              useTls: false, useWebsocket: false, protocolVersion: 5, subscriptions: 0, incomingActive: 0,
              outgoingActive: 0, feedBuffered: 0, feedBufferCapacity: 500, feedDropped: 0, feedLost: 0,
              confirmTimeouts: 0, rpcPending: 0, rpcTimeouts: 0, subscriptionsRejected: 0,
              unsubscribesRejected: 0, acksUnattributed: 0, publishRejected: 0, topicStatsCount: 0,
              scheduledRuns: 0, benchRuns: 0, historyAvailable: true,
              history: { rows: 0, inbound: 0, outbound: 0, bytes: 0, oldestMs: null, newestMs: null, retentionDays: 0, prunedRows: 0 },
              downloadDir: 'D:/Downloads', downloadDirWritable: true, downloadDirError: null,
            },
            bridge: { totalConnections: 0, connectedConnections: 0, configuredRules: 0, enabledRules: 0, forwarded: 0, errors: 0, dropped: 0 },
            checks: [],
          };
        }
        return null;
      },
    };
  }, { items: seed });
  await page.goto('/');
};

const bundle = (body: Record<string, unknown>) => JSON.stringify({
  kind: 'dropqtt.environment', version: 1, exportedAt: '2026-10-03T20:00:00.000Z', ...body,
});

test.describe('environment bundle', () => {
  test('a paste that is not a bundle is refused and merge stays dead', async ({ page }) => {
    await boot(page);
    await page.getByTestId('env-paste').fill('{"kind":"mqttx.settings"}');
    await page.getByTestId('env-check').click();
    await expect(page.getByTestId('env-error')).toContainText('not a DropQTT environment bundle');
    await expect(page.getByTestId('env-merge')).toBeDisabled();
  });

  test('a version this build cannot read says so instead of half-importing', async ({ page }) => {
    await boot(page);
    await page.getByTestId('env-paste').fill(bundle({ version: 7 }));
    await page.getByTestId('env-check').click();
    await expect(page.getByTestId('env-error')).toContainText('version 7');
  });

  test('existing ids are reported as skipped, not as work to do', async ({ page }) => {
    await boot(page, {
      dropqtt_assertion_rules: [{ id: 'as_1', filter: 'sensors/#', field: 'qos', op: 'ge', expected: '1', enabled: true, label: '', text: 'qos >= 1' }],
    });
    await page.getByTestId('env-paste').fill(bundle({
      assertionRules: [
        { id: 'as_1', filter: 'other/#', field: 'qos', op: 'ge', expected: '2', enabled: true, label: '', text: 'qos >= 2' },
        { id: 'as_2', filter: 'fleet/#', field: 'qos', op: 'ge', expected: '1', enabled: true, label: '', text: 'qos >= 1' },
      ],
    }));
    await page.getByTestId('env-check').click();
    await expect(page.getByTestId('env-summary')).toContainText('would add 1');
    await expect(page.getByTestId('env-summary')).toContainText('1 already present');
    // The live rule is untouched until Merge is pressed.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_assertion_rules') || '[]'))).toHaveLength(1);
  });

  test('a bundle whose rules lost their webhook target says the target must be retyped', async ({ page }) => {
    await boot(page);
    await page.getByTestId('env-paste').fill(bundle({
      silenceRules: [{ id: 's9', name: 'hb', topicFilter: 'devices/+/hb', enabled: true, webhook: { url: '', format: 'json', headers: [] }, webhookRedacted: true }],
    }));
    await page.getByTestId('env-check').click();
    await expect(page.getByTestId('env-summary')).toContainText('webhook target removed');
  });

  test('merge appends and reloads; it never rewrites what is already there', async ({ page }) => {
    await boot(page, {
      dropqtt_fault_rules: [{ id: 'fl_keep', name: 'keep me', filter: 'sensors/#', direction: 'inbound', enabled: true, dropPct: 10, delayMs: 0, duplicatePct: 0, corruptPct: 0, badCorrelationPct: 0 }],
    });
    await page.getByTestId('env-paste').fill(bundle({
      faultRules: [{ id: 'fl_new', name: 'imported', filter: 'devices/#', direction: 'both', enabled: true, dropPct: 25, delayMs: 0, duplicatePct: 0, corruptPct: 0, badCorrelationPct: 0 }],
    }));
    await page.getByTestId('env-check').click();
    await expect(page.getByTestId('env-merge')).toBeEnabled();
    // Merge reloads the window on purpose (that is how the owning hooks re-read),
    // so wait the navigation out instead of fighting it.
    await Promise.all([
      page.waitForLoadState('load'),
      page.getByTestId('env-merge').click(),
    ]);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_fault_rules') || '[]').map((r: any) => r.id).sort());
    expect(stored).toEqual(['fl_keep', 'fl_new']);
  });

  test('the buttons explain what they are waiting for', async ({ page }) => {
    await boot(page);
    expect(await page.getByTestId('env-check').getAttribute('title')).toContain('paste a bundle');
    await page.getByTestId('env-paste').fill(bundle({ responderRules: [] }));
    await page.getByTestId('env-check').click();
    expect(await page.getByTestId('env-merge').getAttribute('title')).toContain('nothing new');
  });
});
