import { useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import confetti from 'canvas-confetti';
import { BatchFileItem, TransferProgress } from '../types';
import { prefersReducedMotion } from '../utils/motion';

interface UseBatchSenderOptions {
  publishTopic: string;
  waitForSendComplete: (transferId: string) => Promise<TransferProgress>;
}

/**
 * Sequential batch file sender driven by backend transfer receipts.
 */
export function useBatchSender({ publishTopic, waitForSendComplete }: UseBatchSenderOptions) {
  const [batchFiles, setBatchFiles] = useState<BatchFileItem[]>([]);
  const [isSendingBatch, setIsSendingBatch] = useState(false);
  const [sendingIndex, setSendingIndex] = useState(0);
  const cancelRef = useRef(false);

  const addBatchFiles = useCallback((newFiles: { path: string; name: string; size: number }[]) => {
    const items: BatchFileItem[] = newFiles.map((f) => ({
      id: `batch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      path: f.path,
      name: f.name,
      size: f.size,
      status: 'pending',
    }));
    setBatchFiles((prev) => [...prev, ...items]);
  }, []);

  const removeBatchFile = useCallback((id: string) => {
    setBatchFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearBatchFiles = useCallback(() => setBatchFiles([]), []);

  const requestBatchCancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const startSendBatch = useCallback(
    async (chunkSize: number, qos: number) => {
      // Read the latest queue from a functional update to avoid stale closures
      const queue = await new Promise<BatchFileItem[]>((resolve) => {
        setBatchFiles((prev) => {
          resolve(prev);
          return prev;
        });
      });

      if (queue.length === 0 || isSendingBatch) return;

      setIsSendingBatch(true);
      cancelRef.current = false;

      for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        if (current.status === 'completed') continue;

        setSendingIndex(i);

        if (cancelRef.current) {
          setBatchFiles((prev) =>
            prev.map((item, idx) => (idx >= i ? { ...item, status: 'failed', error: 'Batch cancelled' } : item)),
          );
          break;
        }

        setBatchFiles((prev) => prev.map((item, idx) => (idx === i ? { ...item, status: 'sending' } : item)));

        try {
          const transferId = await invoke<string>('start_send_file', {
            filePath: current.path,
            chunkSize,
            qos,
            customPublishTopic: publishTopic.trim() || undefined,
          });

          const final = await waitForSendComplete(transferId);
          const ok = final.status === 'delivered' || final.status === 'sent';

          setBatchFiles((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? {
                    ...item,
                    status: ok ? 'completed' : 'failed',
                    transferId,
                    error: ok ? undefined : final.errorMessage ?? final.status,
                  }
                : item,
            ),
          );
        } catch (err) {
          setBatchFiles((prev) =>
            prev.map((item, idx) => (idx === i ? { ...item, status: 'failed', error: String(err) } : item)),
          );
        }
      }

      setIsSendingBatch(false);
      if (!cancelRef.current && !prefersReducedMotion()) {
        confetti({ particleCount: 80, spread: 80, origin: { y: 0.7 } });
      }
    },
    [isSendingBatch, publishTopic, waitForSendComplete],
  );

  return {
    batchFiles,
    setBatchFiles,
    isSendingBatch,
    sendingIndex,
    addBatchFiles,
    removeBatchFile,
    clearBatchFiles,
    startSendBatch,
    requestBatchCancel,
  };
}
