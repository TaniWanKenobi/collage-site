// Motion for the section nav (#zm-hud), picked with ?nav= (see ZoomStage.astro; CSS in global.css).
// Every style shares goo's motion: when the current section changes (click or scroll), its indicator springs
// (stiffness 300, damping 20) to the new dot and stretches along Y with its speed (glider() below).
//  - dots / frost / lens: a lime disc travels between the dots (frost/lens keep their glow inside the glass).
//  - bubble: the glass bubble itself travels.  drop: the glass bead travels.  (Glass keeps no goo filter.)
//  - water: the WebGL drop in liquid-nav.ts uses the same spring and stretch.
//  - dock: after Magic UI Dock (MIT), turned vertical. Only the hovered dot magnifies (12 -> 26px),
//    on a stiff, slightly underdamped spring so it snaps rather than glides; a press squashes the dot and it springs
//    back. The lime current marker travels with the goo spring and rides the magnification.
//  - dockline: dock + thread. The dock's magnifying, clicky dots strung on the thread's scroll-filled line;
//    passed knots fill lime, and the line's fill tracks the knots as they push apart.
//  - goo: after 21st.dev GooeyPagination by ruixen.ui. A lime blob springs between the dots under an SVG goo
//    filter (blur -> alpha threshold -> atop), stretching with its speed. The original's blur 8 / alpha 20 -10
//    erases dots this small (12px), so it is scaled down to blur 5 / alpha 20 -8.
//  - thread: a line that fills with the camera's smoothed scroll (zoom-camera.js publishes p, 0..7), a knot per
//    section; passed knots are filled and the bead travels along the line.
//  - odometer: a ruler of ticks whose long lime current tick travels, and a rolling counter (after Magic UI
//    Number Ticker (MIT): its overdamped spring, approximated by a CSS transition).
// Nothing here runs while idle: every loop stops once its springs settle, and the listeners only do work on change.
// Switching live (the Looks picker, scripts/looks.ts, sends a "looks:change" event): setNav() tears the current
// style down completely (everything a style makes registers its own undo with own()) and starts the new one.

/* ---------------- teardown bookkeeping ---------------- */
// Every element, listener, observer, loop and inline style a style adds registers its undo here; teardown runs
// them newest first. gen changes on every switch, so async work (liquid-nav's refraction map) can tell it is stale.
let bin: (() => void)[] = [];
let gen = 0;
export const navGen = () => gen;
export function own(undo: () => void) { bin.push(undo); }
export function listen(t: EventTarget, type: string, fn: EventListener, o?: AddEventListenerOptions) {
  t.addEventListener(type, fn, o);
  own(() => t.removeEventListener(type, fn, o));
}
function teardown(hud: HTMLElement) {
  gen++;
  const b = bin;
  bin = [];
  for (let i = b.length - 1; i >= 0; i--) { try { b[i](); } catch { /* keep tearing down */ } }
  hud.classList.remove('nv', 'nv-glide', 'lg-refract', 'lq-on');
  hud.style.removeProperty('--lg-filter');
}

const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// One rAF loop that runs only while step() reports motion. step gets dt in seconds.
function loop(step: (dt: number) => boolean) {
  let raf = 0, last = 0;
  const tick = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    raf = step(dt) ? requestAnimationFrame(tick) : 0;
    if (!raf) last = 0;
  };
  own(() => { if (raf) cancelAnimationFrame(raf); raf = 0; });
  return () => { if (!raf) raf = requestAnimationFrame(tick); };
}
// Damped spring, integrated in small fixed substeps (stiff springs are unstable at one step per frame).
export function spring(s: { x: number; v: number }, target: number, k: number, c: number, m: number, dt: number) {
  const h = 1 / 600;
  for (let t = 0; t < dt; t += h) {
    const step = Math.min(h, dt - t);
    s.v += ((-k * (s.x - target) - c * s.v) / m) * step;
    s.x += s.v * step;
  }
}
const setVar = (el: HTMLElement, name: string, val: string) => { if (el.style.getPropertyValue(name) !== val) el.style.setProperty(name, val); };

/* ---------------- shared goo motion ---------------- */
// goo's spring and its stretch along the travel axis (1 at rest, up to 1.7 at speed; across shrinks by 1/sqrt).
export const GOO_K = 300, GOO_C = 20;
export const stretch = (v: number) => 1 + Math.min(Math.abs(v) / 900, 0.7);

