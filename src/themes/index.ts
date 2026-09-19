export type Theme = 'cyberpunk' | 'obsidian' | 'nord' | 'solaris';

export interface ThemeTokens {
  '--bg-app': string;
  '--bg-panel': string;
  '--bg-panel-solid': string;
  '--bg-inset': string;
  /** Code / payload display surface (kept dark in light themes, editor-style) */
  '--bg-code': string;
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
