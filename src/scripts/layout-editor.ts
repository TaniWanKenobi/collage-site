// Layout editor for the home collage: open the home page with ?edit (desktop width).
// Every piece of the zoomed-out collage can be dragged, rotated and scaled; idea boxes from the tray try out new
// items. Edits stay in this browser (localStorage) until Reset; "Copy layout" puts a summary on the clipboard to
// hand back so the positions can be written into the components. Nothing here ships in the normal page path: the
// module is only imported when the URL has ?edit.
//   drag = move · shift+drag = rotate · alt+drag (or wheel) = scale · arrows nudge (shift = 10px)
//   [ ] = rotate 1° · - + = scale · F / B = forward / back · Del = remove an idea box · Esc = deselect
//   Ctrl+Z = undo · Ctrl+Shift+Z or Ctrl+Y = redo (also the Undo / Redo buttons)
//   M = minimize the panel · G = placement guides (thirds, phi grid, margins, balance, layout checks) · Ctrl+drag = no snap

interface Edit { dx: number; dy: number; rot: number; s: number; z: number | null }
interface Idea { id: string; label: string; w: number; h: number; x: number; y: number; rot: number; s: number }

const KEY = 'collage-layout-edits-v1';
const UI_KEY = 'collage-layout-ui-v1';
type Show = { thirds: boolean; phi: boolean; diag: boolean; margin: boolean; zpath: boolean; balance: boolean; checks: boolean };
type P = [number, number];
interface Geo { el: HTMLElement; label: string; cx: number; cy: number; ang: number; poly: P[]; area: number; wt: number; l: number; t: number; r: number; b: number }
const IDEAS: [string, number, number][] = [
  ['cassette tape', 150, 96], ['floppy disk', 110, 112], ['bare PCB', 150, 104], ['ticket stub', 170, 70],
  ['parts receipt', 96, 170], ['postage stamp', 90, 110], ['keycap', 72, 72], ['tape measure', 120, 120],
  ['filament spool', 120, 120], ['Hack Club sticker', 110, 110], ['benchy print', 110, 100], ['folded map', 150, 110],
];

