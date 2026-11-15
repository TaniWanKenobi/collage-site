// One WebGL renderer for every 3D model on the home page (lazy-loaded by models-boot.js).
// Each slot is drawn into an offscreen buffer and copied into the slot's own 2D canvas, so models keep
// their place in the collage's stacking order while the page holds a single GL context.
// World slots follow the zoom camera (window.__zoomCam + "zoomcam" event): they render only while on
// screen and no section page is open, at a pixel ratio that tracks the camera zoom so they stay sharp.
// Cost control (a weak laptop GPU was spending most of every frame here):
//  - meshes decode in meshopt's Web Workers, and each .glb is fetched only once a slot first wants to draw;
//  - idle spin and drags draw every display frame; only a machine where a draw is really expensive skips frames
//    (spin stays under ~40% of the main thread);
//  - while the zoom camera moves, slots keep their last frame (CSS scales it) and re-render sharp at rest,
//    so scroll and fly-to frames carry no WebGL work and no canvas reallocations;
//  - every shader compiles in parallel without blocking the page.
// Look: "cel + ink" (src/scripts/toon.js): the models carry baked crease lines, AO and palette colours
// (scripts/models/stylize-bake.mjs), and two tiny shaders with their own lighting draw them. No lights, no
// environment map, one draw per model plus one for its lines and one for its contact shadow.
import { WebGLRenderer, Scene, PerspectiveCamera, Box3, Vector3, Sphere, SRGBColorSpace, MathUtils, Group, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { worldRect, onScreen } from './slot-view.js';
import { prepare, applyStyle, contactBlob, setLineFade, setThemeColors, setBlobColor, DEFAULT_STYLE } from './toon.js';
import { readTheme, onTheme, themed, rgbOf, rgba, type Theme } from './theme-vars';

type Kind = 'world' | 'page' | 'flow';
// key/prog: which piece the camera is heading for, and how far into it (0 = overview, 1 = landed).
interface Cam { s: number; open: boolean; cx: number; cy: number; r: number; vw: number; h: number; key?: string; prog?: number; still?: boolean }
interface Slot {
  el: HTMLElement; kind: Kind; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  scene: Scene; camera: PerspectiveCamera; controls: OrbitControls;
  wr: ReturnType<typeof worldRect> | null; inView: boolean; ready: boolean; active: boolean;
  requested: boolean; drawn: number; userUntil: number; dragging: boolean; turned: boolean; w: number; h: number; cost: number; flyW?: number; flyH?: number;
  // data-spin="0": no auto-rotate, a gentle sway around the front instead (the pivot turns, not the camera).
  pivot: Group | null; sway: boolean;
  // World slots draw their own drop shadow (see SHADOW): hover state, eased like the old CSS transition.
  hovFrom: number; hovTo: number; hovAt: number;
  // A colour theme changed: draw once even if the slot is asleep or between spin frames.
  repaint?: boolean;
}

// World slots (collage objects): the soft drop shadow is drawn into the 2D canvas with the model, not a CSS
// `filter: drop-shadow` on .m3d--world. The canvas is a composited layer, and the GPU re-ran a CSS filter on it
// every frame of a scroll or flight at the zoomed size; drawn here, it costs one blur per model redraw, and there
// are none while the camera moves. Same look: canvas shadowBlur is a gaussian of sigma blur/2, like CSS.
// The canvas hangs out of its slot by PAD (CSS px, keep in sync with Model3D.astro) so the shadow has room.
const PAD = { l: 34, r: 34, t: 28, b: 60 };
const SHADOW = {
  rest: { dy: 16, blur: 18, a: 0.6 },              // was drop-shadow(0 16px 18px rgba(4,8,3,.6))
  hover: { dy: 24, blur: 22, a: 0.55, glow: 18, glowA: 0.18 }, // was ...(0 24px 22px rgba(4,8,3,.55)) drop-shadow(0 0 18px rgba(194,249,112,.18))
  ms: 250,
};
// Colour theme (scripts/theme.ts): the toon materials, the contact blob and the drawn shadow/glow follow it.
// On onyx the shadow colour is barely darker than the page. On a theme's lighter page it shows much more, so the drawn
// shadow is lighter (shadowK) and the contact blob kept near-invisible, as on onyx (the model's frame clips the blob,
// which would show as a hard edge).
let shadowRgb = '4,8,3', glowRgb = '194,249,112', shadowK = 1;
function useTheme(c: Theme, on: boolean) {
  const light = document.documentElement.getAttribute('data-theme-mode') === 'light';
  setThemeColors(on ? { accent: c.accent, surface: c.surface, bg: c.bg } : null);
  shadowRgb = rgbOf(c.shadow).join(',');
  glowRgb = rgbOf(c.accent).join(',');
  shadowK = !on ? 1 : light ? 0.55 : 0.8;
  setBlobColor(rgba(c.shadow, !on ? 0.55 : light ? 0.07 : 0.2));
}
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hoverAmt = (s: Slot, t: number) => {
  const p = reduceMotion ? 1 : Math.min(1, (t - s.hovAt) / SHADOW.ms), e = p * p * (3 - 2 * p);
  return s.hovFrom + (s.hovTo - s.hovFrom) * e;
};

const MAX_PX = 1536; // largest backing-store edge per slot
const SPIN_MS = 0; // idle spin draws every display frame (it used to be 24 fps, which read as choppy)
// No input for this long: auto-spin stops and the loop sleeps (an idle open tab costs ~0 CPU/GPU); any input wakes it.
const SLEEP_MS = 20000;
let lastInput = performance.now();
// The camera counts as moving until this long after its last frame. Longer than the world's own settle delay in
// zoom-camera.js (180 ms), so the sharp redraw at rest does not land on the same frame as the world's repaint.
const REST_MS = 320;
// Largest canvas width (device px) a model zooms at in flight, before its sharp redraw at rest.
const FLY_MAX = 512;
const cam = (): Cam | null => (window as unknown as { __zoomCam?: Cam }).__zoomCam ?? null;

let renderer: WebGLRenderer | null = null;
let loader: GLTFLoader;
const cache = new Map<string, Promise<Object3D>>();
const slots: Slot[] = [];
let bufH = 1, raf = 0, camAt = 0, restTimer = 0, spunAt = 0;
let io: IntersectionObserver;
const now = () => performance.now();
const camMoving = () => now() - camAt < REST_MS;
// Every camera frame: note the time, and schedule one tick just after the camera comes to rest.
// The camera marks the frame where it stops for good (still: the end of a flight, or the scroll smoothing's final
// snap). Then the sharp redraw runs at once instead of REST_MS later. Nothing heavy is drawn while the camera still
// moves, and the world's own repaint (180 ms after its last frame) lands on a different frame.
function onCam() {
  if (cam()?.still) {
    if (camMoving()) { camAt = now() - REST_MS; clearTimeout(restTimer); kick(); }
    return;
  }
  camAt = now();
  clearTimeout(restTimer);
  restTimer = window.setTimeout(kick, REST_MS + 10);
  kick();
}

function init(): boolean {
  if (renderer) return true;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return false;
  }
  // three.js checks every new shader with gl.getError / getShaderInfoLog, and each check waits for the GPU to finish
  // everything queued (a 30-100 ms stall when a section's model first shows up mid-scroll). The shaders are fixed and
  // known to compile, so skip the checks.
  renderer.debug.checkShaderErrors = false;
  renderer.setPixelRatio(1); // all sizes below are device pixels already
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setScissorTest(true);
  // One drawing buffer for every slot, allocated once at the largest size any slot can ask for (MAX_PX square).
  // Resizing it stalls the GPU for 100-150 ms on an integrated GPU, so it used to grow in steps as the camera zoomed
  // in, right in the middle of a scroll. Allocating it here costs that once, while the page is loading.
  renderer.setSize(MAX_PX, MAX_PX, false); bufH = MAX_PX;
  // Decode meshopt buffers in Web Workers (decodeGltfBufferAsync), not on the main thread.
  try { MeshoptDecoder.useWorkers(Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))); } catch { /* main-thread fallback */ }
  loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  io = new IntersectionObserver((es) => {
    es.forEach((e) => { const s = slots.find((x) => x.el === e.target); if (s) s.inView = e.isIntersecting; });
    kick();
  }, { rootMargin: '100px' });
  window.addEventListener('zoomcam', onCam);
  useTheme(readTheme(), themed());
  onTheme((c, d) => { useTheme(c, !!d.spec); slots.forEach((s) => { s.repaint = true; }); kick(); });
  window.addEventListener('resize', () => { slots.forEach((s) => { if (s.kind === 'world') s.wr = worldRect(s.el); }); kick(); });
  document.addEventListener('visibilitychange', kick);
  const wake = () => { lastInput = performance.now(); kick(); };
  for (const ev of ['pointermove', 'pointerdown', 'wheel', 'scroll', 'keydown', 'touchstart']) window.addEventListener(ev, wake, { passive: true, capture: true });
  return true;
}

