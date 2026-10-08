import { test, expect } from '@playwright/test';

/**
 * Webhook header credentials in the keychain: what the bridge and silence editors
 * may and may not leave in localStorage, in an export, and in the keychain itself.
 * The mock keychain is a Map so a test can see exactly what reached it.
 */
const stored = (headers: [string, string][], secretHeaders: [string, string][]) => ({
  id: 'r-vault', name: 'Vaulted API', sourceConn: 'src', sourceFilter: 'sensors/#', sourceQos: 1,
  targetConn: '', targetKind: 'http', topicMode: 'same', enabled: true,
  webhook: { url: 'https://api.internal/ingest', format: 'json', headers, secretHeaders },
});

const boot = async (page: any, opts: { rules?: unknown[]; vault?: boolean; refuse?: string } = {}) => {
  await page.addInitScript(([rules, vault, refuse]) => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'bridge');
    if (rules) localStorage.setItem('dropqtt_bridge_rules', JSON.stringify(rules));
    const w = window as any;
    w.calls = [];
    w.keychain = new Map<string, string>();
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args });
        if (cmd === 'secret_status') return vault ? { available: true, supported: true } : null;
        if (cmd === 'secret_put') {
          if (refuse) throw refuse;
          w.keychain.set(`${args.kind ?? 'broker'}:${args.reference}`, args.value);
          return null;
        }
        if (cmd === 'secret_delete') {
          w.keychain.delete(`${args.kind ?? 'broker'}:${args.reference}`);
          return null;
        }
        if (cmd === 'plugin:event|listen') return 1;
        if (cmd === 'plugin:dialog|save') return 'D:/exports/rules.json';
        if (cmd === 'plugin:fs|write_text_file') {
          const raw = args?.contents ?? args;
          w.written = typeof raw === 'string' ? raw : new TextDecoder().decode(new Uint8Array(Object.values(raw) as number[]));
          return null;
        }
        if (cmd === 'get_connection_status')
          return { connected: false, brokerHost: '127.0.0.1', brokerPort: 18831, clientId: 'DropQTT_vault' };
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'bridge_outbox_state')
          return { counts: { pending: 0, dead: 0, delivered: 0, retries: 0 }, error: null, preview: [], maxAttempts: 8 };
        if (cmd === 'get_subscription_stats' || cmd === 'get_subscription_ids') return {};
        if (cmd === 'get_subscription_ack_state') return { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'plugin:event|unlisten' || cmd === 'get_diagnostics_snapshot') return null;
        if (cmd === 'get_topic_stats' || cmd === 'get_broker_sys' || cmd === 'list_transfers') return [];
        if (cmd === 'get_broker_capabilities')
          return { topicAliasMax: 10, maxQos: 2, retainAvailable: true, wildcardAvailable: true, sharedAvailable: true, subscriptionIdsAvailable: true, receiveMax: 65535, maxPacketSize: null, serverKeepAlive: null, sessionExpiry: null, assignedClientId: null, responseInformation: null, serverReference: null };
        if (cmd === 'assertions_sync_rules' || cmd === 'assertions_state' || cmd === 'assertions_reset')
          return { stats: { matched: 0, passed: 0, violated: 0, unevaluable: 0 }, rules: 0, recent: [] };
        if (cmd.startsWith('faults_') || cmd.startsWith('responder_')) return [];
        if (cmd === 'bridge_status') return [];
        if (cmd === 'bridge_stats') return {};
        if (cmd === 'schedule_list' || cmd === 'bench_progress' || cmd === 'rpc_list') return [];
        if (cmd === 'silence_sync_rules' || cmd === 'silence_state') return [];
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        return null;
      },
    };
  }, [opts.rules ?? null, opts.vault ?? true, opts.refuse ?? null] as const);
  await page.goto('/');
};

const calls = (page: any, cmd: string) =>
  page.evaluate((c: string) => (window as any).calls.filter((x: any) => x.cmd === c).map((x: any) => x.args), cmd);
const disk = (page: any, key = 'dropqtt_bridge_rules') => page.evaluate((k: string) => localStorage.getItem(k) ?? '', key);
const keychain = (page: any) => page.evaluate(() => Object.fromEntries((window as any).keychain));

const HEADERS = 'Headers (one Name: value per line)';

test('a new bridge rule sends its bearer token to the keychain, not to localStorage', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: /Bridge/ }).first().click();
  await page.getByRole('button', { name: /Telemetry to business API/ }).click();
  await expect(page.getByTestId('webhook-header-vault')).toBeVisible();
  await page.getByLabel('Webhook URL').fill('https://example.com/events');
  await page.getByLabel(HEADERS).fill('Content-Type: application/json\nAuthorization: Bearer live-t0ken');
  await page.getByRole('button', { name: 'Add Rule', exact: true }).click();
  await expect(page.getByText('https://example.com/events').first()).toBeVisible();

  const puts = await calls(page, 'secret_put');
  expect(puts).toHaveLength(1);
  expect(puts[0]).toMatchObject({ kind: 'webhook', value: 'Bearer live-t0ken' });
  const saved = await disk(page);
  expect(saved).not.toContain('live-t0ken');
  const [rule] = JSON.parse(saved);
  // The harmless header stays readable, so a 415 can still be debugged from the form.
  expect(rule.webhook.headers).toEqual([['Content-Type', 'application/json']]);
  expect(rule.webhook.secretHeaders).toEqual([['Authorization', puts[0].reference]]);
});

