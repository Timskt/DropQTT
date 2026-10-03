import { test, expect } from '@playwright/test';

/**
 * The scripted responder stands in for a device. The UI's responsibility is narrow
 * but load-bearing: a rule that would answer its own trigger has to be refused with
 * the reason visible (that is a traffic loop waiting to happen), the counts have to
 * come from the engine that did the answering, and a rejected set must not look like
 * it took effect.
 */
const boot = async (page: any, opts: { rules?: any[]; stats?: any[]; connected?: boolean } = {}) => {
  await page.addInitScript((seed: any) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem('dropqtt_responder_rules', JSON.stringify(seed.rules ?? []));
    localStorage.setItem('dropqtt_fault_rules', '[]');
    localStorage.setItem('dropqtt_assertion_rules', '[]');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_resp',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: 5, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    w.responder = seed.stats ?? null;
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
        if (cmd === 'get_connection_status') {
          return seed.connected === false
            ? { connected: false, brokerHost: '', brokerPort: 0, clientId: '' }
            : { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_resp' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
        if (cmd === 'get_broker_capabilities')
          return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'responder_sync_rules') {
          // Mirrors the Rust validator's load-bearing case: a reply that matches its
          // own trigger is a loop.
          for (const r of args.rules ?? []) {
            const trigger = String(r.trigger ?? '').trim();
            const reply = String(r.replyTopic ?? '').trim();
            if (!trigger || !reply) throw new Error(`${r.name || trigger}: a responder needs both`);
            const prefix = trigger.replace(/[#(+].*$/, '');
            if (trigger.endsWith('#') && reply.startsWith(prefix))
              throw new Error(`${r.name || trigger}: the reply topic matches this rule's own trigger — that is a loop`);
          }
          w.responder = (args.rules ?? []).map((r: any) => w.responder?.find((x: any) => x.id === r.id)
            ?? { id: r.id, name: r.name, trigger: r.trigger, enabled: r.enabled, matched: 0, replied: 0, throttled: 0, suppressed: 0, failed: 0, lastError: null });
          return w.responder;
        }
        if (cmd === 'responder_stats') return w.responder ?? [];
        if (cmd === 'responder_reset') {
          w.responder = (w.responder ?? []).map((x: any) => ({ ...x, matched: 0, replied: 0, throttled: 0, suppressed: 0, failed: 0, lastError: null }));
          return w.responder;
        }
        return null;
      },
    };
  }, { rules: opts.rules, stats: opts.stats, connected: opts.connected });
  await page.goto('/');
};

const rule = (over: any = {}) => ({
  id: 'rp_1',
  name: 'gateway ack',
  trigger: 'devices/+/cmd',
  replyTopic: 'devices/gw1/ack',
  replyPayload: '{"ok":true,"echo":"${payload}"}',
  qos: 1,
  retain: false,
  delayMs: 0,
  maxPerSec: 0,
  enabled: true,
  ...over,
});

const stats = (over: any = {}) => ({
  id: 'rp_1',
  name: 'gateway ack',
  trigger: 'devices/+/cmd',
  enabled: true,
  matched: 6,
  replied: 5,
  throttled: 1,
  suppressed: 4,
  failed: 0,
  lastError: null,
  ...over,
});

const lastSync = (page: any) => page.evaluate(() => {
  const calls = (window as any).calls.filter((c: any) => c.cmd === 'responder_sync_rules');
  return calls.length ? calls[calls.length - 1].args.rules : null;
});

test.describe('scripted responder', () => {
  test('the counts come from the engine that answered', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await expect(page.getByTestId('responder-counts-rp_1')).toContainText('matched 6 · replied 5 · throttled 1');
    // Our own replies are counted apart from rate limiting: "we answered it twice"
    // and "we refused to answer it" are different diagnoses.
    await expect(page.getByTestId('responder-counts-rp_1')).toContainText('self-echoed 4');
    await expect(page.getByTestId('responder-armed')).toHaveText('1/1');
  });

  test('a rule that would answer itself is refused with the reason', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await page.getByTestId('responder-trigger-rp_1').fill('devices/#');
    await page.getByTestId('responder-reply-topic-rp_1').fill('devices/gw1/ack');
    await expect(page.getByTestId('responder-error')).toContainText('that is a loop');
    // Refused means the previous set is still the one doing the work.
    await expect(page.getByTestId('responder-armed')).toHaveText('1/1');
  });

  test('a failed reply is shown on the rule that could not send it', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats({ failed: 2, lastError: 'not connected' })] });
    await expect(page.getByTestId('responder-counts-rp_1')).toContainText('failed 2');
    await expect(page.getByTestId('responder-counts-rp_1')).toContainText('not connected');
  });

  test('a new rule is valid on arrival', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await page.getByTestId('responder-add').click();
    const pushed = await lastSync(page);
    expect(pushed).toHaveLength(2);
    expect(pushed[1].replyTopic).toBe('devices/gw1/ack');
    expect(pushed[1].replyPayload).toBe('{"ok":true}');
    expect(pushed[1].name).toBe('');
  });

  test('the tokens a reply can use are listed, not folklore', async ({ page }) => {
    await boot(page);
    await expect(page.getByText('${topic} ${payload} ${counter}', { exact: false })).toBeVisible();
  });

  test('editing a trigger pushes the whole set', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await page.getByTestId('responder-trigger-rp_1').fill('fleet/+/ping');
    const pushed = await lastSync(page);
    expect(pushed[0].trigger).toBe('fleet/+/ping');
  });

  test('reset zeroes the answer counts and keeps the rule armed', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await page.getByTestId('responder-reset').click();
    await expect(page.getByTestId('responder-counts-rp_1')).toContainText('matched 0 · replied 0');
    await expect(page.getByTestId('responder-armed')).toHaveText('1/1');
  });

  test('deleting a rule takes two deliberate clicks', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()] });
    await page.getByTestId('responder-delete-rp_1').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_responder_rules') || '[]'))).toHaveLength(1);
    await page.getByTestId('responder-delete-rp_1').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_responder_rules') || '[]'))).toHaveLength(0);
  });

  test('disconnected says the obvious thing out loud', async ({ page }) => {
    await boot(page, { rules: [rule()], stats: [stats()], connected: false });
    await expect(page.getByText('Nothing answers while disconnected.')).toBeVisible();
  });

  test('an empty panel says traffic is being watched, not answered', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('responder-empty')).toContainText('watched, not answered');
  });
});
