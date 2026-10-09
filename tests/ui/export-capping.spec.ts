import { test, expect } from '@playwright/test';

/**
 * A file built from the result list is a page of the window, not the window.
 *
 * The panel already shows both figures — "Showing 3" and "Window total 9" — but
 * a receipt that says only "Exported 3" leaves the user to join them up, and the
 * one thing they wanted was the whole window. These cases pin the disclosure an
 * export and a recording carry with them.
 *
 * The command table is the one `workspaces.spec.ts` uses to boot the history
 * workspace: several hooks call `.some()` on their result, so answering them
 * with nothing takes the whole app down rather than degrading.
 */
const boot = async (page: any, shown: number, windowTotal: number) => {
  await page.addInitScript(
    ([n, total]) => {
      localStorage.setItem('dropqtt_lang', 'en');
      localStorage.setItem('dropqtt_theme', 'solaris');
      localStorage.setItem('dropqtt_workspace_mode', 'history');
      const now = Date.now();
      const rows = Array.from({ length: n }, (_, i) => ({
        id: `r${i}`,
        topic: 'devices/gw1/telemetry',
        payload: `{"v":${i}}`,
        payloadBase64: btoa(`{"v":${i}}`),
        payloadLen: i + 1,
        truncated: false,
        qos: 1,
        retain: false,
        direction: 'in' as const,
        ts: now - 1000 - i * 100,
        properties: { userProperties: [], responseTopic: null, correlationData: null },
      }));
      const w = window as any;
      w.calls = [];
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1,
        invoke: async (cmd: string, args: any = {}) => {
          w.calls.push({ cmd, args });
          if (cmd === 'get_connection_status') return { connected: true, brokerHost: 'localhost', brokerPort: 1883, clientId: 'test' };
          if (cmd === 'get_default_download_dir') return 'D:/Downloads';
          if (cmd === 'get_subscription_ids') return {};
          if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
            return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
          if (cmd === 'faults_sync_rules' || cmd === 'faults_stats' || cmd === 'faults_reset') return [];
          if (cmd === 'responder_sync_rules' || cmd === 'responder_stats' || cmd === 'responder_reset') return [];
          if (cmd === 'get_broker_capabilities')
            return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
          if (cmd === 'get_subscription_ack_state')
            return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
          if (cmd === 'history_stats')
            return { rows: total, inbound: total, outbound: 0, oldestTs: now - 60_000, newestTs: now - 1000 };
          // The list is the page; the chart counts everything in the window.
          if (cmd === 'query_history') return rows;
          if (cmd === 'history_series')
            return [{ bucket: Math.floor((now - 1000) / args.bucketMs) * args.bucketMs, count: total }];
          if (cmd === 'history_topics')
            return [{ topic: 'devices/gw1/telemetry', count: total, inbound: total, outbound: 0, bytes: total * 8, firstTs: now - 60_000, lastTs: now - 1000 }];
          if (cmd === 'set_history_retention') return null;
          if (cmd === 'bridge_sync_rules' || cmd === 'bridge_status') return [];
          if (cmd === 'bridge_outbox_state')
            return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
          if (cmd === 'schedule_list') return [];
          if (cmd === 'get_topic_stats_cap') return 5000;
          if (cmd === 'plugin:dialog|save') return 'D:/exports/telemetry.json';
          if (cmd === 'test_broker_connection') return 10;
          return null;
        },
      };
    },
    [shown, windowTotal] as const,
  );
  await page.goto('/');
};

const written = async (page: any) =>
  expect
    .poll(() => page.evaluate(() => (window as any).calls.some((c: any) => c.cmd === 'plugin:fs|write_text_file')), { timeout: 20_000 })
    .toBe(true);

test('an export says how much of the window it left behind', async ({ page }) => {
  await boot(page, 3, 9);
  await expect(page.getByTestId('history-results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await written(page);
  await expect(page.getByText(/Exported 3 of the 9 messages in this window/)).toBeVisible({ timeout: 20_000 });
});

test('a recording carries the same disclosure', async ({ page }) => {
  await boot(page, 3, 9);
  await expect(page.getByTestId('history-results')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('history-capture').click();
  await written(page);
  await expect(page.getByText(/it holds 3 of the 9 messages in this window/)).toBeVisible({ timeout: 20_000 });
});

test('a file that really is the whole window is not called a fragment', async ({ page }) => {
  // 3 of 3 is a page exactly as full as a truncated one, so a warning keyed on
  // "the list reached its cap" would fire here and be wrong.
  await boot(page, 3, 3);
  await expect(page.getByTestId('history-results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await written(page);
  await expect(page.getByText('Exported 3 messages, the whole window')).toBeVisible({ timeout: 20_000 });
});
