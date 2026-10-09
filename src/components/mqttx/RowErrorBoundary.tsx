import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Row-level error isolation. When a single message row throws during render,
 * show a minimal chip rather than blanking the whole feed.
 */
export class RowErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[RowErrorBoundary] row render failed:', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="msg-row pt-2.5 text-xs flex items-center gap-2 px-2 py-1.5 rounded-md"
        style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-border)' }}
      >
        <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--bad)' }} />
        <span style={{ color: 'var(--text-secondary)' }}>row failed to render</span>
      </div>
    );
  }
}
