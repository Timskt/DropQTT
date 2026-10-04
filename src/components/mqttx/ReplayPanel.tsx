import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Film, Loader2, Play, Square } from 'lucide-react';
import { ConsolePublishParams } from '../../types';
import { CaptureEvent, CaptureFile, paceFor, parseCapture, summarizeCapture, CaptureError } from '../../utils/capture';
import { fill, Translations } from '../../i18n';

interface ReplayPanelProps {
  t: Translations;
  connected: boolean;
  isV5: boolean;
  onPublish: (params: ConsolePublishParams) => Promise<void>;
}

type Which = 'in' | 'out' | 'both';

const SPEEDS = [1, 2, 5, 10];

/** How a recorded message becomes a publish. Properties are carried only when the
 *  session can actually send them, so a v3 replay does not silently drop half a file. */
const toParams = (e: CaptureEvent, isV5: boolean): ConsolePublishParams => ({
  topic: e.topic,
  payloadBase64: e.payloadBase64,
  qos: e.qos,
  retain: e.retain,
  properties: {
    userProperties: (isV5 && e.props?.userProperties) || [],
    contentType: (isV5 ? e.props?.contentType : undefined) ?? undefined,
    responseTopic: (isV5 ? e.props?.responseTopic : undefined) ?? undefined,
    correlationData: (isV5 ? e.props?.correlationData : undefined) ?? undefined,
    correlationHex: (isV5 ? e.props?.correlationHex : undefined) ?? undefined,
    payloadFormat: (isV5 ? e.props?.payloadFormat : undefined) ?? undefined,
    messageExpiry: (isV5 ? e.props?.messageExpiry : undefined) ?? undefined,
  },
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * Session replay: put a captured minute of real traffic back onto a broker.
 *
 * The reason this exists is the gap between "I saw it at the site" and "here, run it
 * again". The capture keeps the intervals between messages, because a device that
 * reported every 30 s and one that burst 300 messages in a second are different bugs.
 *
 * It publishes through the same path as the console form, so whatever the broker
 * accepts from the form is what it accepts here — no second protocol implementation.
 */
export const ReplayPanel: React.FC<ReplayPanelProps> = ({ t, connected, isV5, onPublish }) => {
  const [capture, setCapture] = useState<CaptureFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [which, setWhich] = useState<Which>('in');
  const [speed, setSpeed] = useState(1);
  const [gapCapMs, setGapCapMs] = useState(2000);
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const stopRef = useRef(false);
  const runningRef = useRef(false);

  const queue = useMemo(() => {
    if (!capture) return [];
    return capture.events.filter((e) => (which === 'both' ? true : e.direction === which));
  }, [capture, which]);

  const gaps = useMemo(() => paceFor(queue, speed, gapCapMs), [queue, speed, gapCapMs]);
  const summary = useMemo(() => (capture ? summarizeCapture(capture.events) : null), [capture]);
  const totalWaitMs = gaps.reduce((a, b) => a + b, 0);

  useEffect(() => {
    // Unmounting must not leave a loop publishing into a broker nobody is watching.
    stopRef.current = true;
  }, []);

  const load = useCallback(async () => {
    const picked = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: 'DropQTT capture', extensions: ['dqrec', 'jsonl', 'txt'] }],
    });
    if (typeof picked !== 'string') return;
    try {
      const text = await invoke<string>('read_capture_file', { path: picked });
      const parsed = parseCapture(text);
      setCapture(parsed);
      setError(null);
      setSent(0);
      setFailed(0);
      setFileName(picked.replace(/^.*[\\/]/, ''));
    } catch (e) {
      setCapture(null);
      setError(e instanceof CaptureError ? e.message : String(e));
    }
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setSent(0);
    setFailed(0);
    let done = 0;
    let bad = 0;
    for (let i = 0; i < queue.length; i += 1) {
      if (stopRef.current) break;
      if (gaps[i] > 0) await wait(gaps[i]);
      if (stopRef.current) break;
      try {
        await onPublish(toParams(queue[i], isV5));
        done += 1;
      } catch (e) {
        // One rejected topic must not abandon the rest of the recording.
        bad += 1;
        setError(String(e));
      }
      setSent(done);
      setFailed(bad);
    }
    runningRef.current = false;
    setRunning(false);
  }, [gaps, isV5, onPublish, queue]);

  const stop = () => {
    stopRef.current = true;
  };

  const cannotRun = !capture || queue.length === 0;
  const runTitle = !connected
    ? t.replayDisabledDisconnected
    : cannotRun
      ? which === 'out'
        ? t.replayDisabledNoOut
        : t.replayDisabledEmpty
      : undefined;

  return (
    <div className="inset-box px-3 py-2.5 space-y-2" data-testid="replay-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <Film className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t.replayTitle}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {t.replayHint}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="btn-ghost !px-2.5 !py-1 flex items-center gap-1 text-[11px] ml-auto"
          data-testid="replay-load"
        >
          {t.replayLoad}
        </button>
      </div>

      {error && (
        <p className="text-[10px] font-mono" style={{ color: 'var(--danger)' }} data-testid="replay-error">
          {error}
        </p>
      )}

      {!capture && !error && (
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }} data-testid="replay-empty">
          {t.replayNoFile}
        </p>
      )}

      {capture && summary && (
        <div className="space-y-2">
          <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }} data-testid="replay-summary">
            <span className="truncate" title={fileName ?? ''}>
              {fileName}
            </span>
            {' · '}
            {fill(t.replayCounts, {
              count: String(summary.count),
              span: (summary.spanMs / 1000).toFixed(1),
              topics: String(summary.topics),
              inbound: String(summary.inbound),
              outbound: String(summary.outbound),
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {t.replayWhich}
              <select
                className="field-input text-[10px] font-mono"
                value={which}
                onChange={(e) => setWhich(e.target.value as Which)}
                data-testid="replay-which"
              >
                <option value="in">{t.replayWhichIn}</option>
                <option value="out">{t.replayWhichOut}</option>
                <option value="both">{t.replayWhichBoth}</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {t.replaySpeed}
              <select
                className="field-input text-[10px] font-mono"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                data-testid="replay-speed"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {fill(t.replaySpeedTimes, { n: String(s) })}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {t.replayGapCap}
              <input
                type="number"
                min={0}
                className="field-input w-20 text-[10px] font-mono"
                value={gapCapMs}
                onChange={(e) => setGapCapMs(Number(e.target.value))}
                data-testid="replay-gap-cap"
              />
            </label>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {!running ? (
              <button
                type="button"
                onClick={() => void run()}
                disabled={!!runTitle}
                title={runTitle}
                className="btn-accent !px-3 !py-1 flex items-center gap-1 text-[11px] disabled:opacity-50"
                data-testid="replay-start"
              >
                <Play className="w-3 h-3" />
                {fill(t.replayStart, { n: String(queue.length) })}
              </button>
            ) : (
              <button
                type="button"
                onClick={stop}
                className="btn-ghost !px-3 !py-1 flex items-center gap-1 text-[11px]"
                data-testid="replay-stop"
              >
                <Square className="w-3 h-3" />
                {t.replayStop}
              </button>
            )}
            {running && (
              <span className="text-[10px] font-mono flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <Loader2 className="w-3 h-3 animate-spin" />
                {fill(t.replayProgress, { sent: String(sent), total: String(queue.length), failed: String(failed) })}
              </span>
            )}
            {!running && (sent > 0 || failed > 0) && (
              <span className="text-[10px] font-mono" style={{ color: failed > 0 ? 'var(--danger)' : 'var(--success)' }} data-testid="replay-result">
                {fill(t.replayFinished, { sent: String(sent), total: String(queue.length), failed: String(failed) })}
              </span>
            )}
            <span className="text-[10px] font-mono ml-auto" style={{ color: 'var(--text-muted)' }}>
              {fill(t.replayEta, { s: (totalWaitMs / 1000).toFixed(1) })}
            </span>
          </div>

          {!isV5 && (
            <p className="text-[10px]" style={{ color: 'var(--warning)' }} data-testid="replay-v3-note">
              {t.replayV3Note}
            </p>
          )}
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }} data-testid="replay-caveat">
            {t.replayCaveat}
          </p>
        </div>
      )}
    </div>
  );
};
