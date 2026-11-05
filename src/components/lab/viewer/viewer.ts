// /lab/viewer: drop a CAD or mesh file and look at it in the site palette. Everything runs in the browser.
// STEP/IGES/BREP go through occt.ts (lazy wasm); the mesh formats use three's own loaders.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { duotoneMaterial } from './duotone';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $<HTMLDivElement>('vw-stage');
const canvas = $<HTMLCanvasElement>('vw-canvas');
const fileInput = $<HTMLInputElement>('vw-file');
const drop = $<HTMLDivElement>('vw-drop');
const status = $<HTMLParagraphElement>('vw-status');
const stat = (k: string, v: string) => { $(`vw-s-${k}`).textContent = v; };
const say = (msg: string) => { status.textContent = msg; };

const CAD: Record<string, 'step' | 'iges' | 'brep'> = { step: 'step', stp: 'step', iges: 'iges', igs: 'iges', brep: 'brep', brp: 'brep' };
const MAIN = ['step', 'stp', 'iges', 'igs', 'brep', 'brp', 'gltf', 'glb', 'obj', 'stl', '3mf', 'ply'];
const Z_UP = new Set(['step', 'stp', 'iges', 'igs', 'brep', 'brp', 'stl', '3mf']);
const BG: Record<string, number | null> = { onyx: 0x0d160b, grape: 0x564d80, lime: 0xc2f970, checker: null };
const ext = (f: File) => f.name.toLowerCase().split('.').pop() || '';
const base = (p: string) => decodeURIComponent(p.split(/[\\/]/).pop() || '').toLowerCase();
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
scene.add(new THREE.HemisphereLight(0xeffdd8, 0x564d80, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 5, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0xc2f970, 1.2); rim.position.set(-4, 2, -3); scene.add(rim);

const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
camera.position.set(3, 2, 3);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.autoRotateSpeed = 1.2;

const grid = new THREE.GridHelper(10, 20, 0x8f86c0, 0x263424);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.7;
scene.add(grid);

/** holder carries the up-axis rotation and centring; model is what was loaded. */
const holder = new THREE.Group();
scene.add(holder);
let model: THREE.Object3D | null = null;
let modelName = 'model';
const original = new Map<THREE.Mesh | THREE.Points, THREE.Material | THREE.Material[]>();
const duo = duotoneMaterial();

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

renderer.setAnimationLoop(() => {
  if (document.hidden) return;
  controls.update();
  renderer.render(scene, camera);
});

// ---------- options ----------
const opt = {
  get grid() { return $<HTMLInputElement>('vw-grid').checked; },
  get wire() { return $<HTMLInputElement>('vw-wire').checked; },
  get duo() { return $<HTMLInputElement>('vw-duo').checked; },
  get spin() { return $<HTMLInputElement>('vw-spin').checked; },
  get bg() { return (document.querySelector('input[name="vw-bg"]:checked') as HTMLInputElement).value; },
  get quality() { return parseFloat($<HTMLSelectElement>('vw-quality').value); },
  get up() { return $<HTMLSelectElement>('vw-up').value; },
};

function applyBg() {
  const c = BG[opt.bg];
  stage.dataset.bg = opt.bg;
  if (c === null) renderer.setClearColor(0x000000, 0);
  else renderer.setClearColor(c, 1);
  const light = opt.bg === 'lime';
  (grid.material as THREE.LineBasicMaterial).opacity = light ? 0.45 : 0.7;
}

function applyMaterials() {
  original.forEach((mat, obj) => {
    if (obj instanceof THREE.Points) return;
    obj.material = opt.duo ? duo : mat;
  });
  duo.wireframe = opt.wire;
  original.forEach((mat) => (Array.isArray(mat) ? mat : [mat]).forEach((m) => { if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = opt.wire; }));
}

for (const id of ['vw-grid', 'vw-wire', 'vw-duo', 'vw-spin']) $(id).addEventListener('change', sync);
document.querySelectorAll('input[name="vw-bg"]').forEach((r) => r.addEventListener('change', sync));
$('vw-up').addEventListener('change', () => { if (model) { orient(); frame(); } });
function sync() {
  grid.visible = opt.grid && !!model;
  controls.autoRotate = opt.spin && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  applyBg();
  applyMaterials();
}
sync();

// ---------- framing ----------
let lastExt = '';
function orient() {
  if (!model) return;
  const zUp = opt.up === 'z' || (opt.up === 'auto' && Z_UP.has(lastExt));
  model.rotation.set(zUp ? -Math.PI / 2 : 0, 0, 0);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -box.min.y, -c.z); // sit on the grid, centred
  model.updateMatrixWorld(true);
}

