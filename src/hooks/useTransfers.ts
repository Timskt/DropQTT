import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import confetti from 'canvas-confetti';
import { TransferProgress } from '../types';
import { runWithToast } from '../utils/toast';
import { prefersReducedMotion } from '../utils/motion';

/**
 * Transfer queue state: progress events from the backend, send/receive
 * controls, and the receiver approval flow.
 */
export function useTransfers() {
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({});
  const transfersRef = useRef(transfers);
  transfersRef.current = transfers;

  const [autoReceive, setAutoReceiveState] = useState<boolean>(() => {
    return localStorage.getItem('dropqtt_auto_receive') !== 'false';
  });

  // Sync persisted approval mode to the backend once at startup
  useEffect(() => {
    invoke('set_auto_receive', { enabled: autoReceive }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlistens: (() => void)[] = [];

    const setup = async () => {
      unlistens.push(
        await listen<TransferProgress>('transfer-progress', (event) => {
          if (disposed) return;
          const item = event.payload;
          setTransfers((prev) => ({ ...prev, [item.transferId]: item }));

          if (item.status === 'completed' && item.direction === 'receive' && !prefersReducedMotion()) {
            confetti({ particleCount: 50, spread: 60, origin: { y: 0.8 } });
          }
        }),
      );
    };
    setup();
    return () => {
      disposed = true;
      unlistens.forEach((fn) => fn());
    };
  }, []);

  const setAutoReceive = useCallback((enabled: boolean) => {
    setAutoReceiveState(enabled);
    localStorage.setItem('dropqtt_auto_receive', String(enabled));
    invoke('set_auto_receive', { enabled }).catch((e) => console.error('set_auto_receive:', e));
  }, []);

  const approveTransfer = useCallback(async (transferId: string) => {
    await runWithToast(() => invoke('approve_transfer', { transferId }), 'Approve failed');
  }, []);

  const rejectTransfer = useCallback(async (transferId: string) => {
    await runWithToast(() => invoke('reject_transfer', { transferId }), 'Reject failed');
  }, []);

  const pauseTransfer = useCallback(async (transferId: string) => {
    await runWithToast(() => invoke('pause_transfer', { transferId }), 'Pause failed');
  }, []);

  const resumeTransfer = useCallback(async (transferId: string) => {
    await runWithToast(() => invoke('resume_transfer', { transferId }), 'Resume failed');
  }, []);

  const cancelTransfer = useCallback(async (transferId: string) => {
    await runWithToast(() => invoke('cancel_transfer', { transferId }), 'Cancel failed');
  }, []);

  const revealFile = useCallback(async (path: string) => {
    await runWithToast(() => invoke('reveal_file', { filePath: path }), 'Reveal failed');
  }, []);

  /**
   * Re-send a file whose peer never confirmed. This starts a *new* transfer
   * rather than replaying the old id: a receiver that is mid-transfer dedupes
   * by id and would ignore the replay, while one that already saved the file
   * would be handed a second copy under a "(1)" name either way. A fresh id is
   * the only option whose worst case is a visible duplicate.
   */
  const resendTransfer = useCallback(
    async (item: TransferProgress) => {
      if (!item.savePath) return;
      const chunks = Math.max(1, item.totalChunks);
      const chunkSize = Math.ceil(Math.max(1, item.totalBytes) / chunks);
      await runWithToast(
        () =>
          invoke<string>('start_send_file', {
            filePath: item.savePath,
            chunkSize,
            qos: 1,
            customPublishTopic: item.channel || undefined,
          }),
        'Resend failed',
      );
    },
    [],
  );

  const clearFinished = useCallback(() => {
    setTransfers((prev) => {
      const next: Record<string, TransferProgress> = {};
      for (const [id, t] of Object.entries(prev)) {
        const terminal =
          t.status === 'delivered' ||
          t.status === 'completed' ||
          t.status === 'confirm_timeout' ||
          t.status === 'failed' ||
          t.status === 'cancelled';
        if (!terminal) next[id] = t;
      }
      return next;
    });
  }, []);

  /** Resolves when the given transfer reaches a terminal observation state. */
  const waitForSendComplete = useCallback((transferId: string): Promise<TransferProgress> => {
    return new Promise((resolve) => {
      const started = Date.now();

      const timer = setInterval(() => {
        const t = transfersRef.current[transferId];
        if (
          t &&
          (t.status === 'delivered' ||
            t.status === 'failed' ||
            t.status === 'cancelled' ||
            // The backend owns the "peer never confirmed" decision, and its
            // window scales with the file size. Duplicating a guess here is how
            // a batch ends up calling an unacknowledged send a success.
            t.status === 'confirm_timeout')
        ) {
          clearInterval(timer);
          resolve(t);
          return;
        }
        // Hard safety net: never block a batch forever
        if (Date.now() - started > 30 * 60_000) {
          clearInterval(timer);
          resolve(
            transfersRef.current[transferId] ?? {
              transferId,
              status: 'failed',
            } as TransferProgress,
          );
        }
      }, 250);
    });
  }, []);

  const awaitingApproval = Object.values(transfers).filter((t) => t.status === 'awaiting_approval');

  const activeCount = Object.values(transfers).filter(
    (t) => t.status === 'transferring' || t.status === 'verifying' || t.status === 'sent',
  ).length;

  return {
    transfers,
    transfersRef,
    activeCount,
    awaitingApproval,
    autoReceive,
    setAutoReceive,
    approveTransfer,
    rejectTransfer,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    revealFile,
    resendTransfer,
    clearFinished,
    waitForSendComplete,
  };
}
