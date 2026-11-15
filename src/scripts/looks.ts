// "Looks" picker (temporary, lives in the A/B panel): switches the URL-driven variants — section nav (?nav=),
// section transition (?tx=), shader background (?bg=), music (?music=), whoosh (?whoosh=) and scroll smoothing
// (?smooth=) and colour theme (?theme=) — live, in place. A pick rewrites the query (replaceState, so the link and a reload keep the look),
// then sends a window "looks:change" event { key, value } that the module concerned applies at once
// (nav-styles.ts, zoom-camera.js for tx + smooth, shader-bg.ts, sound.ts, theme.ts). Modules that load only when their
// param is set are imported first. Remove with the A/B tool.

import { PRESETS as THEMES, parseColors, customSpec, THEME_DEF, ORIGINAL } from './theme-core';
import { DEFAULT_THEME } from './theme-vars';

type Slider = { min: number; max: number; step: number; unit: string; hint?: string };
type Group = { key: string; label: string; opts: [string, string][]; def: string; slider?: Slider };

const GROUPS: Group[] = [
  { key: 'theme', label: 'Theme', def: THEME_DEF, opts: [] }, // preset chips with swatches + a paste box (themeControl)
  { key: 'tx', label: 'Transition', def: '', opts: [
    ['', 'fade'], ['morph', 'morph'], ['iris', 'iris'], ['paper', 'paper'], ['dither', 'dither']] },
  { key: 'music', label: 'Music', def: '', opts: [
    ['', 'off'], ['explore', 'explore'], ['shop', 'shop'], ['voting', 'voting'], ['waves', 'waves'],
    ['penne', 'penne'], ['wrapped', 'wrapped'], ['stash', 'stash'], ['counterspell', 'counterspell'], ['littlething', 'littlething'], ['ranaway', 'ran away']] },
  // Settled and no longer picked here (their URL params still work): nav = dock + thread, bg = ripple,
  // Spotify card = embed (disc on light themes), whoosh = swoop at 200 ms / 100 %, UI sound = tick.
  { key: 'smooth', label: 'Scroll smoothing', def: '', opts: [] }, // rendered as a slider (smoothControl)
];

// Modules that are only loaded when their param is on (same paths as Base.astro / ZoomStage.astro). Each one
// registers its "looks:change" listener when it loads, so the event is sent only after the import settles.
const LOADERS: Record<string, () => Promise<unknown>> = {
  nav: () => import('./nav-styles'),
  bg: () => import('./shader-bg'),
  music: () => import('./sound'),
  sfx: () => import('./sound'),
  whoosh: () => import('./sound'),
  theme: () => import('./theme'),
};

const params = () => new URLSearchParams(location.search);

// ?tx= may carry "+stagger"; split it so the base transition and stagger are picked separately.
// (URLSearchParams decodes a literal "+" to a space, so split on both.)
function txOf(p: URLSearchParams) {
  const parts = (p.get('tx') || '').split(/[+ ]/).filter(Boolean);
  return { base: parts.filter((x) => x !== 'stagger')[0] || '', stagger: parts.includes('stagger') };
}
const txValue = (base: string, st: boolean) => [base, st ? 'stagger' : ''].filter(Boolean).join('+');

// The value each group is showing now; for tx, the whole "base+stagger" spec.
function value(p: URLSearchParams, key: string) {
  if (key === 'tx') { const t = txOf(p); return txValue(t.base, t.stagger); }
  const g = GROUPS.find((x) => x.key === key)!;
  const v = p.get(key);
  return v === null ? g.def : v;
}

// Rewrite the query in place, then tell each module whose value changed.
function go(mut: (p: URLSearchParams) => void) {
  const before = params();
  const p = params();
  mut(p);
  const q = p.toString().replace(/%2B/g, '+').replace(/%3A/gi, ':');
  history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
  sync();
  for (const g of GROUPS) {
    const was = value(before, g.key), now = value(p, g.key);
    if (was === now) continue;
    const send = () => window.dispatchEvent(new CustomEvent('looks:change', { detail: { key: g.key, value: now } }));
    const load = LOADERS[g.key];
    // Turning bg / music / sfx / theme off needs no module: if it never loaded, there is nothing to stop.
    if (load && (now !== '' || g.key === 'nav')) load().then(send, () => {});
    else send();
  }
}

