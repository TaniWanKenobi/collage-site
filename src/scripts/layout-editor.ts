// Layout editor for the home collage: open the home page with ?edit (desktop width).
// Every piece of the zoomed-out collage can be dragged, rotated and scaled; idea boxes from the tray try out new
// items. Edits stay in this browser (localStorage) until Reset; "Copy layout" puts a summary on the clipboard to
// hand back so the positions can be written into the components. Nothing here ships in the normal page path: the
// module is only imported when the URL has ?edit.
//   drag = move · shift+drag = rotate · alt+drag (or wheel) = scale · arrows nudge (shift = 10px)
//   [ ] = rotate 1° · - + = scale · F / B = forward / back · Del = remove an idea box · Esc = deselect

interface Edit { dx: number; dy: number; rot: number; s: number; z: number | null }
interface Idea { id: string; label: string; w: number; h: number; x: number; y: number; rot: number; s: number }

const KEY = 'collage-layout-edits-v1';
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
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ edits, ideas })); } catch { /* private window */ } };

  // ---- styles ----
  const css = document.createElement('style');
  css.textContent = `
    #zm-world [data-edit-id], .le-idea { cursor: move !important; }
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

  // ---- selection + panel ----
  let sel: HTMLElement | null = null;
  const panel = document.createElement('div');
  panel.className = 'le-panel';
  panel.innerHTML = `
    <h2>Layout editor</h2>
    <p>drag = move · shift+drag = rotate · alt+drag / wheel = scale · arrows nudge · [ ] rotate · − + scale · F/B front/back</p>
    <div class="le-sel-info" data-info>click an item</div>
    <button class="le-main" data-copy>Copy layout</button><button data-reset-one>Reset item</button><button data-reset>Reset all</button>
    <h2 style="margin-top:10px">Try an item</h2>
    <p>adds a placeholder box you can place</p>
    <div data-ideas></div>
    <p style="margin-top:8px"><a href="?" style="color:#C2F970">exit editor</a></p>`;
  document.body.appendChild(panel);
  const info = panel.querySelector<HTMLElement>('[data-info]')!;
  const ideaBox = panel.querySelector<HTMLElement>('[data-ideas]')!;
  IDEAS.forEach(([label, w, h]) => {
    const b = document.createElement('button');
    b.textContent = `+ ${label}`;
    b.addEventListener('click', () => {
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

  // ---- pointer ----
  const scale = () => (window as unknown as { __zoomCam?: { s: number } }).__zoomCam?.s || 1;
  const target = (t: EventTarget | null) => {
    const n = t instanceof Element ? t.closest<HTMLElement>('[data-edit-id], .le-idea') : null;
    return n && world.contains(n) ? n : null;
  };
  let drag: { el: HTMLElement; x: number; y: number; mode: 'move' | 'rot' | 'scale'; cx: number; cy: number; a0: number } | null = null;
  // Capture phase on window: runs before the camera's click-to-fly and the 3D orbit controls, and stops them.
  window.addEventListener('pointerdown', (ev) => {
    if (panel.contains(ev.target as Node)) return;
    const el = target(ev.target);
    ev.stopPropagation(); ev.preventDefault();
    select(el);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    drag = { el, x: ev.clientX, y: ev.clientY, mode: ev.shiftKey ? 'rot' : ev.altKey ? 'scale' : 'move', cx, cy, a0: Math.atan2(ev.clientY - cy, ev.clientX - cx) };
  }, true);
  window.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    ev.stopPropagation();
    const k = scale(), d = drag;
    if (d.mode === 'move') change(d.el, (v) => { v.dx += (ev.clientX - d.x) / k; v.dy += (ev.clientY - d.y) / k; });
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
    window.dispatchEvent(new Event('resize')); // 3D slots re-measure where they are
  }, true);
  for (const t of ['click', 'dblclick']) window.addEventListener(t, (ev) => { if (!panel.contains(ev.target as Node)) { ev.stopPropagation(); ev.preventDefault(); } }, true);
  window.addEventListener('wheel', (ev) => {
    if (panel.contains(ev.target as Node)) return;
    ev.preventDefault(); ev.stopPropagation();
    if (sel) change(sel, (v) => { v.s *= Math.exp(-ev.deltaY / 800); });
  }, { capture: true, passive: false });

  window.addEventListener('keydown', (ev) => {
    if (!sel || (ev.target as HTMLElement).closest?.('input, textarea')) return;
    const n = ev.shiftKey ? 10 : 1;
    const k = ev.key;
    const act: Record<string, (v: { dx: number; dy: number; rot: number; s: number }) => void> = {
      ArrowLeft: (v) => { v.dx -= n; }, ArrowRight: (v) => { v.dx += n; }, ArrowUp: (v) => { v.dy -= n; }, ArrowDown: (v) => { v.dy += n; },
      '[': (v) => { v.rot -= n; }, ']': (v) => { v.rot += n; }, '-': (v) => { v.s /= 1.03; }, '=': (v) => { v.s *= 1.03; }, '+': (v) => { v.s *= 1.03; },
    };
    if (act[k]) { ev.preventDefault(); ev.stopPropagation(); change(sel, act[k]); return; }
    if ((k === 'f' || k === 'b') && !ideaOf(sel)) {
      const e = get(sel.dataset.editId!);
      const z = Number(getComputedStyle(sel).zIndex) || 0;
      e.z = z + (k === 'f' ? 1 : -1); apply(sel); save(); refresh();
    }
    if ((k === 'Delete' || k === 'Backspace') && ideaOf(sel)) {
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
    delete edits[sel.dataset.editId!]; sel.style.zIndex = ''; apply(sel); save(); refresh();
  });
  panel.querySelector('[data-reset]')!.addEventListener('click', () => {
    if (!confirm('Reset every item and remove the idea boxes?')) return;
    Object.keys(edits).forEach((k) => delete edits[k]);
    pieces.forEach((el) => { el.style.zIndex = ''; apply(el); });
    ideaEls.forEach((el) => el.remove()); ideaEls.clear(); ideas = [];
    save(); select(null);
  });
}
