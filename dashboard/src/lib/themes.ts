export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  // Tailwind CSS variable values (--color-*)
  bg: string;
  surface: string;
  card: string;
  primary: string;
  primaryHover: string;
  success: string;
  warning: string;
  destructive: string;
  textPrimary: string;
  textMuted: string;
  // Design token values (--bg-*, --fg-*, --accent-*, etc.)
  bgHover: string;
  line: string;
  lineStrong: string;
  fgSubtle: string;
  fgFaint: string;
  accentSoft: string;
  accentLine: string;
  warn: string;
  danger: string;
  agentClaude: string;
  agentCursor: string;
  agentVibe: string;
  agentOpencode: string;
  // Swatch dots for theme picker [bg, accent, surface]
  previewDots: [string, string, string];
}

export const themes: Theme[] = [
  {
    id: 'graphite',
    name: 'Graphite',
    dark: true,
    bg: '#0f0e0d',
    surface: '#171614',
    card: '#1d1b18',
    bgHover: '#23201d',
    line: 'rgba(255,248,235,0.06)',
    lineStrong: 'rgba(255,248,235,0.10)',
    primary: '#8b85ff',
    primaryHover: '#a09bff',
    accentSoft: 'rgba(139,133,255,0.14)',
    accentLine: 'rgba(139,133,255,0.28)',
    textPrimary: '#f5f1ea',
    textMuted: '#a6a098',
    fgSubtle: '#6e6963',
    fgFaint: '#48443f',
    success: '#7ec994',
    warning: '#e6b067',
    destructive: '#e87676',
    warn: '#e6b067',
    danger: '#e87676',
    agentClaude: '#d97757',
    agentCursor: '#7aa2ff',
    agentVibe: '#7ec994',
    agentOpencode: '#50c8d6',
    previewDots: ['#0f0e0d', '#8b85ff', '#171614']
  },
  {
    id: 'ember',
    name: 'Ember',
    dark: true,
    bg: '#100c0a',
    surface: '#1a1210',
    card: '#221812',
    bgHover: '#2c1e17',
    line: 'rgba(255,248,235,0.06)',
    lineStrong: 'rgba(255,248,235,0.10)',
    primary: '#ff8a4c',
    primaryHover: '#ff9d68',
    accentSoft: 'rgba(255,138,76,0.14)',
    accentLine: 'rgba(255,138,76,0.28)',
    textPrimary: '#f5f1ea',
    textMuted: '#a6a098',
    fgSubtle: '#6e6963',
    fgFaint: '#48443f',
    success: '#7ec994',
    warning: '#e6b067',
    destructive: '#e87676',
    warn: '#e6b067',
    danger: '#e87676',
    agentClaude: '#ff8a4c',
    agentCursor: '#7aa2ff',
    agentVibe: '#7ec994',
    agentOpencode: '#50c8d6',
    previewDots: ['#100c0a', '#ff8a4c', '#1a1210']
  },
  {
    id: 'terminal',
    name: 'Terminal',
    dark: true,
    bg: '#0c0e0c',
    surface: '#111911',
    card: '#172017',
    bgHover: '#1c271c',
    line: 'rgba(255,248,235,0.06)',
    lineStrong: 'rgba(255,248,235,0.10)',
    primary: '#7ec994',
    primaryHover: '#96d4a9',
    accentSoft: 'rgba(126,201,148,0.14)',
    accentLine: 'rgba(126,201,148,0.28)',
    textPrimary: '#e8f5e8',
    textMuted: '#96b396',
    fgSubtle: '#608060',
    fgFaint: '#3a5a3a',
    success: '#7ec994',
    warning: '#e6b067',
    destructive: '#e87676',
    warn: '#e6b067',
    danger: '#e87676',
    agentClaude: '#d97757',
    agentCursor: '#7aa2ff',
    agentVibe: '#7ec994',
    agentOpencode: '#4fd8c4',
    previewDots: ['#0c0e0c', '#7ec994', '#111911']
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    dark: true,
    bg: '#0a0c12',
    surface: '#111525',
    card: '#181d30',
    bgHover: '#1e2338',
    line: 'rgba(200,215,255,0.06)',
    lineStrong: 'rgba(200,215,255,0.10)',
    primary: '#7aa2ff',
    primaryHover: '#94b5ff',
    accentSoft: 'rgba(122,162,255,0.14)',
    accentLine: 'rgba(122,162,255,0.28)',
    textPrimary: '#eaecf5',
    textMuted: '#8a95b8',
    fgSubtle: '#5a6585',
    fgFaint: '#3a4560',
    success: '#7ec994',
    warning: '#e6b067',
    destructive: '#e87676',
    warn: '#e6b067',
    danger: '#e87676',
    agentClaude: '#d97757',
    agentCursor: '#7aa2ff',
    agentVibe: '#7ec994',
    agentOpencode: '#50c8d6',
    previewDots: ['#0a0c12', '#7aa2ff', '#111525']
  },
  {
    id: 'mono',
    name: 'Mono',
    dark: true,
    bg: '#0a0a0a',
    surface: '#141414',
    card: '#1c1c1c',
    bgHover: '#242424',
    line: 'rgba(255,255,255,0.06)',
    lineStrong: 'rgba(255,255,255,0.10)',
    primary: '#d4d4d4',
    primaryHover: '#e8e8e8',
    accentSoft: 'rgba(212,212,212,0.12)',
    accentLine: 'rgba(212,212,212,0.25)',
    textPrimary: '#f4f4f4',
    textMuted: '#828282',
    fgSubtle: '#5a5a5a',
    fgFaint: '#363636',
    success: '#7ec994',
    warning: '#e6b067',
    destructive: '#e87676',
    warn: '#e6b067',
    danger: '#e87676',
    agentClaude: '#d97757',
    agentCursor: '#aaaaaa',
    agentVibe: '#7ec994',
    agentOpencode: '#9a9a9a',
    previewDots: ['#0a0a0a', '#d4d4d4', '#141414']
  },
  {
    id: 'mojave',
    name: 'Mojave',
    dark: false,
    bg: '#f6f3ec',
    surface: '#fbf9f4',
    card: '#ffffff',
    bgHover: '#eee9df',
    line: 'rgba(25,20,10,0.08)',
    lineStrong: 'rgba(25,20,10,0.14)',
    primary: '#4f48e6',
    primaryHover: '#6961ea',
    accentSoft: 'rgba(79,72,230,0.10)',
    accentLine: 'rgba(79,72,230,0.24)',
    textPrimary: '#1a1815',
    textMuted: '#56524b',
    fgSubtle: '#807a70',
    fgFaint: '#b5afa4',
    success: '#3f8a5a',
    warning: '#b37410',
    destructive: '#b3452e',
    warn: '#b37410',
    danger: '#b3452e',
    agentClaude: '#b05a3c',
    agentCursor: '#3a6ad9',
    agentVibe: '#3f8a5a',
    agentOpencode: '#0e7490',
    previewDots: ['#f6f3ec', '#4f48e6', '#fbf9f4']
  }
];

