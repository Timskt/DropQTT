/**
 * Minimal global toast store (no context plumbing). Components render via
 * <ToastHost/>; any module can push feedback with `toast.success/error/info`.
 * Replaces the scattered ad-hoc feedback + swallowed console errors (P1-3/P1-6).
 */
export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): Toast[] {
  return toasts;
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string) {
  const t: Toast = { id: ++seq, kind, message };
  toasts = [...toasts, t];
  emit();
  const ttl = kind === 'error' ? 5000 : 2800;
  setTimeout(() => dismiss(t.id), ttl);
}

export const toast = {
  success: (m: string) => push('success', m),
  error: (m: string) => push('error', m),
  info: (m: string) => push('info', m),
};

/** Run an async action, surfacing failures as an error toast. Returns success. */
export async function runWithToast(action: () => Promise<unknown>, errorPrefix: string): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (e) {
    toast.error(`${errorPrefix}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
