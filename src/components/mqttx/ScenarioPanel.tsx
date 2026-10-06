import React, { useEffect, useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { ClipboardList, FileUp, Loader2, Save } from 'lucide-react';
import { AssertionRule, ResponderRule, SilenceRule, SubOptions } from '../../types';
import { usePersistentState } from '../../hooks/usePersistentState';
import { fill, Translations } from '../../i18n';
import {
  applyPlan,
  claimLines,
  collectScenario,
  judgeScenario,
  parseScenario,
  renderScenarioReport,
  reportFileName,
  Scenario,
  scenarioFileName,
  serializeScenario,
  Verdict,
  VerdictLine,
} from '../../utils/scenario';
import { saveTextFile } from '../../utils/exportMessages';

interface ScenarioPanelProps {
  t: Translations;
  isV5: boolean;
  subscriptions: { topic: string; qos: number; options?: SubOptions }[];
  responders: ResponderRule[];
  assertions: AssertionRule[];
  assertionStats: { matched: number; passed: number; violated: number; unevaluable: number };
  rejectedSubs: number;
  onReplaceResponders: (next: ResponderRule[]) => void;
  onReplaceAssertions: (next: AssertionRule[]) => void;
  onSubscribe: (topic: string, qos: number, options: SubOptions) => void;
}

const stateColor = (state: VerdictLine['state']): string =>
  state === 'pass' ? 'var(--success)' : state === 'fail' ? 'var(--danger)' : 'var(--text-muted)';

/** The three roll-up states, in the reader's language: a bare "fail" on a button
 *  in an otherwise localised panel is the sort of thing that reads as a bug. */
const stateWord = (state: Verdict['overall'], t: Translations): string =>
  state === 'pass' ? t.scenarioPass : state === 'fail' ? t.scenarioFail : t.scenarioUnknown;

/**
 * The acceptance scenario: subscriptions + simulated devices + assertions + watchdogs
 * + one load spec, saved as one file and judged at the end.
 *
 * What makes this more than a settings export is the verdict. A simulator that draws
 * curves leaves "is this good?" to the reader; this states which bar was set, what was
 * measured, and whether it was met — and refuses to call an unset bar a pass.
 *
 * The panel applies the three sets it owns (subscriptions, responder rules, assertions)
 * and says plainly which parts of the file it did **not** apply here: watchdogs live in
 * the Data Bridge panel and the load spec in the bench lab. Reporting a partial apply is
 * the whole point — a scenario that looked fully installed would be a lie about rig state.
 *
 * Paste-in is a first-class input: these files travel in tickets and chat, and nobody
 * should have to save one to disk to try it.
 */
export const ScenarioPanel: React.FC<ScenarioPanelProps> = (props) => {
  const { t, isV5, subscriptions, responders, assertions } = props;
  /**
   * Read-only on purpose: the watchdog set belongs to the Data Bridge panel, which is
   * the only writer of that key — and it is mounted in bridge mode while this panel is
   * mounted in console mode, so the two never coexist to fight over it. A scenario has
   * to *capture* the watchdogs, and losing them silently would make the file a partial
   * picture of the rig.
   */
  const [silenceRules] = usePersistentState<SilenceRule[]>('dropqtt_silence_rules', []);
  const [name, setName] = useState('Fleet acceptance');
  const [note, setNote] = useState('');
  const [pasted, setPasted] = useState('');
  const [loaded, setLoaded] = useState<Scenario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const snapshot = useMemo(
    () =>
      collectScenario(
        { name, note, subscriptions, responders, assertions, silence: silenceRules },
        new Date().toISOString(),
      ),
    [assertions, name, note, responders, silenceRules, subscriptions],
  );

  /**
   * The bar belongs to the rig being judged, not to the panel: loading a scenario is
   * what sets a bar, and an unloaded panel has nothing to measure against -- which the
   * backend reports as `noBarSet`, unknown rather than green.
   */
  const expect = loaded?.bench?.expect ?? null;
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  // Judged by `scenario.rs`, the same code the CLI's exit code comes from. A verdict
  // computed here as well would be a second opinion nobody asked for, and the first
  // change to either rule would make the screen disagree with the pipeline.
  useEffect(() => {
    let alive = true;
    void judgeScenario({ expect, assertions: props.assertionStats, refused: props.rejectedSubs }).then((next) => {
      if (alive && next) setVerdict(next);
    });
    return () => {
      alive = false;
    };
  }, [expect, props.assertionStats, props.rejectedSubs]);

  const lines = useMemo(() => claimLines(verdict?.claims ?? [], t), [verdict, t]);
  const overall: Verdict['overall'] = verdict?.overall ?? 'unknown';

  const writeReport = async (ext: 'json' | 'xml') => {
    setBusy(true);
    try {
      const text = await renderScenarioReport({
        expect,
        assertions: props.assertionStats,
        refused: props.rejectedSubs,
        name: snapshot.name,
        ...(snapshot.note ? { note: snapshot.note } : {}),
        labels: lines.map((line) => line.claim),
        words: { fail: t.scenarioFail, unknown: t.scenarioUnknown },
        format: ext === 'json' ? 'json' : 'junit',
      });
      if (text === null) {
        setError(t.scenarioReportFailed);
        return;
      }
      await saveTextFile(reportFileName(snapshot.name, ext), text);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportScenario = async () => {
    setBusy(true);
    try {
      await saveTextFile(scenarioFileName(snapshot.name), serializeScenario(snapshot));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const readText = async (path: string): Promise<string> => {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(path);
  };

  const loadFile = async () => {
    const picked = await openDialog({ multiple: false, directory: false, filters: [{ name: 'DropQTT scenario', extensions: ['dqscn', 'json'] }] });
    if (typeof picked !== 'string') return;
    try {
      setLoaded(parseScenario(await readText(picked)));
      setError(null);
      setNotes([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoaded(null);
    }
  };

  const apply = (scenario: Scenario) => {
    const plan = applyPlan(scenario, isV5, {
      v3Responders: (n) => fill(t.scenarioSkipV3, { n: String(n) }),
      strippedWebhooks: (n) => fill(t.scenarioSkipWebhooks, { n: String(n) }),
      noBar: (nm) => fill(t.scenarioSkipNoBar, { name: nm }),
    });
    props.onReplaceResponders(plan.responders);
    props.onReplaceAssertions(plan.assertions);
    const active = new Set(subscriptions.map((s) => s.topic));
    for (const sub of plan.subscriptions) {
      if (active.has(sub.topic)) continue;
      props.onSubscribe(sub.topic, sub.options?.qos ?? sub.qos, sub.options ?? { qos: sub.qos, noLocal: false, retainAsPublished: false, retainHandling: 0 });
    }
    // Parts this panel cannot install, stated rather than skipped quietly.
    const rest: string[] = [...plan.skipped];
    if (scenario.silence.length > 0) rest.push(fill(t.scenarioSkipElsewhere, { n: String(scenario.silence.length), where: t.modeBridge }));
    if (scenario.bench) rest.push(fill(t.scenarioSkipElsewhere, { n: '1', where: t.scenarioBenchLab }));
    setNotes(rest);
    setError(null);
  };

  return (
    <div className="inset-box px-3 py-2.5 space-y-2" data-testid="scenario-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <ClipboardList className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t.scenarioTitle}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {t.scenarioHint}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="field-input flex-1 min-w-[10rem] text-[11px]"
          aria-label={t.scenarioName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="scenario-name"
        />
        <input
          className="field-input flex-1 min-w-[10rem] text-[11px]"
          aria-label={t.scenarioNote}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.scenarioNotePlaceholder}
          data-testid="scenario-note"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => void exportScenario()}
          disabled={busy}
          className="btn-ghost !px-2.5 !py-1 flex items-center gap-1 text-[11px]"
          title={fill(t.scenarioExportHint, {
            subs: String(subscriptions.length),
            responders: String(responders.length),
            assertions: String(assertions.length),
            watchdogs: String(silenceRules.length),
          })}
          data-testid="scenario-export"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          {t.scenarioExport}
        </button>
        <button
          type="button"
          onClick={() => void loadFile()}
          className="btn-ghost !px-2.5 !py-1 flex items-center gap-1 text-[11px]"
          data-testid="scenario-load"
        >
          <FileUp className="w-3 h-3" />
          {t.scenarioLoad}
        </button>
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {fill(t.scenarioCounts, {
            subs: String(subscriptions.length),
            responders: String(responders.length),
            assertions: String(assertions.length),
            watchdogs: String(silenceRules.length),
          })}
        </span>
      </div>

      <div className="space-y-1">
        <label className="block text-[10px] font-mono" style={{ color: 'var(--text-muted)' }} htmlFor="scenario-paste">
          {t.scenarioPasteHint}
        </label>
        <textarea
          id="scenario-paste"
          className="field-input w-full text-[10px] font-mono"
          rows={3}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          data-testid="scenario-paste"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1 text-[11px]"
            disabled={!pasted.trim()}
            title={pasted.trim() ? undefined : t.scenarioPasteDisabled}
            onClick={() => {
              try {
                setLoaded(parseScenario(pasted));
                setError(null);
                setNotes([]);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setLoaded(null);
              }
            }}
            data-testid="scenario-parse"
          >
            {t.scenarioParse}
          </button>
          {loaded && (
            <button type="button" className="btn-accent !px-2.5 !py-1 text-[11px]" onClick={() => apply(loaded)} data-testid="scenario-apply">
              {t.scenarioApply}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-[10px] font-mono" style={{ color: 'var(--danger)' }} data-testid="scenario-error">
          {error}
        </p>
      )}

      {loaded && (
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }} data-testid="scenario-loaded">
          {fill(t.scenarioLoaded, {
            name: loaded.name,
            subs: String(loaded.subscriptions.length),
            responders: String(loaded.responders.length),
            assertions: String(loaded.assertions.length),
            watchdogs: String(loaded.silence.length),
          })}
        </p>
      )}

      {/* Applying swaps whole rule sets, which is how every other rule surface in
          this app behaves — but "Apply here" must not be the place someone loses
          rules they did not know were being replaced. */}
      {loaded && (loaded.responders.length > 0 || loaded.assertions.length > 0) && (
        <p className="text-[10px]" style={{ color: 'var(--warning)' }} data-testid="scenario-replaces">
          {fill(t.scenarioReplaces, {
            responders: String(responders.length),
            assertions: String(assertions.length),
          })}
        </p>
      )}

      {notes.length > 0 && (
        <ul className="space-y-0.5" data-testid="scenario-notes">
          {notes.map((n) => (
            <li key={n} className="text-[10px]" style={{ color: 'var(--warning)' }}>
              {n}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1" data-testid="scenario-verdict">
        <span className="text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t.scenarioVerdict}
        </span>
        {lines.map((line) => (
          <div key={line.id} className="flex items-center gap-2 text-[10px] font-mono" data-testid={`verdict-${line.id}`}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: stateColor(line.state) }} aria-hidden />
            <span style={{ color: 'var(--text-primary)' }}>{line.claim}</span>
            <span className="ml-auto" style={{ color: stateColor(line.state) }}>
              {line.actual} · {stateWord(line.state, t)}
            </span>
          </div>
        ))}
        <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }} data-testid="scenario-caveat">
          {t.scenarioCaveat}
        </p>
        {/* The verdict is only useful if it can leave the window. JUnit because a CI
            reporter reads that shape; JSON because a person greps for it. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1 text-[11px]"
            title={t.scenarioReportHint}
            onClick={() => void writeReport('json')}
            data-testid="scenario-report-json"
          >
            {fill(t.scenarioReportJson, { overall: stateWord(overall, t) })}
          </button>
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1 text-[11px]"
            title={t.scenarioReportHint}
            onClick={() => void writeReport('xml')}
            data-testid="scenario-report-junit"
          >
            {fill(t.scenarioReportJunit, { overall: stateWord(overall, t) })}
          </button>
        </div>
      </div>
    </div>
  );
};
