export type Theme = 'cyberpunk' | 'obsidian' | 'nord' | 'solaris';

export interface ThemeTokens {
  '--bg-app': string;
  '--bg-panel': string;
  '--bg-panel-solid': string;
  '--bg-inset': string;
  /** Code / payload display surface (kept dark in light themes, editor-style) */
  '--bg-code': string;
  '--code-text': string;
  '--code-border': string;
  '--code-key': string;
  '--code-string': string;
  '--code-number': string;
  '--code-boolean': string;
  '--code-punct': string;
  '--border-panel': string;
  '--border-inset': string;
  '--text-primary': string;
  '--text-secondary': string;
  '--text-muted': string;
  '--accent': string;
  '--accent-strong': string;
  '--accent-contrast': string;
  '--success': string;
  '--danger': string;
  '--warning': string;
  /** Theme-aware semantic status palette (text / soft-fill / border) so status
   *  chips render correctly on BOTH dark and light themes without !important
   *  overrides. Each hue keeps its meaning; only the tint flips per theme. */
  '--info': string;
  '--info-soft': string;
  '--info-border': string;
  '--ok': string;
  '--ok-soft': string;
  '--ok-border': string;
  '--warn': string;
  '--warn-soft': string;
  '--warn-border': string;
  '--bad': string;
  '--bad-soft': string;
  '--bad-border': string;
  '--violet': string;
  '--violet-soft': string;
  '--violet-border': string;
  '--sky': string;
  '--sky-soft': string;
  '--sky-border': string;
  '--indigo': string;
  '--indigo-soft': string;
  '--indigo-border': string;
  '--fuchsia': string;
  '--fuchsia-soft': string;
  '--fuchsia-border': string;
  /** Hover fill + generic overlay + panel elevation */
  '--hover': string;
  '--overlay': string;
  '--panel-shadow': string;
}

export interface ThemeDefinition {
  id: Theme;
  name: string;
  tokens: ThemeTokens;
}

const darkBase: ThemeTokens = {
  '--bg-app': 'radial-gradient(circle at 50% 0%, #111827 0%, #090b10 100%)',
  '--bg-panel': 'rgba(15, 23, 42, 0.72)',
  '--bg-panel-solid': '#0f172a',
  '--bg-inset': 'rgba(2, 6, 23, 0.8)',
  '--bg-code': 'rgba(2, 6, 23, 0.92)',
  '--code-text': '#d3dae6',
  '--code-border': 'rgba(148, 163, 184, 0.2)',
  '--code-key': '#e5c07b',
  '--code-string': '#98c379',
  '--code-number': '#d19a66',
  '--code-boolean': '#c678dd',
  '--code-punct': '#8b94a3',
  '--border-panel': 'rgba(71, 85, 105, 0.55)',
  '--border-inset': 'rgba(51, 65, 85, 0.5)',
  '--text-primary': '#f1f5f9',
  '--text-secondary': '#94a3b8',
  '--text-muted': '#64748b',
  '--accent': '#06b6d4',
  '--accent-strong': '#0891b2',
  '--accent-contrast': '#ffffff',
  '--success': '#34d399',
  '--danger': '#fb7185',
  '--warning': '#fbbf24',
  // Semantic status palette (dark: luminous text on translucent fills)
  '--info': '#22d3ee',
  '--info-soft': 'rgba(34, 211, 238, 0.13)',
  '--info-border': 'rgba(34, 211, 238, 0.34)',
  '--ok': '#34d399',
  '--ok-soft': 'rgba(52, 211, 153, 0.13)',
  '--ok-border': 'rgba(52, 211, 153, 0.34)',
  '--warn': '#fbbf24',
  '--warn-soft': 'rgba(251, 191, 36, 0.13)',
  '--warn-border': 'rgba(251, 191, 36, 0.34)',
  '--bad': '#fb7185',
  '--bad-soft': 'rgba(251, 113, 133, 0.13)',
  '--bad-border': 'rgba(251, 113, 133, 0.38)',
  '--violet': '#c4b5fd',
  '--violet-soft': 'rgba(167, 139, 250, 0.15)',
  '--violet-border': 'rgba(167, 139, 250, 0.38)',
  '--sky': '#7dd3fc',
  '--sky-soft': 'rgba(56, 189, 248, 0.13)',
  '--sky-border': 'rgba(56, 189, 248, 0.34)',
  '--indigo': '#a5b4fc',
  '--indigo-soft': 'rgba(129, 140, 248, 0.15)',
  '--indigo-border': 'rgba(129, 140, 248, 0.38)',
  '--fuchsia': '#e879f9',
  '--fuchsia-soft': 'rgba(232, 121, 249, 0.14)',
  '--fuchsia-border': 'rgba(217, 70, 239, 0.4)',
  '--hover': 'rgba(148, 163, 184, 0.1)',
  '--overlay': 'rgba(2, 6, 23, 0.55)',
  '--panel-shadow': '0 1px 0 rgba(255, 255, 255, 0.03) inset',
};

