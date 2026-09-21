/**
 * Clipboard copy with layered fallbacks.
 *
 * WKWebView (Tauri's macOS/Linux webview) frequently rejects
 * `navigator.clipboard.writeText` with NotAllowedError even from user
 * gestures, which made our copy buttons silently do nothing. This helper
 * tries the async Clipboard API first, then the classic hidden-textarea
 * `execCommand('copy')` path, and reports success to the caller.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. Modern async clipboard API (works in secure contexts with permission)
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }

  // 2. Legacy execCommand path — survives WKWebView clipboard restrictions
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