// A position that springs to a target with goo's spring. draw(y, st) gets the position and the stretch.
// step() is exposed so a style with its own loop (dock) can drive it; to() runs it on its own loop.
export function glider(draw: (y: number, st: number) => void) {
  const s = { x: 0, v: 0 };
  let T = 0;
  const step = (dt: number) => {
    spring(s, T, GOO_K, GOO_C, 1, dt);
    const done = Math.abs(s.x - T) < 0.05 && Math.abs(s.v) < 0.5;
    if (done) { s.x = T; s.v = 0; }
    draw(s.x, stretch(s.v));
    return !done;
  };
  const kick = loop(step);
  return {
    step,
    set(t: number) { T = t; },
    jump(t: number) { T = s.x = t; s.v = 0; draw(t, 1); },
    to(t: number) { T = t; kick(); },
  };
}

// Calls fn(i) whenever the current section (aria-current) changes; i = -1 for the collage overview.
function onCurrent(ul: HTMLElement, dots: HTMLElement[], fn: (i: number) => void) {
  let cur = -2;
  const go = () => {
    const i = dots.findIndex((d) => d.getAttribute('aria-current') === 'true');
    if (i !== cur) { cur = i; fn(i); }
  };
  go();
  const mo = new MutationObserver(go);
  mo.observe(ul, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  own(() => mo.disconnect());
}

const centresOf = (lis: HTMLElement[]) => lis.map((li) => li.offsetTop + li.offsetHeight / 2);

// The travelling current-section indicator for a style: el (made here unless given) is positioned by CSS with its
// centre at the ul's top, and moved here with translateY + a stretch. From hidden (the overview) it appears in
// place; between sections it travels. .nv-glide on the nav lets the CSS drop the static current-dot fill.
function traveller(hud: HTMLElement, ul: HTMLElement, lis: HTMLElement[], dots: HTMLElement[], cls: string, given?: HTMLElement) {
  if (reduceMotion()) return; // the static current-dot look stays
  const el = given || document.createElement('span');
  if (!given) { el.className = `nv-ind ${cls}`; el.setAttribute('aria-hidden', 'true'); ul.prepend(el); own(() => el.remove()); }
  else own(() => { el.style.transform = ''; el.classList.remove('is-on'); });
  hud.classList.add('nv-glide');
  const centres = centresOf(lis);
  const g = glider((y, st) => { el.style.transform = `translateY(${y.toFixed(2)}px) scale(${(1 / Math.sqrt(st)).toFixed(3)}, ${st.toFixed(3)})`; });
  let shown = false;
  onCurrent(ul, dots, (i) => {
    el.classList.toggle('is-on', i >= 0);
    if (i < 0) { shown = false; return; }
    if (shown) g.to(centres[i]); else { g.jump(centres[i]); shown = true; }
  });
}

/* ---------------- dock (Magic UI Dock, vertical, clicky) ---------------- */
function dock(hud: HTMLElement, ul: HTMLElement, lis: HTMLElement[], dots: HTMLElement[], strung = false) {
  // dockline: the same dots strung on the thread's scroll-filled line (drawn below, re-drawn as the dots push apart).
  const line = strung ? dockLine(ul, lis, dots) : null;
  if (reduceMotion()) return;
  // Sizes step through 4 detents (12, 16.7, 21.3, 26px) as the pointer nears, so the magnification ticks.
  // The spring is stiff and a little underdamped (zeta ~.6, ~10% overshoot, settles in ~.2s): crisp, not floaty.
  // Only the dot under the pointer grows (neighbours stay put in size; they just make room for it).
  const BASE = 12, MAG = 26, K = 1400, C = 44, PRESS = 0.74;
  const st = lis.map(() => ({ x: BASE, v: 0 }));
  const pr = lis.map(() => ({ x: 1, v: 0 })); // press squash
  let k = 1, py = Infinity, top = 0, centres = centresOf(lis), pressed = -1, cur = -1, shown = false;
  const hovered = () => {
    if (py === Infinity) return -1;
    let best = -1, bd = Infinity;
    centres.forEach((c, i) => { const d = Math.abs(py - c); if (d < bd) { bd = d; best = i; } });
    const gap = centres.length > 1 ? Math.abs(centres[1] - centres[0]) : 36;
    return bd <= gap / 2 ? best : -1;
  };
  const target = (i: number) => (i === hovered() ? MAG : BASE);
  // The lime current marker: goo's spring and stretch, riding the dot's push and magnification.
  const ind = document.createElement('span');
  ind.className = 'nv-ind nv-ind-dock';
  ind.setAttribute('aria-hidden', 'true');
  ul.prepend(ind);
  own(() => { ind.remove(); lis.forEach((li) => { li.style.removeProperty('--ds'); li.style.removeProperty('--dy'); }); });
  hud.classList.add('nv-glide');
  let scaleNow = 1;
  const g = glider((y, s) => { ind.style.transform = `translateY(${y.toFixed(2)}px) scale(${(scaleNow / Math.sqrt(s)).toFixed(3)}, ${(scaleNow * s).toFixed(3)})`; });
  const dy: number[] = lis.map(() => 0);
  const kick = loop((dt) => {
    let moving = false;
    st.forEach((s, i) => {
      const T = target(i);
      spring(s, T, K, C, 1, dt);
      if (Math.abs(s.x - T) < 0.02 && Math.abs(s.v) < 0.1) { s.x = T; s.v = 0; } else moving = true;
      const P = i === pressed ? PRESS : 1, q = pr[i];
      spring(q, P, K * 1.4, C, 1, dt);
      if (Math.abs(q.x - P) < 0.002 && Math.abs(q.v) < 0.01) { q.x = P; q.v = 0; } else moving = true;
    });
    // Sizes grow "in flow": each dot is pushed by the growth of the ones above it, the column stays centred.
    const extra = st.map((s) => s.x - BASE), total = extra.reduce((a, b) => a + b, 0);
    let acc = 0;
    lis.forEach((li, i) => {
      dy[i] = acc + extra[i] / 2 - total / 2;
      setVar(li, '--ds', ((st[i].x / BASE) * pr[i].x).toFixed(3));
      setVar(li, '--dy', `${dy[i].toFixed(2)}px`);
      acc += extra[i];
    });
    line?.draw(dy);
    if (cur >= 0) {
      scaleNow = (st[cur].x / BASE) * pr[cur].x;
      g.set(centres[cur] + dy[cur]);
      if (g.step(dt)) moving = true;
    }
    return moving;
  });
  onCurrent(ul, dots, (i) => {
    cur = i;
    ind.classList.toggle('is-on', i >= 0);
    if (i < 0) { shown = false; return; }
    if (!shown) { scaleNow = (st[i].x / BASE) * pr[i].x; g.jump(centres[i] + dy[i]); shown = true; }
    kick();
  });
  listen(ul, 'pointerenter', () => {
    // Rest-layout centres, read once per visit (the dots' own transforms don't move offsetTop).
    const r = ul.getBoundingClientRect();
    top = r.top;
    k = ul.offsetHeight ? r.height / ul.offsetHeight : 1; // the nav is scaled up on big screens (ZoomStage --hud-k)
    centres = centresOf(lis);
  });
  listen(ul, 'pointermove', (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType === 'touch') return;
    py = (e.clientY - top) / k;
    // Only wake the loop when a dot changes detent (or is still settling): moving within a detent costs nothing.
    if (st.some((s, i) => s.x !== target(i) || s.v !== 0)) kick();
  });
  listen(ul, 'pointerleave', () => { py = Infinity; pressed = -1; kick(); });
  // Press: squash on pointer down, spring back (with a little overshoot) on release. Keyboard clicks get a tap.
  const liOf = (t: EventTarget | null) => lis.indexOf((t as Element | null)?.closest?.('li') as HTMLElement);
  listen(ul, 'pointerdown', (e) => { const i = liOf(e.target); if (i >= 0) { pressed = i; kick(); } });
  const release = () => { if (pressed >= 0) { pressed = -1; kick(); } };
  listen(ul, 'pointerup', release);
  listen(ul, 'pointercancel', release);
  let tap = 0;
  own(() => clearTimeout(tap));
  listen(ul, 'click', (e) => {
    if ((e as MouseEvent).detail !== 0) return;
    const i = liOf(e.target);
    if (i < 0) return;
    pressed = i; kick();
    clearTimeout(tap);
    tap = window.setTimeout(() => { if (pressed === i) release(); }, 90);
  });
}

