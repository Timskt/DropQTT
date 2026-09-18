export type Theme = 'cyberpunk' | 'obsidian' | 'nord' | 'solaris';

export interface ThemeDefinition {
  id: Theme;
  name: string;
  bodyBg: string;
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentGradient: string;
}

export const themes: Record<Theme, ThemeDefinition> = {
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk Neon',
    bodyBg: 'radial-gradient(circle at 50% 0%, #111827 0%, #090b10 100%)',
    cardBg: 'rgba(15, 23, 42, 0.70)',
    cardBorder: 'rgba(6, 182, 212, 0.20)',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    accent: '#06b6d4',
    accentGradient: 'from-cyan-500 via-blue-600 to-indigo-600',
  },
  obsidian: {
    id: 'obsidian',
    name: 'Midnight Obsidian (OLED)',
    bodyBg: '#000000',
    cardBg: 'rgba(18, 18, 18, 0.85)',
    cardBorder: 'rgba(255, 255, 255, 0.12)',
    textPrimary: '#ffffff',
    textSecondary: '#a1a1aa',
    accent: '#ffffff',
    accentGradient: 'from-zinc-100 via-zinc-400 to-zinc-600',
  },
  nord: {
    id: 'nord',
    name: 'Nord Frost',
    bodyBg: '#2e3440',
    cardBg: 'rgba(59, 66, 82, 0.75)',
    cardBorder: 'rgba(136, 192, 208, 0.25)',
    textPrimary: '#eceff4',
    textSecondary: '#d8dee9',
    accent: '#88c0d0',
    accentGradient: 'from-sky-400 via-teal-400 to-cyan-500',
  },
  solaris: {
    id: 'solaris',
    name: 'Solaris Light',
    bodyBg: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
    cardBg: 'rgba(255, 255, 255, 0.85)',
    cardBorder: 'rgba(203, 213, 225, 0.8)',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    accent: '#2563eb',
    accentGradient: 'from-blue-600 via-indigo-600 to-cyan-600',
  },
};
