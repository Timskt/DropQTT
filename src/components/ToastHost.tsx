import React, { useSyncExternalStore } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { subscribe, getSnapshot, dismiss, Toast } from '../utils/toast';

const KIND_STYLE: Record<Toast['kind'], { color: string; border: string; icon: React.ReactNode }> = {
  success: { color: 'var(--ok)', border: 'var(--ok-border)', icon: <CheckCircle2 className="w-4 h-4" /> },
  error: { color: 'var(--bad)', border: 'var(--bad-border)', icon: <AlertCircle className="w-4 h-4" /> },
  info: { color: 'var(--info)', border: 'var(--info-border)', icon: <Info className="w-4 h-4" /> },
};

/** Global toast surface — mount once near the app root. */
export const ToastHost: React.FC = () => {
  const toasts = useSyncExternalStore(subscribe, getSnapshot);
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const s = KIND_STYLE[t.kind];
        return (
          <div
            key={t.id}
            className="panel flex items-start gap-2 px-3 py-2 text-[12px] animate-fade-in shadow-lg"
            style={{ background: 'var(--bg-panel-solid)', borderColor: s.border, color: 'var(--text-primary)' }}
          >
            <span className="shrink-0 mt-0.5" style={{ color: s.color }}>{s.icon}</span>
            <span className="flex-1 break-words select-text">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 opacity-50 hover:opacity-100 transition"
              style={{ color: 'var(--text-muted)' }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