/* ---------------- dockline: the thread's line for the dock ---------------- */
// Like thread(), the fill follows the camera's smoothed scroll (p, 0..n; section i sits at i + .5), and a knot is
// "passed" once the fill reaches it. Here the knots move (the dock pushes them apart around the hovered dot), so the
// fill's end is placed between the knots' current centres rather than at a fixed fraction of the line.
const LINE_EXT = 8; // the line runs this far past the end dots (room for the push-apart, which is at most 7px each way)
function dockLine(ul: HTMLElement, lis: HTMLElement[], dots: HTMLElement[]) {
  const n = lis.length;
  const line = document.createElement('span');
  line.className = 'nv-thread';
  line.setAttribute('aria-hidden', 'true');
  line.innerHTML = '<i></i>';
  ul.prepend(line);
  own(() => { line.remove(); lis.forEach((li) => li.removeAttribute('data-past')); });
  const fill = line.firstElementChild as HTMLElement;
  const centres = centresOf(lis);
  const top = -LINE_EXT, len = ul.offsetHeight + 2 * LINE_EXT;
  let p = 0, flying = false, dy: number[] = lis.map(() => 0), shown = -1;
  const past = lis.map(() => false);
  const at = (i: number) => centres[i] + dy[i];
  const draw = (d?: number[]) => {
    if (d) dy = d;
    const q = clamp(p, 0, n);
    let y: number;
    if (q <= 0.5) y = top + (at(0) - top) * (q / 0.5);
    else if (q >= n - 0.5) y = at(n - 1) + (top + len - at(n - 1)) * ((q - (n - 0.5)) / 0.5);
    else { const k = Math.floor(q - 0.5), t = q - 0.5 - k; y = at(k) + (at(k + 1) - at(k)) * t; }
    const f = Math.round(clamp((y - top) / len, 0, 1) * 4000) / 4000;
    if (f !== shown) { shown = f; fill.style.transform = `scaleY(${f})`; }
    lis.forEach((li, i) => {
      const on = q >= i + 0.5 - 0.01;
      if (on !== past[i]) { past[i] = on; li.toggleAttribute('data-past', on); }
    });
  };
  // During a click flight the scroll isn't moving, so the fill eases to the destination knot (CSS transition).
  const onCam = (d: { p?: number; flying?: boolean } | undefined) => {
    if (!d) return;
    if (d.flying) {
      if (!flying) { flying = true; if (!reduceMotion()) fill.classList.add('nv-fly'); }
      const i = dots.findIndex((b) => b.getAttribute('aria-current') === 'true');
      p = i < 0 ? 0 : i + 0.5;
    } else {
      if (flying) { flying = false; fill.classList.remove('nv-fly'); }
      if (typeof d.p === 'number') p = d.p;
    }
    draw();
  };
  onCam((window as Window & { __zoomCam?: { p?: number; flying?: boolean } }).__zoomCam);
  listen(window, 'zoomcam', (e) => onCam((e as CustomEvent).detail));
  return { draw };
}

