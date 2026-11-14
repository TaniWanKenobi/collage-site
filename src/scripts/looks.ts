// "Looks" picker (temporary, lives in the A/B panel): switches the URL-driven variants — section nav (?nav=),
// section transition (?tx=), shader background (?bg=), music (?music=), UI sounds (?sfx=) and scroll smoothing
// (?smooth=) — live, in place. A pick rewrites the query (replaceState, so the link and a reload keep the look),
// then sends a window "looks:change" event { key, value } that the module concerned applies at once
// (nav-styles.ts, zoom-camera.js for tx + smooth, shader-bg.ts, sound.ts). Modules that load only when their
// param is set are imported first. Remove with the A/B tool.

type Group = { key: string; label: string; opts: [string, string][]; def: string };

const GROUPS: Group[] = [
  { key: 'nav', label: 'Section nav', def: 'dots', opts: [
    ['dots', 'dots'], ['frost', 'frost'], ['lens', 'lens'], ['drop', 'drop'], ['bubble', 'bubble'], ['water', 'water'],
    ['dock', 'dock'], ['goo', 'goo'], ['thread', 'thread'], ['odometer', 'odometer']] },
  { key: 'tx', label: 'Transition', def: '', opts: [
    ['', 'fade'], ['morph', 'morph'], ['iris', 'iris'], ['paper', 'paper'], ['dither', 'dither']] },
  { key: 'bg', label: 'Background', def: '', opts: [
    ['', 'flat'], ['satin', 'satin'], ['halo', 'halo'], ['melt', 'melt'], ['smoke', 'smoke'], ['dither', 'dither'], ['contours', 'contours']] },
  { key: 'music', label: 'Music', def: '', opts: [
    ['', 'off'], ['explore', 'explore'], ['shop', 'shop'], ['voting', 'voting'], ['waves', 'waves']] },
  { key: 'sfx', label: 'UI sounds', def: '', opts: [
    ['', 'off'], ['synth', 'synth'], ['tap', 'tap'], ['stopwatch', 'stopwatch'], ['tick', 'tick']] },
  { key: 'smooth', label: 'Scroll smoothing', def: '', opts: [
    ['0', 'none'], ['0.065', 'snappy'], ['', 'default'], ['0.18', 'floaty']] },
];

// Modules that are only loaded when their param is on (same paths as Base.astro / ZoomStage.astro). Each one
// registers its "looks:change" listener when it loads, so the event is sent only after the import settles.
const LOADERS: Record<string, () => Promise<unknown>> = {
  nav: () => import('./nav-styles'),
  bg: () => import('./shader-bg'),
  music: () => import('./sound'),
  sfx: () => import('./sound'),
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
  const q = p.toString().replace(/%2B/g, '+');
  history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
  sync();
  for (const g of GROUPS) {
    const was = value(before, g.key), now = value(p, g.key);
    if (was === now) continue;
    const send = () => window.dispatchEvent(new CustomEvent('looks:change', { detail: { key: g.key, value: now } }));
    const load = LOADERS[g.key];
    // Turning bg / music / sfx off needs no module: if it never loaded, there is nothing to stop.
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

mount();
