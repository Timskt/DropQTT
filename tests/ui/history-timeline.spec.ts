import { test, expect } from '@playwright/test';

/**
 * The activity timeline: time on one axis, a topic prefix per row. What these
 * pin is the two claims the view could get wrong — that it fetched without being
 * asked (it scans a window, so it must not), and that silence means absence
 * (it only means "we stored nothing", which the caveat has to keep saying).
 */
const segment = (startMs: number, endMs: number, messages: number) => ({ startMs, endMs, messages });
const mark = (tsMs: number, topic: string, answered: boolean, rttMs: number | null) => ({
  tsMs,
  topic,
  correlation: answered ? '632d31' : '632d32',
  answered,
  rttMs,
});

const emptyTimeline = {
  entities: [],
  windowStartMs: 0,
  windowEndMs: 0,
  gapMs: 30_000,
  depth: 2,
  entitiesDropped: 0,
  rowsScanned: 0,
  truncated: false,
};

const boot = async (page: any, timeline: Record<string, any> = emptyTimeline, rows = 5) => {
  await page.addInitScript(
    ([exTimeline, exRows]) => {
      localStorage.setItem('dropqtt_lang', 'en');
      localStorage.setItem('dropqtt_theme', 'solaris');
      localStorage.setItem('dropqtt_workspace_mode', 'history');
      const w = window as any;
      w.timeline = exTimeline;
      w.calls = [];
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: (cb: any) => {
          const id = Math.random();
          (w as any).__cbs = (w as any).__cbs || new Map();
          (w as any).__cbs.set(id, cb);
          return id;
        },
        invoke: async (cmd: string, args: any = {}) => {
          w.calls.push({ cmd, args });
          if (cmd === 'plugin:event|listen') return 1;
          if (cmd === 'plugin:event|unlisten') return null;
          if (cmd === 'get_connection_status')
            return { connected: false, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_tl' };
          if (cmd === 'get_default_download_dir') return 'D:/Downloads';
          if (cmd === 'get_topic_stats_cap') return 5000;
          if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
          if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'list_transfers') return [];
          if (cmd === 'bridge_status' || cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
          if (cmd === 'bridge_outbox_state')
            return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
          if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
            return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
          if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
          if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
          if (cmd === 'get_broker_capabilities')
            return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
          if (cmd === 'get_subscription_ack_state')
            return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
          if (cmd === 'history_stats')
            return { rows: exRows, inbound: 1, outbound: 1, oldestTs: 1_000, newestTs: 9_000, lostRows: 0, retentionDays: 0, prunedRows: 0 };
          if (cmd === 'query_history') return [];
          if (cmd === 'history_series' || cmd === 'history_topics') return [];
          if (cmd === 'history_trace')
            return { hits: [], summary: { count: 0, topics: [], firstMs: null, lastMs: null, inbound: 0, outbound: 0, correlations: [], truncated: false } };
          if (cmd === 'history_timeline') return w.timeline;
          return null;
        },
      };
    },
    [timeline, rows] as const,
);
  await page.goto('/');
};

const callsFor = (page: any, cmd: string) =>
  page.evaluate((name: string) => ((window as any).calls || []).filter((c: any) => c.cmd === name), cmd);

const build = async (page: any) => {
  await page.getByTestId('timeline-build').click();
  // A window with nothing in it answers with the empty line, not a chart.
  await expect(page.getByTestId('timeline-result').or(page.getByTestId('timeline-empty'))).toBeVisible();
};

test('the timeline waits to be asked rather than scanning on every search', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('timeline-card')).toBeVisible();
  await expect(page.getByTestId('timeline-build')).toBeEnabled();
  expect(await callsFor(page, 'history_timeline')).toHaveLength(0);

  await build(page);
  const calls = await callsFor(page, 'history_timeline');
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toMatchObject({ depth: 2, gapMs: 30_000, maxEntities: null });
  expect(calls[0].args.untilMs).toBeGreaterThan(calls[0].args.sinceMs);
});

test('a stretch of traffic and a dropout are drawn apart, and the row counts both', async ({ page }) => {
  await boot(page, {
    ...emptyTimeline,
    windowStartMs: 1_000,
    windowEndMs: 11_000,
    rowsScanned: 6,
    entities: [
      {
        entity: 'devices/gw-7',
        segments: [segment(1_000, 3_000, 3), segment(9_000, 9_500, 1)],
        marks: [mark(2_000, 'devices/gw-7/cmd', true, 400), mark(9_000, 'devices/gw-7/cmd', false, null)],
        messages: 6,
        firstMs: 1_000,
        lastMs: 9_500,
        longestGapMs: 6_000,
      },
    ],
  });
  await build(page);

  const row = page.getByTestId('timeline-row-devices/gw-7');
  await expect(row).toContainText('devices/gw-7');
  await expect(row).toContainText('6 msgs · 2 stretches · longest silence 6s');
  await expect(row).toContainText('1/2 commands answered');
  await expect(row.getByTestId('timeline-segment')).toHaveCount(2);
  await expect(row.getByTestId('timeline-mark')).toHaveCount(1);
  await expect(row.getByTestId('timeline-mark-lost')).toHaveCount(1);

  // Nothing may spill off the track: an overflowing bar reads as a longer stretch.
  const boxes = await row.locator('[data-testid="timeline-segment"]').evaluateAll((els) =>
    els.map((e) => ({ left: parseFloat((e as HTMLElement).style.left), width: parseFloat((e as HTMLElement).style.width) })),
  );
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.left + b.width).toBeLessThanOrEqual(100.0001);
  }
  await expect(page.getByTestId('timeline-caveat')).toContainText('only means we stored a message');
});

test('a window with nothing in it says so instead of showing an empty chart', async ({ page }) => {
  await boot(page, { ...emptyTimeline, windowStartMs: 1_000, windowEndMs: 11_000 });
  await build(page);
  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  await expect(page.getByTestId('timeline-result')).toHaveCount(0);
});

test('the caps are named when the window is bigger than the view', async ({ page }) => {
  await boot(page, {
    ...emptyTimeline,
    windowStartMs: 0,
    windowEndMs: 10_000,
    rowsScanned: 50_000,
    entitiesDropped: 12,
    truncated: true,
    entities: [
      { entity: 'a', segments: [segment(0, 1_000, 2)], marks: [], messages: 2, firstMs: 0, lastMs: 1_000, longestGapMs: 0 },
    ],
  });
  await build(page);
  await expect(page.getByTestId('timeline-dropped')).toHaveText('12 more prefixes not drawn');
  await expect(page.getByTestId('timeline-truncated')).toContainText('more than 50000 rows');
});

test('a silence threshold under a second cannot be built, and says why', async ({ page }) => {
  await boot(page);
  await page.getByTestId('timeline-gap').fill('0');
  const button = page.getByTestId('timeline-build');
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', /1 second or more/);
  await expect(page.getByTestId('timeline-gap-error')).toBeVisible();
});

test('an empty history disables the build with a reason on the button', async ({ page }) => {
  await boot(page, emptyTimeline, 0);
  const button = page.getByTestId('timeline-build');
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', /No messages in this window/);
});

test('the grouping level is what the request carries', async ({ page }) => {
  await boot(page);
  await page.getByTestId('timeline-depth').selectOption('3');
  await page.getByTestId('timeline-gap').fill('120');
  await build(page);
  const calls = await callsFor(page, 'history_timeline');
  expect(calls[0].args).toMatchObject({ depth: 3, gapMs: 120_000 });
});