export const themes: Record<Theme, ThemeDefinition> = {
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk Neon',
    tokens: { ...darkBase },
  },
  obsidian: {
    id: 'obsidian',
    name: 'Midnight Obsidian (OLED)',
    tokens: {
      ...darkBase,
      '--bg-app': '#000000',
      '--bg-panel': 'rgba(17, 17, 17, 0.9)',
      '--bg-panel-solid': '#121212',
      '--bg-inset': 'rgba(0, 0, 0, 0.85)',
      '--bg-code': 'rgba(10, 10, 12, 0.95)',
      '--border-panel': 'rgba(255, 255, 255, 0.12)',
      '--border-inset': 'rgba(255, 255, 255, 0.08)',
      '--accent': '#e4e4e7',
      '--accent-strong': '#a1a1aa',
      '--accent-contrast': '#09090b',
    },
  },
  nord: {
    id: 'nord',
    name: 'Nord Frost',
    tokens: {
      ...darkBase,
      '--bg-app': '#2e3440',
      '--bg-panel': 'rgba(59, 66, 82, 0.82)',
      '--bg-panel-solid': '#3b4252',
      '--bg-inset': 'rgba(46, 52, 64, 0.9)',
      '--bg-code': 'rgba(35, 40, 50, 0.95)',
      '--border-panel': 'rgba(136, 192, 208, 0.25)',
      '--border-inset': 'rgba(136, 192, 208, 0.15)',
      '--text-primary': '#eceff4',
      '--text-secondary': '#d8dee9',
      '--text-muted': '#7b88a1',
      '--accent': '#88c0d0',
      '--accent-strong': '#5e81ac',
      '--accent-contrast': '#2e3440',
      '--success': '#a3be8c',
      '--danger': '#bf616a',
      '--warning': '#ebcb8b',
    },
  },
  solaris: {
    id: 'solaris',
    name: 'Solaris Light',
    tokens: {
      // Warm-paper light theme: ivory canvases, slate-ink text, steel-blue accent,
      // and a dark editor-style code surface (like every serious light IDE theme).
      '--bg-app': 'linear-gradient(165deg, #faf9f6 0%, #f2f0ea 55%, #e9e5dc 100%)',
      '--bg-panel': 'rgba(255, 255, 255, 0.92)',
      '--bg-panel-solid': '#ffffff',
      '--bg-inset': 'rgba(120, 113, 108, 0.07)',
      '--bg-code': '#292e36',
      '--code-text': '#d3dae6',
      '--code-border': 'rgba(148, 163, 184, 0.28)',
      '--code-key': '#e5c07b',
      '--code-string': '#98c379',
      '--code-number': '#d19a66',
      '--code-boolean': '#c678dd',
      '--code-punct': '#8b94a3',
      '--border-panel': 'rgba(120, 113, 108, 0.26)',
      '--border-inset': 'rgba(120, 113, 108, 0.17)',
      '--text-primary': '#292524',
      '--text-secondary': '#57534e',
      '--text-muted': '#a8a29e',
      '--accent': '#2563eb',
      '--accent-strong': '#1d4ed8',
      '--accent-contrast': '#ffffff',
      '--success': '#15803d',
      '--danger': '#b91c1c',
      '--warning': '#b45309',
      // Semantic status palette (light: deep saturated text on faint tints, so
      // every chip/active-state stays legible on the ivory canvas)
      '--info': '#0e7490',
      '--info-soft': 'rgba(8, 145, 178, 0.1)',
      '--info-border': 'rgba(8, 145, 178, 0.28)',
      '--ok': '#15803d',
      '--ok-soft': 'rgba(21, 128, 61, 0.1)',
      '--ok-border': 'rgba(21, 128, 61, 0.28)',
      '--warn': '#b45309',
      '--warn-soft': 'rgba(180, 83, 9, 0.1)',
      '--warn-border': 'rgba(180, 83, 9, 0.28)',
      '--bad': '#b91c1c',
      '--bad-soft': 'rgba(185, 28, 28, 0.09)',
      '--bad-border': 'rgba(185, 28, 28, 0.26)',
      '--violet': '#6d28d9',
      '--violet-soft': 'rgba(109, 40, 217, 0.09)',
      '--violet-border': 'rgba(109, 40, 217, 0.26)',
      '--sky': '#0369a1',
      '--sky-soft': 'rgba(3, 105, 161, 0.1)',
      '--sky-border': 'rgba(3, 105, 161, 0.28)',
      '--indigo': '#4338ca',
      '--indigo-soft': 'rgba(67, 56, 202, 0.09)',
      '--indigo-border': 'rgba(67, 56, 202, 0.26)',
      '--fuchsia': '#a21caf',
      '--fuchsia-soft': 'rgba(162, 28, 175, 0.09)',
      '--fuchsia-border': 'rgba(162, 28, 175, 0.26)',
      '--hover': 'rgba(120, 113, 108, 0.09)',
      '--overlay': 'rgba(120, 113, 108, 0.06)',
      '--panel-shadow': '0 1px 2px rgba(41, 37, 36, 0.05), 0 10px 30px rgba(120, 113, 108, 0.12)',
    },
  },
};

/** Apply a theme's CSS custom properties to :root */
export function applyTheme(theme: Theme) {
  const def = themes[theme] || themes.cyberpunk;
  const root = document.documentElement;
  (Object.entries(def.tokens) as [string, string][]).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
  root.dataset.theme = theme;
}

/** Back-compatible flat accessor used by legacy props */
export function themeBodyBg(theme: Theme): string {
  return themes[theme]?.tokens['--bg-app'] ?? themes.cyberpunk.tokens['--bg-app'];
}