export function initLayoutEditor() {
  const world = document.getElementById('zm-world');
  if (!world) return;
  // Hold the camera at the overview: no scroll zoom while editing.
  window.scrollTo(0, 0);
  document.documentElement.style.overflow = 'hidden';

  const pieces = [...world.children].filter((el): el is HTMLElement =>
    el instanceof HTMLElement && el.id !== 'zm-whead' && !el.classList.contains('tama-screen') && getComputedStyle(el).position === 'absolute');
  const follower = world.querySelector<HTMLElement>('.tama-screen'); // the zoom target on the Tamagotchi's screen
  const morph = world.querySelector<HTMLElement>('[data-morph]');
  const name = (el: HTMLElement) =>
    el.dataset.editName || el.dataset.jump || (el.dataset.src ? el.dataset.src.split('/').pop()!.replace('.glb', '') : '') ||
    el.id || el.textContent!.trim().slice(0, 24) || el.className.split(' ')[0] || 'piece';
  pieces.forEach((el, i) => { el.dataset.editId = `${i}:${name(el)}`; });

  let saved: { edits: Record<string, Edit>; ideas: Idea[] } = { edits: {}, ideas: [] };
  try { saved = JSON.parse(localStorage.getItem(KEY) || '') || saved; } catch { /* first run */ }
  const edits = saved.edits;
  let ideas: Idea[] = saved.ideas || [];
  let schedule = () => {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ edits, ideas })); } catch { /* private window */ } schedule(); };

  // ---- undo / redo: whole-layout snapshots, taken just before each change ----
  const undo: string[] = [], redo: string[] = [];
  const snap = () => JSON.stringify({ edits, ideas });
  // A run of the same small step (arrow nudges, wheel scaling) within 600 ms is one history entry.
  let runKey = '', runAt = 0;
  function checkpoint(run = '') {
    const t = performance.now();
    if (run && run === runKey && t - runAt < 600) { runAt = t; return; }
    runKey = run; runAt = t;
    const now = snap();
    if (undo[undo.length - 1] === now) return;
    undo.push(now); if (undo.length > 200) undo.shift();
    redo.length = 0; syncButtons();
  }
  let syncButtons = () => {};

  // ---- styles ----
  const css = document.createElement('style');
  css.textContent = `
    #zm-world [data-edit-id], .le-idea { cursor: move !important; pointer-events: auto !important; }
    #zm-world [data-edit-id]:hover, .le-idea:hover { outline: 1px dashed rgba(194,249,112,.6); outline-offset: 2px; }
    .le-sel { outline: 2px solid #C2F970 !important; outline-offset: 3px; }
    #zm-world * { user-select: none; }
    .le-idea { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center; text-align: center;
      padding: 6px; border: 2px dashed #8F86C0; border-radius: 6px; background: rgba(91,79,143,.28); color: #EFFDD8;
      font: 600 13px/1.15 ui-monospace, monospace; z-index: 30; }
    .le-panel { position: fixed; right: 12px; bottom: 12px; z-index: 9999; width: 290px; max-height: calc(100vh - 24px); overflow: auto;
      box-sizing: border-box; padding: 12px; border-radius: 10px; background: #0d160b; color: #EFFDD8; box-shadow: 0 10px 30px rgba(0,0,0,.6);
      font: 12px/1.4 ui-monospace, monospace; border: 1px solid #2c3a22; }
    .le-panel h2 { margin: 0 0 6px; font: 700 13px ui-monospace, monospace; color: #C2F970; }
    .le-panel p { margin: 4px 0; color: #a9b99a; }
    .le-panel button { margin: 2px 2px 2px 0; padding: 5px 8px; border: 1px solid #3c4d2e; border-radius: 6px; background: #1b2614; color: #EFFDD8; font: inherit; cursor: pointer; }
    .le-panel button:hover { border-color: #C2F970; }
    .le-panel button.le-main { background: #C2F970; color: #0d160b; border-color: #C2F970; font-weight: 700; }
    .le-sel-info { min-height: 34px; padding: 6px; margin: 6px 0; border-radius: 6px; background: #1b2614; white-space: pre; }
    .le-head { display: flex; align-items: center; gap: 6px; }
    .le-head h2 { flex: 1; margin: 0; cursor: pointer; }
    .le-panel .le-min-btn { margin: 0; padding: 2px 9px; font-weight: 700; }
    .le-panel.le-min { width: auto; padding: 6px 8px 6px 12px; overflow: visible; }
    .le-panel.le-min .le-body { display: none; }
    .le-panel details { margin-top: 8px; }
    .le-panel summary { cursor: pointer; color: #C2F970; font-weight: 700; }
    .le-panel ul { margin: 6px 0 0; padding-left: 16px; color: #a9b99a; }
    .le-panel li { margin: 3px 0; }
    .le-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; margin: 6px 0; }
    .le-opts label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
    .le-sw { display: inline-block; width: 10px; height: 3px; border-radius: 2px; }
    .le-panel .le-report { margin: 6px 0 0; padding: 0; list-style: none; }
    .le-report li { margin: 3px 0; padding: 4px 6px; border-radius: 5px; background: #1b2614; color: #d8e6c8; }
    .le-report li.bad { background: #3a1a17; }
    .le-report li[data-sel] { cursor: pointer; }
    .le-report li[data-sel]:hover { outline: 1px solid #C2F970; }
    .le-report li.ok::before { content: '✓ '; color: #C2F970; }
    .le-report li.bad::before { content: '⚠ '; color: #ff6b5d; }
    .le-report li.info::before { content: '· '; color: #8F86C0; }
    .le-guides { position: absolute; left: 0; top: 0; width: 1440px; height: 900px; overflow: visible; pointer-events: none !important; z-index: 9000; }
    .le-guides line, .le-guides polygon, .le-guides polyline, .le-guides rect, .le-guides ellipse, .le-guides circle { vector-effect: non-scaling-stroke; }
    .le-toast { position: fixed; left: 50%; top: 16px; translate: -50% 0; z-index: 10000; padding: 8px 14px; border-radius: 999px; background: #C2F970; color: #0d160b; font: 700 13px ui-monospace, monospace; }
  `;
  document.head.appendChild(css);

  // ---- apply ----
  const get = (id: string): Edit => (edits[id] ||= { dx: 0, dy: 0, rot: 0, s: 1, z: null });
  function apply(el: HTMLElement) {
    const e = edits[el.dataset.editId!];
    const set = (t: HTMLElement) => {
      t.style.translate = e ? `${e.dx}px ${e.dy}px` : '';
      t.style.rotate = e && e.rot ? `${e.rot}deg` : '';
      t.style.scale = e && e.s !== 1 ? String(e.s) : '';
    };
    set(el);
    if (e && e.z != null) el.style.zIndex = String(e.z);
    if (el === morph && follower) set(follower);
  }
  pieces.forEach(apply);

  const ideaEls = new Map<string, HTMLElement>();
  function drawIdea(d: Idea) {
    let el = ideaEls.get(d.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'le-idea';
      el.dataset.ideaId = d.id;
      el.textContent = d.label;
      world!.appendChild(el);
      ideaEls.set(d.id, el);
    }
    Object.assign(el.style, { left: `${d.x}px`, top: `${d.y}px`, width: `${d.w}px`, height: `${d.h}px`, rotate: `${d.rot}deg`, scale: String(d.s) });
  }
  ideas.forEach(drawIdea);

  function restore(json: string) {
    const st = JSON.parse(json) as { edits: Record<string, Edit>; ideas: Idea[] };
    Object.keys(edits).forEach((k) => delete edits[k]);
    Object.assign(edits, st.edits);
    pieces.forEach((el) => { el.style.zIndex = ''; apply(el); });
    ideas = st.ideas;
    const keep = new Set(ideas.map((d) => d.id));
    ideaEls.forEach((el, id) => { if (!keep.has(id)) { el.remove(); ideaEls.delete(id); } });
    ideas.forEach(drawIdea);
    if (sel && !sel.isConnected) select(null);
    save(); refresh(); runKey = ''; syncButtons();
    window.dispatchEvent(new Event('resize'));
  }
  function step(from: string[], to: string[]) {
    const prev = from.pop();
    if (prev === undefined) return;
    to.push(snap());
    restore(prev);
  }

  // ---- selection + panel ----
  let sel: HTMLElement | null = null;
  const panel = document.createElement('div');
  panel.className = 'le-panel';
  panel.innerHTML = `
    <div class="le-head"><h2 data-min-title title="Minimize (M)">Layout editor</h2><button class="le-min-btn" data-min title="Minimize (M)">–</button></div>
    <div class="le-body">
    <p>drag = move · shift+drag = rotate · alt+drag / wheel = scale · arrows nudge · [ ] rotate · − + scale · F/B front/back · Ctrl+Z / Ctrl+Shift+Z undo, redo · M hide panel</p>
    <div class="le-sel-info" data-info>click an item</div>
    <button data-undo title="Ctrl+Z">Undo</button><button data-redo title="Ctrl+Shift+Z">Redo</button><br><button class="le-main" data-copy>Copy layout</button><button data-reset-one>Reset item</button><button data-reset>Reset all</button>
    <h2 style="margin-top:10px">Placement guides</h2>
    <button class="le-main" data-guides title="G">Show guides</button><label style="margin-left:6px;cursor:pointer" title="Ctrl+drag skips snapping"><input type="checkbox" data-snap> snap</label>
    <div class="le-opts" data-opts></div>
    <ul class="le-report" data-report></ul>
    <details><summary>How to place things</summary><ul>
      <li>Put the focal piece (globe + portrait) on a thirds or phi crossing, not dead centre.</li>
      <li>Balance asymmetrically: the amber dot (centre of visual weight) should sit inside the dashed ellipse, about 8% of the screen from centre. Much closer looks static; past 15% looks lopsided.</li>
      <li>Read path is a Z: wordmark top left, across, then down to a call to action at the far end.</li>
      <li>Tilt cards and notes 2–8°, stickers up to 12°. Mix left and right tilts, keep 1–3 pieces straight as anchors, and avoid tilts under 1° (they look like mistakes).</li>
      <li>Pieces either overlap clearly (12px or more, about 10–30% of the smaller one) or keep 24px or more apart. Edges that just touch read as errors.</li>
      <li>Group into 3–4 clusters (odd counts read best), with tighter gaps inside a cluster than between them. Leave 25–40% of the screen empty in one or two open areas, not as even confetti.</li>
      <li>Keep text 48px or more from the screen edge. Let pieces bleed off the edge on purpose (15% or more cropped) or stay clear; a slight crop looks accidental.</li>
      <li>Vary sizes: one hero, a few medium pieces, several small ones.</li>
      <li>The numbers are rules of thumb from photo and scrapbook composition guides; trust your eye over them.</li>
    </ul></details>
    <details><summary>Try an item</summary>
    <p>adds a placeholder box you can place</p>
    <div data-ideas></div></details>
    <p style="margin-top:8px"><a href="?" style="color:#C2F970">exit editor</a></p>
    </div>`;
  document.body.appendChild(panel);
  const info = panel.querySelector<HTMLElement>('[data-info]')!;
  const undoBtn = panel.querySelector<HTMLButtonElement>('[data-undo]')!, redoBtn = panel.querySelector<HTMLButtonElement>('[data-redo]')!;
  syncButtons = () => { undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length; undoBtn.style.opacity = undo.length ? '' : '.4'; redoBtn.style.opacity = redo.length ? '' : '.4'; };
  undoBtn.addEventListener('click', () => step(undo, redo));
  redoBtn.addEventListener('click', () => step(redo, undo));
  syncButtons();
  const ideaBox = panel.querySelector<HTMLElement>('[data-ideas]')!;
  IDEAS.forEach(([label, w, h]) => {
    const b = document.createElement('button');
    b.textContent = `+ ${label}`;
    b.addEventListener('click', () => {
      checkpoint();
      const d: Idea = { id: `idea-${Date.now().toString(36)}`, label, w, h, x: 720 - w / 2, y: 450 - h / 2, rot: 0, s: 1 };
      ideas.push(d); drawIdea(d); save(); select(ideaEls.get(d.id)!);
    });
    ideaBox.appendChild(b);
  });

  const ideaOf = (el: HTMLElement | null) => (el && el.dataset.ideaId ? ideas.find((d) => d.id === el.dataset.ideaId) || null : null);
  function describe(el: HTMLElement): string {
    const d = ideaOf(el);
    if (d) return `${d.label} (idea)\ncentre ${Math.round(d.x + d.w / 2)}, ${Math.round(d.y + d.h / 2)} · ${d.rot.toFixed(1)}° · ×${d.s.toFixed(2)}`;
    const e = edits[el.dataset.editId!] || { dx: 0, dy: 0, rot: 0, s: 1, z: null };
    return `${name(el)}\nmove ${Math.round(e.dx)}, ${Math.round(e.dy)} · +${e.rot.toFixed(1)}° · ×${e.s.toFixed(2)}${e.z != null ? ` · z ${e.z}` : ''}`;
  }
  function select(el: HTMLElement | null) {
    if (sel) sel.classList.remove('le-sel');
    sel = el;
    if (sel) sel.classList.add('le-sel');
    info.textContent = sel ? describe(sel) : 'click an item';
  }
  const refresh = () => { if (sel) info.textContent = describe(sel); };

  function change(el: HTMLElement, f: (v: { dx: number; dy: number; rot: number; s: number }) => void) {
    const d = ideaOf(el);
    if (d) {
      const v = { dx: d.x, dy: d.y, rot: d.rot, s: d.s };
      f(v); d.x = v.dx; d.y = v.dy; d.rot = v.rot; d.s = Math.max(0.2, v.s); drawIdea(d);
    } else {
      const e = get(el.dataset.editId!);
      f(e); e.s = Math.max(0.2, e.s); apply(el);
    }
    save(); refresh();
  }

  // ---- minimize ----
  const ui = { min: false, guides: false, snap: true, show: { thirds: true, phi: false, diag: false, margin: true, zpath: false, balance: true, checks: true } as Show };
  try { const u = JSON.parse(localStorage.getItem(UI_KEY) || '{}'); Object.assign(ui, u, { show: { ...ui.show, ...(u.show || {}) } }); } catch { /* defaults */ }
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* private window */ } };
  const minBtn = panel.querySelector<HTMLButtonElement>('[data-min]')!;
  function setMin(m: boolean) {
    ui.min = m; saveUi();
    panel.classList.toggle('le-min', m);
    minBtn.textContent = m ? '▴' : '–';
    minBtn.title = m ? 'Show the panel (M)' : 'Minimize (M)';
  }
  minBtn.addEventListener('click', () => setMin(!ui.min));
  panel.querySelector('[data-min-title]')!.addEventListener('click', () => setMin(!ui.min));
  setMin(ui.min);

  // ---- placement guides ----
  // Overlays drawn inside the world (so they zoom with it), from composition rules: thirds and phi grids, golden
  // diagonals, a safe margin, the Z reading path, the centre of visual weight, and live layout checks.
  const NS = 'http://www.w3.org/2000/svg';
  const gsvg = document.createElementNS(NS, 'svg');
  gsvg.setAttribute('class', 'le-guides');
  gsvg.setAttribute('aria-hidden', 'true');
  world.appendChild(gsvg);
  const COL: Record<keyof Show, string> = { thirds: '#C2F970', phi: '#FFB86B', diag: '#B9B0F0', margin: '#EFFDD8', zpath: '#FF7EB6', balance: '#FFB86B', checks: '#ff6b5d' };
  const OPTS: [keyof Show, string][] = [['thirds', 'thirds'], ['phi', 'phi grid'], ['diag', 'diagonals'], ['margin', 'margins'], ['zpath', 'Z path'], ['balance', 'balance'], ['checks', 'checks']];
  const optBox = panel.querySelector<HTMLElement>('[data-opts]')!;
  OPTS.forEach(([k, label]) => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox"${ui.show[k] ? ' checked' : ''}> <span class="le-sw" style="background:${COL[k]}"></span>${label}`;
    l.querySelector('input')!.addEventListener('change', (e) => { ui.show[k] = (e.target as HTMLInputElement).checked; saveUi(); schedule(); });
    optBox.appendChild(l);
  });
  const snapBox = panel.querySelector<HTMLInputElement>('[data-snap]')!;
  snapBox.checked = ui.snap;
  snapBox.addEventListener('change', () => { ui.snap = snapBox.checked; saveUi(); });
  const guidesBtn = panel.querySelector<HTMLButtonElement>('[data-guides]')!;
  const report = panel.querySelector<HTMLElement>('[data-report]')!;
  function setGuides(on: boolean) {
    ui.guides = on; saveUi();
    guidesBtn.textContent = on ? 'Hide guides' : 'Show guides';
    optBox.style.display = on ? '' : 'none';
    schedule();
  }
  guidesBtn.addEventListener('click', () => setGuides(!ui.guides));

  // The visible screen in world px: wider or taller screens see past the 1440x900 world (see --ex/--ey).
  function frame() {
    const cs = getComputedStyle(world!);
    const ex = parseFloat(cs.getPropertyValue('--ex')) || 0, ey = parseFloat(cs.getPropertyValue('--ey')) || 0;
    return { x: -ex, y: -ey, w: 1440 + 2 * ex, h: 900 + 2 * ey };
  }
  type Frame = ReturnType<typeof frame>;
  const MARGIN = 48;
  function guideLines(f = frame()) {
    const xs = [f.x + f.w / 2, f.x + MARGIN, f.x + f.w - MARGIN], ys = [f.y + f.h / 2, f.y + MARGIN, f.y + f.h - MARGIN];
    if (ui.guides && ui.show.thirds) { xs.push(f.x + f.w / 3, f.x + f.w * 2 / 3); ys.push(f.y + f.h / 3, f.y + f.h * 2 / 3); }
    if (ui.guides && ui.show.phi) { xs.push(f.x + f.w * 0.382, f.x + f.w * 0.618); ys.push(f.y + f.h * 0.382, f.y + f.h * 0.618); }
    return { xs, ys };
  }
  // Each piece's outline in world px: its own rotation and scale about its centre. Cut-out stickers and 3D slots
  // have see-through corners, so they count as a box 80% the size.
  function geo(el: HTMLElement): Geo | null {
    if (!el.isConnected || el.offsetWidth < 2 || el.offsetHeight < 2) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const k = scale(), wr = world!.getBoundingClientRect(), r = el.getBoundingClientRect();
    const cx = (r.left + r.width / 2 - wr.left) / k, cy = (r.top + r.height / 2 - wr.top) / k;
    const m = cs.transform && cs.transform !== 'none' ? new DOMMatrix(cs.transform) : new DOMMatrix();
    const rm = /(-?[\d.]+)deg/.exec(cs.rotate || '');
    let ang = Math.atan2(m.b, m.a) * 180 / Math.PI + (rm ? parseFloat(rm[1]) : 0);
    ang = ((ang + 540) % 360) - 180;
    const sc = Math.hypot(m.a, m.b) * (cs.scale && cs.scale !== 'none' ? parseFloat(cs.scale) || 1 : 1);
    const soft = el.matches('.sticker, .sticker-deco, [data-src], [data-morph]') || cs.borderRadius.startsWith('50%');
    const ins = soft ? 0.8 : 1;
    const hw = el.offsetWidth * sc * ins / 2, hh = el.offsetHeight * sc * ins / 2;
    const a = ang * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    const poly = ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as P[]).map(([x, y]): P => [cx + x * co - y * si, cy + x * si + y * co]);
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    // Visual weight ~ visible area; text-only pieces (outlined tagline, small copy) weigh half.
    const solid = !!el.dataset.ideaId || !!el.querySelector('img, canvas, picture, svg') || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
    const area = 4 * hw * hh;
    const label = el.dataset.ideaId ? (ideaOf(el)?.label || 'idea') : nice(el);
    return { el, label, cx, cy, ang, poly, area, wt: area * (solid ? 1 : 0.5), l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
  }
  const allEls = () => [...pieces, ...ideaEls.values()];
  // Readable names for the report (the raw names are element ids and section keys).
  const NICE: Record<string, string> = {
    'gr-me': 'portrait', 'globe-disc': 'globe', contact: 'Email stamp', timeline: 'trophy', writing: 'book', photos: 'photos',
    map: 'map card', guestbook: 'guestbook note', ice3dp: '3D printer', tamagotchi: 'Tamagotchi', 'zm-hint': 'scroll hint', cassette: 'cassette',
  };
  function nice(el: HTMLElement) {
    const n = name(el);
    if (NICE[n]) return NICE[n];
    if (el.tagName === 'H1') return 'intro line';
    if (/^ships things/i.test(n) || el.matches('[class*="tagline"], [id*="tagline"]')) return 'tagline';
    if (/^TANISHQ/i.test(n)) return 'wordmark';
    return n.length > 18 ? `"${n.slice(0, 16)}…"` : n;
  }

  // -- convex polygon helpers --
  const signed = (p: P[]) => p.reduce((s, q, i) => { const n = p[(i + 1) % p.length]; return s + q[0] * n[1] - n[0] * q[1]; }, 0) / 2;
  const polyArea = (p: P[]) => (p.length > 2 ? Math.abs(signed(p)) : 0);
  function clip(subject: P[], clipper: P[]): P[] { // Sutherland–Hodgman
    let out = subject;
    const sg = signed(clipper) > 0 ? 1 : -1;
    for (let i = 0; i < clipper.length && out.length; i++) {
      const a = clipper[i], b = clipper[(i + 1) % clipper.length];
      const side = (p: P) => sg * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
      const cut = (p: P, q: P): P => { const d1 = side(p), d2 = side(q), t = d1 / (d1 - d2); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
      const inp = out; out = [];
      inp.forEach((p, j) => {
        const q = inp[(j + 1) % inp.length];
        if (side(q) >= 0) { if (side(p) < 0) out.push(cut(p, q)); out.push(q); } else if (side(p) >= 0) out.push(cut(p, q));
      });
    }
    return out;
  }
  function segPt(p: P, a: P, b: P): P {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
    return [a[0] + dx * t, a[1] + dy * t];
  }
  function gap(A: P[], B: P[]) { // closest points between two separate outlines
    let best = { d: Infinity, p: A[0], q: B[0] };
    const run = (X: P[], Y: P[], flip: boolean) => X.forEach((p) => Y.forEach((a, i) => {
      const q = segPt(p, a, Y[(i + 1) % Y.length]), d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < best.d) best = flip ? { d, p: q, q: p } : { d, p, q };
    }));
    run(A, B, false); run(B, A, true);
    return best;
  }
  const inPoly = (x: number, y: number, p: P[]) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    return c;
  };
  const pts = (p: P[]) => p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');

  type Issue = { cls: 'ok' | 'bad' | 'info'; text: string; els?: HTMLElement[] };
  function analyse(gs: Geo[], f: Frame) {
    const issues: Issue[] = [], marks: string[] = [];
    // Balance: centre of visual weight vs the screen centre, and how the weight splits into quarters.
    const W = gs.reduce((s, g) => s + g.wt, 0) || 1;
    const mx = gs.reduce((s, g) => s + g.wt * g.cx, 0) / W, my = gs.reduce((s, g) => s + g.wt * g.cy, 0) / W;
    const fcx = f.x + f.w / 2, fcy = f.y + f.h / 2;
    const ox = (mx - fcx) / f.w, oy = (my - fcy) / f.h;
    const side = `${Math.abs(ox * 100).toFixed(0)}% ${ox < 0 ? 'left' : 'right'}, ${Math.abs(oy * 100).toFixed(0)}% ${oy < 0 ? 'up' : 'down'}`;
    if (Math.abs(ox) < 0.03 && Math.abs(oy) < 0.03) issues.push({ cls: 'info', text: `Balance: weight is almost dead centre (${side}). Fine, but it can look static.` });
    else if (Math.hypot(ox, oy) <= 0.08) issues.push({ cls: 'ok', text: `Balance: weight sits ${side} of centre.` });
    else issues.push({ cls: 'bad', text: `Balance: weight leans ${side}. Move heavy pieces in, or add weight on the other side.` });
    const quad = [0, 0, 0, 0];
    gs.forEach((g) => { quad[(g.cx < fcx ? 0 : 1) + (g.cy < fcy ? 0 : 2)] += g.wt / W; });
    ['top left', 'top right', 'bottom left', 'bottom right'].forEach((qn, i) => {
      if (quad[i] < 0.1) issues.push({ cls: 'info', text: `The ${qn} quarter holds only ${Math.round(quad[i] * 100)}% of the weight. Fine if that's your open space.` });
      else if (quad[i] > 0.4) issues.push({ cls: 'bad', text: `The ${qn} quarter holds ${Math.round(quad[i] * 100)}% of the weight (crowded).` });
    });

    // Focal point: the heaviest piece should clearly lead, near a thirds/phi crossing.
    // Two heavy pieces stacked on each other (portrait over the globe) read as one focal unit.
    const byWt = [...gs].sort((a, b) => b.wt - a.wt);
    let stack: [Geo, Geo] | null = null;
    if (byWt.length > 2) {
      const [a, b] = byWt, ov = polyArea(clip(a.poly, b.poly)) / (Math.min(a.area, b.area) || 1);
      if (ov > 0.3) stack = [a, b];
    }
    if (byWt.length > 1) {
      const lead = stack ? { label: `${stack[0].label} + ${stack[1].label}`, wt: stack[0].wt + stack[1].wt, cx: (stack[0].cx * stack[0].wt + stack[1].cx * stack[1].wt) / (stack[0].wt + stack[1].wt), cy: (stack[0].cy * stack[0].wt + stack[1].cy * stack[1].wt) / (stack[0].wt + stack[1].wt) } : byWt[0];
      const next = byWt[stack ? 2 : 1], ratio = lead.wt / next.wt, cross: P[] = [];
      [1 / 3, 2 / 3, 0.382, 0.618].forEach((u) => [1 / 3, 2 / 3, 0.382, 0.618].forEach((v) => cross.push([f.x + f.w * u, f.y + f.h * v])));
      const near = Math.min(...cross.map(([x, y]) => Math.hypot(lead.cx - x, lead.cy - y)));
      issues.push({ cls: ratio >= 1.5 ? 'ok' : 'bad', text: `Focal point: ${lead.label}, ${ratio.toFixed(1)}× the next heaviest (${next.label})${ratio < 1.5 ? '; aim for 1.5× or more' : ''}. Its centre is ${Math.round(near)}px from the nearest thirds/phi crossing.`, els: [(stack ? stack[0] : byWt[0]).el] });
    }
    const stacked = (A: Geo, B: Geo) => !!stack && stack.includes(A) && stack.includes(B);

    // Tilts.
    const tilted = gs.filter((g) => Math.abs(g.ang) >= 1);
    gs.forEach((g) => {
      const a = Math.abs(g.ang);
      if (a > 0.2 && a < 1) issues.push({ cls: 'bad', text: `${g.label} is tilted ${g.ang.toFixed(1)}°: tiny tilts look accidental. Use 0°, or 2° and up.`, els: [g.el] });
      if (a > 12.5) issues.push({ cls: 'bad', text: `${g.label} is tilted ${g.ang.toFixed(1)}° (steep; 12° or less reads calmer).`, els: [g.el] });
    });
    const byAng = [...tilted].sort((a, b) => a.ang - b.ang);
    for (let i = 0; i + 2 < byAng.length; i++) {
      if (byAng[i + 2].ang - byAng[i].ang <= 1.5) {
        const grp = byAng.slice(i, i + 3);
        issues.push({ cls: 'bad', text: `${grp.map((g) => g.label).join(', ')} share almost the same tilt (about ${grp[1].ang.toFixed(1)}°). Vary them.`, els: grp.map((g) => g.el) });
        i += 2;
      }
    }
    if (tilted.length >= 3) {
      const neg = tilted.filter((g) => g.ang < 0).length / tilted.length;
      const mean = tilted.reduce((s, g) => s + g.ang, 0) / tilted.length;
      const sd = Math.sqrt(tilted.reduce((s, g) => s + (g.ang - mean) ** 2, 0) / tilted.length);
      if (neg < 0.35 || neg > 0.65) issues.push({ cls: 'bad', text: `${Math.round(neg * 100)}% of the tilted pieces lean left. Mix directions (roughly 35–65%).` });
      else issues.push({ cls: 'ok', text: `Tilts mix both ways (${Math.round(neg * 100)}% lean left, spread ${sd.toFixed(1)}°).` });
      if (sd < 3) issues.push({ cls: 'bad', text: `Tilts are very alike (spread ${sd.toFixed(1)}°; 3° or more looks livelier).` });
    }
    if (gs.length && gs.length === tilted.length) issues.push({ cls: 'bad', text: 'Nothing is straight: keep 1–3 pieces at 0° as anchors.' });

    // Touching edges and heavy overlaps, pair by pair.
    gs.forEach((A, i) => gs.slice(i + 1).forEach((B) => {
      if (stacked(A, B) || A.r < B.l - 30 || B.r < A.l - 30 || A.b < B.t - 30 || B.b < A.t - 30) return;
      const inter = clip(A.poly, B.poly), ia = polyArea(inter), small = Math.min(A.area, B.area) || 1;
      if (ia > 0) {
        const fr = ia / small;
        if (fr < 0.02) {
          issues.push({ cls: 'bad', text: `${A.label} and ${B.label} barely overlap. Overlap 12px or more, or pull them apart.`, els: [A.el, B.el] });
          marks.push(`<polygon points="${pts(inter)}" fill="${COL.checks}" fill-opacity=".7" stroke="${COL.checks}" stroke-width="2"/>`);
        } else if (fr > 0.35) {
          issues.push({ cls: 'bad', text: `${A.area < B.area ? A.label : B.label} is ${Math.round(fr * 100)}% covered by ${A.area < B.area ? B.label : A.label}. Above about 35% it hides content.`, els: [A.el, B.el] });
          marks.push(`<polygon points="${pts(inter)}" fill="${COL.checks}" fill-opacity=".22" stroke="${COL.checks}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
        }
      } else {
        const g = gap(A.poly, B.poly);
        if (g.d < 24) {
          issues.push({ cls: 'bad', text: `${A.label} and ${B.label} nearly touch (${Math.round(g.d)}px apart). Overlap them, or leave 24px or more.`, els: [A.el, B.el] });
          marks.push(`<line x1="${g.p[0]}" y1="${g.p[1]}" x2="${g.q[0]}" y2="${g.q[1]}" stroke="${COL.checks}" stroke-width="3"/><circle cx="${(g.p[0] + g.q[0]) / 2}" cy="${(g.p[1] + g.q[1]) / 2}" r="9" fill="none" stroke="${COL.checks}" stroke-width="2"/>`);
        }
      }
    }));

    // Screen edges: crop on purpose (15%+) or stay clear; slight crops and near misses look like mistakes.
    const fr: P[] = [[f.x, f.y], [f.x + f.w, f.y], [f.x + f.w, f.y + f.h], [f.x, f.y + f.h]];
    gs.forEach((g) => {
      const ins = polyArea(clip(g.poly, fr)) / (g.area || 1);
      const edge = Math.min(g.l - f.x, g.t - f.y, f.x + f.w - g.r, f.y + f.h - g.b);
      if (ins < 0.99 && ins > 0.85) issues.push({ cls: 'bad', text: `${g.label} is cut off by the screen edge by only ${Math.max(1, Math.round((1 - ins) * 100))}%. Bleed 15% or more, or bring it in.`, els: [g.el] });
      else if (ins >= 0.99 && edge >= 0 && edge < 8) issues.push({ cls: 'bad', text: `${g.label} grazes the screen edge (${Math.round(edge)}px).`, els: [g.el] });
    });

    // Empty space, sampled on a 16px grid.
    let free = 0, tot = 0;
    for (let y = f.y + 8; y < f.y + f.h; y += 16) for (let x = f.x + 8; x < f.x + f.w; x += 16) {
      tot++;
      if (!gs.some((g) => x >= g.l && x <= g.r && y >= g.t && y <= g.b && inPoly(x, y, g.poly))) free++;
    }
    const fp = free / (tot || 1);
    issues.push({ cls: fp < 0.15 ? 'bad' : fp < 0.25 || fp > 0.5 ? 'info' : 'ok', text: `Empty space: ${Math.round(fp * 100)}% of the screen${fp < 0.15 ? ' (cluttered; aim for 25–40%)' : fp < 0.25 ? ' (a bit busy; 25–40% is typical)' : fp > 0.5 ? ' (very open; fine if intended)' : ''}.` });

    // Scale variety: three pieces of nearly the same size look flat.
    const bySize = gs.filter((g) => !g.el.dataset.ideaId).sort((a, b) => a.area - b.area);
    for (let i = 0; i + 2 < bySize.length; i++) {
      if (bySize[i + 2].area <= bySize[i].area * 1.15) {
        const grp = bySize.slice(i, i + 3);
        issues.push({ cls: 'info', text: `${grp.map((g) => g.label).join(', ')} are nearly the same size. Making one bigger adds hierarchy.`, els: grp.map((g) => g.el) });
        i += 2;
      }
    }
    const rank = { bad: 0, info: 1, ok: 2 };
    issues.sort((a, b) => rank[a.cls] - rank[b.cls]);
    return { issues, marks, mx, my };
  }

  let issues: Issue[] = [];
  report.addEventListener('click', (ev) => {
    const li = (ev.target as HTMLElement).closest('li');
    const it = li ? issues[Number(li.dataset.i)] : null;
    if (it?.els?.length) select(it.els[0]);
  });
  let drawQueued = 0;
  let snapLines: { xs: number[]; ys: number[] } = { xs: [], ys: [] };
  schedule = () => { if (!drawQueued) drawQueued = requestAnimationFrame(() => { drawQueued = 0; drawGuides(); }); };
  function drawGuides() {
    const f = frame(), sh = ui.show, out: string[] = [], k = scale(), fs = 13 / k;
    const L = (x1: number, y1: number, x2: number, y2: number, c: string, o = 0.55, dash = '', w = 1.5) =>
      out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-opacity="${o}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    const T = (x: number, y: number, t: string, c: string, anchor = 'start') =>
      out.push(`<text x="${x}" y="${y}" fill="${c}" font-size="${fs}" font-family="ui-monospace, monospace" font-weight="700" text-anchor="${anchor}" paint-order="stroke" stroke="#0d160b" stroke-width="${4 / k}">${t}</text>`);
    if (ui.guides) {
      const X = (u: number) => f.x + f.w * u, Y = (v: number) => f.y + f.h * v;
      if (sh.margin) {
        out.push(`<rect x="${f.x + MARGIN}" y="${f.y + MARGIN}" width="${f.w - 2 * MARGIN}" height="${f.h - 2 * MARGIN}" fill="none" stroke="${COL.margin}" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="6 5"/>`);
        L(X(0.5), f.y, X(0.5), f.y + f.h, COL.margin, 0.3, '2 6'); L(f.x, Y(0.5), f.x + f.w, Y(0.5), COL.margin, 0.3, '2 6');
        T(f.x + MARGIN + 6, f.y + MARGIN + fs + 4, `${MARGIN}px safe margin`, COL.margin);
      }
      if (sh.thirds) {
        [1 / 3, 2 / 3].forEach((u) => { L(X(u), f.y, X(u), f.y + f.h, COL.thirds); L(f.x, Y(u), f.x + f.w, Y(u), COL.thirds); });
        [1 / 3, 2 / 3].forEach((u) => [1 / 3, 2 / 3].forEach((v) => out.push(`<circle cx="${X(u)}" cy="${Y(v)}" r="${8 / k}" fill="none" stroke="${COL.thirds}" stroke-width="2"/>`)));
        T(X(1 / 3) + 6, Y(1 / 3) - 8, 'thirds', COL.thirds);
      }
      if (sh.phi) {
        [0.382, 0.618].forEach((u) => { L(X(u), f.y, X(u), f.y + f.h, COL.phi, 0.6, '8 4'); L(f.x, Y(u), f.x + f.w, Y(u), COL.phi, 0.6, '8 4'); });
        T(X(0.618) + 6, Y(0.382) - 8, 'phi', COL.phi);
      }
      if (sh.diag) {
        const c: P[] = [[f.x, f.y], [f.x + f.w, f.y], [f.x + f.w, f.y + f.h], [f.x, f.y + f.h]];
        L(c[0][0], c[0][1], c[2][0], c[2][1], COL.diag, 0.6); L(c[3][0], c[3][1], c[1][0], c[1][1], COL.diag, 0.6);
        // Golden triangles: from the two free corners, perpendicular to each diagonal.
        [[1, 0, 2], [3, 0, 2], [0, 3, 1], [2, 3, 1]].forEach(([p, a, b]) => { const q = segPt(c[p], c[a], c[b]); L(c[p][0], c[p][1], q[0], q[1], COL.diag, 0.4, '4 4'); });
      }
      if (sh.zpath) {
        const m = 120, zp: P[] = [[f.x + m, f.y + m], [f.x + f.w - m, f.y + m], [f.x + m, f.y + f.h - m], [f.x + f.w - m, f.y + f.h - m]];
        out.push(`<polyline points="${pts(zp)}" fill="none" stroke="${COL.zpath}" stroke-opacity=".7" stroke-width="2.5" stroke-dasharray="10 6"/>`);
        ['1 first look: wordmark', '2', '3', '4 last look: call to action'].forEach((t, i) => { out.push(`<circle cx="${zp[i][0]}" cy="${zp[i][1]}" r="${9 / k}" fill="${COL.zpath}"/>`); T(zp[i][0] + (i % 2 ? -14 / k : 14 / k), zp[i][1] + 5 / k, t, COL.zpath, i % 2 ? 'end' : 'start'); });
      }
      const gs = allEls().map(geo).filter((g): g is Geo => !!g);
      const res = analyse(gs, f);
      issues = res.issues;
      if (sh.checks) {
        const bad = new Set(issues.filter((i) => i.cls === 'bad').flatMap((i) => i.els || []));
        gs.forEach((g) => out.push(bad.has(g.el)
          ? `<polygon points="${pts(g.poly)}" fill="none" stroke="${COL.checks}" stroke-opacity=".85" stroke-width="1.5" stroke-dasharray="5 4"/>`
          : `<polygon points="${pts(g.poly)}" fill="none" stroke="#EFFDD8" stroke-opacity=".3" stroke-width="1"/>`));
        out.push(...res.marks);
        gs.forEach((g) => T(g.cx, g.cy + fs / 3, `${g.ang > 0.05 ? '+' : ''}${Math.abs(g.ang) < 0.05 ? '0' : g.ang.toFixed(1)}°`, '#EFFDD8', 'middle'));
      }
      if (sh.balance) {
        const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
        out.push(`<ellipse cx="${cx}" cy="${cy}" rx="${f.w * 0.08}" ry="${f.h * 0.08}" fill="none" stroke="${COL.balance}" stroke-opacity=".75" stroke-width="1.5" stroke-dasharray="6 4"/>`);
        L(cx - 16 / k, cy, cx + 16 / k, cy, '#EFFDD8', 0.9); L(cx, cy - 16 / k, cx, cy + 16 / k, '#EFFDD8', 0.9);
        L(cx, cy, res.mx, res.my, COL.balance, 0.95, '', 2);
        out.push(`<circle cx="${res.mx}" cy="${res.my}" r="${10 / k}" fill="${COL.balance}" stroke="#0d160b" stroke-width="2"/>`);
        T(res.mx + 16 / k, res.my - 12 / k, 'centre of weight', COL.balance);
      }
      report.innerHTML = issues.map((it, i) => `<li class="${it.cls}" data-i="${i}"${it.els?.length ? ' data-sel title="click to select"' : ''}>${it.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('');
    } else report.innerHTML = '';
    // Snap lines show while dragging, guides on or off.
    snapLines.xs.forEach((x) => L(x, f.y - 400, x, f.y + f.h + 400, '#00E5FF', 0.95, '', 1.5));
    snapLines.ys.forEach((y) => L(f.x - 400, y, f.x + f.w + 400, y, '#00E5FF', 0.95, '', 1.5));
    gsvg.innerHTML = out.join('');
  }
  window.addEventListener('resize', schedule);
  setGuides(ui.guides);

  // ---- pointer ----
  const scale = () => (window as unknown as { __zoomCam?: { s: number } }).__zoomCam?.s || 1;
  const target = (t: EventTarget | null) => {
    const n = t instanceof Element ? t.closest<HTMLElement>('[data-edit-id], .le-idea') : null;
    return n && world.contains(n) ? n : null;
  };
  let drag: { el: HTMLElement; x: number; y: number; mode: 'move' | 'rot' | 'scale'; cx: number; cy: number; a0: number;
    x0: number; y0: number; v0x: number; v0y: number; box: Geo | null; tx: number[]; ty: number[] } | null = null;
  // Capture phase on window: runs before the camera's click-to-fly and the 3D orbit controls, and stops them.
  window.addEventListener('pointerdown', (ev) => {
    if (panel.contains(ev.target as Node)) return;
    const el = target(ev.target);
    ev.stopPropagation(); ev.preventDefault();
    select(el);
    if (!el) return;
    checkpoint(); // a click with no movement leaves an equal snapshot, dropped again on pointerup
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const d0 = ideaOf(el), e0 = edits[el.dataset.editId!];
    // Snap targets: the screen centre, safe margins, the visible grids, and every other piece's edges and centre.
    const gl = guideLines(), tx = [...gl.xs], ty = [...gl.ys];
    allEls().forEach((o) => { if (o === el) return; const g = geo(o); if (g) { tx.push(g.l, g.r, (g.l + g.r) / 2); ty.push(g.t, g.b, (g.t + g.b) / 2); } });
    drag = { el, x: ev.clientX, y: ev.clientY, mode: ev.shiftKey ? 'rot' : ev.altKey ? 'scale' : 'move', cx, cy, a0: Math.atan2(ev.clientY - cy, ev.clientX - cx),
      x0: ev.clientX, y0: ev.clientY, v0x: d0 ? d0.x : e0?.dx || 0, v0y: d0 ? d0.y : e0?.dy || 0, box: geo(el), tx, ty };
  }, true);
  window.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    ev.stopPropagation();
    const k = scale(), d = drag;
    if (d.mode === 'move') {
      let mx = (ev.clientX - d.x0) / k, my = (ev.clientY - d.y0) / k;
      snapLines = { xs: [], ys: [] };
      if (ui.snap && !ev.ctrlKey && !ev.metaKey && d.box) {
        const tol = 6 / k, b = d.box;
        const best = (edges: number[], ts: number[]) => {
          let bd = Infinity, sh = 0, at = 0;
          edges.forEach((e) => ts.forEach((t) => { const dd = Math.abs(t - e); if (dd < bd) { bd = dd; sh = t - e; at = t; } }));
          return bd <= tol ? { sh, at } : null;
        };
        const sx = best([b.l + mx, (b.l + b.r) / 2 + mx, b.r + mx], d.tx), sy = best([b.t + my, (b.t + b.b) / 2 + my, b.b + my], d.ty);
        if (sx) { mx += sx.sh; snapLines.xs.push(sx.at); }
        if (sy) { my += sy.sh; snapLines.ys.push(sy.at); }
      }
      change(d.el, (v) => { v.dx = d.v0x + mx; v.dy = d.v0y + my; });
    }
    else if (d.mode === 'rot') {
      const a = Math.atan2(ev.clientY - d.cy, ev.clientX - d.cx);
      change(d.el, (v) => { v.rot += (a - d.a0) * 180 / Math.PI; });
      d.a0 = a;
    } else change(d.el, (v) => { v.s *= Math.exp((ev.clientX - d.x - (ev.clientY - d.y)) / 300); });
    d.x = ev.clientX; d.y = ev.clientY;
  }, true);
  window.addEventListener('pointerup', (ev) => {
    if (!drag) return;
    ev.stopPropagation();
    drag = null;
    snapLines = { xs: [], ys: [] }; schedule();
    if (undo[undo.length - 1] === snap()) { undo.pop(); syncButtons(); }
    window.dispatchEvent(new Event('resize')); // 3D slots re-measure where they are
  }, true);
  for (const t of ['click', 'dblclick']) window.addEventListener(t, (ev) => { if (!panel.contains(ev.target as Node)) { ev.stopPropagation(); ev.preventDefault(); } }, true);
  window.addEventListener('wheel', (ev) => {
    if (panel.contains(ev.target as Node)) return;
    ev.preventDefault(); ev.stopPropagation();
    if (sel) { checkpoint('wheel:' + (sel.dataset.editId || sel.dataset.ideaId)); change(sel, (v) => { v.s *= Math.exp(-ev.deltaY / 800); }); }
  }, { capture: true, passive: false });

  window.addEventListener('keydown', (ev) => {
    if ((ev.target as HTMLElement).closest?.('input, textarea')) return;
    const mod = ev.ctrlKey || ev.metaKey, lk = ev.key.toLowerCase();
    if (mod && (lk === 'z' || lk === 'y')) {
      ev.preventDefault(); ev.stopPropagation();
      if (lk === 'y' || ev.shiftKey) step(redo, undo); else step(undo, redo);
      return;
    }
    if (!mod && !ev.altKey && (lk === 'm' || lk === 'g')) { ev.preventDefault(); ev.stopPropagation(); if (lk === 'm') setMin(!ui.min); else setGuides(!ui.guides); return; }
    if (!sel || mod) return;
    const n = ev.shiftKey ? 10 : 1;
    const k = ev.key;
    const act: Record<string, (v: { dx: number; dy: number; rot: number; s: number }) => void> = {
      ArrowLeft: (v) => { v.dx -= n; }, ArrowRight: (v) => { v.dx += n; }, ArrowUp: (v) => { v.dy -= n; }, ArrowDown: (v) => { v.dy += n; },
      '[': (v) => { v.rot -= n; }, ']': (v) => { v.rot += n; }, '-': (v) => { v.s /= 1.03; }, '=': (v) => { v.s *= 1.03; }, '+': (v) => { v.s *= 1.03; },
    };
    if (act[k]) { ev.preventDefault(); ev.stopPropagation(); checkpoint('key:' + k + (sel.dataset.editId || sel.dataset.ideaId)); change(sel, act[k]); return; }
    if ((k === 'f' || k === 'b') && !ideaOf(sel)) {
      checkpoint();
      const e = get(sel.dataset.editId!);
      const z = Number(getComputedStyle(sel).zIndex) || 0;
      e.z = z + (k === 'f' ? 1 : -1); apply(sel); save(); refresh();
    }
    if ((k === 'Delete' || k === 'Backspace') && ideaOf(sel)) {
      checkpoint();
      const d = ideaOf(sel)!; ideas = ideas.filter((x) => x !== d); ideaEls.get(d.id)?.remove(); ideaEls.delete(d.id); save(); select(null);
    }
    if (k === 'Escape') select(null);
  }, true);

  // ---- buttons ----
  const toast = (t: string) => { const el = document.createElement('div'); el.className = 'le-toast'; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 1600); };
  panel.querySelector('[data-copy]')!.addEventListener('click', async () => {
    const lines = ['Collage layout (1440x900 world px; move = offset from the current spot, rotation added to the current one)'];
    pieces.forEach((el) => {
      const e = edits[el.dataset.editId!];
      if (!e || (!e.dx && !e.dy && !e.rot && e.s === 1 && e.z == null)) return;
      lines.push(`- ${name(el)}: move ${Math.round(e.dx)}, ${Math.round(e.dy)}; rotate +${e.rot.toFixed(1)}°; scale ${e.s.toFixed(2)}${e.z != null ? `; z-index ${e.z}` : ''}`);
    });
    ideas.forEach((d) => lines.push(`- NEW ${d.label}: centre ${Math.round(d.x + d.w / 2)}, ${Math.round(d.y + d.h / 2)}; size ${Math.round(d.w * d.s)}x${Math.round(d.h * d.s)}; rotate ${d.rot.toFixed(1)}°`));
    if (lines.length === 1) lines.push('(no changes)');
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); toast('Layout copied: paste it to Claude'); }
    catch { window.prompt('Copy this layout:', text); }
  });
  panel.querySelector('[data-reset-one]')!.addEventListener('click', () => {
    if (!sel || ideaOf(sel)) return;
    checkpoint();
    delete edits[sel.dataset.editId!]; sel.style.zIndex = ''; apply(sel); save(); refresh();
  });
  panel.querySelector('[data-reset]')!.addEventListener('click', () => {
    if (!confirm('Reset every item and remove the idea boxes? (Undo brings them back.)')) return;
    checkpoint();
    Object.keys(edits).forEach((k) => delete edits[k]);
    pieces.forEach((el) => { el.style.zIndex = ''; apply(el); });
    ideaEls.forEach((el) => el.remove()); ideaEls.clear(); ideas = [];
    save(); select(null);
  });
}