function setTx(base: string, st: boolean) {
  go((p) => { const v = txValue(base, st); if (v) p.set('tx', v); else p.delete('tx'); });
}

// Pressed state of every chip, from the URL.
let box: HTMLElement | null = null;
function sync() {
  if (!box) return;
  syncSmooth();
  syncTheme();
  sliderSyncs.forEach((f) => f());
  const p = params(), t = txOf(p);
  box.querySelectorAll<HTMLButtonElement>('button[data-key]').forEach((b) => {
    const key = b.dataset.key!;
    const on = b.dataset.stagger !== undefined ? t.stagger : (key === 'tx' ? t.base : value(p, key)) === b.dataset.val;
    b.setAttribute('aria-pressed', String(on));
  });
}

function mount() {
  const panel = document.getElementById('ab-panel');
  if (!panel || panel.querySelector('.looks')) return;
  box = document.createElement('div');
  box.className = 'looks';
  box.innerHTML = '<h2>Looks</h2>';
  for (const g of GROUPS) {
    const fs = document.createElement('fieldset');
    fs.className = 'ab-test looks-group';
    const lg = document.createElement('legend');
    lg.textContent = g.label;
    fs.append(lg);
    if (g.key === 'smooth') { fs.append(smoothControl()); box.append(fs); continue; }
    if (g.key === 'theme') { fs.append(themeControl()); box.append(fs); continue; }
    if (g.slider) { fs.append(sliderControl(g, g.slider)); box.append(fs); continue; }
    const row = document.createElement('div');
    row.className = 'looks-opts';
    for (const [val, text] of g.opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.dataset.key = g.key;
      b.dataset.val = val;
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-pressed') === 'true') return;
        if (g.key === 'tx') return setTx(val, txOf(params()).stagger);
        go((p) => { if (val === g.def) p.delete(g.key); else p.set(g.key, val); });
      });
      row.append(b);
    }
    if (g.key === 'tx') {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'looks-extra';
      s.textContent = '+ stagger';
      s.dataset.key = 'tx';
      s.dataset.stagger = '';
      s.addEventListener('click', () => { const t = txOf(params()); setTx(t.base, !t.stagger); });
      row.append(s);
    }
    fs.append(row);
    box.append(fs);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'looks-reset';
  reset.textContent = 'reset all';
  reset.addEventListener('click', () => go((p) => GROUPS.forEach((g) => p.delete(g.key))));
  box.append(reset);
  panel.append(box);
  sync();
}

// ---- Plain sliders (whoosh timing / volume): a range + number box writing ?<key>= (deleted at the default) ----
const sliderSyncs: (() => void)[] = [];
function sliderControl(g: Group, sl: Slider) {
  const wrap = document.createElement('div');
  wrap.className = 'looks-smooth';
  wrap.innerHTML = `<div class="ls-row"><div class="ls-track"><input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" aria-label="${g.label}"></div>`
    + `<label class="ls-num"><input type="number" min="${sl.min}" max="${sl.max}" step="1" aria-label="${g.label} in ${sl.unit}"><span>${sl.unit}</span></label></div>`
    + (sl.hint ? `<p class="ls-hint">${sl.hint}</p>` : '');
  const range = wrap.querySelector<HTMLInputElement>('input[type=range]')!, num = wrap.querySelector<HTMLInputElement>('input[type=number]')!;
  const set = (v: number) => {
    v = Math.round(Math.min(sl.max, Math.max(sl.min, v)));
    go((p) => { if (String(v) === g.def) p.delete(g.key); else p.set(g.key, String(v)); });
  };
  range.addEventListener('input', () => set(+range.value));
  // on release, play the whoosh once so the new setting can be heard
  range.addEventListener('change', () => window.dispatchEvent(new CustomEvent('sound:preview-whoosh')));
  num.addEventListener('change', () => { set(+num.value); window.dispatchEvent(new CustomEvent('sound:preview-whoosh')); });
  const sync = () => {
    const v = +(params().get(g.key) ?? g.def);
    range.value = String(v);
    if (document.activeElement !== num) num.value = String(v);
    wrap.style.setProperty('--ls-fill', `${((v - sl.min) / (sl.max - sl.min)) * 100}%`);
  };
  sliderSyncs.push(sync);
  sync();
  return wrap;
}

