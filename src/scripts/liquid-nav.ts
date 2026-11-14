// Liquid-glass looks for the section nav (#zm-hud), ported from two 21st.dev components (React -> plain TS):
//  - refraction ("lens", "water"): Aceternity's Liquid Glass (21st.dev/@manuarora700/components/liquid-glass).
//    A Snell's-law displacement map, generated here for the capsule's size, bends what is behind it through an
//    SVG filter used as a backdrop-filter, with chromatic fringes at the rim. Chromium only; others keep frost.
//  - water drop ("water"): gughigug's Liquid Glass Navbar (21st.dev/@gughigug/components/liquid-glass-navbar,
//    guglielmogiannattasio.it). A tiny WebGL shader draws a drop that springs to the current section, stretches,
//    splits into droplets on long jumps and merges back with a ripple. Turned vertical and lime here, and the
//    always-on ambient ripple is off: it only draws while the drop moves, so an idle page costs nothing.
//    Its lead blob moves with goo's spring and stretch (nav-styles.ts glider: stiffness 300, damping 20, stretched
//    along the capsule by speed), like every other nav style.
// Everything made here registers its undo with nav-styles' own()/listen(), so setNav() can switch styles live
// (the water drop's WebGL context is released with WEBGL_lose_context).

import { spring, stretch, GOO_K, GOO_C, initNavStyle, own, listen, navGen } from './nav-styles';
import { readTheme, themed, rgbOf } from './theme-vars';

