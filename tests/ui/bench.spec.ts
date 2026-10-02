import { test, expect } from '@playwright/test';

/**
 * The bench lab's numbers are produced in Rust (tick loop, ack accounting,
 * loopback timing), so the UI contract is narrow: submit a complete spec, render
 * whatever the backend reports, and stay in control of a run it cannot see.
 */
const boot = async (page: any, startReply: 'ok' | 'reject' = 'ok') => {
  await page.addInitScript((mode: string) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem(
      'dropqtt_active_broker',
      JSON.stringify({
        host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_test',
        keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
        protocolVersion: 5, cleanSession: true,
      }),
    );
    const w = window as any;
    w.calls = [];
    const handlers = new Map<number, { event: string; cb: (e: any) => void }>();
    const byId = new Map<number, (e: any) => void>();
    let nextId = 1;
    /** Backend run state: the event pushes it, the poll reads the same copy. */
    w.__runs = [];
    w.__fire = (event: string, payload: any) => {
      if (event === 'bench-progress') w.__runs = payload;
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
        if (cmd === 'get_connection_status') {
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_test' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ack_state')
          return w.ackState ?? { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'bridge_status' || cmd === 'list_transfers') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'schedule_list') return [];
        if (cmd === 'rpc_list') return [];
        if (cmd === 'bench_progress') return w.__runs.map((r: any) => ({ ...r }));
        if (cmd === 'bench_start' && mode === 'reject') {
          throw 'rate must be between 1 and 20000 msg/s';
        }
        return null;
      },
    };
  }, startReply);
  await page.goto('/');
};

const openBench = async (page: any) => {
  await page.getByRole('button', { name: 'Bench Lab' }).click();
};

const row = () => ({
  id: 'bench-1', topics: ['bench/hot'], rate: 5000, size: 128, qos: 1, retain: false,
  sent: 12345, acked: 12300, observed: 400, elapsedMs: 2500, status: 'running',
  lastError: null,
  latency: { samples: 400, dropped: 0, p50Ms: 3, p95Ms: 11, p99Ms: 27, maxMs: 44, meanMs: 5.2 },
});

test('the form submits one complete spec, topics split on separators', async ({ page }) => {
  await boot(page);
  await openBench(page);

  await page.getByPlaceholder(/Bench topics/).fill('bench/a bench/b, bench/c');
  await page.getByTitle('0 = until stopped').fill('0');
  await page.locator('select[title="QoS"]').selectOption('2');
  await page.getByLabel('Bench Lab Retain Flag').check();

  await page.getByRole('button', { name: 'Start bench' }).click();

  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'bench_start').at(-1),
    )
    .toMatchObject({
      args: {
        spec: {
          topics: ['bench/a', 'bench/b', 'bench/c'],
          rate: 3000,
          size: 64,
          qos: 2,
          retain: true,
          durationSec: 0,
        },
      },
    });
  expect(
    (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'start_bench'),
  ).toHaveLength(0);
});

test('counters and percentiles come from the backend event, not local math', async ({ page }) => {
  await boot(page);
  await openBench(page);
  await page.getByRole('button', { name: 'Start bench' }).click();

  await page.evaluate((r) => (window as any).__fire('bench-progress', [r]), row());

  await expect(page.getByTitle('bench/hot')).toBeVisible();
  await expect(page.getByText('12,345 sent')).toBeVisible();
  await expect(page.getByText('12,300 acked')).toBeVisible();
  await expect(page.getByText('p50 3 · p95 11 · p99 27 ms')).toBeVisible();
  // 12345 sent over 2500 ms
  await expect(page.getByText('4938/s')).toBeVisible();
});

test('a run with no loopback samples says so instead of showing zero latency', async ({ page }) => {
  await boot(page);
  await openBench(page);
  await page.evaluate((r) => (window as any).__fire('bench-progress', [{ ...r, observed: 0, latency: { ...r.latency, samples: 0 } }]), row());
  await expect(page.getByText('timed 0')).toBeVisible();
  await expect(page.getByText(/p50 0/)).toHaveCount(0);
});

test('stopping addresses the backend run by id', async ({ page }) => {
  await boot(page);
  await openBench(page);
  await page.evaluate((r) => (window as any).__fire('bench-progress', [r]), row());
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'bench_stop').at(-1),
    )
    .toMatchObject({ args: { id: 'bench-1' } });
});

test('backend validation surfaces instead of failing silently', async ({ page }) => {
  await boot(page, 'reject');
  await openBench(page);
  await page.getByRole('button', { name: 'Start bench' }).click();
  await expect(page.getByText('rate must be between 1 and 20000 msg/s')).toBeVisible();
});
