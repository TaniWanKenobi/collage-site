// "Looks" picker (temporary, lives in the A/B panel): switches the URL-driven variants — section nav (?nav=),
// section transition (?tx=), shader background (?bg=), music (?music=), UI sounds (?sfx=) and scroll smoothing
// (?smooth=). Those modules read the URL once at load, so a pick rewrites the query in place (replaceState) and
// reloads; the reload keeps the scroll position, so you stay where you were. Remove with the A/B tool.

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

const params = new URLSearchParams(location.search);

// ?tx= may carry "+stagger"; split it so the base transition and stagger are picked separately.
// (URLSearchParams decodes a literal "+" to a space, so split on both.)
const txParts = (params.get('tx') || '').split(/[+ ]/).filter(Boolean);
const txBase = txParts.filter((p) => p !== 'stagger')[0] || '';
const stagger = txParts.includes('stagger');

function current(g: Group): string {
  if (g.key === 'tx') return txBase;
  const v = params.get(g.key);
  return v === null ? g.def : v;
}

function go(mut: (p: URLSearchParams) => void) {
  const p = new URLSearchParams(location.search);
  mut(p);
  const q = p.toString().replace(/%2B/g, '+');
  history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
  location.reload();
}

function setTx(base: string, st: boolean) {
  go((p) => {
    const v = [base, st ? 'stagger' : ''].filter(Boolean).join('+');
    if (v) p.set('tx', v); else p.delete('tx');
  });
}

function mount() {
  const panel = document.getElementById('ab-panel');
  if (!panel || panel.querySelector('.looks')) return;
  const box = document.createElement('div');
  box.className = 'looks';
  box.innerHTML = '<h2>Looks</h2><p class="ab-note">Each pick reloads in place.</p>';
  for (const g of GROUPS) {
    const fs = document.createElement('fieldset');
    fs.className = 'ab-test looks-group';
    const lg = document.createElement('legend');
    lg.textContent = g.label;
    fs.append(lg);
    const row = document.createElement('div');
    row.className = 'looks-opts';
    const cur = current(g);
    for (const [val, text] of g.opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-pressed', String(val === cur));
      b.addEventListener('click', () => {
        if (val === cur) return;
        if (g.key === 'tx') return setTx(val, stagger);
        go((p) => { if (val === g.def) p.delete(g.key); else p.set(g.key, val); });
      });
      row.append(b);
    }
    if (g.key === 'tx') {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'looks-extra';
      s.textContent = '+ stagger';
      s.setAttribute('aria-pressed', String(stagger));
      s.addEventListener('click', () => setTx(txBase, !stagger));
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
}

mount();