const isSafari = () => /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR/.test(navigator.userAgent);
const urlBackdrop = () => typeof CSS !== 'undefined' && (CSS.supports('backdrop-filter', 'url(#x)') || CSS.supports('-webkit-backdrop-filter', 'url(#x)'));
const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ---------------- refraction map (Aceternity) ---------------- */
function sdRoundedBox(px: number, py: number, hw: number, hh: number, r: number) {
  const qx = Math.abs(px) - hw + r, qy = Math.abs(py) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
// Squircle-dome slope -> Snell's-law bend; x = 0 at the rim, 1 at the centre.
function bend(x: number) {
  const u = 1 - Math.min(1, Math.max(0, x)), den = (1 - u ** 4) ** 0.75;
  if (den < 1e-6) return 0;
  const ti = Math.atan(Math.min(u ** 3 / den, 8)), st = Math.sin(ti) / 1.5;
  return st >= 1 ? Math.sin(ti) : Math.sin(ti - Math.asin(st));
}
function displacementMap(w: number, h: number, radius: number, bevelDepth: number, dpr: number) {
  const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr)), hw = W / 2, hh = H / 2;
  const r = Math.min(radius * dpr, hw, hh), bevel = Math.max(1, bevelDepth * dpr), gain = 1.35;
  const n = Math.ceil(bevel), phi = new Float32Array(n + 1);
  for (let d = 1; d <= n; d++) phi[d] = phi[d - 1] + bend(d / n);
  const samplePhi = (depth: number) => {
    if (depth <= 0) return phi[0];
    if (depth >= n) return phi[n];
    const i = Math.floor(depth), f = depth - i;
    return phi[i] * (1 - f) + phi[i + 1] * f;
  };
  const field = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = sdRoundedBox(x - hw + 0.5, y - hh + 0.5, hw, hh, r);
    field[y * W + x] = d > 0 ? 0 : samplePhi(Math.min(bevel, -d));
  }
  const ll = Math.hypot(-0.55, -0.85), lx = -0.55 / ll, ly = -0.85 / ll;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const py = y - hh + 0.5;
    for (let x = 0; x < W; x++) {
      const px = x - hw + 0.5, i = (y * W + x) << 2, d = sdRoundedBox(px, py, hw, hh, r);
      if (d > 0) { data[i] = data[i + 1] = data[i + 2] = 128; data[i + 3] = 0; continue; }
      const x0 = Math.max(0, x - 1), x1 = Math.min(W - 1, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(H - 1, y + 1);
      const dx = Math.max(-1, Math.min(1, (field[y * W + x1] - field[y * W + x0]) / (x1 - x0 || 1) * gain));
      const dy = Math.max(-1, Math.min(1, (field[y1 * W + x] - field[y0 * W + x]) / (y1 - y0 || 1) * gain));
      let spec = 0;
      if (d >= -bevel) {
        const gx = sdRoundedBox(px + 1, py, hw, hh, r) - sdRoundedBox(px - 1, py, hw, hh, r);
        const gy = sdRoundedBox(px, py + 1, hw, hh, r) - sdRoundedBox(px, py - 1, hw, hh, r);
        const len = Math.hypot(gx, gy) || 1, dot = (gx / len) * lx + (gy / len) * ly, rim = 1 - Math.min(1, -d / bevel);
        spec = (Math.max(0, dot) + Math.max(0, -dot) * 0.35) * rim;
      }
      data[i] = 128 + dx * 127; data[i + 1] = 128 + dy * 127; data[i + 2] = Math.round(spec * 255); data[i + 3] = 255;
    }
  }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.getContext('2d')!.putImageData(new ImageData(data, W, H), 0, 0);
  return new Promise<string>((res) => c.toBlob((b) => res(b ? URL.createObjectURL(b) : ''), 'image/png'));
}
async function refract(hud: HTMLElement) {
  if (isSafari() || !urlBackdrop()) return;
  const g = navGen(); // the map is made asynchronously: drop it if the style was switched meanwhile
  const w = hud.offsetWidth, h = hud.offsetHeight;
  if (!w || !h) return;
  const scale = 30, ab = 5, frost = 0.4;
  const url = await displacementMap(w, h, Math.min(w, h) / 2, Math.min(16, Math.min(w, h) / 2), Math.min(window.devicePixelRatio || 1, 2));
  if (!url) return;
  if (g !== navGen()) { URL.revokeObjectURL(url); return; }
  own(() => URL.revokeObjectURL(url));
  await new Promise<void>((r) => { const i = new Image(); i.onload = i.onerror = () => r(); i.src = url; });
  if (g !== navGen()) return;
  const id = `lg-map-${w}x${h}`, pad = scale + ab + 4, px = (pad / w) * 100, py = (pad / h) * 100;
  const disp = (s: number, out: string) => `<feDisplacementMap in="SourceGraphic" in2="map" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="${out}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">
<filter id="${id}" color-interpolation-filters="sRGB" x="-${px.toFixed(2)}%" y="-${py.toFixed(2)}%" width="${(100 + 2 * px).toFixed(2)}%" height="${(100 + 2 * py).toFixed(2)}%">
<feImage href="${url}" x="0" y="0" width="${w}" height="${h}" result="map" preserveAspectRatio="none"/>
${disp(scale + ab, 'dR')}<feColorMatrix in="dR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"/>
${disp(scale, 'dG')}<feColorMatrix in="dG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green"/>
${disp(scale - ab, 'dB')}<feColorMatrix in="dB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue"/>
<feBlend in="red" in2="green" mode="screen" result="rg"/><feBlend in="rg" in2="blue" mode="screen" result="rgb"/>
<feGaussianBlur in="rgb" stdDeviation="${frost}"/></filter></svg>`;
  hud.insertAdjacentHTML('beforeend', svg);
  const el = hud.lastElementChild as Element;
  own(() => el.remove());
  hud.style.setProperty('--lg-filter', `url(#${id}) blur(0.5px) saturate(1.85) brightness(1.06)`);
  hud.classList.add('lg-refract');
}