/* ---------------- goo (21st.dev GooeyPagination by ruixen.ui, vertical) ---------------- */
function goo(hud: HTMLElement, ul: HTMLElement, lis: HTMLElement[], dots: HTMLElement[]) {
  const PAD = 16;
  hud.insertAdjacentHTML('beforeend', `<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute"><filter id="nv-goo-f"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></svg>`);
  const svg = hud.lastElementChild as Element;
  own(() => svg.remove());
  const layer = document.createElement('div');
  layer.className = 'nv-goo';
  layer.setAttribute('aria-hidden', 'true');
  const centres = centresOf(lis);
  layer.innerHTML = centres.map((c) => `<i style="top:${PAD + c - 6}px"></i>`).join('') + '<b></b>';
  ul.prepend(layer);
  own(() => layer.remove());
  const blob = layer.querySelector('b') as HTMLElement;
  const g = glider((y, sy) => {
    blob.style.transform = `translateY(${(PAD + y - 6).toFixed(2)}px) scale(${(1.8 / Math.sqrt(sy)).toFixed(3)}, ${(1.8 * sy).toFixed(3)})`;
  });
  let shown = false;
  onCurrent(ul, dots, (i) => {
    layer.classList.toggle('is-on', i >= 0);
    if (i < 0) { shown = false; return; }
    // From hidden (the overview) the blob appears in place; between sections it travels.
    if (!shown || reduceMotion()) { g.jump(centres[i]); shown = true; return; }
    g.to(centres[i]);
  });
}

