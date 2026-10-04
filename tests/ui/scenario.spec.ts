import { test, expect } from '@playwright/test';

/**
 * The acceptance scenario: one file that composes the rig and ends in a verdict.
 * These pin the three ways this feature could quietly lie — a verdict that reads a
 * missing bar as a pass, an apply that claims to have installed parts it cannot,
 * and an export that carries an alert endpoint into a shared file.
 */
const SCENARIO = {
  kind: 'scenario',
  format: 'dropqtt-scenario/1',
  name: 'Nightly fleet gate',
  createdAt: '2026-10-04T00:00:00.000Z',
  subscriptions: [
    { topic: 'devices/#', qos: 1, options: { qos: 1, noLocal: false, retainAsPublished: false, retainHandling: 0 } },
  ],
  responders: [
    { id: 'r1', name: 'echo', trigger: 'lab/rpc/#', replyTopic: 'lab/reply', replyPayload: '{}', qos: 1, retain: false, delayMs: 0, maxPerSec: 0, enabled: true },
  ],
  assertions: [
    { id: 'a1', filter: 'devices/#', field: 'json', op: 'lt', expected: '80', enabled: true, label: 'temp under 80' },
  ],
  silence: [{ id: 's1', name: 'gateway quiet', topicFilter: 'devices/gw-7/#', timeoutSec: 45, cooldownSec: 120, enabled: true }],
  bench: { topics: ['devices/gw-7/telemetry'], rate: 50, size: 64, qos: 1, retain: false, durationSec: 20, mirror: true, expect: { minRate: 40, maxP99Ms: 250, maxLost: 2 } },
};

const boot = async (
  page: any,
  opts: { protocol?: number; assertionStats?: Record<string, number>; rejected?: unknown[] } = {},
) => {
  const { protocol = 5, assertionStats = { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rejected = [] } = opts;
  await page.addInitScript(
    ([exProtocol, exStats, exRejected]) => {
      localStorage.setItem('dropqtt_lang', 'en');
      localStorage.setItem('dropqtt_theme', 'solaris');
      localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
      localStorage.setItem(
        'dropqtt_active_broker',
        JSON.stringify({
          host: '127.0.0.1', port: 18831, useTls: false, clientId: 'DropQTT_scn',
          keepAliveSecs: 30, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: exProtocol, cleanSession: true,
        }),
      );
      localStorage.setItem('dropqtt_subscriptions', JSON.stringify([]));
      const w = window as any;
      w.calls = [];
      w.stats = exStats;
      w.written = { text: '' };
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      const record = (cmd: string, args: any) => {
        w.calls.push({ cmd, args });
      };
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: (cb: any) => {
          const id = Math.random();
          (w as any).__cbs = (w as any).__cbs || new Map();
          (w as any).__cbs.set(id, cb);
          return id;
        },
        invoke: async (cmd: string, args: any = {}) => {
          record(cmd, args);
          if (cmd === 'plugin:event|listen') return 1;
          if (cmd === 'plugin:event|unlisten') return null;
          if (cmd === 'plugin:dialog|save') return 'C:/scenarios/nightly.dqscn';
          if (cmd === 'plugin:fs|write_text_file') {
            const raw = args?.contents ?? args;
            const bytes: number[] = typeof raw === 'string' ? Array.from(raw).map((c) => c.charCodeAt(0)) : Object.values(raw);
            w.written = { text: String.fromCharCode(...bytes) };
            return null;
          }
          if (cmd === 'get_connection_status')
            return { connected: true, brokerHost: '127.0.0.1', brokerPort: 18831, clientId: 'DropQTT_scn' };
          if (cmd === 'get_default_download_dir') return 'D:/Downloads';
          if (cmd === 'get_topic_stats_cap') return 5000;
          if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'list_transfers') return [];
          if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
          if (cmd === 'get_subscription_ack_state') return { rejected: exRejected, refusedUnsubscribes: [], capped: [], unattributed: 0 };
          if (cmd === 'bridge_status' || cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
          if (cmd === 'bridge_outbox_state')
            return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
          if (cmd === 'assertions_sync_rules')
            return { stats: { ...w.stats, recent: [] }, rules: (args.rules || []).length, recent: [] };
          if (cmd === 'assertions_state') return { stats: { ...w.stats, recent: [] }, rules: [], recent: [] };
          if (cmd === 'assertions_reset') return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
          if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
          if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
          if (cmd === 'get_broker_capabilities')
            return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
          if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
          return null;
        },
      };
    },
    [protocol, assertionStats, rejected] as const,
  );
  await page.goto('/');
};

const callsFor = (page: any, cmd: string) =>
  page.evaluate((name: string) => ((window as any).calls || []).filter((c: any) => c.cmd === name), cmd);

const pasteAndParse = async (page: any, doc: unknown) => {
  await page.getByTestId('scenario-paste').fill(typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));
  await page.getByTestId('scenario-parse').click();
};

test('the panel states what the current rig holds before anything is exported', async ({ page }) => {
  await boot(page);
  const panel = page.getByTestId('scenario-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Now: 0 subs · 0 responders · 0 assertions · 0 watchdogs');
});