/* ---------------- water drop (gughigug), vertical ---------------- */
// Drop colours (sRGB 0..1): its shadow, body tint and rim. The default theme keeps the original lime values; a colour
// theme (scripts/theme.ts) derives them from its accent and page background.
function waterColors() {
  if (!themed()) return { sh: [0.01, 0.05, 0.01], tint: [0.78, 0.98, 0.52], lc: [0.45, 0.75, 0.16] };
  const c = readTheme(), f = (h: string, k: number, to: number) => rgbOf(h).map((v) => (v / 255) * (1 - k) + to * k);
  return { sh: f(c.bg, 0.4, 0), tint: f(c.accent, 0.25, 1), lc: f(c.accent, 0.3, 0) };
}
const PAD = 14;
const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
// The original shader, laid along the capsule: p.yx turns the vertical capsule into its horizontal pill space.
const FRAG = `precision highp float;
uniform vec2 uRes;uniform float uDpr;uniform float uTime;uniform vec4 uPill;
uniform vec4 uBlob[6];uniform float uSy[6];uniform vec4 uRip[6];uniform vec3 uSh,uTint,uLc;
float sdRB(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float sdCap(vec2 p,vec4 B,float sy){p-=B.xy;p.y/=sy;p.x=max(abs(p.x)-B.z,0.);return(length(p)-B.w)*min(1.,sy);}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float dropD(vec2 p){float d=1e4;for(int i=0;i<6;i++){if(uBlob[i].w>.5){d=smin(d,sdCap(p,uBlob[i],uSy[i]),10.);}}return d;}
float pillD(vec2 p){vec2 h=uPill.zw*.5;return sdRB(p-uPill.xy-h,h,h.y);}
float lens(float d,float w){float t=clamp(-d/w,0.,1.);return sqrt(1.-(1.-t)*(1.-t));}
float waves(vec2 p){float w=0.;for(int i=0;i<6;i++){vec4 R=uRip[i];if(R.w>0.){float x=length(p-R.xy)-R.z*240.;w+=R.w*exp(-R.z*1.7)*sin(x*.3)*exp(-x*x/700.);}}return w;}
float H(vec2 p){float dp=pillD(p);return lens(dp,uPill.w*.36)*2.4+lens(dropD(p),9.)*7.5+waves(p)*smoothstep(0.,7.,-dp);}
float caus(vec2 p,float t){vec2 q=p;float c=0.;for(int i=0;i<3;i++){q+=vec2(sin(q.y*1.1+t),cos(q.x*1.3-t*.7))*.6;c+=1./(1.+16.*abs(sin(q.x)*sin(q.y)));}return c/3.;}
void main(){
 vec2 p=vec2(gl_FragCoord.x,uRes.y*uDpr-gl_FragCoord.y)/uDpr;p=p.yx;
 float dp=pillD(p);float dd=dropD(p);
 float h0=H(p);vec3 n=normalize(vec3(h0-H(p+vec2(1.,0.)),h0-H(p+vec2(0.,1.)),1.));
 vec3 V=vec3(0.,0.,1.);
 float spec=pow(max(dot(reflect(-normalize(vec3(-.45,-.8,.85)),n),V),0.),70.);
 float spec2=pow(max(dot(reflect(-normalize(vec3(.6,.75,.7)),n),V),0.),22.)*.3;
 float fres=clamp((1.-n.z)*4.,0.,1.);
 vec3 irid=.5+.5*cos(6.2831*(vec3(0.,.33,.67)+fres*.85+p.x*.0028+uTime*.035));
 float pm=smoothstep(1.,-1.,dp);float dm=smoothstep(1.,-1.,dd)*smoothstep(1.,-2.,dp);
 float sh=smoothstep(9.,-9.,dropD(p-vec2(0.,5.)))*(1.-dm)*pm*.18;
 vec3 c=uSh*sh;float a=sh;
 float pa=clamp(pm*(fres*.5+spec*.9+spec2),0.,1.);
 c=mix(vec3(1.),irid,.5*fres)*pa+c*(1.-pa);a=pa+a*(1.-pa);
 float th=lens(dd,9.);
 float cs=caus((p+n.xy*th*18.)*.085,uTime*.9);
 vec3 tint=uTint;
 float rim=dm*(1.-smoothstep(0.,7.,-dd));
 float cres=dm*smoothstep(.12,.55,dot(n.xy,normalize(vec2(.55,.85))))*smoothstep(0.,3.,-dd);
 float body=.5+.5*clamp(-n.y*3.,-1.,1.);
 float da=dm*(.52+.2*body);vec3 dc=mix(tint,vec3(1.),body*.5);
 float la=rim*.3;vec3 lc=uLc;dc=lc*la+dc*da*(1.-la);da=la+da*(1.-la);
 la=clamp(cres*.7+smoothstep(.6,1.,cs)*.28*th*dm,0.,1.);dc=vec3(1.)*la+dc*(1.-la);da=la+da*(1.-la);
 la=clamp(dm*(spec*1.2+spec2*.5),0.,1.);dc=vec3(1.)*la+dc*(1.-la);da=la+da*(1.-la);
 la=dm*smoothstep(-2.,0.,dd)*.4;dc=mix(vec3(1.),irid,.35)*la+dc*(1.-la);da=la+da*(1.-la);
 c=dc+c*(1.-da);a=da+a*(1.-da);
 gl_FragColor=vec4(c,a);
}`;

function initGL(cv: HTMLCanvasElement) {
  const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  gl.useProgram(p);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const n of ['uRes', 'uDpr', 'uTime', 'uPill', 'uBlob', 'uSy', 'uRip', 'uSh', 'uTint', 'uLc']) u[n] = gl.getUniformLocation(p, n);
  return { gl, u };
}