/* ---------------- thread ---------------- */
function thread(hud: HTMLElement, ul: HTMLElement, lis: HTMLElement[], dots: HTMLElement[]) {
  const n = lis.length;
  const line = document.createElement('span');
  line.className = 'nv-thread';
  line.setAttribute('aria-hidden', 'true');
  line.innerHTML = '<i></i>';
  ul.prepend(line);
  own(() => { line.remove(); lis.forEach((li) => li.removeAttribute('data-past')); });
  const fill = line.firstElementChild as HTMLElement;
  let shown = -1, flying = false;
  const past = lis.map(() => false);
  const show = (f: number) => {
    f = Math.round(clamp(f, 0, 1) * 2000) / 2000;
    if (f === shown) return;
    shown = f;
    fill.style.transform = `scaleY(${f})`;
    // A knot counts as passed once the fill reaches it (section i sits at (i + .5) / n).
    lis.forEach((li, i) => {
      const p = f * n >= i + 0.5 - 0.01;
      if (p !== past[i]) { past[i] = p; li.toggleAttribute('data-past', p); }
    });
  };
  // Driven only by the camera's own event, which fires only on camera frames. During a click flight the
  // scroll position is not moving, so the fill eases to the destination section with a CSS transition.
  const onCam = (d: { p?: number; flying?: boolean } | undefined) => {
    if (!d) return;
    if (d.flying) {
      if (!flying) { flying = true; if (!reduceMotion()) fill.classList.add('nv-fly'); }
      const i = dots.findIndex((b) => b.getAttribute('aria-current') === 'true');
      show(i < 0 ? 0 : (i + 0.5) / n);
      return;
    }
    if (flying) { flying = false; fill.classList.remove('nv-fly'); }
    if (typeof d.p === 'number') show(d.p / n);
  };
  onCam((window as Window & { __zoomCam?: { p?: number; flying?: boolean } }).__zoomCam);
  listen(window, 'zoomcam', (e) => onCam((e as CustomEvent).detail));
  // The bead slides along the line to the current knot.
  traveller(hud, ul, lis, dots, 'nv-ind-bead');
}

/* ---------------- odometer (Magic UI Number Ticker roll) ---------------- */
function odometer(hud: HTMLElement, ul: HTMLElement, lis: HTMLElement[], dots: HTMLElement[]) {
  const strip = '<span class="nv-roll"><span class="nv-strip">' + Array.from({ length: 10 }, (_, d) => `<span>${d}</span>`).join('') + '</span></span>';
  const odo = document.createElement('span');
  odo.className = 'nv-odo mono';
  odo.setAttribute('aria-hidden', 'true');
  odo.innerHTML = strip + strip + `<span class="nv-of">/${String(dots.length).padStart(2, '0')}</span>`;
  hud.insertBefore(odo, ul);
  own(() => odo.remove());
  const strips = Array.from(odo.querySelectorAll<HTMLElement>('.nv-strip'));
  onCurrent(ul, dots, (i) => {
    const v = String(i + 1).padStart(2, '0');
    strips.forEach((s, k) => { s.style.transform = `translateY(${-Number(v[k]) * 10}%)`; });
  });
  // The long lime current tick travels down the ruler.
  traveller(hud, ul, lis, dots, 'nv-ind-tick');
}

