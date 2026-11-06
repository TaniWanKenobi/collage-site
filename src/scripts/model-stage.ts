// One WebGL renderer for every 3D model on the home page (lazy-loaded by models-boot.js).
// Each slot is drawn into an offscreen buffer and copied into the slot's own 2D canvas, so models keep
// their place in the collage's stacking order while the page holds a single GL context.
// World slots follow the zoom camera (window.__zoomCam + "zoomcam" event): they render only while on
// screen and no section page is open, at a pixel ratio that tracks the camera zoom so they stay sharp.
// Cost control (a weak laptop GPU was spending most of every frame here):
//  - meshes decode in meshopt's Web Workers, and each .glb is fetched only once a slot first wants to draw;
//  - idle spin draws at up to 30 fps, slower on a machine where a draw is expensive (spin stays under ~20% of
//    the main thread); a drag (and its damping) draws at full rate;
//  - while the zoom camera moves, slots keep their last frame (CSS scales it) and re-render sharp at rest,
//    so scroll and fly-to frames carry no WebGL work and no canvas reallocations;
//  - every shader (the environment map's and the models') compiles in parallel without blocking the page.
import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Box3, Vector3, Sphere,
  ACESFilmicToneMapping, SRGBColorSpace, PMREMGenerator, MathUtils, type Object3D, type Texture,
  type Camera, type Material, type Mesh, type WebGLRenderTarget,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { worldRect, onScreen } from './slot-view.js';

type Kind = 'world' | 'page' | 'flow';
interface Cam { s: number; open: boolean; cx: number; cy: number; r: number; vw: number; h: number }
interface Slot {
  el: HTMLElement; kind: Kind; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  scene: Scene; camera: PerspectiveCamera; controls: OrbitControls;
  wr: ReturnType<typeof worldRect> | null; inView: boolean; ready: boolean; active: boolean;
  requested: boolean; drawn: number; userUntil: number; dragging: boolean; turned: boolean; w: number; h: number; cost: number;
}

const MAX_PX = 1536; // largest backing-store edge per slot
const SPIN_MS = 1000 / 30 - 2; // idle auto-rotate frame interval (30 fps, with a little slack for rAF jitter)
// The camera counts as moving until this long after its last frame. Longer than the world's own settle delay in
// zoom-camera.js (180 ms), so the sharp redraw at rest does not land on the same frame as the world's repaint.
const REST_MS = 320;
const BUF_STEP = 256; // the shared drawing buffer grows in steps: reallocating it stalls the GPU for 10-150 ms
const cam = (): Cam | null => (window as unknown as { __zoomCam?: Cam }).__zoomCam ?? null;

let renderer: WebGLRenderer | null = null;
let env: Texture;
let envReady: Promise<unknown>;
let loader: GLTFLoader;
const cache = new Map<string, Promise<Object3D>>();
const slots: Slot[] = [];
let bufW = 1, bufH = 1, raf = 0, camAt = 0, restTimer = 0, spunAt = 0, bigSince = 0;
let io: IntersectionObserver;
const now = () => performance.now();
const camMoving = () => now() - camAt < REST_MS;
// Every camera frame: note the time, and schedule one tick just after the camera comes to rest.
function onCam() {
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
  renderer.setPixelRatio(1); // all sizes below are device pixels already
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setScissorTest(true);
  renderer.setSize(512, 512, false); bufW = bufH = 512; // fits both collage objects at the overview: no early reallocations
  envReady = makeEnv(renderer).then((t) => { env = t; });
  // Decode meshopt buffers in Web Workers (decodeGltfBufferAsync), not on the main thread.
  try { MeshoptDecoder.useWorkers(Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))); } catch { /* main-thread fallback */ }
  loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  io = new IntersectionObserver((es) => {
    es.forEach((e) => { const s = slots.find((x) => x.el === e.target); if (s) s.inView = e.isIntersecting; });
    kick();
  }, { rootMargin: '100px' });
  window.addEventListener('zoomcam', onCam);
  window.addEventListener('resize', () => { slots.forEach((s) => { if (s.kind === 'world') s.wr = worldRect(s.el); }); kick(); });
  document.addEventListener('visibilitychange', kick);
  return true;
}