function frame() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(holder);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, 1e-6);
  const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.2;
  const dir = new THREE.Vector3(1, 0.65, 1.15).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.near = dist / 200;
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.minDistance = r * 0.2;
  controls.maxDistance = dist * 6;
  controls.update();
  // grid sized to the model, on its base
  const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 2.2;
  grid.scale.setScalar(size / 10);
  grid.position.set(sphere.center.x, box.min.y, sphere.center.z);
  grid.visible = opt.grid;
}

// ---------- loading ----------
function blobManager(files: File[]) {
  const urls = new Map<string, string>();
  for (const f of files) urls.set(f.name.toLowerCase(), URL.createObjectURL(f));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => urls.get(base(u)) ?? u);
  return { manager, revoke: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}

const defaultMat = () => new THREE.MeshStandardMaterial({ color: 0xd9dccf, metalness: 0.05, roughness: 0.55, side: THREE.DoubleSide });

async function parseCad(file: File, fmt: 'step' | 'iges' | 'brep'): Promise<THREE.Object3D> {
  say(`Loading OpenCascade (about 7.6 MB, cached after the first file) and reading ${file.name}…`);
  const { readCad } = await import('./occt');
  const meshes = await readCad(fmt, await file.arrayBuffer(), opt.quality);
  const group = new THREE.Group();
  for (const m of meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    if (m.normal && m.normal.length === m.position.length) g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    const base = m.color ? new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2], THREE.SRGBColorSpace) : null;
    const faceColors = (m.faces || []).filter((f) => f.color);
    let material: THREE.Material | THREE.Material[];
    if (faceColors.length) {
      // per-face colours from the STEP file: one material per distinct colour, one group per face
      const mats: THREE.MeshStandardMaterial[] = [];
      const byKey = new Map<string, number>();
      const matFor = (c: [number, number, number] | null) => {
        const k = c ? c.join(',') : 'base';
        if (!byKey.has(k)) {
          const mat = defaultMat();
          if (c) mat.color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); else if (base) mat.color.copy(base);
          byKey.set(k, mats.push(mat) - 1);
        }
        return byKey.get(k)!;
      };
      for (const f of m.faces!) g.addGroup(f.first * 3, (f.last - f.first + 1) * 3, matFor(f.color));
      material = mats;
    } else {
      material = defaultMat();
      if (base) (material as THREE.MeshStandardMaterial).color.copy(base);
    }
    const mesh = new THREE.Mesh(g, material);
    mesh.name = m.name || '';
    group.add(mesh);
  }
  return group;
}

async function parse(main: File, files: File[]): Promise<THREE.Object3D> {
  const e = ext(main);
  if (CAD[e]) return parseCad(main, CAD[e]);
  if (e === 'stl') {
    const g = new STLLoader().parse(await main.arrayBuffer());
    const mat = defaultMat();
    if (g.hasAttribute('color')) mat.vertexColors = true;
    return new THREE.Mesh(g, mat);
  }
  if (e === 'ply') {
    const g = new PLYLoader().parse(await main.arrayBuffer());
    const vc = g.hasAttribute('color');
    if (!g.index && !g.hasAttribute('normal')) {
      // no faces: a point cloud
      const box = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute);
      const size = box.getSize(new THREE.Vector3()).length() / 400;
      return new THREE.Points(g, new THREE.PointsMaterial({ size, color: vc ? 0xffffff : 0xc2f970, vertexColors: vc }));
    }
    const mat = defaultMat(); mat.vertexColors = vc;
    return new THREE.Mesh(g, mat);
  }
  if (e === '3mf') return new ThreeMFLoader().parse(await main.arrayBuffer());
  const { manager, revoke } = blobManager(files);
  try {
    if (e === 'obj') {
      const loader = new OBJLoader(manager);
      const mtl = files.find((f) => ext(f) === 'mtl');
      if (mtl) {
        const mats = new MTLLoader(manager).parse(await mtl.text(), '');
        mats.preload();
        loader.setMaterials(mats);
      }
      const obj = loader.parse(await main.text());
      if (!mtl) obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = defaultMat(); });
      return obj;
    }
    if (e === 'glb' || e === 'gltf') {
      const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
      const data = e === 'glb' ? await main.arrayBuffer() : await main.text();
      const gltf = await loader.parseAsync(data, '');
      return gltf.scene;
    }
  } finally {
    // textures resolve asynchronously; give them a moment before the blob URLs go away
    setTimeout(revoke, 30000);
  }
  throw new Error(`.${e} isn't a format this viewer reads`);
}

function clear() {
  if (model) {
    holder.remove(model);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    original.forEach((mat) => (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose()));
  }
  original.clear();
  model = null;
  grid.visible = false;
  stage.classList.remove('has-model');
  for (const k of ['files', 'format', 'size', 'tris', 'parse', 'meshes']) stat(k, '—');
  ($('vw-png') as HTMLButtonElement).disabled = true;
  ($('vw-glb') as HTMLButtonElement).disabled = true;
  ($('vw-fit') as HTMLButtonElement).disabled = true;
}