const load = (src: string) => {
  // Toon materials go on the cached copy once; every slot's clone shares them (two programs for the whole page).
  if (!cache.has(src)) cache.set(src, loader.loadAsync(src).then((g) => { prepare(g.scene); applyStyle(g.scene, DEFAULT_STYLE); return g.scene; }));
  return cache.get(src)!.then((o) => o.clone(true));
};

export function addSlots(els: HTMLElement[]) {
  if (!init()) { els.forEach((el) => el.classList.add('no-webgl')); return; }
  for (const el of els) {
    if (slots.some((s) => s.el === el)) continue;
    const canvas = el.querySelector<HTMLCanvasElement>('canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) continue;
    const kind = (el.dataset.m3d as Kind) || 'flow';
    const scene = new Scene(); // no lights: the toon shaders carry their own key, fill and rim
    const camera = new PerspectiveCamera(30, 1, 0.01, 1000);
    // World slots: the canvas is larger than the slot (shadow room) and lets pointers through, so drags and
    // clicks hit the slot itself, exactly where the canvas used to be.
    const controls = new OrbitControls(camera, kind === 'world' ? el : canvas);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    const sway = el.dataset.spin === '0';
    controls.autoRotate = !sway;
    controls.autoRotateSpeed = 1.1;
    const s: Slot = { el, kind, canvas, ctx, scene, camera, controls, wr: kind === 'world' ? worldRect(el) : null, inView: false, ready: false, active: false, requested: false, drawn: 0, userUntil: 0, dragging: false, turned: false, w: 0, h: 0, cost: 0, pivot: null, sway, hovFrom: 0, hovTo: 0, hovAt: 0 };
    // A drag draws at full frame rate, and keeps doing so while the damping settles. A plain click (which
    // flies the camera to the section) is not a drag and must not hold the slot at full rate.
    controls.addEventListener('start', () => { s.dragging = true; s.turned = false; });
    controls.addEventListener('change', () => { if (s.dragging) s.turned = true; kick(); });
    controls.addEventListener('end', () => { s.dragging = false; if (s.turned) s.userUntil = now() + 1200; kick(); });
    if (kind === 'world') {
      const hov = (to: number) => { const t = now(); s.hovFrom = hoverAmt(s, t); s.hovTo = to; s.hovAt = t; s.userUntil = Math.max(s.userUntil, t + SHADOW.ms + 50); kick(); };
      el.addEventListener('pointerenter', () => hov(1));
      el.addEventListener('pointerleave', () => hov(0));
    }
    slots.push(s);
    if (kind !== 'world') io.observe(el);
    // Collage objects: fetch and decode now, not on the next frame (their .glb is usually preloaded already).
    if (kind === 'world') { wireClick(s); request(s); }
  }
  kick();
}

// Fetch and decode a slot's model the first time the slot is worth drawing (a deep link to a section does not
// download the collage's models until the camera goes there).
function request(s: Slot) {
  s.requested = true;
  load(s.el.dataset.src!).then(async (obj) => {
    // data-upright: the CAD lies flat with its face up (+Y); stand it up so that face looks at the camera (+Z).
    if (s.el.dataset.upright) obj.rotation.x = Math.PI / 2;
    const pivot = new Group();
    pivot.add(obj);
    const box = frame(s, pivot);
    s.pivot = pivot;
    s.scene.add(pivot);
    // data-toy: a clickable screen and buttons on the model (src/scripts/tama-toy.ts).
    if (s.el.dataset.toy) {
      const { attachToy } = await import('./tama-toy.ts');
      attachToy({ el: s.el, canvas: s.canvas, camera: s.camera, model: obj, redraw: () => { s.userUntil = now() + 400; kick(); } });
    }
    if (s.el.dataset.blob !== '0') s.scene.add(contactBlob(box));
    // Compile the model's shaders off the main thread where the browser supports it (KHR_parallel_shader_compile).
    try { await renderer!.compileAsync(s.scene, s.camera); } catch { /* falls back to compiling on first render */ }
    s.ready = true;
    kick();
  }).catch(() => s.el.classList.add('is-missing'));
}

// A press that barely moves is a click (fly to the section); anything more is an orbit drag.
function wireClick(s: Slot) {
  let x = 0, y = 0, moved = 0;
  s.el.addEventListener('pointerdown', (e) => { x = e.clientX; y = e.clientY; moved = 0; });
  s.el.addEventListener('pointermove', (e) => { if (e.buttons) moved = Math.max(moved, Math.hypot(e.clientX - x, e.clientY - y)); });
  s.el.addEventListener('click', (e) => { if (moved > 6) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}

// Centre the model and back the camera off until its bounding sphere fills the slot.
function frame(s: Slot, obj: Object3D): Box3 {
  const box = new Box3().setFromObject(obj);
  const c = box.getCenter(new Vector3());
  // Centre the model inside its pivot, so a sway turns it about its own middle.
  (obj.children[0] ?? obj).position.sub(c);
  box.translate(c.negate());
  const r = box.getBoundingSphere(new Sphere()).radius || 1;
  const fill = Number(s.el.dataset.fill ?? 0.9);
  const dist = r / Math.sin(MathUtils.degToRad(s.camera.fov / 2)) / fill;
  const el = MathUtils.degToRad(Number(s.el.dataset.elev ?? 22));
  const az = MathUtils.degToRad(Number(s.el.dataset.azim ?? 35));
  s.camera.position.set(dist * Math.cos(el) * Math.sin(az), dist * Math.sin(el), dist * Math.cos(el) * Math.cos(az));
  s.camera.near = dist / 100; s.camera.far = dist * 10;
  s.camera.updateProjectionMatrix();
  s.controls.target.set(0, 0, 0);
  s.controls.update();
  return box;
}

// Is the slot worth drawing now, and how many screen pixels does one CSS pixel of it cover?
function view(s: Slot): number {
  const c = cam();
  if (s.kind === 'world') {
    if (!c || !s.wr) return 0;
    if (c.open || !onScreen(s.wr, c)) return 0;
    return c.s;
  }
  if (!s.inView) return 0;
  if (s.kind === 'page') {
    const page = s.el.closest<HTMLElement>('.zpage');
    if (!c || !c.open || !page || parseFloat(page.style.opacity || '0') < 0.5) return 0;
    const w = s.el.offsetWidth;
    return w ? s.el.getBoundingClientRect().width / w : 0;
  }
  return 1;
}

function kick() { if (!raf) raf = requestAnimationFrame(tick); }
let sizeKey = '';
function tick() {
  raf = 0;
  if (document.hidden || !renderer) return;
  // The camera re-anchors edge pieces when the screen size changes: re-measure world slots then.
  const c = cam(), key = c ? `${c.vw}x${c.h}` : '';
  if (key !== sizeKey) { sizeKey = key; slots.forEach((s) => { if (s.kind === 'world') s.wr = worldRect(s.el); }); }
  const t = now(), moving = camMoving();
  // Idle spin: every visible slot redraws together, every frame unless a draw is very expensive
  // (each slot keeps a running average of what its draw costs, which is far higher on a slow CPU).
  const spinCost = slots.reduce((n, s) => n + (s.active ? s.cost : 0), 0);
  // Only a machine where a draw is really slow drops frames: spin may use up to ~40% of the main thread.
  const spinDue = t - spunAt >= Math.max(SPIN_MS, spinCost * 2.5 - 4);
  let again = false;
  const todo: [Slot, number, number, number][] = [];
  let firsts = 0; // a slot's first draw uploads its meshes: at most one per frame
  for (const s of slots) {
    const scale = view(s);
    if (scale > 0 && !s.requested) request(s);
    s.active = s.ready && scale > 0;
    if (!s.active) { s.drawn = 0; continue; }
    const user = s.dragging || (t < s.userUntil && !moving);
    // Asleep (no input for SLEEP_MS): keep the last frame and stop the loop.
    if (s.drawn && !user && !s.repaint && t - lastInput > SLEEP_MS) continue;
    again = true; // auto-rotate keeps visible slots moving
    // Camera in motion (scroll or fly-to): no WebGL work at all, the slot keeps its last frame and CSS scales it.
    // On a weak integrated GPU the spin was what made scrolling stutter. Exceptions: a drag, and the model the
    // zoom is heading into when it morphs to face the camera (data-morph), which must turn with the zoom.
    const cmv = cam(), morphing = !!s.el.dataset.morph && !!cmv && cmv.key === s.el.dataset.morph && (cmv.prog ?? 0) > 0;
    if (moving && s.drawn && !s.dragging && !morphing) continue;
    // Camera in motion: the models keep spinning, but at their current canvas size (CSS scales it), so a zoom
    // never reallocates canvases mid-flight. They pick up the sharp size for the new zoom once the camera rests.
    // A drag redraws every frame when a draw is cheap, and leaves frames free in between when it is not.
    if (s.drawn && !s.repaint && (user ? t - s.drawn < Math.min(s.cost * 1.5, 100) - 2 : !spinDue)) continue;
    const cw = s.el.offsetWidth, ch = s.el.offsetHeight;
    if (!cw || !ch) continue;
    if (!s.drawn && !s.el.classList.contains('is-live') && firsts++) continue;
    // Device pixels per CSS pixel, stepped to 0.25 so a camera flight does not resize the canvas every frame.
    const k = Math.min(MAX_PX / Math.max(cw, ch), Math.max(1, Math.round((window.devicePixelRatio || 1) * scale * 4) / 4));
    // In flight: half resolution (motion hides it; it halves the GPU's fill and upload work). The size follows the
    // zoom in coarse steps (x1.4), so a zoom into the model resizes the canvas a handful of times instead of
    // stretching its take-off pixels up to full screen, and never resizes it every frame.
    const fly = moving && s.drawn > 0;
    if (fly) {
      const fw = Math.min(FLY_MAX, Math.max(64, Math.round(cw * k / 2)));
      // Capped at FLY_MAX px wide, so the pixels drawn per frame in flight stay bounded on any machine.
      if (!s.flyW || (fw > s.flyW * 1.4 && s.flyW < FLY_MAX) || fw < s.flyW / 2) { s.flyW = fw; s.flyH = Math.max(1, Math.round(fw * ch / cw)); }
    } else s.flyW = s.flyH = 0;
    const w = fly ? s.flyW! : Math.round(cw * k);
    const h = fly ? s.flyH! : Math.round(ch * k);
    todo.push([s, w, h, cw]);
  }
  if (spinDue && todo.some(([s]) => !s.dragging)) spunAt = t;
  for (const [s, w, h, cw] of todo) {
    const t0 = now();
    // World slots: canvas px per CSS px for this draw (half in flight), and the shadow padding in canvas px.
    const kk = w / cw, world = s.kind === 'world';
    const pl = world ? Math.round(PAD.l * kk) : 0, pt = world ? Math.round(PAD.t * kk) : 0;
    const cwPx = w + (world ? pl + Math.round(PAD.r * kk) : 0), chPx = h + (world ? pt + Math.round(PAD.b * kk) : 0);
    if (s.canvas.width !== cwPx || s.canvas.height !== chPx) { s.canvas.width = cwPx; s.canvas.height = chPx; }
    if (s.camera.aspect !== w / h) { s.camera.aspect = w / h; s.camera.updateProjectionMatrix(); }
    // deltaTime keeps the spin speed the same at 30, 60 or 120 Hz.
    s.controls.update(s.drawn ? Math.min(t - s.drawn, 250) / 1000 : 0);
    // data-morph: when the zoom heads into this piece, the model stops swaying and the camera swings square onto
    // its screen, so the section page can fade in exactly over it (the page sits on a flat panel over the screen).
    const cm = cam(), mk = s.el.dataset.morph;
    const mp = mk && cm && cm.key === mk ? Math.min(1, (cm.prog ?? 0) / 0.6) : 0, m = mp * mp * (3 - 2 * mp);
    if (s.sway && s.pivot) s.pivot.rotation.y = Math.sin(t / 1900) * 0.2 * (1 - m);
    let back: Vector3 | null = null;
    if (m > 0 && s.pivot) {
      const scr = s.pivot.getObjectByName('tama-screen');
      if (scr) {
        s.pivot.updateMatrixWorld();
        const f = scr.getWorldPosition(new Vector3());
        back = s.camera.position.clone();
        const front = new Vector3(f.x, f.y, f.z + back.length());
        s.camera.position.lerpVectors(back, front, m);
        s.camera.lookAt(f.multiplyScalar(m));
      }
    }
    s.drawn = t; s.w = w; s.h = h; s.repaint = false;
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.clear();
    // Ink thins out on small slots so it never turns into hatching (a 1 px line is a bigger share of a small model).
    setLineFade(Math.min(1, Math.max(0.45, (Math.min(w, h) - 120) / 360)));
    renderer.render(s.scene, s.camera);
    if (back) { s.camera.position.copy(back); s.camera.lookAt(s.controls.target); } // the orbit controls own the camera
    const ctx = s.ctx, src = renderer.domElement;
    ctx.clearRect(0, 0, cwPx, chPx);
    if (world) {
      // Shadow-only passes: the model is drawn far off the canvas and its shadow offset back onto it, so the
      // model's own pixels are drawn once, on top, with no shadow.
      const hv = hoverAmt(s, t), R = SHADOW.rest, H = SHADOW.hover, off = cwPx + 64;
      const pass = (color: string, blur: number, dy: number) => {
        ctx.shadowColor = color; ctx.shadowBlur = blur * kk; ctx.shadowOffsetX = off; ctx.shadowOffsetY = dy * kk;
        ctx.drawImage(src, 0, bufH - h, w, h, pl - off, pt, w, h);
      };
      if (hv > 0.001) pass(`rgba(${glowRgb},${(H.glowA * hv).toFixed(3)})`, H.glow, 0);
      pass(`rgba(${shadowRgb},${((R.a + (H.a - R.a) * hv) * shadowK).toFixed(3)})`, R.blur + (H.blur - R.blur) * hv, R.dy + (H.dy - R.dy) * hv);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    }
    ctx.drawImage(src, 0, bufH - h, w, h, pl, pt, w, h);
    if (!s.el.classList.contains('is-live')) s.el.classList.add('is-live');
    const d = now() - t0;
    s.cost = s.cost ? s.cost * 0.8 + Math.min(d, 100) * 0.2 : Math.min(d, 20); // first draws upload meshes: not typical
  }
  if (again) kick();
}
