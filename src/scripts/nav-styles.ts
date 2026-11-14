// Motion for the section nav (#zm-hud), picked with ?nav= (see ZoomStage.astro; CSS in global.css).
// Every style shares goo's motion: when the current section changes (click or scroll), its indicator springs
// (stiffness 300, damping 20) to the new dot and stretches along Y with its speed (glider() below).
//  - dots / frost / lens: a lime disc travels between the dots (frost/lens keep their glow inside the glass).
//  - bubble: the glass bubble itself travels.  drop: the glass bead travels.  (Glass keeps no goo filter.)
//  - water: the WebGL drop in liquid-nav.ts uses the same spring and stretch.
//  - dock: after Magic UI Dock (MIT), turned vertical. Dots magnify near the pointer in detents (4 sizes) through
//    a stiff, slightly underdamped spring so it ticks rather than glides; a press squashes the dot and it springs
//    back. The lime current marker travels with the goo spring and rides the magnification.
//  - goo: after 21st.dev GooeyPagination by ruixen.ui. A lime blob springs between the dots under an SVG goo
//    filter (blur -> alpha threshold -> atop), stretching with its speed. The original's blur 8 / alpha 20 -10
//    erases dots this small (12px), so it is scaled down to blur 5 / alpha 20 -8.
//  - thread: a line that fills with the camera's smoothed scroll (zoom-camera.js publishes p, 0..7), a knot per
//    section; passed knots are filled and the bead travels along the line.
//  - odometer: a ruler of ticks whose long lime current tick travels, and a rolling counter (after Magic UI
//    Number Ticker (MIT): its overdamped spring, approximated by a CSS transition).
// Nothing here runs while idle: every loop stops once its springs settle, and the listeners only do work on change.

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
  new MutationObserver(go).observe(ul, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
}

const centresOf = (lis: HTMLElement[]) => lis.map((li) => li.offsetTop + li.offsetHeight / 2);

// The travelling current-section indicator for a style: el (made here unless given) is positioned by CSS with its
// centre at the ul's top, and moved here with translateY + a stretch. From hidden (the overview) it appears in
// place; between sections it travels. .nv-glide on the nav lets the CSS drop the static current-dot fill.
function traveller(hud: HTMLElement, ul: HTMLElement, lis: HTMLElement[], dots: HTMLElement[], cls: string, given?: HTMLElement) {
  if (reduceMotion()) return; // the static current-dot look stays
  const el = given || document.createElement('span');
  if (!given) { el.className = `nv-ind ${cls}`; el.setAttribute('aria-hidden', 'true'); ul.prepend(el); }
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
function dock(hud: HTMLElement, ul: HTMLElement, lis: HTMLElement[], dots: HTMLElement[]) {
  if (reduceMotion()) return;
  // Sizes step through 4 detents (12, 16.7, 21.3, 26px) as the pointer nears, so the magnification ticks.
  // The spring is stiff and a little underdamped (zeta ~.6, ~10% overshoot, settles in ~.2s): crisp, not floaty.
  const BASE = 12, MAG = 26, DIST = 140, STEPS = 3, K = 1400, C = 44, PRESS = 0.74;
  const st = lis.map(() => ({ x: BASE, v: 0 }));
  const pr = lis.map(() => ({ x: 1, v: 0 })); // press squash
  let py = Infinity, top = 0, centres = centresOf(lis), pressed = -1, cur = -1, shown = false;
  const target = (i: number) => {
    if (py === Infinity) return BASE;
    const t = 1 - clamp(Math.abs(py - centres[i]) / DIST, 0, 1);
    return BASE + ((MAG - BASE) * Math.round(t * STEPS)) / STEPS;
  };
  // The lime current marker: goo's spring and stretch, riding the dot's push and magnification.
  const ind = document.createElement('span');
  ind.className = 'nv-ind nv-ind-dock';
  ind.setAttribute('aria-hidden', 'true');
  ul.prepend(ind);
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
  ul.addEventListener('pointerenter', () => {
    // Rest-layout centres, read once per visit (the dots' own transforms don't move offsetTop).
    top = ul.getBoundingClientRect().top;
    centres = centresOf(lis);
  });
  ul.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    py = e.clientY - top;
    // Only wake the loop when a dot changes detent (or is still settling): moving within a detent costs nothing.
    if (st.some((s, i) => s.x !== target(i) || s.v !== 0)) kick();
  });
  ul.addEventListener('pointerleave', () => { py = Infinity; pressed = -1; kick(); });
  // Press: squash on pointer down, spring back (with a little overshoot) on release. Keyboard clicks get a tap.
  const liOf = (t: EventTarget | null) => lis.indexOf((t as Element | null)?.closest?.('li') as HTMLElement);
  ul.addEventListener('pointerdown', (e) => { const i = liOf(e.target); if (i >= 0) { pressed = i; kick(); } });
  const release = () => { if (pressed >= 0) { pressed = -1; kick(); } };
  ul.addEventListener('pointerup', release);
  ul.addEventListener('pointercancel', release);
  ul.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const i = liOf(e.target);
    if (i < 0) return;
    pressed = i; kick();
    setTimeout(() => { if (pressed === i) release(); }, 90);
  });
}

/* ---------------- goo (21st.dev GooeyPagination by ruixen.ui, vertical) ---------------- */
function goo(hud: HTMLElement, ul: HTMLElement, lis: HTMLElement[], dots: HTMLElement[]) {
  const PAD = 16;
  hud.insertAdjacentHTML('beforeend', `<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute"><filter id="nv-goo-f"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></svg>`);
  const layer = document.createElement('div');
  layer.className = 'nv-goo';
  layer.setAttribute('aria-hidden', 'true');
  const centres = centresOf(lis);
  layer.innerHTML = centres.map((c) => `<i style="top:${PAD + c - 6}px"></i>`).join('') + '<b></b>';
  ul.prepend(layer);
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
  window.addEventListener('zoomcam', (e) => onCam((e as CustomEvent).detail));
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
  const strips = Array.from(odo.querySelectorAll<HTMLElement>('.nv-strip'));
  onCurrent(ul, dots, (i) => {
    const v = String(i + 1).padStart(2, '0');
    strips.forEach((s, k) => { s.style.transform = `translateY(${-Number(v[k]) * 10}%)`; });
  });
  // The long lime current tick travels down the ruler.
  traveller(hud, ul, lis, dots, 'nv-ind-tick');
}

export function initNavStyle(hud: HTMLElement) {
  const ul = hud.querySelector('ul') as HTMLElement | null;
  if (!ul) return;
  const lis = Array.from(ul.querySelectorAll<HTMLElement>(':scope > li'));
  const dots = Array.from(ul.querySelectorAll<HTMLElement>('.hud-dot'));
  switch (hud.dataset.nav) {
    case 'dots': case 'frost': case 'lens': traveller(hud, ul, lis, dots, 'nv-ind-disc'); break;
    case 'bubble': traveller(hud, ul, lis, dots, 'nv-ind-bubble'); break;
    case 'drop': { const bead = ul.querySelector<HTMLElement>('.hud-bead'); if (bead) traveller(hud, ul, lis, dots, '', bead); break; }
    case 'dock': dock(hud, ul, lis, dots); break;
    case 'goo': goo(hud, ul, lis, dots); break;
    case 'thread': thread(hud, ul, lis, dots); break;
    case 'odometer': odometer(hud, ul, lis, dots); break;
    // water: liquid-nav.ts (WebGL drop) uses glider's spring and stretch itself
  }
}