test('export captures the rig and carries no alert endpoint', async ({ page }) => {
  await boot(page);
  await page.evaluate(() =>
    localStorage.setItem(
      'dropqtt_silence_rules',
      JSON.stringify([
        { id: 's9', name: 'quiet', topicFilter: 'devices/x/#', timeoutSec: 30, cooldownSec: 60, enabled: true, webhook: { url: 'https://ops.example.com/h?token=abc', format: 'json', headers: [['Authorization', 'Bearer abc']] } },
      ]),
    ),
  );
  await page.reload();
  await page.getByTestId('scenario-name').fill('Gate A');
  await page.getByTestId('scenario-export').click();
  const written = await page.evaluate(() => (window as any).written.text);
  expect(written).toContain('dropqtt-scenario/1');
  expect(written).toContain('devices/x/#');
  expect(written).not.toContain('ops.example.com');
  expect(written).not.toContain('Bearer');
  expect(written).not.toContain('token=abc');
});

test('a pasted scenario is read back with its own counts', async ({ page }) => {
  await boot(page);
  await pasteAndParse(page, SCENARIO);
  await expect(page.getByTestId('scenario-loaded')).toContainText('Nightly fleet gate');
  await expect(page.getByTestId('scenario-loaded')).toContainText('1 subscriptions · 1 responders · 1 assertions · 1 watchdogs');
});

test('a file that is not a scenario is refused with the reason', async ({ page }) => {
  await boot(page);
  await pasteAndParse(page, '{not json');
  await expect(page.getByTestId('scenario-error')).toContainText('not valid JSON');
  await expect(page.getByTestId('scenario-loaded')).toHaveCount(0);

  await pasteAndParse(page, { kind: 'scenario', format: 'dropqtt-scenario/9', name: 'future' });
  await expect(page.getByTestId('scenario-error')).toContainText('another format');
});

test('applying installs what this panel owns and names what it cannot', async ({ page }) => {
  await boot(page);
  await pasteAndParse(page, SCENARIO);
  await page.getByTestId('scenario-apply').click();

  const assertions = await callsFor(page, 'assertions_sync_rules');
  expect(assertions.at(-1).args.rules).toHaveLength(1);
  const responders = await callsFor(page, 'responder_sync_rules');
  expect(responders.at(-1).args.rules).toHaveLength(1);
  const subs = await callsFor(page, 'subscribe_topic');
  expect(subs.at(-1)?.args?.topic).toBe('devices/#');

  const notes = page.getByTestId('scenario-notes');
  await expect(notes).toContainText('watchdogs applied without an alert endpoint');
  await expect(notes).toContainText('1 item(s) are not applied here');
});

test('a 3.1.1 session says the responder rules were not installed', async ({ page }) => {
  await boot(page, { protocol: 3 });
  await pasteAndParse(page, SCENARIO);
  await page.getByTestId('scenario-apply').click();
  await expect(page.getByTestId('scenario-notes')).toContainText('1 responder rules were not applied');
  const responders = await callsFor(page, 'responder_sync_rules');
  expect(responders.at(-1).args.rules).toEqual([]);
});

test('an unset bar reads unknown, never met', async ({ page }) => {
  await boot(page);
  const verdict = page.getByTestId('scenario-verdict');
  await expect(verdict).toContainText('Message assertions');
  await expect(verdict).toContainText('0 violated, 0 unevaluable of 0 matched');
  // Nothing has run, so the traffic claims must not appear as a pass.
  await expect(verdict).toContainText('not run yet');
});

test('a violated assertion fails the verdict', async ({ page }) => {
  await boot(page, { assertionStats: { matched: 12, passed: 9, violated: 3, unevaluable: 0 } });
  await expect(page.getByTestId('scenario-verdict')).toContainText('3 violated, 0 unevaluable of 12 matched');
  await expect(page.getByTestId('scenario-verdict')).toContainText('not met');
});

test('a refused subscription fails the verdict even when traffic looks healthy', async ({ page }) => {
  await boot(page, { rejected: [{ filter: 'secret/telemetry', code: 0x9e, meaning: 'no shared subs', atMs: 1 }] });
  await expect(page.getByTestId('scenario-verdict')).toContainText('Refused subscriptions');
  await expect(page.getByTestId('scenario-verdict')).toContainText('1 · not met');
});

test('the verdict leaves the window as a file a CI can read', async ({ page }) => {
  await boot(page, { assertionStats: { matched: 6, passed: 4, violated: 2, unevaluable: 0 } });
  // The button label carries the roll-up, so a pass is never implied by silence.
  await expect(page.getByTestId('scenario-report-junit')).toContainText('(not met)');
  await page.getByTestId('scenario-report-junit').click();
  const xml = await page.evaluate(() => (window as any).written.text);
  expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  expect(xml).toContain('failures="1" skipped="1"');
  expect(xml).toContain('2 violated, 0 unevaluable of 6 matched');
  // The rate claim never ran, so it must be skipped rather than a green testcase.
  expect(xml).toContain('<skipped message="unknown: not run yet"/>');
});
