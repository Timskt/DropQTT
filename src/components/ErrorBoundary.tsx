import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Translations, fill } from '../i18n';

interface Props {
  /** Which part of the UI is wrapped, shown in the fallback. */
  area: string;
  t: Translations;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a throwing panel from blanking the whole app. Without this, one bad
 * payload anywhere in a workspace leaves the user with an empty window and no
 * diagnostic at all.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.area}] render failed:`, error);
  }

  render() {
    const { error } = this.state;
    const { area, t } = this.props;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="panel p-5 space-y-3 max-w-2xl mx-auto"
        style={{ borderColor: 'var(--bad)', background: 'var(--bad-soft)' }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--bad)' }} />
          <span>{fill(t.uiCrashedTitle, { area })}</span>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {t.uiCrashedHint}
        </p>
        <pre
          className="select-text text-[11px] font-mono whitespace-pre-wrap break-words rounded-md border p-2.5 max-h-40 overflow-auto"
          style={{ background: 'var(--bg-code)', borderColor: 'var(--code-border)', color: 'var(--code-text)' }}
        >
          {String(error?.message || error)}
        </pre>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="btn-ghost !px-3 !py-1.5 flex items-center gap-1.5 text-xs"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t.uiCrashedRetry}
        </button>
      </div>
    );
  }
}
