// One WebGL renderer for every 3D model on the home page (lazy-loaded by models-boot.js).
// Each slot is drawn into an offscreen buffer and copied into the slot's own 2D canvas, so models keep
// their place in the collage's stacking order while the page holds a single GL context.
// World slots follow the zoom camera (window.__zoomCam + "zoomcam" event): they render only while on
// screen and no section page is open, at a pixel ratio that tracks the camera zoom so they stay sharp.
import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Box3, Vector3, Sphere,
  ACESFilmicToneMapping, SRGBColorSpace, PMREMGenerator, MathUtils, type Object3D, type Texture,
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
}

const MAX_PX = 2048; // largest backing-store edge per slot
const cam = (): Cam | null => (window as unknown as { __zoomCam?: Cam }).__zoomCam ?? null;

let renderer: WebGLRenderer | null = null;
let env: Texture;
let loader: GLTFLoader;
const cache = new Map<string, Promise<Object3D>>();
const slots: Slot[] = [];
let bufW = 1, bufH = 1, raf = 0;
let io: IntersectionObserver;

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
  env = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  io = new IntersectionObserver((es) => {
    es.forEach((e) => { const s = slots.find((x) => x.el === e.target); if (s) s.inView = e.isIntersecting; });
    kick();
  }, { rootMargin: '100px' });
  window.addEventListener('zoomcam', kick);
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
    controls.addEventListener('change', kick);
    const s: Slot = { el, kind, canvas, ctx, scene, camera, controls, wr: kind === 'world' ? worldRect(el) : null, inView: false, ready: false, active: false };
    slots.push(s);
    if (kind !== 'world') io.observe(el);
    if (kind === 'world') wireClick(s);
    load(el.dataset.src!).then((obj) => {
      frame(s, obj);
      scene.add(obj);
      s.ready = true;
      kick();
    }).catch(() => el.classList.add('is-missing'));
  }
  kick();
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
  let again = false;
  for (const s of slots) {
    const scale = s.ready ? view(s) : 0;
    s.active = scale > 0;
    if (!s.active) continue;
    const cw = s.el.offsetWidth, ch = s.el.offsetHeight;
    if (!cw || !ch) continue;
    // Device pixels per CSS pixel, stepped to 0.25 so a camera flight does not resize the canvas every frame.
    const k = Math.min(MAX_PX / Math.max(cw, ch), Math.max(1, Math.round((window.devicePixelRatio || 1) * scale * 4) / 4));
    const w = Math.round(cw * k), h = Math.round(ch * k);
    if (s.canvas.width !== w || s.canvas.height !== h) { s.canvas.width = w; s.canvas.height = h; }
    if (w > bufW || h > bufH) { bufW = Math.max(bufW, w); bufH = Math.max(bufH, h); renderer.setSize(bufW, bufH, false); }
    if (s.camera.aspect !== w / h) { s.camera.aspect = w / h; s.camera.updateProjectionMatrix(); }
    s.controls.update();
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.clear();
    renderer.render(s.scene, s.camera);
    s.ctx.clearRect(0, 0, w, h);
    s.ctx.drawImage(renderer.domElement, 0, bufH - h, w, h, 0, 0, w, h);
    if (!s.el.classList.contains('is-live')) s.el.classList.add('is-live');
    again = true; // auto-rotate keeps visible slots moving
  }
  if (again) kick();
}