/** STL exporters often write zero facet normals; spot-check and recompute if so. */
function badNormals(g: THREE.BufferGeometry) {
  const n = g.getAttribute('normal');
  const step = Math.max(1, Math.floor(n.count / 64));
  for (let i = 0; i < n.count; i += step) if (Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < 0.5) return true;
  return false;
}

let busy = false;
async function load(list: FileList | File[]) {
  const files = Array.from(list);
  if (!files.length || busy) return;
  const main = MAIN.map((x) => files.find((f) => ext(f) === x)).find(Boolean);
  if (!main) { say(`Nothing I can open in ${files.map((f) => f.name).join(', ')}. Try STEP, IGES, STL, OBJ, GLB/GLTF, 3MF or PLY.`); return; }
  busy = true;
  stage.setAttribute('aria-busy', 'true');
  say(`Reading ${main.name}…`);
  const t0 = performance.now();
  try {
    const obj = await parse(main, files);
    const ms = performance.now() - t0;
    clear();
    model = obj;
    modelName = main.name.replace(/\.[^.]+$/, '') || 'model';
    lastExt = ext(main);
    let tris = 0, meshes = 0;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(m.isMesh || (o as THREE.Points).isPoints)) return;
      meshes++;
      const g = m.geometry;
      if (m.isMesh) {
        if (!g.hasAttribute('normal') || badNormals(g)) g.computeVertexNormals();
        tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      }
      original.set(m, m.material);
    });
    holder.add(obj);
    orient();
    frame();
    sync();
    stage.classList.add('has-model');
    const total = files.reduce((s, f) => s + f.size, 0);
    stat('files', files.length === 1 ? main.name : `${main.name} + ${files.length - 1}`);
    stat('format', lastExt.toUpperCase());
    stat('size', fmtBytes(total));
    stat('tris', Math.round(tris).toLocaleString());
    stat('parse', ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
    stat('meshes', meshes.toLocaleString());
    for (const id of ['vw-png', 'vw-glb', 'vw-fit']) ($(id) as HTMLButtonElement).disabled = false;
    say(`Loaded ${main.name}: ${Math.round(tris).toLocaleString()} triangles in ${ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s'}. Drag to orbit, scroll to zoom.`);
  } catch (err) {
    console.warn('[lab viewer]', err);
    say(`Couldn't open ${main.name}: ${(err as Error).message || err}`);
  } finally {
    busy = false;
    stage.removeAttribute('aria-busy');
    fileInput.value = '';
  }
}

// ---------- input ----------
fileInput.addEventListener('change', () => fileInput.files && load(fileInput.files));
let depth = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; drop.hidden = false; } });
addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  depth = 0; drop.hidden = true;
  if (e.dataTransfer?.files.length) load(e.dataTransfer.files);
});

// keyboard orbit on the focused canvas: arrows rotate, +/- zoom, 0 / f frames
const sph = new THREE.Spherical();
canvas.addEventListener('keydown', (e) => {
  const off = camera.position.clone().sub(controls.target);
  sph.setFromVector3(off);
  const step = THREE.MathUtils.degToRad(e.shiftKey ? 3 : 12);
  switch (e.key) {
    case 'ArrowLeft': sph.theta -= step; break;
    case 'ArrowRight': sph.theta += step; break;
    case 'ArrowUp': sph.phi = Math.max(0.05, sph.phi - step); break;
    case 'ArrowDown': sph.phi = Math.min(Math.PI - 0.05, sph.phi + step); break;
    case '+': case '=': sph.radius *= 0.85; break;
    case '-': case '_': sph.radius /= 0.85; break;
    case '0': case 'f': frame(); e.preventDefault(); return;
    default: return;
  }
  e.preventDefault();
  camera.position.copy(controls.target).add(off.setFromSpherical(sph));
  controls.update();
});

// ---------- export ----------
function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$('vw-fit').addEventListener('click', frame);
$('vw-clear').addEventListener('click', () => { clear(); say('Cleared.'); });
$('vw-png').addEventListener('click', () => {
  renderer.render(scene, camera);
  canvas.toBlob((b) => { if (b) { download(b, `${modelName}.png`); say(`Saved ${modelName}.png (${canvas.width}×${canvas.height}).`); } }, 'image/png');
});
$('vw-glb').addEventListener('click', async () => {
  if (!model) return;
  // export with the file's own materials, never the duotone shader
  original.forEach((mat, obj) => { obj.material = mat; });
  try {
    const out = await new GLTFExporter().parseAsync(holder, { binary: true });
    const b = new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' });
    download(b, `${modelName}.glb`);
    say(`Saved ${modelName}.glb (${fmtBytes(b.size)}).`);
  } catch (err) {
    say(`GLB export failed: ${(err as Error).message || err}`);
  } finally {
    applyMaterials();
  }
});

clear();
say('Drop a file anywhere on the page, or choose one. STEP and IGES load a 7.6 MB OpenCascade wasm the first time.');
