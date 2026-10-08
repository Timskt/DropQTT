import React, { useMemo } from 'react';
import { GitCompareArrows, X } from 'lucide-react';
import { HistoryRow } from '../../types';
import { Translations, fill } from '../../i18n';
import { diffMessages, diffMetadata, DiffNote, FieldChange } from '../../utils/messageDiff';

const NOTE_KEYS: Record<DiffNote['code'], keyof Translations> = {
  cap: 'historyCompareNoteCap',
  depth: 'historyCompareNoteDepth',
  wide: 'historyCompareNoteWide',
};

const noteText = (n: DiffNote, t: Translations): string => {
  const key = NOTE_KEYS[n.code];
  switch (n.code) {
    case 'cap':
      return fill(t[key], { count: '200' });
    case 'depth':
      return fill(t[key], { depth: '6', path: n.path });
    default:
      return fill(t[key], { before: String(n.before), after: String(n.after) });
  }
};

const ChangeRow: React.FC<{ c: FieldChange; t: Translations }> = ({ c, t }) => {
  const color = c.type === 'added' ? 'var(--ok)' : c.type === 'removed' ? 'var(--warn)' : 'var(--accent)';
  return (
    <div
      className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-3 py-1 text-[10px] font-mono"
      style={{ borderLeft: `2px solid ${color}`, borderTop: '1px solid var(--border-inset)' }}
    >
      <span className="truncate" title={c.path} style={{ color: 'var(--text-secondary)' }}>{c.path}</span>
      <span className="truncate" title={c.before} style={{ color: c.before ? 'var(--warn)' : 'var(--text-muted)' }}>
        {c.before || t.historyCompareAdded}
      </span>
      <span className="truncate" title={c.after} style={{ color: c.after ? 'var(--ok)' : 'var(--text-muted)' }}>
        {c.after || t.historyCompareRemoved}
      </span>
    </div>
  );
};

interface Props {
  a: HistoryRow;
  b: HistoryRow;
  t: Translations;
  onClear: () => void;
}

export const MessageDiffCard: React.FC<Props> = ({ a, b, t, onClear }) => {
  const payloadDiff = useMemo(() => diffMessages(a, b), [a, b]);
  const meta = useMemo(() => diffMetadata(a, b), [a, b]);
  const { counts, fields, lines, notes, kind, identical, unreliable } = payloadDiff;

  return (
    <div className="inset-box mb-2" data-testid="message-diff">
      <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--border-inset)' }}>
        <span className="flex items-center gap-2 text-[11px] font-medium">
          <GitCompareArrows className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          {t.historyCompareTitle}
        </span>
        <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          <span className="chip chip-info">{t.historyCompareSlotA}</span>
          <span className="max-w-[22%] truncate" title={a.topic}>{a.topic}</span>
          <span style={{ color: 'var(--text-muted)' }}>{fill(t.historyCompareGap, { seconds: Math.round(meta.gapMs / 1000) })}</span>
          <span className="chip chip-neutral">{t.historyCompareSlotB}</span>
          <span className="max-w-[22%] truncate" title={b.topic}>{b.topic}</span>
          <button onClick={onClear} className="btn-ghost !px-2 !py-0.5 flex items-center gap-1" data-testid="diff-clear">
            <X className="w-3 h-3" /> {t.historyCompareClear}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 text-[10px]" style={{ borderBottom: '1px solid var(--border-inset)' }}>
        <span className="chip chip-neutral">{kind}</span>
        {identical && <span style={{ color: 'var(--ok)' }}>{t.historyCompareIdentical}</span>}
        {!identical && (
          <>
            <span style={{ color: 'var(--ok)' }}>+{counts.added} {t.historyCompareAdded}</span>
            <span style={{ color: 'var(--warn)' }}>-{counts.removed} {t.historyCompareRemoved}</span>
            <span style={{ color: 'var(--accent)' }}>{counts.changed} {t.historyCompareChanged}</span>
          </>
        )}
      </div>

      {(unreliable || kind === 'binary' || notes.length > 0) && (
        <div className="px-3 py-1.5 flex flex-col gap-1 text-[10px]" style={{ borderBottom: '1px solid var(--border-inset)', color: 'var(--warn)' }}>
          {unreliable && <div data-testid="diff-unreliable">{t.historyCompareUnreliable}</div>}
          {kind === 'binary' && <div>{t.historyCompareBinary}</div>}
          {notes.map((n, i) => (
            <div key={i} data-testid="diff-note">{noteText(n, t)}</div>
          ))}
        </div>
      )}

      {meta.fields.length > 0 && (
        <div className="px-3 py-1.5 text-[10px]" style={{ borderBottom: '1px solid var(--border-inset)', color: 'var(--text-muted)' }}>
          <span className="ui-label">{t.historyCompareMeta}: </span>
          {meta.fields.map((f) => (
            <span key={f.path} className="font-mono">
              {f.path} {f.before || '—'} → {f.after || '—'}{'  '}
            </span>
          ))}
        </div>
      )}

      {kind === 'text' ? (
        <div className="max-h-[30vh] overflow-y-auto font-mono text-[10px] py-1">
          {lines.map((l, i) => (
            <div
              key={i}
              className="px-3 py-0.5 whitespace-pre-wrap break-all"
              style={
                l.type === 'added'
                  ? { color: 'var(--ok)', background: 'color-mix(in srgb, var(--ok) 8%, transparent)' }
                  : l.type === 'removed'
                    ? { color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 8%, transparent)' }
                    : l.type === 'uncompared'
                      ? { color: 'var(--text-muted)', fontStyle: 'italic' }
                      : { color: 'var(--text-muted)' }
              }
            >
              {l.type === 'added' ? '+ ' : l.type === 'removed' ? '- ' : '  '}
              {l.type === 'uncompared' ? notes.map((n) => (n.code === 'wide' ? noteText(n, t) : ''))[0] : l.text}
            </div>
          ))}
        </div>
      ) : (
        <div className="max-h-[30vh] overflow-y-auto py-1">
          {fields.map((f, i) => (
            <ChangeRow key={`${f.path}-${i}`} c={f} t={t} />
          ))}
        </div>
      )}
    </div>
  );
};
