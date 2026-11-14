// Theme presets and the colour maths behind them (pure: no DOM, so a Node script can print the contrast table).
// A theme starts from a few palette colours with roles picked (bg, accent, surface, ...); resolve() derives the
// rest and nudges colours (mixing towards black or white) until they pass contrast:
//   body text >= 7:1 on bg and bg-2, muted/deco/accent-ink >= 4.5:1, accent >= 3:1 (UI), text on paper/accent/surface >= 4.5:1.
// The palette's own colours stay the fills (bg, surface, paper, accent where it passes), so they read as the theme.
import { DEFAULT_THEME, type Theme } from './theme-vars';

export interface Spec {
  mode: 'light' | 'dark';
  bg: string; accent: string; surface: string;
  bg2?: string; paper?: string; deco?: string; text?: string; muted?: string;
}
export interface Preset extends Spec { name: string; label: string; palette: string[]; why?: string }

export const PRESETS: Preset[] = [
  { name: 'dusk', label: 'dusk', palette: ['#686868', '#C2AFF0', '#9191E9', '#457EAC', '#2D5D7B'],
    mode: 'dark', bg: '#2D5D7B', accent: '#C2AFF0', surface: '#457EAC', deco: '#9191E9', paper: '#E7DFFA', muted: '#686868' },
  { name: 'petal', label: 'petal', palette: ['#E27396', '#EA9AB2', '#EFCFE3', '#EAF2D7', '#B3DEE2'],
    mode: 'light', bg: '#EAF2D7', accent: '#E27396', surface: '#B3DEE2', paper: '#EFCFE3', deco: '#EA9AB2' },
  { name: 'peach', label: 'peach', palette: ['#9381FF', '#B8B8FF', '#F8F7FF', '#FFEEDD', '#FFD8BE'],
    mode: 'light', bg: '#FFEEDD', bg2: '#FFD8BE', accent: '#9381FF', surface: '#B8B8FF', paper: '#F8F7FF' },
  { name: 'olive', label: 'olive', palette: ['#DDD1C7', '#C2CFB2', '#8DB580', '#7E8987', '#4B4A67'],
    mode: 'dark', bg: '#4B4A67', accent: '#8DB580', surface: '#7E8987', paper: '#DDD1C7', text: '#E4EADB', deco: '#C2CFB2',
    why: 'dark on Vintage Grape: the two darker colours carry a dark page and Muted Olive stays a bright accent; on Dust Grey the olive/grey accents fall under 3:1 and the page washes out' },
  { name: 'blush', label: 'blush', palette: ['#F1DEDE', '#BBACC1', '#80727B'],
    mode: 'light', bg: '#F1DEDE', accent: '#80727B', surface: '#BBACC1' },
  { name: 'frost', label: 'frost', palette: ['#DEFFFC', '#E2E4F6', '#E7C8DD'],
    mode: 'light', bg: '#DEFFFC', accent: '#E7C8DD', surface: '#E2E4F6' },
  { name: 'ivory', label: 'ivory', palette: ['#2A2B2A', '#706C61', '#F8F4E3'],
    mode: 'light', bg: '#F8F4E3', accent: '#2A2B2A', surface: '#706C61', text: '#2A2B2A' },
  { name: 'sky', label: 'sky', palette: ['#D9F0FF', '#A3D5FF', '#83C9F4'],
    mode: 'light', bg: '#D9F0FF', accent: '#83C9F4', surface: '#A3D5FF' },
];

