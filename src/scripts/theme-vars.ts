// Colour roles shared by the CSS (global.css :root) and the JS colour owners (3D models, globe, shader
// backgrounds, nav water, Tamagotchi screen). Tiny on purpose: the owners import this, not the preset table.
// scripts/theme.ts overrides the roles on <html> and sends a window "theme:change" event { spec, mode, colors }.

export const ROLES = [
  'bg', 'bg2', 'line', 'shadow', 'surface', 'surfaceDeep', 'deco', 'accent', 'accentInk', 'onAccent',
  'text', 'muted', 'onSurface', 'paper', 'ink', 'ink2', 'inkSurface',
] as const;
export type Role = (typeof ROLES)[number];
export type Theme = Record<Role, string>;
export interface ThemeChange { spec: string; mode: 'light' | 'dark'; colors: Theme }

export const CSS_VAR: Record<Role, string> = {
  bg: '--bg', bg2: '--bg-2', line: '--line', shadow: '--shadow', surface: '--surface', surfaceDeep: '--surface-deep',
  deco: '--deco', accent: '--accent', accentInk: '--accent-ink', onAccent: '--on-accent', text: '--text',
  muted: '--muted', onSurface: '--on-surface', paper: '--paper', ink: '--ink', ink2: '--ink-2', inkSurface: '--ink-surface',
};

// Same values as global.css :root (the default look, no overrides).
export const DEFAULT_THEME: Theme = {
  bg: '#0D160B', bg2: '#172315', line: '#263424', shadow: '#040803', surface: '#564D80', surfaceDeep: '#3F3862',
  deco: '#8F86C0', accent: '#C2F970', accentInk: '#C2F970', onAccent: '#0D160B', text: '#EFFDD8', muted: '#A8B595',
  onSurface: '#EFFDD8', paper: '#EFFDD8', ink: '#0D160B', ink2: '#4A5640', inkSurface: '#564D80',
};

/** Is a theme on right now? (theme.ts sets data-theme on <html>; the head script does too, before first paint.) */
export const themed = () => document.documentElement.hasAttribute('data-theme');

/** The current role colours, read from the computed style of <html> (hex strings). */
export function readTheme(): Theme {
  if (!themed()) return { ...DEFAULT_THEME };
  const cs = getComputedStyle(document.documentElement), out = { ...DEFAULT_THEME };
  for (const r of ROLES) { const v = cs.getPropertyValue(CSS_VAR[r]).trim(); if (/^#[0-9a-f]{6}$/i.test(v)) out[r] = v; }
  return out;
}

/** Run `fn` on every theme switch. */
export function onTheme(fn: (colors: Theme, d: ThemeChange) => void) {
  window.addEventListener('theme:change', (e) => { const d = (e as CustomEvent<ThemeChange>).detail; if (d) fn(d.colors, d); });
}

/** '#rrggbb' -> [r, g, b] 0..255 */
export const rgbOf = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** '#rrggbb' + alpha -> 'rgba(r,g,b,a)' (canvas colours) */
export const rgba = (h: string, a: number) => `rgba(${rgbOf(h).join(',')},${a})`;