/* ---------------- hover magnify (the dock's hover, for every other style) ---------------- */
// Only the dot under the pointer grows (to 1.6x) on the dock's stiff, slightly underdamped spring; a press squashes
// it and it springs back. Written as --hv on the li; CSS applies it with the `scale` property (so it composes with
// each style's own transforms) and scales the tooltip back so its text stays the same size.
export function hoverMagnify(ul: HTMLElement, lis: HTMLElement[]) {
  if (reduceMotion()) return;
  const MAG = 1.6, PRESS = 0.8, K = 1400, C = 44;
  const st = lis.map(() => ({ x: 1, v: 0 }));
  let hov = -1, pressed = -1;
  const target = (i: number) => (i === hov ? (i === pressed ? MAG * PRESS : MAG) : 1);
  // goo draws its dots as <i> in its filter layer (made after this runs), so mirror the scale onto those too.
  const mirror = () => ul.querySelectorAll<HTMLElement>('.nv-goo i');
  const kick = loop((dt) => {
    let moving = false;
    const m = mirror();
    st.forEach((s, i) => {
      const T = target(i);
      spring(s, T, K, C, 1, dt);
      if (Math.abs(s.x - T) < 0.002 && Math.abs(s.v) < 0.01) { s.x = T; s.v = 0; } else moving = true;
      setVar(lis[i], '--hv', s.x.toFixed(3));
      if (m[i]) setVar(m[i], '--hv', s.x.toFixed(3));
    });
    return moving;
  });
  own(() => lis.forEach((li) => li.style.removeProperty('--hv')));
  const liOf = (t: EventTarget | null) => lis.indexOf((t as Element | null)?.closest?.('li') as HTMLElement);
  listen(ul, 'pointerover', (e) => { if ((e as PointerEvent).pointerType === 'touch') return; const i = liOf(e.target); if (i !== hov) { hov = i; kick(); } });
  listen(ul, 'pointerleave', () => { hov = -1; pressed = -1; kick(); });
  listen(ul, 'pointerdown', (e) => { const i = liOf(e.target); if (i >= 0) { pressed = i; kick(); } });
  const release = () => { if (pressed >= 0) { pressed = -1; kick(); } };
  listen(ul, 'pointerup', release);
  listen(ul, 'pointercancel', release);
}

export function initNavStyle(hud: HTMLElement) {
  const ul = hud.querySelector('ul') as HTMLElement | null;
  if (!ul) return;
  const lis = Array.from(ul.querySelectorAll<HTMLElement>(':scope > li'));
  const dots = Array.from(ul.querySelectorAll<HTMLElement>('.hud-dot'));
  if (!/^dock(line)?$/.test(hud.dataset.nav || '')) hoverMagnify(ul, lis); // the dock has its own (with push-apart)
  switch (hud.dataset.nav) {
    case 'dots': case 'frost': case 'lens': traveller(hud, ul, lis, dots, 'nv-ind-disc'); break;
    case 'bubble': traveller(hud, ul, lis, dots, 'nv-ind-bubble'); break;
    case 'drop': { const bead = ul.querySelector<HTMLElement>('.hud-bead'); if (bead) traveller(hud, ul, lis, dots, '', bead); break; }
    case 'dock': dock(hud, ul, lis, dots); break;
    case 'dockline': dock(hud, ul, lis, dots, true); break;
    case 'goo': goo(hud, ul, lis, dots); break;
    case 'thread': thread(hud, ul, lis, dots); break;
    case 'odometer': odometer(hud, ul, lis, dots); break;
    // water: liquid-nav.ts (WebGL drop) uses glider's spring and stretch itself
  }
}

/* ---------------- switching ---------------- */
const NAVS = /^(dots|frost|lens|drop|bubble|water|dock|goo|thread|dockline|odometer)$/;

// Tear down whatever style is running and start v (dockline, the default, for anything unknown). The current-section marker
// appears where the camera already is: each style reads aria-current on start and jumps there.
export function setNav(hud: HTMLElement, v: string) {
  if (!NAVS.test(v)) v = 'dockline';
  teardown(hud);
  hud.dataset.nav = v;
  // .nv resets the glass rules that apply to every non-dots style for the four non-glass looks.
  hud.classList.toggle('nv', /^(dock|dockline|goo|thread|odometer)$/.test(v));
  const g = gen;
  // lens / water: the 21st.dev liquid-glass ports (loaded only when picked)
  if (v === 'lens' || v === 'water') import('./liquid-nav').then((m) => { if (g === gen) m.initLiquidNav(hud); });
  if (v !== 'water') initNavStyle(hud);
  else { const ul = hud.querySelector<HTMLElement>('ul'); if (ul) hoverMagnify(ul, Array.from(ul.querySelectorAll<HTMLElement>(':scope > li'))); }
}

// The Looks picker (scripts/looks.ts) switches the style live.
window.addEventListener('looks:change', (e) => {
  const d = (e as CustomEvent<{ key: string; value: string }>).detail;
  if (d?.key !== 'nav') return;
  const hud = document.getElementById('zm-hud');
  if (hud) setNav(hud, d.value || 'dockline');
});
