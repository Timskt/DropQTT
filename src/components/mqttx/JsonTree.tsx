import React, { useMemo, useState } from 'react';

/**
 * Collapsible JSON tree viewer for message payloads. Objects/arrays fold with
 * a ▶/▼ caret and a compact summary; leaves are syntax-colored on the dark
 * code surface. Large containers start collapsed to keep huge payloads
 * scannable.
 */

const COLORS = {
  key: 'var(--code-key)',
  string: 'var(--code-string)',
  number: 'var(--code-number)',
  boolean: 'var(--code-boolean)',
  null: 'var(--code-punct)',
  punct: 'var(--code-punct)',
};

const MAX_PREVIEW = 120;
/** Containers bigger than this start collapsed */
const AUTO_COLLAPSE_ITEMS = 20;

function leafSpan(v: unknown): React.ReactNode {
  if (v === null) return <span style={{ color: COLORS.null }}>null</span>;
  switch (typeof v) {
    case 'string': {
      const shown = v.length > MAX_PREVIEW ? `${v.slice(0, MAX_PREVIEW)}…` : v;
      return (
        <span style={{ color: COLORS.string }} title={v}>
          "{shown}"
        </span>
      );
    }
    case 'number':
      return <span style={{ color: COLORS.number }}>{String(v)}</span>;
    case 'boolean':
      return <span style={{ color: COLORS.boolean }}>{String(v)}</span>;
    default:
      return <span style={{ color: COLORS.punct }}>{String(v)}</span>;
  }
}

const JsonNode: React.FC<{ name: string | null; value: unknown; depth: number }> = ({
  name,
  value,
  depth,
}) => {
  const isContainer = value !== null && typeof value === 'object';
  const entries: [string, unknown][] = useMemo(() => {
    if (!isContainer) return [];
    return Array.isArray(value)
      ? value.map((x, i) => [String(i), x] as [string, unknown])
      : Object.entries(value as Record<string, unknown>);
  }, [isContainer, value]);

  const [open, setOpen] = useState(depth < 2 && entries.length <= AUTO_COLLAPSE_ITEMS);

  if (!isContainer) {
    return (
      <div className="flex gap-1.5 leading-relaxed">
        {name !== null && <span style={{ color: COLORS.key }}>{name}:</span>}
        {leafSpan(value)}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const bracket = isArray ? ['[', ']'] : ['{', '}'];
  const preview = entries
    .slice(0, 3)
    .map(([k, v]) => (isArray ? '' : `${k}: `) + (typeof v === 'object' && v !== null ? '…' : String(v).slice(0, 24)))
    .join(', ');

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-start gap-1 text-left leading-relaxed hover:opacity-90"
      >
        <span className="shrink-0 w-3 text-[9px] mt-0.5" style={{ color: COLORS.punct }}>
          {open ? '▼' : '▶'}
        </span>
        <span>
          {name !== null && <span style={{ color: COLORS.key }}>{name}: </span>}
          <span style={{ color: COLORS.punct }}>
            {bracket[0]}
            {!open && (
              <span className="opacity-70">
                {' '}
                {preview}
                {entries.length > 3 ? ', …' : ''}{' '}
              </span>
            )}
            {bracket[1]}
          </span>
          <span className="ml-1.5 text-[10px]" style={{ color: COLORS.punct }}>
            {entries.length} {isArray ? 'items' : 'keys'}
          </span>
        </span>
      </button>
      {open && (
        <div className="pl-4 ml-1.5 border-l" style={{ borderColor: 'var(--code-border)' }}>
          {entries.map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const JsonTree: React.FC<{ text: string }> = ({ text }) => {
  const data = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false as const };
    }
  }, [text]);

  if (!data.ok) {
    return (
      <pre className="text-[12px] whitespace-pre-wrap" style={{ color: 'var(--code-text)' }}>
        {text}
      </pre>
    );
  }
  return (
    <div className="text-[12px] font-mono select-text">
      <JsonNode name={null} value={data.value} depth={0} />
    </div>
  );
};
