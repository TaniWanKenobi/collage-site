// The live globe in the grape disc: a rotating lat/long wireframe drawn with a perspective projection
// on a plain 2D canvas. Same geometry, tilt, spin and camera as the old React Three Fiber version, at
// ~3 KB instead of ~300 KB gzipped (three + React). Desktop only, loaded after the page is idle.
import { worldRect, onScreen, zoomDpr, prefersStatic, whenIdle } from './slot-view.js';

const GRAPE_LITE = '#8F86C0';
const LIME = '#C2F970';
const SIZE = 294; // CSS px of the slot
const CAM_Z = 3.05, FOV = 40; // the old three.js camera
const TILT_X = 0.35, TILT_Z = -0.18; // group rotation [0.35, 0, -0.18] (Euler XYZ)
const SPIN = 0.18; // rad/s around Y

function loops() {
  const seg = 96, out = [];
  const ring = (fn) => { const pts = []; for (let i = 0; i <= seg; i++) pts.push(fn((i / seg) * Math.PI * 2)); return pts; };
  for (let lat = -60; lat <= 60; lat += 30) {
    const phi = (lat * Math.PI) / 180, r = Math.cos(phi), y = Math.sin(phi);
    out.push(ring((t) => [r * Math.cos(t), y, r * Math.sin(t)]));
  }
  for (let lon = 0; lon < 180; lon += 30) {
    const th = (lon * Math.PI) / 180;
    out.push(ring((t) => [Math.cos(t) * Math.cos(th), Math.sin(t), Math.cos(t) * Math.sin(th)]));
  }
  return out;
}
const LOOPS = loops();
const MARKER = (() => { const p = (40 * Math.PI) / 180, t = (-50 * Math.PI) / 180; return [Math.cos(p) * Math.cos(t), Math.sin(p), Math.cos(p) * Math.sin(t)]; })();

// p' = Rx(TILT_X) * Rz(TILT_Z) * Ry(spin) * p   (three's XYZ Euler on the outer group, spin on the inner one)
function xform(p, cy, sy) {
  let [x, y, z] = p;
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cz = Math.cos(TILT_Z), sz = Math.sin(TILT_Z);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  const cx = Math.cos(TILT_X), sx = Math.sin(TILT_X);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  return [x, y, z];
}

function mount(slot) {
  const host = slot.closest('.globe-disc');
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `display:block;width:${SIZE}px;height:${SIZE}px;pointer-events:none`;
  slot.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const focal = SIZE / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);

  let wr = worldRect(slot), dpr = 0, visible = false, angle = 0, last = 0, raf = 0;

  function draw() {
    const cy = Math.cos(angle), sy = Math.sin(angle), c = SIZE / 2;
    const proj = (p) => { const q = xform(p, cy, sy), k = focal / (CAM_Z - q[2]); return [c + q[0] * k, c - q[1] * k, k]; };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = GRAPE_LITE;
    ctx.lineWidth = 1.1;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const loop of LOOPS) loop.forEach((p, i) => { const [x, y] = proj(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    // Silhouette ring facing the camera (unit circle at z=0), like the CSS fallback's outline.
    const R = focal / CAM_Z;
    ctx.moveTo(c + R, c);
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.stroke();
    const [mx, my, mk] = proj(MARKER);
    ctx.fillStyle = LIME;
    ctx.beginPath();
    ctx.arc(mx, my, 0.07 * mk, 0, Math.PI * 2);
    ctx.fill();
  }

  function frame(t) {
    raf = 0;
    if (!visible) return;
    angle += Math.min((t - (last || t)) / 1000, 0.05) * SPIN;
    last = t;
    draw();
    raf = requestAnimationFrame(frame);
  }

  function sync() {
    const cam = window.__zoomCam;
    const vis = onScreen(wr, cam) && !(cam && cam.open);
    const d = zoomDpr(cam, SIZE);
    if (d !== dpr) {
      dpr = d;
      canvas.width = canvas.height = Math.round(SIZE * dpr);
      draw();
    }
    slot.style.visibility = vis ? 'visible' : 'hidden';
    host && host.classList.toggle('three-live', vis);
    if (vis && !visible) { visible = true; last = 0; if (!raf) raf = requestAnimationFrame(frame); }
    else if (!vis && visible) { visible = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  }

  window.addEventListener('zoomcam', sync);
  window.addEventListener('resize', () => { wr = worldRect(slot); sync(); });
  sync();
}

export function initGlobe() {
  if (prefersStatic()) return;
  whenIdle(() => document.querySelectorAll('[data-three-slot="globe"]').forEach(mount));
}