const load = (src: string) => {
  if (!cache.has(src)) cache.set(src, loader.loadAsync(src).then((g) => g.scene));
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
    const scene = new Scene();
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    // Palette lighting: lime-tint sky / grape ground, white key, lime rim.
    scene.add(new HemisphereLight(0xeffdd8, 0x564d80, 1.1));
    const key = new DirectionalLight(0xffffff, 2.2); key.position.set(3, 5, 4); scene.add(key);
    const rim = new DirectionalLight(0xc2f970, 1.4); rim.position.set(-4, 2, -3); scene.add(rim);
    const camera = new PerspectiveCamera(30, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.1;
    const s: Slot = { el, kind, canvas, ctx, scene, camera, controls, wr: kind === 'world' ? worldRect(el) : null, inView: false, ready: false, active: false, requested: false, drawn: 0, userUntil: 0, dragging: false, turned: false, w: 0, h: 0, cost: 0 };
    // A drag draws at full frame rate, and keeps doing so while the damping settles. A plain click (which
    // flies the camera to the section) is not a drag and must not hold the slot at full rate.
    controls.addEventListener('start', () => { s.dragging = true; s.turned = false; });
    controls.addEventListener('change', () => { if (s.dragging) s.turned = true; kick(); });
    controls.addEventListener('end', () => { s.dragging = false; if (s.turned) s.userUntil = now() + 1200; kick(); });
    slots.push(s);
    if (kind !== 'world') io.observe(el);
    if (kind === 'world') wireClick(s);
  }
  kick();
}

