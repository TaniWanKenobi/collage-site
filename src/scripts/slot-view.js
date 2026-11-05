// Shared helpers for anything drawn inside the zoomed 1440x900 collage world (3D slots, canvases).
// The camera (zoom-camera.js) publishes window.__zoomCam = { s, cx, cy, r, vw, h, open, ... } and fires
// a "zoomcam" event each frame. These helpers turn that into a screen rect with pure math, so listeners
// never call getBoundingClientRect mid-frame (that forced a layout on every scroll frame).

/** Largest canvas backing-store edge, so a 294px slot at 10x zoom does not allocate a 6000px canvas. */
export const MAX_CANVAS_PX = 3072;

/** Untransformed box of `el` in world coordinates (offset chain up to #zm-world). Measure once, re-measure on resize. */
export function worldRect(el) {
  let x = 0, y = 0, n = el;
  while (n && n.id !== 'zm-world') { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight, inWorld: !!n };
}

/** Screen-space bounding box of a world rect under the camera: translate(vw/2,h/2) scale(s) rotate(-r) translate(-cx,-cy). */
export function screenRect(wr, cam) {
  if (!cam || cam.cx == null) return null;
  const a = (-cam.r * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const [px, py] of [[wr.x, wr.y], [wr.x + wr.w, wr.y], [wr.x, wr.y + wr.h], [wr.x + wr.w, wr.y + wr.h]]) {
    const dx = px - cam.cx, dy = py - cam.cy;
    const X = cam.vw / 2 + cam.s * (dx * c - dy * s), Y = cam.h / 2 + cam.s * (dx * s + dy * c);
    l = Math.min(l, X); r = Math.max(r, X); t = Math.min(t, Y); b = Math.max(b, Y);
  }
  return { left: l, top: t, right: r, bottom: b };
}

/** Is the slot on screen (stage viewport) right now? Falls back to true when there is no camera yet. */
export function onScreen(wr, cam) {
  const q = screenRect(wr, cam);
  if (!q) return true;
  return q.right > 0 && q.bottom > 0 && q.left < cam.vw && q.top < cam.h;
}

/** Pixel ratio that keeps a canvas of `cssSize` sharp at the camera's current scale, capped and stepped. */
export function zoomDpr(cam, cssSize) {
  const base = window.devicePixelRatio || 1;
  const cap = MAX_CANVAS_PX / Math.max(1, cssSize);
  // Rounded to 0.25 steps so the backing store is not resized on every frame of a flight.
  return Math.min(cap, Math.max(1, Math.round(base * (cam ? cam.s : 1) * 4) / 4));
}

/** Phones and reduced-motion visitors keep the static fallbacks. */
export function prefersStatic() {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth < 760;
}

/** Run `fn` once the page has loaded and the main thread is idle (3D is never on the critical path). */
export function whenIdle(fn, timeout = 2500) {
  const go = () => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 200));
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}