// ---- Scroll smoothing: a draggable bar (0-500 ms catch-up time), a number box, and preset dots on the track ----
const SMOOTH_MAX = 500, SMOOTH_DEF = 110; // ms; the camera's default tau is 0.11 s
// The bar is a square-root scale (bar position u in 0..1000 -> ms = 500 * (u/1000)^2), so the useful low end
// (0-200 ms) gets most of the room; the number box is plain ms.
const U_MAX = 1000;
const toMs = (u: number) => Math.round(SMOOTH_MAX * (u / U_MAX) ** 2);
const toU = (ms: number) => Math.round(U_MAX * Math.sqrt(ms / SMOOTH_MAX));
const PRESETS: [number, string][] = [[0, 'none'], [65, 'snappy'], [110, 'default'], [180, 'floaty'], [300, 'drifty']];
let syncSmooth = () => {};

function smoothMs(p: URLSearchParams) {
  const v = p.get('smooth');
  return v === null || v === '' ? SMOOTH_DEF : Math.round(Math.min(SMOOTH_MAX, Math.max(0, parseFloat(v) * 1000 || 0)));
}

function smoothControl() {
  const wrap = document.createElement('div');
  wrap.className = 'looks-smooth';
  wrap.innerHTML = `
    <div class="ls-names ls-names-top"></div>
    <div class="ls-row">
      <div class="ls-track">
        <input type="range" min="0" max="${U_MAX}" step="1" aria-label="Scroll smoothing">
        <div class="ls-dots"></div>
      </div>
      <label class="ls-num"><input type="number" min="0" max="${SMOOTH_MAX}" step="1" aria-label="Scroll smoothing in milliseconds"><span>ms</span></label>
    </div>
    <div class="ls-names ls-names-bot"></div>`;
  const range = wrap.querySelector<HTMLInputElement>('input[type=range]')!;
  const num = wrap.querySelector<HTMLInputElement>('input[type=number]')!;
  const dots = wrap.querySelector<HTMLElement>('.ls-dots')!;
  const names = wrap.querySelector<HTMLElement>('.ls-names-bot')!;
  const namesTop = wrap.querySelector<HTMLElement>('.ls-names-top')!;
  const pos = (ms: number) => `calc(7px + ${(toU(ms) / U_MAX).toFixed(4)} * (100% - 14px))`; // thumb is 14px wide
  PRESETS.forEach(([ms, name], k) => {
    const d = document.createElement('button');
    d.type = 'button'; d.className = 'ls-dot'; d.dataset.ms = String(ms);
    d.style.left = pos(ms);
    d.setAttribute('aria-label', `${name} (${ms} ms)`); d.title = `${name} · ${ms} ms`;
    d.addEventListener('click', () => set(ms));
    dots.append(d);
    const n = document.createElement('button');
    n.type = 'button'; n.className = 'ls-name'; n.textContent = name; n.dataset.ms = String(ms);
    n.style.left = pos(ms);
    n.tabIndex = -1; // the dot is the keyboard target; the label is a bigger mouse target
    n.addEventListener('click', () => set(ms));
    (k % 2 ? namesTop : names).append(n); // alternate above/below the bar so close presets don't collide
  });
  // Write the URL (replaceState) and tell the camera; '' (no param) when it's the default.
  function set(ms: number) {
    ms = Math.round(Math.min(SMOOTH_MAX, Math.max(0, ms)));
    go((p) => { if (ms === SMOOTH_DEF) p.delete('smooth'); else p.set('smooth', String(ms / 1000)); });
  }
  range.addEventListener('input', () => set(toMs(+range.value)));
  num.addEventListener('change', () => set(+num.value));
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') set(+num.value); });
  syncSmooth = () => {
    const ms = smoothMs(params());
    range.value = String(toU(ms));
    range.setAttribute("aria-valuetext", `${ms} ms`);
    if (document.activeElement !== num) num.value = String(ms);
    wrap.style.setProperty('--ls-fill', `${(toU(ms) / U_MAX) * 100}%`);
    wrap.querySelectorAll<HTMLElement>('[data-ms]').forEach((el) => el.setAttribute('aria-pressed', String(+el.dataset.ms! === ms)));
  };
  syncSmooth();
  return wrap;
}

