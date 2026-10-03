import { test, expect } from '@playwright/test';

/**
 * Structural accessibility guard. The audit found form controls whose only name
 * was a placeholder, and icon buttons whose only name was a tooltip; both are
 * invisible to a screen reader. Rather than re-reviewing every panel by hand in
 * future rounds, this walks each workspace and fails on any control that has no
 * accessible name at all.
 */
const boot = async (page: any, mode: string) => {
  await page.addInitScript((m: string) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', m);
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_a11y',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: 5, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
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
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_a11y' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ids') return w.subIds ?? {};
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return w.assertions ?? { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset')
          return w.faults ?? [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset')
          return w.responder ?? [];
        if (cmd === 'get_broker_capabilities')
          return w.caps ?? { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'get_subscription_ack_state')
          return w.ackState ?? { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'bridge_outbox_state') return w.outbox ?? { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
        if (cmd === 'bridge_outbox_flush' || cmd === 'bridge_outbox_drop') return 0;
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        return null;
      },
    };
  }, mode);
  await page.goto('/');
};

/**
 * Anything with a layout box must be nameable. A tooltip counts as a name, but
 * not for an icon-only button: a 3.5-unit glyph with nothing but `title` reads as
 * "button" to a screen reader, which is the defect being guarded.
 */
const audit = (page: any) =>
  page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const nameVia = (el: Element): string | null => {
      const explicit = el.getAttribute('aria-label');
      if (explicit && explicit.trim()) return 'aria-label';
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy && document.getElementById(labelledBy)) return 'aria-labelledby';
      const id = el.getAttribute('id');
      if (id && document.querySelector(`label[for="${id}"]`)) return 'label[for]';
      if (el.closest('label')) return 'wrapping label';
      const title = el.getAttribute('title');
      if (title && title.trim()) return 'title';
      return null;
    };
    const controls = Array.from(document.querySelectorAll('input,select,textarea'))
      .filter(visible)
      .filter((el) => (el as HTMLInputElement).type !== 'hidden')
      .filter((el) => !nameVia(el))
      .map((el) => `${el.tagName.toLowerCase()}[${(el as HTMLInputElement).type || ''}] ${(el as HTMLInputElement).placeholder || el.getAttribute('title') || '(unnamed)'}`);
    const buttons = Array.from(document.querySelectorAll('button'))
      .filter(visible)
      .filter((b) => !b.textContent?.trim())
      .filter((b) => !b.getAttribute('aria-label'))
      .map((b) => `button title=${b.getAttribute('title') || '(none)'}`);
    return { controls, buttons };
  });

for (const [mode, label] of [
  ['mqttx', 'MQTT console'],
  ['bridge', 'message bridge'],
  ['history', 'history'],
  ['transfer', 'file transfer'],
] as [string, string][]) {
  test(`no form control in the ${label} workspace is left unnamed`, async ({ page }) => {
    await boot(page, mode);
    await expect.poll(async () => (await audit(page)).controls).toEqual([]);
    await expect.poll(async () => (await audit(page)).buttons).toEqual([]);
  });
}

test('the bench lab and the rule editor name everything once expanded', async ({ page }) => {
  await boot(page, 'mqttx');
  await page.getByRole('button', { name: 'Bench Lab' }).click();
  await expect.poll(async () => (await audit(page)).controls).toEqual([]);

  await boot(page, 'bridge');
  await page.getByRole('button', { name: /Add rule|New rule/i }).first().click();
  await expect.poll(async () => (await audit(page)).controls).toEqual([]);
});

test('the command palette names every control it shows', async ({ page }) => {
  await boot(page, 'mqttx');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('command-palette')).toBeVisible();
  await expect.poll(async () => (await audit(page)).controls).toEqual([]);
  await expect.poll(async () => (await audit(page)).buttons).toEqual([]);
  // The listbox and its options must be reachable, not just labelled.
  expect(await page.evaluate(() => document.querySelector('[role="dialog"]')?.getAttribute('aria-modal'))).toBe('true');
  expect(await page.evaluate(() => document.querySelectorAll('[role="option"]').length)).toBeGreaterThan(0);
});

test('the settings dialog names every control it shows', async ({ page }) => {
  await boot(page, 'mqttx');
  await page.getByRole('button', { name: /Settings/ }).first().click();
  await expect
    .poll(async () => (await audit(page)).controls)
    .toEqual([]);
  await expect.poll(async () => (await audit(page)).buttons).toEqual([]);
});
