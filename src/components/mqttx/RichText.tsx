import React, { useCallback, useMemo } from 'react';
import { marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

/**
 * Rich-text renderers for untrusted MQTT payloads.
 *
 * SECURITY: message content arrives from arbitrary brokers/publishers, so
 * - Markdown is converted then fully sanitized with DOMPurify (no scripts,
 *   no event handlers, dangerous URL schemes stripped). The only allowed
 *   interactive remnants are links (forced to _blank + noopener) and disabled
 *   task-list checkboxes.
 * - HTML is rendered inside a sandboxed iframe with ALL capabilities
 *   disabled (sandbox="" = no scripts, no same-origin, no forms).
 */

marked.setOptions({ gfm: true, breaks: true });

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function highlightCode(code: string, lang?: string): { html: string; label: string } {
  const hint = (lang || '').trim().toLowerCase().split(',')[0];
  if (hint && hljs.getLanguage(hint)) {
    try {
      return {
        html: hljs.highlight(code, { language: hint, ignoreIllegals: true }).value,
        label: hint,
      };
    } catch {
      /* fall through to auto-detect */
    }
  }
  if (code.length > 0 && code.length < 8000) {
    try {
      const auto = hljs.highlightAuto(code);
      if (auto.relevance > 5) {
        return { html: auto.value, label: auto.language || hint || 'text' };
      }
    } catch {
      /* plain output below */
    }
  }
  return { html: escapeHtml(code), label: hint || 'text' };
}

// Fenced code blocks become a dark editor surface: language badge + copy button.
// Classes survive sanitization (DOMPurify keeps class attributes); interactivity
// is wired afterwards via event delegation — never inline onclick handlers.
marked.use({
  renderer: {
    code(token: Tokens.Code): string {
      const { html, label } = highlightCode(token.text, token.lang ?? undefined);
      return (
        `<div class="md-pre">` +
          `<div class="md-pre-head">` +
            `<span class="md-pre-lang">${escapeHtml(label)}</span>` +
            `<button type="button" class="md-copy" data-copy>Copy</button>` +
          `</div>` +
          `<pre class="md-pre-body"><code class="hljs language-${escapeHtml(label)}">${html}</code></pre>` +
        `</div>`
      );
    },
  },
});

// GFM task lists: marked emits `<input type="checkbox" disabled>`; keep it
// (rendered state only) by extending the default allowed sets.
const purifyConfig = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'checked', 'disabled'],
};

/**
 * Post-process the sanitized DOM tree: force safe link behavior.
 * (Runs on the parsed element tree, before innerHTML assignment.)
 */
function decorate(root: HTMLElement): HTMLElement {
  root.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer nofollow');
  });
  return root;
}

export const MarkdownView: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(text) as string;
      const clean = DOMPurify.sanitize(raw, purifyConfig) as string;
      const tpl = document.createElement('div');
      tpl.innerHTML = clean;
      return decorate(tpl).innerHTML;
    } catch {
      return null;
    }
  }, [text]);

  // Delegated Copy buttons (no inline handlers survive sanitization)
  const handleClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest?.('.md-copy') as HTMLElement | null;
    if (!btn) return;
    const block = btn.closest('.md-pre');
    const code = block?.querySelector('code')?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = 'Copied ✓';
      btn.classList.add('md-copy-done');
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('md-copy-done');
      }, 1400);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  if (html === null) {
    return <pre className="text-[12px] whitespace-pre-wrap" style={{ color: 'var(--danger)' }}>{text}</pre>;
  }

  return (
    <div
      className={`rich-md ${className ?? ''}`}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

/** Fully-sandboxed HTML preview: opaque origin, zero capabilities */
export const HtmlPreview: React.FC<{ source: string; className?: string }> = ({ source, className }) => (
  <iframe
    title="HTML Preview"
    sandbox=""
    srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:13px;margin:10px;word-break:break-word;line-height:1.6}</style></head><body>${source}</body></html>`}
    className={`w-full min-h-[10rem] bg-white rounded-md border border-slate-700/60 ${className ?? ''}`}
  />
);
