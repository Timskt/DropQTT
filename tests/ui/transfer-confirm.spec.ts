import { test, expect } from '@playwright/test';

/**
 * "Every chunk went out" and "the peer verified the file" are different facts,
 * and the sender now has a terminal state for the gap between them. The status
 * itself is produced in Rust (and its window is unit-tested there); what is
 * pinned here is that the queue renders it as its own outcome instead of
 * collapsing it into success or failure.
 */
const boot = async (page: any) => {
  await page.addInitScript(() => {
    localStorage.setItem('dropqtt_lang', 'en');
    localStorage.setItem('dropqtt_theme', 'solaris');
    localStorage.setItem('dropqtt_workspace_mode', 'transfer');
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
        if (cmd === 'get_connection_status') {
          return { connected: true, brokerHost: '127.0.0.1', brokerPort: 1883, clientId: 'ct' };
        }
        if (cmd === 'get_default_download_dir') return 'D:/Downloads';
        // Faithful shapes: every one of these is a collection in the real backend.
        if (cmd === 'bridge_status' || cmd === 'list_transfers' || cmd === 'get_topic_stats'
          || cmd === 'get_broker_sys' || cmd === 'schedule_list' || cmd === 'bench_progress') return [];
        if (cmd === 'get_subscription_stats') return {};
        if (cmd === 'get_subscription_ack_state')
          return w.ackState ?? { rejected: [], refusedUnsubscribes: [], capped: [], unattributed: 0 };
        if (cmd === 'get_topic_stats_cap') return 5000;
        if (cmd === 'history_stats') return { rows: 0, inbound: 0, outbound: 0 };
        if (cmd === 'plugin:event|listen') {
          const cb = byId.get(args.handler);
          if (cb) handlers.set(args.handler, { event: args.event, cb });
          return args.handler;
        }
        if (cmd === 'plugin:event|unlisten') return null;
        return null;
      },
    };
  });
  await page.goto('/');
};

const progress = (over: any) => ({
  transferId: 't-1', channel: 'deaf/files', fileName: 'archive-1mb.bin',
  direction: 'send', bytesTransferred: 1048576, totalBytes: 1048576,
  chunksTransferred: 16, totalChunks: 16, speedBps: 0,
  status: 'confirm_timeout', errorMessage: 'peer never confirmed the transfer',
  sha256: '9794449e9dbdf3cf',
  // For a send row this is the source file, which is what a resend re-reads.
  savePath: '/tmp/archive-1mb.bin',
  ...over,
});

test('an unconfirmed send gets its own terminal state, not a silent success', async ({ page }) => {
  await boot(page);
  await page.evaluate((p) => (window as any).__fire('transfer-progress', p), progress({}));

  await expect(page.getByText('Sent · peer never confirmed')).toBeVisible();
  await expect(page.getByText('Sent · Awaiting Receipt')).toHaveCount(0);
  await expect(page.getByText('16/16')).toBeVisible();
});

test('a confirmed send still reads as verified, and the two never merge', async ({ page }) => {
  await boot(page);
  const fire = (p: any) =>
    page.evaluate((pp) => (window as any).__fire('transfer-progress', pp), p);
  const delivered = progress({
    transferId: 't-2', channel: 'live/files', fileName: 'photo-2mb.bin', status: 'delivered',
    errorMessage: undefined,
  });
  await expect
    .poll(async () => {
      fire(progress({}));
      fire(delivered);
      return (
        (await page.getByText('Sent · peer never confirmed').isVisible().catch(() => false)) &&
        (await page.getByText('Verified').isVisible().catch(() => false))
      );
    })
    .toBe(true);
  // Two independent rows: the receipt that did arrive is not downgraded by the
  // one that never did.
  await expect(page.getByText('archive-1mb.bin')).toBeVisible();
  await expect(page.getByText('photo-2mb.bin')).toBeVisible();
});

test('an unconfirmed send can be re-sent as a new transfer', async ({ page }) => {
  await boot(page);
  await expect
    .poll(async () => {
      await page.evaluate((p) => (window as any).__fire('transfer-progress', p), progress({}));
      return page.getByText('Sent · peer never confirmed').isVisible().catch(() => false);
    })
    .toBe(true);

  await page.getByRole('button', { name: 'Resend as a new transfer' }).click();

  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as any).calls)).filter((c: any) => c.cmd === 'start_send_file').at(-1),
    )
    .toMatchObject({
      args: {
        // Same source file and same prefix; the backend mints a fresh transfer id,
        // because replaying the old id would be deduped by a mid-flight receiver.
        filePath: '/tmp/archive-1mb.bin',
        customPublishTopic: 'deaf/files',
        chunkSize: 65536,
        qos: 1,
      },
    });
});

test('a timed-out row is clearable', async ({ page }) => {
  await boot(page);
  await expect
    .poll(async () => {
      await page.evaluate((p) => (window as any).__fire('transfer-progress', p), progress({}));
      return page.getByText('Sent · peer never confirmed').isVisible().catch(() => false);
    })
    .toBe(true);
  await expect(page.getByRole('button', { name: /Clear Finished|清除已结束/ })).toBeVisible();
});