// ---------- colour maths (sRGB hex) ----------
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const hex = (c: number[]) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** WCAG relative luminance */
export const lum = (h: string) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** WCAG contrast ratio */
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** a mixed with b, t = share of b (like color-mix(in srgb, a, b t)) */
export const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
/** OKLCH chroma (how colourful) */
function chroma(h: string) {
  const [r, g, b] = rgb(h).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return Math.hypot(1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
}
const BLACK = '#000000', WHITE = '#FFFFFF';
/** fg, mixed towards black (light bg) or white (dark bg) in small steps until it reaches `min` against every bg. */
export function fix(fg: string, bgs: string | string[], min: number) {
  const list = Array.isArray(bgs) ? bgs : [bgs];
  const worst = (c: string) => Math.min(...list.map((b) => contrast(c, b)));
  if (worst(fg) >= min) return fg;
  const to = lum(list[0]) > 0.18 ? BLACK : WHITE;
  for (let t = 0.04; t < 1; t += 0.04) { const c = mix(fg, to, t); if (worst(c) >= min) return c; }
  return to;
}
/** the first candidate with `min` contrast on bg, else the one on the side fix() pushes towards (the darkest on a
 *  light bg, the lightest on a dark one), pushed until it passes */
function pick(bg: string, min: number, ...cands: string[]) {
  for (const c of cands) if (contrast(c, bg) >= min) return c;
  const toBlack = lum(bg) > 0.18;
  const best = [...cands].sort((a, b) => (toBlack ? lum(a) - lum(b) : lum(b) - lum(a)))[0];
  return fix(best, bg, min);
}

/** Derive every role from a spec. */
export function resolve(s: Spec): Theme {
  const dark = s.mode === 'dark';
  let bg = s.bg.toUpperCase();
  // a dark page needs a really dark bg (the default onyx is 1% luminance); a light one a really light bg
  if (dark) while (lum(bg) > 0.025) bg = mix(bg, BLACK, 0.12);
  else while (lum(bg) < 0.55) bg = mix(bg, WHITE, 0.12);
  const surface = s.surface.toUpperCase();
  const textSeed = s.text ?? (dark ? mix(s.paper ?? s.accent, WHITE, 0.75) : mix(surface, BLACK, 0.8));
  let bg2 = s.bg2 ?? mix(bg, textSeed, 0.05);
  const text = fix(textSeed, [bg, bg2], 7);
  if (!s.bg2) bg2 = mix(bg, text, 0.05);
  const line = mix(bg, text, 0.12);
  const shadow = dark ? mix(bg, BLACK, 0.7) : mix(text, BLACK, 0.35);
  const muted = fix(s.muted ? mix(s.muted, text, 0.35) : mix(text, bg, 0.35), [bg, bg2], 4.5);
  const accent = fix(s.accent.toUpperCase(), [bg, bg2], 3);
  const accentInk = fix(accent, [bg, bg2], 4.5);
  const onAccent = pick(accent, 4.5, dark ? bg : text, dark ? text : bg);
  const surfaceDeep = mix(surface, dark ? bg : text, 0.3);
  const onSurface = pick(surface, 4.5, text, dark ? bg : WHITE);
  const deco = fix(s.deco ?? mix(surface, text, 0.4), [bg, bg2], 4.5);
  const paper = (s.paper ?? (dark ? mix(textSeed, WHITE, 0.4) : mix(bg, WHITE, 0.65))).toUpperCase();
  const ink = pick(paper, 7, dark ? bg : text, text);
  const ink2 = fix(mix(ink, paper, 0.35), paper, 4.5);
  const inkSurface = fix(surface, paper, 4.5);
  return { bg, bg2, line, shadow, surface, surfaceDeep, deco, accent, accentInk, onAccent, text, muted, onSurface, paper, ink, ink2, inkSurface };
}

// ---------- paste box ----------
/** Pull 3-5 colours out of any text ("#E27396, ea9ab2 / #fff ..."). Returns an error message instead when it can't. */
export function parseColors(input: string): string[] | string {
  const out: string[] = [];
  // 6 digits with or without '#'; 3 digits only with '#' (so words like "add" or "bed" don't count)
  for (const m of input.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b|\b([0-9a-f]{6})\b/gi)) {
    let h = (m[1] || m[2]).toUpperCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!out.includes('#' + h)) out.push('#' + h);
  }
  if (out.length < 3) return out.length ? `found ${out.length} colour${out.length > 1 ? 's' : ''}; need 3 to 5` : 'no hex colours found';
  if (out.length > 5) return `found ${out.length} colours; use at most 5`;
  return out;
}

/** Roles for a pasted palette: mostly-light palettes get a light page on their lightest colour, others a dark page
 *  on their darkest; the most colourful mid-tone is the accent, the next most colourful the surface. */
export function autoSpec(cols: string[]): Spec {
  const byLum = [...cols].sort((a, b) => lum(a) - lum(b));
  const light = cols.filter((c) => lum(c) > 0.35).length > cols.length / 2;
  const bg = light ? byLum[byLum.length - 1] : byLum[0];
  const rest = cols.filter((c) => c !== bg);
  const score = (c: string) => chroma(c) * (1 - Math.abs(Math.sqrt(lum(c)) - 0.65));
  const accent = [...rest].sort((a, b) => score(b) - score(a))[0];
  const others = rest.filter((c) => c !== accent).sort((a, b) => chroma(b) - chroma(a));
  const surface = others[0] ?? mix(accent, bg, 0.5);
  const left = others.slice(1);
  const lightest = [...left].sort((a, b) => lum(b) - lum(a))[0];
  const paper = lightest && lum(lightest) > 0.45 ? lightest : undefined;
  const deco = left.find((c) => c !== paper);
  return { mode: light ? 'light' : 'dark', bg, accent, surface, paper, deco };
}

/** '?theme=' value -> theme, or null for the default look. Accepts a preset name or "custom:HEX-HEX-HEX". */
export function themeFor(value: string | null): { spec: string; name: string; colors: Theme; mode: 'light' | 'dark' } | null {
  if (!value) return null;
  const p = PRESETS.find((x) => x.name === value);
  if (p) return { spec: value, name: p.name, colors: resolve(p), mode: p.mode };
  if (value.startsWith('custom:')) {
    const cols = parseColors(value.slice(7).replace(/[-_]/g, ' '));
    if (typeof cols === 'string') return null;
    const s = autoSpec(cols);
    return { spec: customSpec(cols), name: 'custom', colors: resolve(s), mode: s.mode };
  }
  return null;
}
export const customSpec = (cols: string[]) => 'custom:' + cols.map((c) => c.slice(1)).join('-');
export { DEFAULT_THEME };
