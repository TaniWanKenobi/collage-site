// One WebGL renderer for every model slot on a lab page. It draws each slot into an offscreen buffer
// (viewport + scissor) and copies the result into that slot's own 2D canvas, so slots keep their place
// in the collage's stacking order (cards can overlap a model) while the page holds a single GL context.
import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Box3, Vector3, Sphere,
  ACESFilmicToneMapping, SRGBColorSpace, PMREMGenerator, MathUtils, type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface Slot {
  el: HTMLElement; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  scene: Scene; camera: PerspectiveCamera; controls: OrbitControls;
  visible: boolean; ready: boolean;
}

const MAX_PX = 2048;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function start(els: HTMLElement[]) {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    els.forEach((el) => el.classList.add('no-webgl'));
    return;
  }
  renderer.setPixelRatio(1); // sizes below are already in device pixels
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setScissorTest(true);
  const env = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const cache = new Map<string, Promise<Object3D>>();
  const load = (src: string) => {
    if (!cache.has(src)) cache.set(src, loader.loadAsync(src).then((g) => g.scene));
    return cache.get(src)!.then((o) => o.clone(true)); // one fetch, one copy per slot
  };

  const slots: Slot[] = [];
  let bufW = 1, bufH = 1;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const s = slots.find((x) => x.el === e.target);
      if (s) s.visible = e.isIntersecting;
    });
    kick();
  }, { rootMargin: '100px' });

  for (const el of els) {
    const canvas = el.querySelector<HTMLCanvasElement>('canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) continue;
    const scene = new Scene();
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    scene.add(new HemisphereLight(0xeffdd8, 0x564d80, 1.1));
    const key = new DirectionalLight(0xffffff, 2.2); key.position.set(3, 5, 4); scene.add(key);
    const rim = new DirectionalLight(0xc2f970, 1.4); rim.position.set(-4, 2, -3); scene.add(rim);
    const camera = new PerspectiveCamera(30, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.autoRotate = !reduce;
    controls.autoRotateSpeed = 1.1;
    controls.addEventListener('change', kick);
    const slot: Slot = { el, canvas, ctx, scene, camera, controls, visible: false, ready: false };
    slots.push(slot);
    io.observe(el);

    load(el.dataset.src!).then((obj) => {
      frame(slot, obj);
      scene.add(obj);
      slot.ready = true;
      kick();
    }).catch(() => {
      el.classList.add('is-missing');
      const ph = el.querySelector('.lab-model-ph');
      if (ph) ph.innerHTML = `${ph.innerHTML}<br><span style="color:var(--muted)">model not found</span>`;
    });
  }

  // Centre the model at the origin and back the camera off until its bounding sphere fills the slot.
  function frame(s: Slot, obj: Object3D) {
    const box = new Box3().setFromObject(obj);
    const c = box.getCenter(new Vector3());
    obj.position.sub(c);
    const r = box.getBoundingSphere(new Sphere()).radius || 1;
    const fill = Number(s.el.dataset.fill ?? 0.9);
    const dist = r / Math.sin(MathUtils.degToRad(s.camera.fov / 2)) / fill;
    const el = MathUtils.degToRad(Number(s.el.dataset.elev ?? 22));
    const az = MathUtils.degToRad(Number(s.el.dataset.azim ?? 35));
    s.camera.position.set(dist * Math.cos(el) * Math.sin(az), dist * Math.sin(el), dist * Math.cos(el) * Math.cos(az));
    s.camera.near = dist / 100; s.camera.far = dist * 10;
    s.controls.target.set(0, 0, 0);
    s.controls.update();
  }

  let raf = 0;
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }
  function tick() {
    raf = 0;
    if (document.hidden) return;
    let again = false;
    for (const s of slots) {
      if (!s.visible || !s.ready) continue;
      const r = s.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.min(MAX_PX, Math.round(r.width * dpr)));
      const h = Math.max(1, Math.min(MAX_PX, Math.round(r.height * dpr)));
      if (s.canvas.width !== w || s.canvas.height !== h) { s.canvas.width = w; s.canvas.height = h; }
      if (w > bufW || h > bufH) { bufW = Math.max(bufW, w); bufH = Math.max(bufH, h); renderer.setSize(bufW, bufH, false); }
      s.camera.aspect = w / h;
      s.camera.updateProjectionMatrix();
      s.controls.update();
      renderer.setViewport(0, 0, w, h);
      renderer.setScissor(0, 0, w, h);
      renderer.clear();
      renderer.render(s.scene, s.camera);
      s.ctx.clearRect(0, 0, w, h);
      s.ctx.drawImage(renderer.domElement, 0, bufH - h, w, h, 0, 0, w, h);
      if (!s.el.classList.contains('is-live')) s.el.classList.add('is-live');
      if (s.controls.autoRotate) again = true;
    }
    if (again) kick();
  }
  document.addEventListener('visibilitychange', kick);
  addEventListener('resize', kick);
}