function water(hud: HTMLElement) {
  const ul = hud.querySelector('ul'), lis = Array.from(hud.querySelectorAll<HTMLElement>('ul > li'));
  const dots = Array.from(hud.querySelectorAll<HTMLElement>('[data-dot]'));
  if (!ul || !lis.length) return false;
  const cv = document.createElement('canvas');
  cv.className = 'lq-water';
  cv.setAttribute('aria-hidden', 'true');
  hud.prepend(cv);
  const glc = initGL(cv);
  if (!glc) { cv.remove(); return false; }
  // Undo (runs after the listeners below are removed, so losing the context on purpose is not a fallback).
  own(() => { if (s.raf) cancelAnimationFrame(s.raf); s.raf = 0; glc.gl.getExtension('WEBGL_lose_context')?.loseContext(); cv.remove(); });
  const reduce = reduceMotion();
  let cols = waterColors();
  // Positions are along the capsule (top to bottom) in canvas px; cy is the capsule's middle across.
  const s = {
    a: { x: 0, v: 0 }, b: { x: 0, v: 0 }, sy: { s: 1 }, lead: 0, lagFrom: 0,
    sats: [] as { x: number; y: number; vx: number; vy: number; r: number; k: number }[],
    rips: [] as { x: number; y: number; age: number; amp: number }[],
    tx: 0, cy: 0, r: 11, on: 0, onT: 0, moving: false, split: false, ready: false,
    w: 0, h: 0, raf: 0, last: 0, time: 0, cur: -1,
  };
  const measure = () => {
    s.w = hud.offsetWidth; s.h = hud.offsetHeight; s.cy = PAD + s.w / 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = s.w + PAD * 2, Hh = s.h + PAD * 2;
    cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr);
    cv.style.width = `${W}px`; cv.style.height = `${Hh}px`;
  };
  const centre = (i: number) => {
    const li = lis[i];
    let y = li.offsetTop + li.offsetHeight / 2, n = li.offsetParent as HTMLElement | null;
    while (n && n !== hud) { y += n.offsetTop; n = n.offsetParent as HTMLElement | null; }
    return PAD + y;
  };
  const draw = () => {
    const { gl, u } = glc, sep = Math.abs(s.a.x - s.b.x), thin = Math.min(sep / (2 * s.r || 1), 1), dpr = Math.min(window.devicePixelRatio || 1, 2);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(u.uRes, s.w + PAD * 2, s.h + PAD * 2);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1f(u.uTime, s.time);
    // swapped space: the pill runs along x for its height, across y for its width
    gl.uniform4f(u.uPill, PAD, PAD, s.h, s.w);
    const blobs = new Float32Array(24), sy = new Float32Array(6).fill(1), r = s.r * s.on;
    const head = s.lead === 0 ? s.a : s.b, tail = s.lead === 0 ? s.b : s.a;
    // s.sy.s is goo's stretch: the head capsule lengthens along the nav by it and thins across by 1/sqrt of it
    const st = s.sy.s, rh = r * (1 - 0.12 * thin);
    if (r > 0.6) blobs.set([head.x, s.cy, rh * (st - 1), rh, tail.x, s.cy, 0, r * (1 - 0.5 * thin)], 0);
    sy[0] = sy[1] = 1 / Math.sqrt(st);
    s.sats.slice(0, 4).forEach((d, i) => blobs.set([d.x, d.y, 0, d.r], 8 + i * 4));
    gl.uniform4fv(u.uBlob, blobs);
    gl.uniform1fv(u.uSy, sy);
    const rips = new Float32Array(24);
    s.rips.slice(-6).forEach((p, i) => rips.set([p.x, p.y, p.age, p.amp], i * 4));
    gl.uniform4fv(u.uRip, rips);
    gl.uniform3fv(u.uSh, cols.sh); gl.uniform3fv(u.uTint, cols.tint); gl.uniform3fv(u.uLc, cols.lc);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const step = (dt: number, now: number) => {
    s.time += dt;
    s.on += (s.onT - s.on) * Math.min(1, dt * 10);
    let still = Math.abs(s.on - s.onT) < 0.01;
    if (reduce) { s.a.x = s.b.x = s.tx; s.a.v = s.b.v = 0; s.sy.s = 1; s.sats = []; }
    else {
      [s.a, s.b].forEach((B, i) => {
        const lead = i === s.lead;
        if (lead) spring(B, s.tx, GOO_K, GOO_C, 1, dt);
        else { const f = now < s.lagFrom ? 0.08 : 1; B.v += (72 * (s.tx - B.x) - 13 * B.v) * dt * f; B.x += B.v * dt; }
        const lo = PAD + 4 + s.r - 3, hi = PAD + s.h - 4 - s.r + 3;
        if (B.x < lo || B.x > hi) { B.x = Math.max(lo, Math.min(hi, B.x)); B.v *= -0.25; }
        if (Math.abs(s.tx - B.x) > 0.3 || Math.abs(B.v) > 3) still = false;
      });
      // goo's stretch: longer along the capsule, thinner across, by the lead blob's speed
      s.sy.s = stretch((s.lead === 0 ? s.a : s.b).v);
      const sep = Math.abs(s.a.x - s.b.x), r = s.r * (1 - 0.3 * Math.min(sep / (2 * s.r || 1), 1));
      if (!s.split && s.moving && sep - 2 * r > -6) {
        s.split = true;
        const lo = s.lead === 0 ? s.b : s.a, hi = s.lead === 0 ? s.a : s.b;
        [0.3, 0.5, 0.72].forEach((t, j) => s.sats.push({ x: lo.x + (hi.x - lo.x) * t + (Math.random() - 0.5) * 6, y: s.cy + (Math.random() - 0.5) * 6, vx: (lo.v + hi.v) * 0.45, vy: (Math.random() - 0.5) * 40, r: 4 + Math.random() * 2 - j * 0.4, k: 70 + Math.random() * 90 }));
      }
      s.sats = s.sats.filter((d) => {
        d.vx += (d.k * (s.tx - d.x) - 9 * d.vx) * dt; d.vy += (90 * (s.cy - d.y) - 7 * d.vy) * dt;
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.x = Math.max(PAD + 6 + d.r, Math.min(PAD + s.h - 6 - d.r, d.x));
        d.y = Math.max(s.cy - s.r + d.r, Math.min(s.cy + s.r - d.r, d.y));
        if (Math.abs(s.tx - d.x) < s.r * 0.5) d.r -= dt * 26;
        return d.r > 0.6;
      });
      if (s.sats.length) still = false;
    }
    if (s.moving && still) { s.moving = false; if (!reduce) s.rips.push({ x: s.tx, y: s.cy, age: 0, amp: s.split ? 1.1 : 0.6 }); }
    s.rips.forEach((p) => (p.age += dt));
    s.rips = s.rips.filter((p) => p.age < 2.4);
    return still && !s.moving && !s.rips.length && !s.sats.length;
  };
  const loop = () => {
    if (s.raf || document.hidden) return;
    s.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - s.last) / 1000, 1 / 30);
      s.last = now;
      const done = step(dt, now);
      draw();
      s.raf = done ? 0 : requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
  };
  const go = (i: number) => {
    if (i === s.cur && s.ready) return;
    s.cur = i;
    if (i < 0) { s.onT = 0; loop(); return; }
    const nx = centre(i);
    s.onT = 1;
    if (!s.ready || s.on < 0.05) { s.a.x = s.b.x = s.tx = nx; s.a.v = s.b.v = 0; s.ready = true; }
    else if (Math.abs(nx - s.tx) > 0.5) {
      s.lead = Math.abs(nx - s.a.x) <= Math.abs(nx - s.b.x) ? 0 : 1;
      s.lagFrom = performance.now() + 70; s.moving = true; s.split = false; s.tx = nx;
    }
    loop();
  };
  // A theme switch: new drop colours, one redraw.
  listen(window, 'theme:change', () => { cols = waterColors(); draw(); });
  const current = () => dots.findIndex((d) => d.getAttribute('aria-current') === 'true');
  measure();
  draw();
  go(current());
  const mo = new MutationObserver(() => go(current()));
  mo.observe(ul, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  own(() => mo.disconnect());
  listen(cv, 'webglcontextlost', (e) => { e.preventDefault(); cv.remove(); hud.dataset.nav = 'drop'; initNavStyle(hud); });
  hud.classList.add('lq-on');
  return true;
}

export function initLiquidNav(hud: HTMLElement) {
  const mode = hud.dataset.nav;
  if (mode === 'water' && !water(hud)) { hud.dataset.nav = 'drop'; initNavStyle(hud); } // no WebGL: the CSS glass bead
  if (mode === 'lens' || mode === 'water') refract(hud);
}