export const DEFAULT_THEME_ID = 'graphite';
export const DEFAULT_DARK_THEME_ID = 'graphite';
export const DEFAULT_LIGHT_THEME_ID = 'mojave';

export function resolveStoredThemeId(themeId: string): string {
  // Legacy theme id migrations
  const legacyMap: Record<string, string> = {
    'rust': 'graphite',
    'deep-space': 'graphite',
    'carbon': 'mono',
    'terminal-green': 'terminal',
    'midnight-violet': 'cobalt',
    'bloodline': 'ember',
    'oled': 'mono',
    'infrared': 'graphite',
    'cloud': 'mojave',
    'cream': 'mojave',
    'frost': 'mojave',
    'sakura': 'mojave'
  };
  return legacyMap[themeId] ?? (themes.find(t => t.id === themeId) ? themeId : DEFAULT_THEME_ID);
}

export function migrateLegacyThemeLocalStorage(): void {
  for (const key of ['theme', 'darkTheme', 'lightTheme'] as const) {
    const v = localStorage.getItem(key);
    if (v) {
      const migrated = resolveStoredThemeId(v);
      if (migrated !== v) {
        localStorage.setItem(key, migrated);
      }
    }
  }
}

function isLightHex(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 127.5;
}

export function applyTheme(themeId: string): void {
  const resolvedId = resolveStoredThemeId(themeId);
  const theme =
    themes.find((t) => t.id === resolvedId) ?? themes.find((t) => t.id === DEFAULT_THEME_ID)!;
  const root = document.documentElement;

  // Old Tailwind CSS variables (--color-*)
  root.style.setProperty('--color-bg', theme.bg);
  root.style.setProperty('--color-surface', theme.surface);
  root.style.setProperty('--color-card', theme.card);
  root.style.setProperty('--color-input', theme.surface);
  root.style.setProperty('--color-border', theme.card);
  root.style.setProperty('--color-primary', theme.primary);
  root.style.setProperty('--color-primary-hover', theme.primaryHover);
  root.style.setProperty('--color-success', theme.success);
  root.style.setProperty('--color-warning', theme.warning);
  root.style.setProperty('--color-destructive', theme.destructive);
  root.style.setProperty('--color-text-primary', theme.textPrimary);
  root.style.setProperty('--color-text-muted', theme.textMuted);
  root.style.setProperty('--color-fg', isLightHex(theme.bg) ? '#000000' : '#ffffff');

  // New design token CSS variables
  root.style.setProperty('--bg', theme.bg);
  root.style.setProperty('--bg-elev', theme.surface);
  root.style.setProperty('--bg-elev-2', theme.card);
  root.style.setProperty('--bg-hover', theme.bgHover);
  root.style.setProperty('--line', theme.line);
  root.style.setProperty('--line-strong', theme.lineStrong);
  root.style.setProperty('--fg', theme.textPrimary);
  root.style.setProperty('--fg-muted', theme.textMuted);
  root.style.setProperty('--fg-subtle', theme.fgSubtle);
  root.style.setProperty('--fg-faint', theme.fgFaint);
  root.style.setProperty('--accent', theme.primary);
  root.style.setProperty('--accent-soft', theme.accentSoft);
  root.style.setProperty('--accent-line', theme.accentLine);
  root.style.setProperty('--success', theme.success);
  root.style.setProperty('--warn', theme.warn);
  root.style.setProperty('--danger', theme.danger);
  root.style.setProperty('--agent-claude', theme.agentClaude);
  root.style.setProperty('--agent-cursor', theme.agentCursor);
  root.style.setProperty('--agent-vibe', theme.agentVibe);
  root.style.setProperty('--agent-opencode', theme.agentOpencode);

  root.setAttribute('data-theme', theme.dark ? 'dark' : 'light');
  document.body.style.background = theme.bg;
  document.body.style.color = theme.textPrimary;
  window.dispatchEvent(new CustomEvent('nc-theme-changed'));
}

let _colorSchemeListener: ((e: MediaQueryListEvent) => void) | null = null;
let _colorSchemeQuery: MediaQueryList | null = null;

export function resolveAutoTheme(): string {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (prefersDark) {
    return resolveStoredThemeId(localStorage.getItem('darkTheme') ?? DEFAULT_DARK_THEME_ID);
  }
  return resolveStoredThemeId(localStorage.getItem('lightTheme') ?? DEFAULT_LIGHT_THEME_ID);
}

export function startAutoThemeWatcher(): void {
  stopAutoThemeWatcher();
  _colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  _colorSchemeListener = () => {
    applyTheme(resolveAutoTheme());
  };
  _colorSchemeQuery.addEventListener('change', _colorSchemeListener);
}

export function stopAutoThemeWatcher(): void {
  if (_colorSchemeQuery && _colorSchemeListener) {
    _colorSchemeQuery.removeEventListener('change', _colorSchemeListener);
  }
  _colorSchemeQuery = null;
  _colorSchemeListener = null;
}
