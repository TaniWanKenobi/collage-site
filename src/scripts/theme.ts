// ?theme=<preset> or ?theme=custom:HEX-HEX-HEX: recolours the whole site live (presets and paste-box parsing in
// theme-core.ts). Loaded only when ?theme= is in the URL (layouts/Base.astro) or the Looks picker switches it
// (scripts/looks.ts sends "looks:change" { key: 'theme' }). applyTheme() writes every colour role on <html>
// (style="--bg: …"), sets data-theme (the name) and data-theme-mode (light|dark), and sends a window
// "theme:change" event { spec, mode, colors } so the JS colour owners (3D models, globe, shader backgrounds, nav
// water, Tamagotchi screen) update in place. Default / off removes the overrides: the :root look in global.css.
// The resolved vars are kept in localStorage so the head script in Base.astro can paint them before first paint.
import { themeFor } from './theme-core';
import './theme-images'; // recolours the home-page photo of me and the map card on every switch
import { ROLES, CSS_VAR, DEFAULT_THEME, type ThemeChange } from './theme-vars';

export const STORE = 'theme-vars';
let current: string | null = null;

/** Apply a ?theme= value ('' / null / unknown = the default look). Safe to call repeatedly. */
export function applyTheme(value: string | null) {
  const t = themeFor(value);
  const spec = t ? t.spec : '';
  if (spec === current) return;
  current = spec;
  const el = document.documentElement;
  let detail: ThemeChange;
  if (!t) {
    for (const r of ROLES) el.style.removeProperty(CSS_VAR[r]);
    el.removeAttribute('data-theme');
    el.removeAttribute('data-theme-mode');
    try { localStorage.removeItem(STORE); } catch { /* private mode */ }
    detail = { spec: '', mode: 'dark', colors: { ...DEFAULT_THEME } };
  } else {
    for (const r of ROLES) el.style.setProperty(CSS_VAR[r], t.colors[r]);
    el.setAttribute('data-theme', t.name);
    el.setAttribute('data-theme-mode', t.mode);
    const css = ROLES.map((r) => `${CSS_VAR[r]}:${t.colors[r]}`).join(';');
    try { localStorage.setItem(STORE, JSON.stringify({ spec: t.spec, name: t.name, mode: t.mode, css })); } catch { /* private mode */ }
    detail = { spec: t.spec, mode: t.mode, colors: t.colors };
  }
  window.dispatchEvent(new CustomEvent<ThemeChange>('theme:change', { detail }));
}

window.addEventListener('looks:change', (e) => {
  const d = (e as CustomEvent<{ key: string; value: string }>).detail;
  if (d?.key === 'theme') applyTheme(d.value || '');
});
applyTheme(new URLSearchParams(location.search).get('theme'));