test('editing shows the mark, and saving it unchanged keeps the same reference', async ({ page }) => {
  await boot(page, { rules: [stored([['Content-Type', 'text/plain']], [['Authorization', 'ref-a']])] });
  await page.getByTitle('Edit rule').click();
  const box = page.getByLabel(HEADERS);
  await expect(box).toHaveValue('Content-Type: text/plain\nAuthorization: ••••••');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(box).toHaveCount(0);
  expect(await calls(page, 'secret_put')).toHaveLength(0);
  expect(await calls(page, 'secret_delete')).toHaveLength(0);
  expect(JSON.parse(await disk(page))[0].webhook.secretHeaders).toEqual([['Authorization', 'ref-a']]);
});

test('typing over a stored value stores the new one and releases the old reference', async ({ page }) => {
  await boot(page, { rules: [stored([], [['Authorization', 'ref-a']])] });
  await page.getByTitle('Edit rule').click();
  await page.getByLabel(HEADERS).fill('Authorization: Bearer rotated');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => calls(page, 'secret_delete')).toEqual([{ reference: 'ref-a', kind: 'webhook' }]);
  const [put] = await calls(page, 'secret_put');
  expect(put).toMatchObject({ kind: 'webhook', value: 'Bearer rotated' });
  expect(put.reference).not.toBe('ref-a');
});

test('a mark moved to another header name is refused instead of saved as dots', async ({ page }) => {
  await boot(page, { rules: [stored([], [['Authorization', 'ref-a']])] });
  await page.getByTitle('Edit rule').click();
  await page.getByLabel(HEADERS).fill('X-Token: ••••••');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText('X-Token');
  expect(JSON.parse(await disk(page))[0].webhook.secretHeaders).toEqual([['Authorization', 'ref-a']]);
});

test('a keychain that refuses the write saves nothing and says why', async ({ page }) => {
  await boot(page, { refuse: 'the keychain is locked' });
  await page.getByRole('button', { name: /Bridge/ }).first().click();
  await page.getByRole('button', { name: /Telemetry to business API/ }).click();
  await page.getByLabel(HEADERS).fill('Authorization: Bearer nope');
  await page.getByRole('button', { name: 'Add Rule', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('the keychain is locked');
  expect(await disk(page)).not.toContain('Bearer nope');
});

test('deleting a rule deletes its stored header value', async ({ page }) => {
  await boot(page, { rules: [stored([], [['Authorization', 'ref-a']])] });
  await page.evaluate(() => (window as any).keychain.set('webhook:ref-a', 'Bearer old'));
  await page.getByRole('button', { name: 'Delete rule' }).click();
  await page.getByRole('button', { name: 'click again to confirm' }).click();
  await expect.poll(() => keychain(page)).toEqual({});
});

test('an export carries neither the value nor the reference', async ({ page }) => {
  await boot(page, { rules: [stored([['X-Trace', '1']], [['Authorization', 'ref-a']])] });
  await page.getByRole('button', { name: 'Export rules' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).written ?? '')).toContain('Vaulted API');
  const text: string = await page.evaluate(() => (window as any).written);
  expect(text).not.toContain('ref-a');
  expect(text).not.toContain('secretHeaders');
  expect(text).not.toContain('api.internal');
});

test('without a keychain the header stays as typed and no vault hint is promised', async ({ page }) => {
  await boot(page, { vault: false });
  await page.getByRole('button', { name: /Bridge/ }).first().click();
  await page.getByRole('button', { name: /Telemetry to business API/ }).click();
  await page.getByLabel(HEADERS).fill('Authorization: Bearer plain');
  await expect(page.getByTestId('webhook-header-vault')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Rule', exact: true }).click();
  await expect(page.getByLabel(HEADERS)).toHaveCount(0);
  expect(await calls(page, 'secret_put')).toHaveLength(0);
  expect(JSON.parse(await disk(page))[0].webhook.headers).toEqual([['Authorization', 'Bearer plain']]);
});

test('a silence alert stores its token too, and a malformed header line is an error, not a crash', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'New alert' }).click();
  await page.getByPlaceholder('edge-gateway heartbeat').fill('Gateway');
  await page.getByPlaceholder('devices/+/hb').fill('devices/+/hb');
  await page.getByPlaceholder('http://localhost:8080/alerts').fill('http://127.0.0.1:8081/alert');
  const box = page.getByLabel(HEADERS).last();
  await box.fill('Authorization Bearer missing-colon');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText('valid HTTP(S) URL and headers');

  await expect(page.getByTestId('silence-header-vault')).toBeVisible();
  await box.fill('Authorization: Bearer pager-t0ken');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Gateway')).toBeVisible();
  expect(await calls(page, 'secret_put')).toEqual([expect.objectContaining({ kind: 'webhook', value: 'Bearer pager-t0ken' })]);
  expect(await disk(page, 'dropqtt_silence_rules')).not.toContain('pager-t0ken');
});
