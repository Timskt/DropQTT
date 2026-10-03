import { test, expect } from '@playwright/test';

/**
 * Measurement for review §1.12 ("the feed has no virtualisation and polls too
 * much"). This is not a regression gate on wall-clock numbers — a CI box's frames
 * are not a field laptop's — it is the measurement that has to exist before
 * anyone rewrites the feed. Each case prints what it found; the assertions are
 * deliberately loose bounds that would only fail on a real pathology.
 *
 * Method: fire the same `mqtt-messages` event the backend fires, then wait two
 * animation frames so React's render and the browser's paint are both inside the
 * timed window.
 */
const boot = async (page: any) => {
  await page.addInitScript(() => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_perf',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt', protocolVersion: 5, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    const handlers = new Map<number, { event: string; cb: (e: any) => void }>();
    const byId = new Map<number, (e: any) => void>();
    let nextId = 1;
    w.__fire = (event: string, payload: any) => {
      handlers.forEach((h) => { if (h.event === event) h.cb({ event, payload, id: 0 }); });
    };
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
        if (cmd === 'get_connection_status') return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_perf' };
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
        if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
        if (cmd === 'bridge_outbox_state')
          return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
        if (cmd === 'get_broker_capabilities')
          return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        return null;
      },
    };
  });
  await page.goto('/');
};

/** Fire a batch and time until it is on screen. */
const measureBatch = (page: any, size: number, from = 0) =>
  page.evaluate(
    async ([n, start]: [number, number]) => {
      const mk = (i: number) => ({
        id: `m${i}`,
        topic: `bench/row/${i % 40}`,
        payload: JSON.stringify({ seq: i, temp: 20 + (i % 10), tags: ['a', 'b', 'c'] }),
        payloadLen: 48,
        payloadBase64: btoa(JSON.stringify({ seq: i })),
        truncated: false, qos: 1, retain: false,
        timestamp: '10:00:00.000', timestampMs: Date.now() + i, direction: 'in',
      });
      const paint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const t0 = performance.now();
      (window as any).__fire('mqtt-messages', { messages: Array.from({ length: n }, (_, i) => mk(i + start)), dropped: 0 });
      await paint();
      const t1 = performance.now();
      return { ms: Math.round((t1 - t0) * 10) / 10, nodes: document.querySelectorAll('*').length };
    },
    [size, from] as const,
  );

test('what a 500-row feed actually costs, and what one more row costs', async ({ page }) => {
  await boot(page);
  const samples: Record<string, { ms: number; nodes: number }> = {};
  samples.batch100 = await measureBatch(page, 100);
  samples.oneMoreAt100 = await measureBatch(page, 1, 100);
  samples.to500 = await measureBatch(page, 400, 101);
  samples.oneMoreAt500 = await measureBatch(page, 1, 501);
  // The cap is 500 rows, so this is the steady state under a flood.
  samples.floodPastCap = await measureBatch(page, 120, 900);
  console.log('FEED PERF>', JSON.stringify(samples, null, 2));

  const rows = await page.evaluate(() => document.querySelectorAll('.msg-row').length);
  console.log('FEED ROWS IN DOM>', rows);
  expect(rows).toBe(500);
  expect(samples.batch100.ms).toBeLessThan(4000);
  expect(samples.oneMoreAt500.ms).toBeLessThan(4000);
});

test('cost of typing in the feed filter while the feed is full', async ({ page }) => {
  await boot(page);
  await measureBatch(page, 500);
  const result = await page.evaluate(async () => {
    const input = document.querySelector('[aria-label^="Search topic or payload"]') as HTMLInputElement;
    if (!input) return null;
    const paint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const count = () => document.querySelectorAll('.msg-row').length;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const before = count();
    const t0 = performance.now();
    set.call(input, 'bench/row/1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await paint();
    const firstPaint = performance.now() - t0;
    // The list is allowed to arrive a moment later; what matters is that the box
    // is not blocked behind it.
    while (count() === before && performance.now() - t0 < 5000) await paint();
    return {
      firstPaintMs: Math.round(firstPaint * 10) / 10,
      settledMs: Math.round((performance.now() - t0) * 10) / 10,
      before,
      after: count(),
    };
  });
  console.log('FILTER KEYSTROKE>', JSON.stringify(result));
  expect(result).not.toBeNull();
  expect(result!.after).toBeLessThan(result!.before);
});
