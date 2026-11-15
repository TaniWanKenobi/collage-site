// ?bg=<name>: a WebGL shader background behind the collage (variants in scripts/shaders/*.glsl.ts).
// Loaded only when ?bg= is in the URL (see layouts/Base.astro) or the Looks picker turns one on (scripts/looks.ts
// sends "looks:change"; setBg() swaps the variant live, and "flat" releases the canvas and its WebGL context).
// Without it the site keeps its flat onyx.
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
//  - Pointer variants (pointer: 'wake' | 'light', e.g. ripple, reveal) also draw on a window pointermove (mouse/pen
//    only; touch keeps the base look). A short eased settle (<= ~1 s) follows, then the loop stops: no rAF at rest.
//  - prefers-reduced-motion: one static frame. No WebGL2 / compile error / lost context: the CSS background.
import { STACKED_MQ } from './slot-view.js';
import { HEAD, main, type BgVariant } from './shaders/common.glsl';
import { readTheme, rgbOf, type Theme } from './theme-vars';

const LOADERS: Record<string, () => Promise<{ default: BgVariant }>> = {
  satin: () => import('./shaders/satin.glsl'),
  halo: () => import('./shaders/halo.glsl'),
  melt: () => import('./shaders/melt.glsl'),
  smoke: () => import('./shaders/smoke.glsl'),
  dither: () => import('./shaders/dither.glsl'),
  contours: () => import('./shaders/contours.glsl'),
  ripple: () => import('./shaders/ripple.glsl'),
  reveal: () => import('./shaders/reveal.glsl'),
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

// The canvas + WebGL2 context, made when a variant is first switched on and released (WEBGL_lose_context) when
// switched off. use() swaps the variant on the same context; stop() removes everything start() added.
function start() {
  const canvas = document.createElement('canvas');
  canvas.id = 'bg-gl';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
    preserveDrawingBuffer: false, powerPreference: 'low-power',
  });
  if (!gl) return null;

  const style = document.createElement('style');
  style.textContent =
    '#bg-gl{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;display:block}' +
    // The root and stage paint their own onyx; let the canvas show through (the stage's .grain stays on top).
    'html[data-bg] #zm-root,html[data-bg] #zm-stage{background-color:transparent!important}' +
    `@media ${STACKED_MQ}{#bg-gl{display:none}}`;
  document.head.appendChild(style);
  document.body.prepend(canvas);

  // Live: the variant shader draws every frame. Baked: it draws once into `tex`, DISPLAY draws every frame.
  let shadeProg: WebGLProgram | null = null, showProg: WebGLProgram | null = null;
  let baked = false, pointer: BgVariant['pointer'], speed = 1, tex: WebGLTexture | null = null, fbo: WebGLFramebuffer | null = null;
  let texW = 0, texH = 0;
  const locs = new Map<string, WebGLUniformLocation | null>();
  const loc = (p: WebGLProgram, n: string) => {
    const k = (p === shadeProg ? 's' : 'd') + n;
    if (!locs.has(k)) locs.set(k, gl.getUniformLocation(p, n));
    return locs.get(k)!;
  };

  const stacked = window.matchMedia(STACKED_MQ);
  const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  let cam: Cam = window.__zoomCam || {};
  let drift = 0, lastEvt = 0, raf = 0, dirty = true, lost = false;
  window.__bgFrames = 0;

  // Palette uniforms (the colour theme): set on the variant program before it draws (live) or bakes.
  const PAL: [string, keyof Theme][] = [['ONYX', 'bg'], ['ONYX2', 'bg2'], ['LIME', 'accent'], ['TINT', 'text'], ['LAV', 'deco']];
  let pal = readTheme();
  const setPal = (p: WebGLProgram) => { for (const [n, r] of PAL) { const [x, y, z] = rgbOf(pal[r]); gl.uniform3f(loc(p, n), x / 255, y / 255, z / 255); } };

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
    setPal(shadeProg!);
    gl!.viewport(0, 0, texW, texH);
    gl!.uniform2f(loc(shadeProg!, 'u_res'), texW, texH);
    gl!.uniform1f(loc(shadeProg!, 'u_t'), 0);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
  }

  // Pointer state (CSS px, eased in step()): target t*, shown x/y, strength k (0..1), velocity v* (viewport heights/s).
  const ptr = { tx: 0, ty: 0, x: 0, y: 0, k: 0, vx: 0, vy: 0, inside: false, last: 0, t: 0 };
  // Advance the pointer easing to `now`; true while it is still moving (the caller then asks for another frame).
  function step(now: number) {
    const gap = now - ptr.t;
    const dt = gap > 100 ? 1 / 60 : Math.max(gap, 1) / 1000; // first frame after a rest: one nominal frame
    ptr.t = now;
    const px = ptr.x, py = ptr.y;
    const a = 1 - Math.exp(-dt / 0.07); // the shown pointer lags the real one by ~70 ms
    ptr.x += (ptr.tx - ptr.x) * a;
    ptr.y += (ptr.ty - ptr.y) * a;
    const h = window.innerHeight || 1, b = 1 - Math.exp(-dt / 0.1);
    let vx = (ptr.x - px) / dt / h, vy = -(ptr.y - py) / dt / h;
    const m = Math.hypot(vx, vy);
    if (m > 3) { vx *= 3 / m; vy *= 3 / m; }
    ptr.vx += (vx - ptr.vx) * b;
    ptr.vy += (vy - ptr.vy) * b;
    // wake: on while the pointer moved in the last 120 ms; light: on while it is over the page.
    const kt = ptr.inside && (pointer === 'light' || now - ptr.last < 120) ? 1 : 0;
    ptr.k += (kt - ptr.k) * (1 - Math.exp(-dt / (kt > ptr.k ? 0.08 : 0.15)));
    const busy = Math.abs(ptr.tx - ptr.x) + Math.abs(ptr.ty - ptr.y) > 0.3 || Math.abs(kt - ptr.k) > 0.01 ||
      Math.abs(ptr.vx) + Math.abs(ptr.vy) > 0.01 || (pointer === 'wake' && ptr.k > 0.01);
    if (!busy) { ptr.k = kt; ptr.vx = ptr.vy = 0; ptr.x = ptr.tx; ptr.y = ptr.ty; }
    return busy;
  }

  function draw(now: number) {
    raf = 0;
    if (lost || !showProg || document.hidden || stacked.matches) return;
    if (cam.open && !dirty) return; // a section page covers the world
    dirty = false;
    const more = !!pointer && step(now);
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
    if (!baked) { gl!.uniform1f(loc(showProg!, 'u_t'), speed * (p * 0.6 + drift * 0.25)); setPal(showProg!); }
    if (pointer) {
      // The canvas is fixed and full-viewport, so client coords map straight to canvas px (y flipped).
      const sx = canvas.width / (window.innerWidth || 1), sy = canvas.height / (window.innerHeight || 1);
      gl!.uniform2f(loc(showProg!, 'u_ptr'), ptr.x * sx, canvas.height - ptr.y * sy);
      gl!.uniform1f(loc(showProg!, 'u_pk'), reduced ? 0 : ptr.k); // reduced motion: the static base look
      gl!.uniform2f(loc(showProg!, 'u_pv'), ptr.vx, ptr.vy);
    }
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    window.__bgFrames!++;
    if (more) request();
  }
  function request() { if (!raf) raf = requestAnimationFrame(draw); }

  const offs: (() => void)[] = [];
  const on = (t: EventTarget, type: string, fn: EventListener) => { t.addEventListener(type, fn); offs.push(() => t.removeEventListener(type, fn)); };
  on(window, 'zoomcam', (e) => {
    cam = (e as CustomEvent<Cam>).detail || cam;
    if (reducedMq.matches) return; // one static frame
    const now = performance.now();
    // Ambient drift only advances while the camera moves (gaps between events are capped at 50 ms).
    if (lastEvt) drift += Math.min(now - lastEvt, 50) / 1000;
    lastEvt = now;
    if (!cam.open) request();
  });
  on(window, 'resize', () => { dirty = true; request(); });
  // Pointer variants: window-level, so it also reacts while the pointer is over the collage. Touch: no hover, the base look.
  on(window, 'pointermove', (e) => {
    const ev = e as PointerEvent;
    if (!pointer || ev.pointerType === 'touch' || reducedMq.matches) return;
    if (!ptr.inside && ptr.k < 0.01) { ptr.x = ev.clientX; ptr.y = ev.clientY; } // enter: start where it is
    ptr.tx = ev.clientX; ptr.ty = ev.clientY;
    ptr.inside = true;
    ptr.last = performance.now();
    if (!cam.open) request();
  });
  const leave = () => { if (pointer && ptr.inside) { ptr.inside = false; if (!cam.open) request(); } };
  on(document.documentElement, 'pointerleave', leave);
  on(window, 'blur', leave);
  // A theme switch: one redraw (a baked variant re-bakes its texture first).
  on(window, 'theme:change', (e) => { pal = (e as CustomEvent<{ colors: Theme }>).detail.colors; texW = texH = 0; dirty = true; request(); });
  on(document, 'visibilitychange', () => { if (!document.hidden) { dirty = true; request(); } });
  on(stacked, 'change', () => { dirty = true; request(); });
  on(reducedMq, 'change', () => { dirty = true; request(); });
  on(canvas, 'webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    document.documentElement.removeAttribute('data-bg');
    canvas.style.display = 'none';
  });

  function release() {
    if (shadeProg) gl!.deleteProgram(shadeProg);
    if (showProg && showProg !== shadeProg) gl!.deleteProgram(showProg);
    if (tex) gl!.deleteTexture(tex);
    if (fbo) gl!.deleteFramebuffer(fbo);
    shadeProg = showProg = tex = fbo = null;
    texW = texH = 0;
    locs.clear();
  }

  return {
    // Swap to a variant on this context; false if it does not compile (the caller then falls back to CSS).
    use(name: string, variant: BgVariant) {
      if (lost) return false;
      release();
      baked = !!variant.baked;
      pointer = baked ? undefined : variant.pointer;
      ptr.k = 0; ptr.vx = ptr.vy = 0; ptr.inside = false;
      speed = variant.speed ?? 1;
      shadeProg = compile(gl, HEAD + variant.frag + main(baked ? EXT : 1, !baked));
      showProg = baked ? compile(gl, DISPLAY) : shadeProg;
      if (!shadeProg || !showProg) return false;
      if (baked) { tex = gl.createTexture(); fbo = gl.createFramebuffer(); }
      canvas.style.imageRendering = variant.pixelated ? 'pixelated' : '';
      document.documentElement.setAttribute('data-bg', name);
      dirty = true;
      request();
      return true;
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      offs.forEach((f) => f()); // first, so losing the context on purpose is not handled as a loss
      release();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
      style.remove();
      document.documentElement.removeAttribute('data-bg');
    },
  };
}

let bg: ReturnType<typeof start> = null;
let want = '';
let req = 0;

function off() { if (bg) { bg.stop(); bg = null; } }

// No ?bg= = BG_DEF (ripple, for now); ?bg=flat = the flat CSS background.
const BG_DEF = 'ripple';
const pickBg = (v: string | null) => (v === null || v === '' ? BG_DEF : v === 'flat' ? '' : v);

// Switch the background to `name` ('' or unknown = the flat CSS background). Safe to call repeatedly.
export async function setBg(name: string) {
  if (!LOADERS[name]) name = '';
  if (name === want) return;
  want = name;
  const r = ++req;
  if (!name || !document.getElementById('zm-root')) { off(); return; }
  const variant = (await LOADERS[name]()).default;
  if (r !== req) return; // switched again while loading
  if (!bg) bg = start();
  if (bg && !bg.use(name, variant)) off();
}

// The Looks picker (scripts/looks.ts) switches it live.
window.addEventListener('looks:change', (e) => {
  const d = (e as CustomEvent<{ key: string; value: string }>).detail;
  if (d?.key === 'bg') setBg(pickBg(d.value)).catch(() => {});
});
setBg(pickBg(new URLSearchParams(location.search).get('bg'))).catch(() => {});
