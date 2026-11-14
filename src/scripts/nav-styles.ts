// Six non-glass looks for the section nav (#zm-hud), picked with ?nav= (see ZoomStage.astro; CSS in global.css):
//  - dock: after Magic UI Dock (MIT), turned vertical. Each dot's size follows the pointer's distance along Y
//    (interpolate [-140, 0, 140] -> [12, 26, 12]) through a spring (mass .1, stiffness 150, damping 12), and the
//    dots push apart as they grow.
//  - goo: after 21st.dev GooeyPagination by ruixen.ui. A lime blob springs (stiffness 300, damping 20) between the
//    dots under an SVG goo filter (blur -> alpha threshold -> atop), stretching with its speed. The original's
//    blur 8 / alpha 20 -10 erases dots this small (12px), so it is scaled down to blur 5 / alpha 20 -8.
//  - thread: a line that fills with the camera's smoothed scroll (zoom-camera.js publishes p, 0..7), a knot per
//    section; passed knots are filled, the current one tightens into a bead.
//  - odometer: a ruler of ticks and a rolling counter (after Magic UI Number Ticker (MIT): its overdamped spring,
//    approximated by a CSS transition).
//  - tabs: taped paper tabs on the right edge (CSS only).
//  - magnet: dots lean toward the cursor within 90px and spring back.
// Nothing here runs while idle: every loop stops once its springs settle, and the listeners only do work on change.

const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// One rAF loop per style that runs only while step() reports motion. step gets dt in seconds.
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
// Damped spring, integrated in small fixed substeps (the dock's mass .1 spring is too stiff for one step per frame).
function spring(s: { x: number; v: number }, target: number, k: number, c: number, m: number, dt: number) {
  const h = 1 / 600;
  for (let t = 0; t < dt; t += h) {
    const step = Math.min(h, dt - t);
    s.v += ((-k * (s.x - target) - c * s.v) / m) * step;
    s.x += s.v * step;
  }
}
const setVar = (el: HTMLElement, name: string, val: string) => { if (el.style.getPropertyValue(name) !== val) el.style.setProperty(name, val); };

/* ---------------- dock (Magic UI Dock, vertical) ---------------- */
function dock(ul: HTMLElement, lis: HTMLElement[]) {
  if (reduceMotion()) return;
  const BASE = 12, MAG = 26, DIST = 140;
  const st = lis.map(() => ({ x: BASE, v: 0 }));
  let py = Infinity, top = 0, centres: number[] = [];
  const target = (i: number) => (py === Infinity ? BASE : MAG - (MAG - BASE) * clamp(Math.abs(py - centres[i]) / DIST, 0, 1));
  const kick = loop((dt) => {
    let moving = false;
    st.forEach((s, i) => {
      const T = target(i);
      spring(s, T, 150, 12, 0.1, dt);
      if (Math.abs(s.x - T) < 0.01 && Math.abs(s.v) < 0.05) { s.x = T; s.v = 0; } else moving = true;
    });
    // Sizes grow "in flow": each dot is pushed by the growth of the ones above it, the column stays centred.
    const extra = st.map((s) => s.x - BASE), total = extra.reduce((a, b) => a + b, 0);
    let acc = 0;
    lis.forEach((li, i) => {
      setVar(li, '--ds', (st[i].x / BASE).toFixed(3));
      setVar(li, '--dy', `${(acc + extra[i] / 2 - total / 2).toFixed(2)}px`);
      acc += extra[i];
    });
    return moving;
  });
  ul.addEventListener('pointerenter', () => {
    // Rest-layout centres, read once per visit (the dots' own transforms don't move offsetTop).
    top = ul.getBoundingClientRect().top;
    centres = lis.map((li) => li.offsetTop + li.offsetHeight / 2);
  });
  ul.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; py = e.clientY - top; kick(); });
  ul.addEventListener('pointerleave', () => { py = Infinity; kick(); });
}

