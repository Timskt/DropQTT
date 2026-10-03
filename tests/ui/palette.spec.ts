import { test, expect } from '@playwright/test';

/**
 * The palette is mostly about discoverability (the audit's complaint was that the
 * newer features are invisible until you already know where they are), so these tests
 * drive it the way a keyboard user would: open with the shortcut, move with arrows,
 * run with Enter, and land back where you started. The saved-filter strip is the other
 * half of the same complaint: repeating a filter by hand is why people stop filtering.
 */
const boot = async (page: any, opts: { messages?: any[]; density?: string } = {}) => {
  await page.addInitScript((seed: any) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'mqttx');
    localStorage.setItem('dropqtt_density', seed.density ?? 'cozy');
    localStorage.setItem('dropqtt_active_broker', JSON.stringify({
      host: '127.0.0.1', port: 1883, useTls: false, clientId: 'DropQTT_kbd',
      keepAliveSecs: 60, defaultQos: 1, baseTopic: 'dropqtt',
      protocolVersion: 5, cleanSession: true,
    }));
    const w = window as any;
    w.calls = [];
    w.seedMessages = seed.messages ?? [];
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
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'DropQTT_kbd' };
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
        return null;
      },
    };
  }, { messages: opts.messages, density: opts.density });
  await page.goto('/');
};

const openPalette = async (page: any) => {
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('command-palette')).toBeVisible();
};

const activeMode = (page: any) => page.evaluate(() => localStorage.getItem('dropqtt_workspace_mode'));

const selected = (page: any) => page.evaluate(() => {
  const el = document.querySelector('[role="option"][aria-selected="true"] button');
  return el ? el.getAttribute('data-testid') : null;
});

test.describe('command palette', () => {
  test('the shortcut opens it, Escape closes it, and focus comes back', async ({ page }) => {
    await boot(page);
    await page.getByTestId('palette-trigger').focus();
    await openPalette(page);
    // Focus starts inside the dialog, not on whatever had it.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('palette-input');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('palette-trigger');
  });

  test('typing narrows the list and Enter runs the highlighted command', async ({ page }) => {
    await boot(page);
    await openPalette(page);
    await page.keyboard.type('history');
    await expect(page.getByTestId('palette-item-go-history')).toBeVisible();
    await expect(page.getByTestId('palette-item-go-mqttx')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    await expect.poll(() => activeMode(page)).toBe('history');
  });

  test('arrows wrap, so the last command is two keystrokes from the first', async ({ page }) => {
    await boot(page);
    await openPalette(page);
    await page.getByTestId('palette-input').press('ArrowUp');
    const last = await page.evaluate(() => {
      const el = document.querySelector('[role="option"][aria-selected="true"] button');
      return el ? el.getAttribute('data-testid') : null;
    });
    expect(last).toBe('palette-item-density');
    await page.getByTestId('palette-input').press('ArrowDown');
    // Wrapping back to the top must land on the first command, not on nothing.
    expect(await selected(page)).toBe('palette-item-go-transfer');
  });

  test('the connection command says which broker it means', async ({ page }) => {
    await boot(page);
    await openPalette(page);
    await expect(page.getByTestId('palette-item-toggle-connect')).toContainText('127.0.0.1:1883');
  });

  test('the density command tightens rows without re-rendering the feed', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as any).__fire('mqtt-messages', {
      messages: [{
        id: 'm1', topic: 'sensors/a', payload: 'hi', payloadLen: 2, payloadBase64: 'aGk=',
        truncated: false, qos: 1, retain: false, timestamp: '10:00:00', timestampMs: 1,
        direction: 'in', matchedFilters: [], subscriptionIds: [],
      }],
      dropped: 0,
    }));
    const rowFont = () => page.evaluate(() => {
      const el = document.querySelector('.msg-row');
      return el ? `${getComputedStyle(el).fontSize}|${document.documentElement.dataset.density}` : null;
    });
    expect(await rowFont()).toBe('12px|cozy');
    await openPalette(page);
    await page.getByTestId('palette-item-density').click();
    // CSS owns the spacing, so a memoised row still changes.
    await expect.poll(rowFont).toBe('11px|compact');
    expect(await page.evaluate(() => localStorage.getItem('dropqtt_density'))).toBe('compact');
  });

  test('a palette command is not a way to skip a confirmation', async ({ page }) => {
    await boot(page);
    await openPalette(page);
    // Destructive actions stay where their two-step guard is visible, so a command
    // name that looks close must not resolve to one.
    await page.keyboard.type('clear');
    await expect(page.getByTestId('palette-empty')).toBeVisible();
    await expect(page.locator('[data-testid^="palette-item-"]')).toHaveCount(0);
  });
});

test.describe('saved feed filters', () => {
  const filterInput = (page: any) => page.getByLabel('Search topic or payload content');

  test('a typed filter can be saved and comes back as a chip', async ({ page }) => {
    await boot(page);
    await expect(filterInput(page)).toBeVisible();
    await expect(page.getByTestId('filter-save')).toBeDisabled();
    expect(await filterInput(page).getAttribute('title')).toBeNull();
    await page.getByTestId('filter-save').hover().catch(() => {});
    expect(await page.getByTestId('filter-save').getAttribute('title')).toContain('Type something');
    await filterInput(page).fill('devices/+/telemetry');
    await page.getByTestId('filter-save').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_feed_filters') || '[]'))).toEqual(['devices/+/telemetry']);
    await expect(page.getByTestId('filter-preset-devices/+/telemetry')).toBeVisible();
  });

  test('clicking a saved filter applies it to the feed', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => localStorage.setItem('dropqtt_feed_filters', JSON.stringify(['alarm', 'battery'])));
    await page.reload();
    await filterInput(page).fill('other');
    await page.getByTestId('filter-preset-alarm').click();
    expect(await filterInput(page).inputValue()).toBe('alarm');
  });

  test('removing a saved filter takes two deliberate clicks', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => localStorage.setItem('dropqtt_feed_filters', JSON.stringify(['alarm'])));
    await page.reload();
    await page.getByTestId('filter-remove-alarm').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_feed_filters') || '[]'))).toEqual(['alarm']);
    await page.getByTestId('filter-remove-alarm').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dropqtt_feed_filters') || '[]'))).toEqual([]);
    await expect(page.getByTestId('filter-presets-empty')).toBeVisible();
  });

  test('the same filter cannot be saved twice', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => localStorage.setItem('dropqtt_feed_filters', JSON.stringify(['alarm'])));
    await page.reload();
    await filterInput(page).fill('alarm');
    await expect(page.getByTestId('filter-save')).toBeDisabled();
    expect(await page.getByTestId('filter-save').getAttribute('title')).toContain('already saved');
  });
});