// ---- Theme: a chip per preset (name + its palette as swatches), "default", and a paste box for any 3-5 hex colours ----
let syncTheme = () => {};

function swatches(cols: string[]) {
  const s = document.createElement('span');
  s.className = 'lt-sw';
  s.setAttribute('aria-hidden', 'true');
  for (const c of cols) { const i = document.createElement('i'); i.style.background = c; s.append(i); }
  return s;
}

function themeControl() {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'looks-opts looks-themes';
  const chip = (val: string, name: string, cols: string[]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.key = 'theme';
    b.dataset.val = val;
    if (cols.length) b.append(swatches(cols));
    b.append(name);
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-pressed') === 'true') return;
      const v = b.dataset.val || '';
      go((p) => { if (v && v !== THEME_DEF) p.set('theme', v); else p.delete('theme'); });
    });
    row.append(b);
    return b;
  };
  chip(ORIGINAL, 'lime', [DEFAULT_THEME.bg, DEFAULT_THEME.surface, DEFAULT_THEME.accent]); // the original :root palette (no overrides)
  for (const p of THEMES) chip(p.name, p.label, p.palette);
  const mine = chip('', 'custom', []); // shows the pasted palette while one is on
  mine.hidden = true;
  const form = document.createElement('div');
  form.className = 'lt-paste';
  form.innerHTML = '<input type="text" spellcheck="false" autocomplete="off" placeholder="paste 3-5 hex colours" aria-label="Paste 3 to 5 hex colours for a custom theme"><p class="lt-msg" role="status" aria-live="polite"></p>';
  const input = form.querySelector('input')!, msg = form.querySelector<HTMLElement>('.lt-msg')!;
  const apply = () => {
    if (!input.value.trim()) { msg.textContent = ''; return; }
    const cols = parseColors(input.value);
    if (typeof cols === 'string') { msg.textContent = cols; input.setAttribute('aria-invalid', 'true'); return; }
    msg.textContent = '';
    input.removeAttribute('aria-invalid');
    go((p) => p.set('theme', customSpec(cols)));
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  input.addEventListener('paste', () => setTimeout(apply, 0));
  input.addEventListener('input', () => { if (input.hasAttribute('aria-invalid')) { msg.textContent = ''; input.removeAttribute('aria-invalid'); } });
  let shown: string | null = null;
  syncTheme = () => {
    const v = params().get('theme') || '';
    if (shown !== null && v !== shown) { msg.textContent = ''; input.removeAttribute('aria-invalid'); } // a new pick clears an old error
    shown = v;
    const custom = v.startsWith('custom:') ? parseColors(v.slice(7).replace(/[-_]/g, ' ')) : null;
    mine.hidden = !Array.isArray(custom);
    if (Array.isArray(custom)) {
      mine.dataset.val = v;
      mine.replaceChildren(swatches(custom), 'custom');
    }
  };
  wrap.append(row, form);
  syncTheme();
  return wrap;
}

mount();