/* ---------------- goo (21st.dev GooeyPagination by ruixen.ui, vertical) ---------------- */
function goo(hud: HTMLElement, ul: HTMLElement, lis: HTMLElement[], dots: HTMLElement[]) {
  const PAD = 16;
  hud.insertAdjacentHTML('beforeend', `<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute"><filter id="nv-goo-f"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></svg>`);
  const layer = document.createElement('div');
  layer.className = 'nv-goo';
  layer.setAttribute('aria-hidden', 'true');
  const centres = lis.map((li) => li.offsetTop + li.offsetHeight / 2);
  layer.innerHTML = centres.map((c) => `<i style="top:${PAD + c - 6}px"></i>`).join('') + '<b></b>';
  ul.prepend(layer);
  const blob = layer.querySelector('b') as HTMLElement;
  const s = { x: 0, v: 0 };
  let T = 0, cur = -2, shown = false;
  const draw = () => {
    const sy = 1 + Math.min(Math.abs(s.v) / 900, 0.7);
    blob.style.transform = `translateY(${(PAD + s.x - 6).toFixed(2)}px) scale(${(1.8 / Math.sqrt(sy)).toFixed(3)}, ${(1.8 * sy).toFixed(3)})`;
  };
  const kick = loop((dt) => {
    spring(s, T, 300, 20, 1, dt);
    const done = Math.abs(s.x - T) < 0.05 && Math.abs(s.v) < 0.5;
    if (done) { s.x = T; s.v = 0; }
    draw();
    return !done;
  });
  const go = () => {
    const i = dots.findIndex((d) => d.getAttribute('aria-current') === 'true');
    if (i === cur) return;
    cur = i;
    layer.classList.toggle('is-on', i >= 0);
    if (i < 0) { shown = false; return; }
    T = centres[i];
    // From hidden (the overview) the blob appears in place; between sections it travels.
    if (!shown || reduceMotion()) { s.x = T; s.v = 0; shown = true; draw(); return; }
    kick();
  };
  go();
  new MutationObserver(go).observe(ul, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
}

/* ---------------- thread ---------------- */
function thread(ul: HTMLElement, lis: HTMLElement[], dots: HTMLElement[]) {
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
}

/* ---------------- odometer (Magic UI Number Ticker roll) ---------------- */
function odometer(hud: HTMLElement, ul: HTMLElement, dots: HTMLElement[]) {
  const strip = '<span class="nv-roll"><span class="nv-strip">' + Array.from({ length: 10 }, (_, d) => `<span>${d}</span>`).join('') + '</span></span>';
  const odo = document.createElement('span');
  odo.className = 'nv-odo mono';
  odo.setAttribute('aria-hidden', 'true');
  odo.innerHTML = strip + strip + `<span class="nv-of">/${String(dots.length).padStart(2, '0')}</span>`;
  hud.insertBefore(odo, ul);
  const strips = Array.from(odo.querySelectorAll<HTMLElement>('.nv-strip'));
  let cur = -2;
  const go = () => {
    const i = dots.findIndex((d) => d.getAttribute('aria-current') === 'true');
    if (i === cur) return;
    cur = i;
    const v = String(i + 1).padStart(2, '0');
    strips.forEach((s, k) => { s.style.transform = `translateY(${-Number(v[k]) * 10}%)`; });
  };
  go();
  new MutationObserver(go).observe(ul, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
}

/* ---------------- magnet ---------------- */
function magnet(lis: HTMLElement[]) {
  if (reduceMotion()) return;
  const RANGE = 90, PULL = 6;
  const st = lis.map(() => ({ x: { x: 0, v: 0 }, y: { x: 0, v: 0 } }));
  let px = -1e4, py = -1e4, rects: { x: number; y: number }[] | null = null, box = { l: 0, t: 0, r: 0, b: 0 };
  const measure = () => {
    rects = lis.map((li) => { const r = li.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    box = { l: Math.min(...rects.map((c) => c.x)) - RANGE, r: Math.max(...rects.map((c) => c.x)) + RANGE, t: rects[0].y - RANGE, b: rects[rects.length - 1].y + RANGE };
  };
  const targets = (i: number) => {
    if (!rects) return [0, 0];
    const dx = px - rects[i].x, dy = py - rects[i].y, d = Math.hypot(dx, dy);
    if (d >= RANGE || d < 0.01) return [0, 0];
    const t = 1 - d / RANGE, m = Math.min(d, PULL * t * t * (3 - 2 * t));
    return [(dx / d) * m, (dy / d) * m];
  };
  const kick = loop((dt) => {
    let moving = false;
    st.forEach((s, i) => {
      const [tx, ty] = targets(i);
      spring(s.x, tx, 220, 22, 1, dt);
      spring(s.y, ty, 220, 22, 1, dt);
      if (Math.abs(s.x.x - tx) < 0.02 && Math.abs(s.y.x - ty) < 0.02 && Math.abs(s.x.v) + Math.abs(s.y.v) < 0.1) { s.x.x = tx; s.y.x = ty; s.x.v = s.y.v = 0; } else moving = true;
      setVar(lis[i], '--mx', `${s.x.x.toFixed(2)}px`);
      setVar(lis[i], '--my', `${s.y.x.toFixed(2)}px`);
    });
    return moving;
  });
  let near = false;
  const dirty = () => { rects = null; };
  window.addEventListener('scroll', dirty, { passive: true });
  window.addEventListener('resize', dirty);
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (!rects) measure();
    const inZone = e.clientX >= box.l && e.clientX <= box.r && e.clientY >= box.t && e.clientY <= box.b;
    if (!inZone && !near) return;
    near = inZone;
    px = inZone ? e.clientX : -1e4; py = inZone ? e.clientY : -1e4;
    kick();
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { if (near) { near = false; px = py = -1e4; kick(); } });
}

export function initNavStyle(hud: HTMLElement) {
  const ul = hud.querySelector('ul') as HTMLElement | null;
  if (!ul) return;
  const lis = Array.from(ul.querySelectorAll<HTMLElement>(':scope > li'));
  const dots = Array.from(ul.querySelectorAll<HTMLElement>('.hud-dot'));
  switch (hud.dataset.nav) {
    case 'dock': dock(ul, lis); break;
    case 'goo': goo(hud, ul, lis, dots); break;
    case 'thread': thread(ul, lis, dots); break;
    case 'odometer': odometer(hud, ul, dots); break;
    case 'magnet': magnet(lis); break;
    // tabs: CSS only
  }
}
