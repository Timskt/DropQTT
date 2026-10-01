import { test, expect } from '@playwright/test';

/**
 * Silence-alert rules: the UI must push the whole set to the backend on change
 * and surface the Rust-side validation rather than swallowing it.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'bridge');
    const w = window as any;
    w.calls = [];
    w.rejectSync = false;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args });
        if (cmd === 'get_connection_status') {
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'T' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'bridge_status' || cmd === 'get_topic_stats' || cmd === 'get_broker_sys') return [];
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'silence_sync_rules') {
          if (w.rejectSync) throw 'Silence rule timeout must be at least 5 seconds';
          return null;
        }
        return null;
      },
    };
  });
  await page.goto('/');
  await page.waitForTimeout(700);
});

test('a silence rule is validated in the form and then pushed to the backend', async ({ page }) => {
  await page.getByRole('button', { name: 'New alert' }).click();
  await page.getByPlaceholder('edge-gateway heartbeat').fill('Kitchen gateway');
  await page.getByPlaceholder('devices/+/hb').fill('devices/+/hb');
  await page.getByPlaceholder('http://localhost:8080/alerts').fill('http://127.0.0.1:8081/alert');

  // Below the backend's floor: caught client-side, nothing pushed yet.
  await page.getByLabel('Silence threshold (s)').fill('2');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 5 seconds');

  await page.getByLabel('Silence threshold (s)').fill('45');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Kitchen gateway')).toBeVisible();

  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'silence_sync_rules').at(-1),
    )
    .toMatchObject({
      args: {
        rules: [{
          name: 'Kitchen gateway',
          topicFilter: 'devices/+/hb',
          timeoutSec: 45,
          cooldownSec: 300,
          enabled: true,
        }],
      },
    });
});

test('backend validation errors surface instead of being swallowed', async ({ page }) => {
  await page.evaluate(() => { (window as any).rejectSync = true; });
  await page.getByRole('button', { name: 'New alert' }).click();
  await page.getByPlaceholder('edge-gateway heartbeat').fill('Too slow');
  await page.getByPlaceholder('devices/+/hb').fill('g/#');
  await page.getByPlaceholder('http://localhost:8080/alerts').fill('http://127.0.0.1:8081/alert');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 5 seconds');
});
