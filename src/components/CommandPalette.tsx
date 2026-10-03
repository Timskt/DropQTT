import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'lucide-react';
import { Translations } from '../i18n';

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  /** What it will do, shown on the right; the label alone is often not enough. */
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
  t: Translations;
}

/**
 * The command palette exists mostly for discoverability: shared subscriptions, the
 * bench lab, RPC and the rule panels are all real features that a person cannot find
 * by looking at an empty console. It runs commands, not destructive ones - clearing
 * the feed or deleting a rule keeps its two-step guard in the place where you can see
 * what you are pointing at.
 *
 * The dialog mounts only while open, so "start with an empty query" is a mount, not a
 * state reset inside an effect.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, commands, onClose, t }) =>
  open ? <PaletteDialog commands={commands} onClose={onClose} t={t} /> : null;

const PaletteDialog: React.FC<{
  commands: PaletteCommand[];
  onClose: () => void;
  t: Translations;
}> = ({ commands, onClose, t }) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.group} ${c.label} ${c.hint ?? ''}`.toLowerCase().includes(q));
  }, [commands, query]);

  // Typing shortens the list, which can leave the cursor past its end; clamping on
  // read keeps that from costing another render.
  const selected = matches.length === 0 ? -1 : Math.min(cursor, matches.length - 1);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => restoreTo.current?.focus?.();
  }, []);

  const commit = (index: number) => {
    const cmd = matches[index];
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((i) => (matches.length ? (Math.min(i, matches.length - 1) + 1) % matches.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((i) => (matches.length ? (Math.min(i, matches.length - 1) - 1 + matches.length) % matches.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(selected);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.paletteTitle}
        className="panel w-full max-w-lg overflow-hidden"
        data-testid="command-palette"
      >
        <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-panel)' }}>
          <Command className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
          <input
            ref={inputRef}
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: 'var(--text-primary)' }}
            value={query}
            placeholder={t.palettePlaceholder}
            aria-label={t.palettePlaceholder}
            data-testid="palette-input"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--bg-code)', color: 'var(--text-muted)' }}>
            Esc
          </kbd>
        </div>

        <ul className="max-h-[46vh] overflow-y-auto py-1.5" role="listbox" aria-label={t.paletteTitle}>
          {matches.length === 0 && (
            <li className="px-3 py-2 text-xs italic" style={{ color: 'var(--text-muted)' }} data-testid="palette-empty">
              {t.paletteEmpty}
            </li>
          )}
          {matches.map((cmd, index) => (
            <React.Fragment key={cmd.id}>
              {cmd.group !== matches[index - 1]?.group && (
                <li className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  {cmd.group}
                </li>
              )}
              <li role="option" aria-selected={index === selected}>
                <button
                  type="button"
                  onClick={() => commit(index)}
                  onMouseMove={() => setCursor(index)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs"
                  style={{
                    background: index === selected ? 'var(--bg-code)' : 'transparent',
                    color: 'var(--text-primary)',
                  }}
                  data-testid={`palette-item-${cmd.id}`}
                >
                  <span className="truncate">{cmd.label}</span>
                  {cmd.hint && (
                    <span className="text-[10px] font-mono truncate shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {cmd.hint}
                    </span>
                  )}
                </button>
              </li>
            </React.Fragment>
          ))}
        </ul>

        <div className="px-3 py-1.5 text-[10px]" style={{ borderTop: '1px solid var(--border-panel)', color: 'var(--text-muted)' }}>
          {t.paletteHint}
        </div>
      </div>
    </div>
  );
};