// The room environment map, built exactly as before (PMREMGenerator.fromScene), but its shaders compile first
// through compileAsync: built directly, it compiled them synchronously and froze the page for 0.6-0.8 s.
// A dry run of fromScene with render() stubbed records what it would draw; those programs are compiled in
// parallel (KHR_parallel_shader_compile), then the real fromScene finds them all cached and ready.
async function makeEnv(r: WebGLRenderer): Promise<Texture> {
  await new Promise((res) => setTimeout(res, 0)); // a separate task from creating the renderer
  const room = new RoomEnvironment();
  const pmrem = new PMREMGenerator(r);
  try {
    const calls: [Object3D, Camera, WebGLRenderTarget | null, Material | Material[] | null][] = [];
    const render = r.render;
    r.render = (scene, camera) => { calls.push([scene, camera, r.getRenderTarget(), (scene as Mesh).isMesh ? (scene as Mesh).material : null]); };
    try { pmrem.fromScene(room, 0.04).dispose(); } finally { r.render = render; }
    const prev = r.getRenderTarget(), seen = new Set<string>(), jobs: Promise<unknown>[] = [];
    for (const [scene, camera, target, mat] of calls) {
      const key = `${scene.uuid}|${mat && !Array.isArray(mat) ? mat.uuid : ''}|${target ? 1 : 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (mat) (scene as Mesh).material = mat;
      r.setRenderTarget(target); // program parameters depend on the target (tone mapping, color space)
      jobs.push(r.compileAsync(scene, camera)); // creates the programs now, resolves when they are linked
    }
    r.setRenderTarget(prev);
    await Promise.all(jobs);
  } catch { /* fall through: fromScene compiles whatever is missing */ }
  return pmrem.fromScene(room, 0.04).texture;
}

// Fetch and decode a slot's model the first time the slot is worth drawing (a deep link to a section does not
// download the collage's models until the camera goes there).
function request(s: Slot) {
  s.requested = true;
  Promise.all([load(s.el.dataset.src!), envReady]).then(async ([obj]) => {
    s.scene.environment = env;
    frame(s, obj);
    s.scene.add(obj);
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
function frame(s: Slot, obj: Object3D) {
  const box = new Box3().setFromObject(obj);
  obj.position.sub(box.getCenter(new Vector3()));
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
  // Idle spin: every visible slot redraws together, at up to 30 fps but no more than ~20% of the main thread
  // (each slot keeps a running average of what its draw costs, which is far higher on a slow CPU).
  const spinCost = slots.reduce((n, s) => n + (s.active ? s.cost : 0), 0);
  const spinDue = t - spunAt >= Math.max(SPIN_MS, spinCost * 5);
  let again = false, needW = 1, needH = 1;
  const todo: [Slot, number, number][] = [];
  let firsts = 0; // a slot's first draw uploads its meshes: at most one per frame
  for (const s of slots) {
    const scale = view(s);
    if (scale > 0 && !s.requested) request(s);
    s.active = s.ready && scale > 0;
    if (!s.active) { s.drawn = 0; continue; }
    again = true; // auto-rotate keeps visible slots moving
    const user = s.dragging || (t < s.userUntil && !moving);
    // Camera in motion: keep the last frame (CSS scales it); nothing to redraw unless the user is dragging.
    if (moving && s.drawn && !user) { needW = Math.max(needW, s.w); needH = Math.max(needH, s.h); continue; }
    // A drag redraws every frame when a draw is cheap, and leaves frames free in between when it is not.
    if (s.drawn && (user ? t - s.drawn < Math.min(s.cost * 1.5, 100) - 2 : !spinDue)) { needW = Math.max(needW, s.w); needH = Math.max(needH, s.h); continue; }
    const cw = s.el.offsetWidth, ch = s.el.offsetHeight;
    if (!cw || !ch) continue;
    if (!s.drawn && !s.el.classList.contains('is-live') && firsts++) continue;
    // Device pixels per CSS pixel, stepped to 0.25 so a camera flight does not resize the canvas every frame.
    const k = Math.min(MAX_PX / Math.max(cw, ch), Math.max(1, Math.round((window.devicePixelRatio || 1) * scale * 4) / 4));
    const w = Math.round(cw * k), h = Math.round(ch * k);
    needW = Math.max(needW, w); needH = Math.max(needH, h);
    todo.push([s, w, h]);
  }
  // One drawing buffer for every slot (sized for all visible slots, in BUF_STEP steps): grow it when a slot
  // needs more. Shrinking also reallocates (and can stall ~100 ms next to a repaint), so it waits until the
  // buffer has been far too big for 3 s of rest.
  const step = (n: number) => Math.max(512, Math.ceil(n / BUF_STEP) * BUF_STEP);
  const big = step(needW) < bufW / 2 || step(needH) < bufH / 2;
  bigSince = big && !moving ? bigSince || t : 0;
  if (todo.length && (needW > bufW || needH > bufH || (bigSince && t - bigSince > 3000))) {
    bufW = step(needW); bufH = step(needH); renderer.setSize(bufW, bufH, false); bigSince = 0;
  }
  if (spinDue && todo.some(([s]) => !s.dragging)) spunAt = t;
  for (const [s, w, h] of todo) {
    const t0 = now();
    if (s.canvas.width !== w || s.canvas.height !== h) { s.canvas.width = w; s.canvas.height = h; }
    if (s.camera.aspect !== w / h) { s.camera.aspect = w / h; s.camera.updateProjectionMatrix(); }
    // deltaTime keeps the spin speed the same at 30, 60 or 120 Hz.
    s.controls.update(s.drawn ? Math.min(t - s.drawn, 250) / 1000 : 0);
    s.drawn = t; s.w = w; s.h = h;
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.clear();
    renderer.render(s.scene, s.camera);
    s.ctx.clearRect(0, 0, w, h);
    s.ctx.drawImage(renderer.domElement, 0, bufH - h, w, h, 0, 0, w, h);
    if (!s.el.classList.contains('is-live')) s.el.classList.add('is-live');
    const d = now() - t0;
    s.cost = s.cost ? s.cost * 0.8 + Math.min(d, 100) * 0.2 : Math.min(d, 20); // first draws upload meshes: not typical
  }
  if (again) kick();
}
