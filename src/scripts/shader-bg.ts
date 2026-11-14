// ?bg=<name>: a WebGL shader background behind the collage (variants in scripts/shaders/*.glsl.ts).
// Loaded only when ?bg= is in the URL (see layouts/Base.astro); without it the site keeps its flat onyx.
//
// Performance rules (scrolling must stay smooth):
//  - No idle GPU: a frame is drawn only on a "zoomcam" event (the camera publishes one per frame while it
//    moves), on resize, or when the tab comes back. Once the camera settles there is no rAF at all and the
//    canvas keeps showing its last frame.
//  - Shader time follows the smoothed scroll position (camera p, 0..7) plus a slow drift that only advances
//    while the camera is moving.
//  - Drawn at half the device resolution (capped at 1 canvas px per CSS px) and upscaled by CSS.
//  - Heavy variants (baked: true) are drawn once into a texture; per frame only that texture is panned/zoomed.
//  - Not drawn while a section page covers the world (its panel is opaque), nor on the phone layout.
//  - prefers-reduced-motion: one static frame. No WebGL2 / compile error / lost context: the CSS background.
import { STACKED_MQ } from './slot-view.js';
import { HEAD, main, type BgVariant } from './shaders/common.glsl';

const LOADERS: Record<string, () => Promise<{ default: BgVariant }>> = {
  satin: () => import('./shaders/satin.glsl'),
  halo: () => import('./shaders/halo.glsl'),
  melt: () => import('./shaders/melt.glsl'),
  smoke: () => import('./shaders/smoke.glsl'),
  dither: () => import('./shaders/dither.glsl'),
  contours: () => import('./shaders/contours.glsl'),
};

interface Cam { p?: number | null; zoom?: number; open?: boolean; cx?: number; cy?: number }
declare global { interface Window { __zoomCam?: Cam; __bgFrames?: number } }

const VERT = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

// A baked texture covers EXT times the viewport so the camera pan/zoom never runs off its edge.
const EXT = 1.15;
const DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_z;
uniform vec2 u_pan;
out vec4 o_col;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  uv = (uv * (1.0 - 0.12 * u_z) + u_pan) / ${EXT.toFixed(3)};
  o_col = texture(u_tex, vec2(uv.x * u_res.y / u_res.x, uv.y) + 0.5);
}`;

function compile(gl: WebGL2RenderingContext, frag: string): WebGLProgram | null {
  const prog = gl.createProgram();
  const add = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    gl.attachShader(prog, s);
    return s;
  };
  const vs = add(gl.VERTEX_SHADER, VERT), fs = add(gl.FRAGMENT_SHADER, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    // Dev aid only (a debug message, not an error); the site falls back to its CSS background.
    console.debug('[shader-bg]', gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(prog));
    return null;
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

async function init() {
  const name = new URLSearchParams(location.search).get('bg') || '';
  const load = LOADERS[name];
  if (!load || !document.getElementById('zm-root')) return;
  const variant = (await load()).default;

  const canvas = document.createElement('canvas');
  canvas.id = 'bg-gl';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
    preserveDrawingBuffer: false, powerPreference: 'low-power',
  });
  if (!gl) return;
  const baked = !!variant.baked;
  // Live: the variant shader draws every frame. Baked: it draws once into `tex`, DISPLAY draws every frame.
  const shadeProg = compile(gl, HEAD + variant.frag + main(baked ? EXT : 1, !baked));
  const showProg = baked ? compile(gl, DISPLAY) : shadeProg;
  if (!shadeProg || !showProg) return;
  const locs = new Map<string, WebGLUniformLocation | null>();
  const loc = (p: WebGLProgram, n: string) => {
    const k = (p === shadeProg ? 's' : 'd') + n;
    if (!locs.has(k)) locs.set(k, gl.getUniformLocation(p, n));
    return locs.get(k)!;
  };
  const tex = baked ? gl.createTexture() : null;
  const fbo = baked ? gl.createFramebuffer() : null;
  let texW = 0, texH = 0;

  const style = document.createElement('style');
  style.textContent =
    '#bg-gl{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;display:block}' +
    (variant.pixelated ? '#bg-gl{image-rendering:pixelated}' : '') +
    // The root and stage paint their own onyx; let the canvas show through (the stage's .grain stays on top).
    'html[data-bg] #zm-root,html[data-bg] #zm-stage{background-color:transparent!important}' +
    `@media ${STACKED_MQ}{#bg-gl{display:none}}`;
  document.head.appendChild(style);
  document.body.prepend(canvas);
  document.documentElement.setAttribute('data-bg', name);

  const stacked = window.matchMedia(STACKED_MQ);
  const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const speed = variant.speed ?? 1;
  let cam: Cam = window.__zoomCam || {};
  let drift = 0, lastEvt = 0, raf = 0, dirty = true, lost = false;
  window.__bgFrames = 0;

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = Math.min(0.5 * dpr, 1);
    const w = Math.max(1, Math.round(window.innerWidth * k)), h = Math.max(1, Math.round(window.innerHeight * k));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  // Baked variants: (re)draw the texture when the canvas size changes. Time is fixed at 0 (no animation, only parallax).
  function bake() {
    if (texW === canvas.width && texH === canvas.height) return;
    texW = canvas.width; texH = canvas.height;
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, texW, texH, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0);
    gl!.useProgram(shadeProg);
    gl!.viewport(0, 0, texW, texH);
    gl!.uniform2f(loc(shadeProg!, 'u_res'), texW, texH);
    gl!.uniform1f(loc(shadeProg!, 'u_t'), 0);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
  }

  function draw() {
    raf = 0;
    if (lost || document.hidden || stacked.matches) return;
    if (cam.open && !dirty) return; // a section page covers the world
    dirty = false;
    size();
    if (baked) bake();
    const reduced = reducedMq.matches;
    const p = reduced ? 0 : cam.p || 0;
    const z = reduced ? 0 : cam.zoom || 0;
    // Light parallax: the pattern follows the camera centre a little (world is 1440x900).
    const px = reduced ? 0 : ((cam.cx ?? 720) - 720) / 900 * 0.06;
    const py = reduced ? 0 : -((cam.cy ?? 450) - 450) / 900 * 0.06;
    gl!.useProgram(showProg);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.uniform2f(loc(showProg!, 'u_res'), canvas.width, canvas.height);
    gl!.uniform1f(loc(showProg!, 'u_z'), z);
    gl!.uniform2f(loc(showProg!, 'u_pan'), px, py);
    if (!baked) gl!.uniform1f(loc(showProg!, 'u_t'), speed * (p * 0.6 + drift * 0.25));
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    window.__bgFrames!++;
  }
  function request() { if (!raf) raf = requestAnimationFrame(draw); }

  window.addEventListener('zoomcam', (e) => {
    cam = (e as CustomEvent<Cam>).detail || cam;
    if (reducedMq.matches) return; // one static frame
    const now = performance.now();
    // Ambient drift only advances while the camera moves (gaps between events are capped at 50 ms).
    if (lastEvt) drift += Math.min(now - lastEvt, 50) / 1000;
    lastEvt = now;
    if (!cam.open) request();
  });
  window.addEventListener('resize', () => { dirty = true; request(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { dirty = true; request(); } });
  stacked.addEventListener('change', () => { dirty = true; request(); });
  reducedMq.addEventListener('change', () => { dirty = true; request(); });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    document.documentElement.removeAttribute('data-bg');
    canvas.style.display = 'none';
  });
  request();
}

init().catch(() => {});
