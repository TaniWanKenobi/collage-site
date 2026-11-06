// Stylized "cel + ink" look for the CAD models, shared by the home-page runtime (model-stage.ts), the lab viewer,
// the poster renderer (scripts/models/render.html) and the offline bake (scripts/models/stylize-bake.mjs).
// Plain JS (with JSDoc) so the browser page and Node can import it without a build step.
//
// What a baked GLB (stylize-bake.mjs) carries:
//   - one triangle primitive per kind of surface (all opaque untextured parts share one), with
//       COLOR_0 = (palette colour, linear) + baked ambient occlusion in alpha,
//       _ORIG   = (original CAD colour, linear) + a flag in alpha (0 = screen: drawn flat, unlit);
//   - one LINES primitive with the crease edges (same two attributes, for the ink colour choice).
// Files that are not baked (lab drops) get the same look at runtime: palette per material, edges from
// EdgesGeometry, no AO.
import {
  Color, ShaderMaterial, MeshStandardMaterial, LineSegments, EdgesGeometry, Mesh, PlaneGeometry,
  MeshBasicMaterial, CanvasTexture, Vector3, Box3, SRGBColorSpace,
} from 'three';

// ---------- palette (section d of the spec: hue-snap, keep lightness order, in OKLCH) ----------
export const LADDERS = {
  grape: ['#2B2640', '#3E3762', '#564D80', '#8F86C0', '#C9C3E6'],
  lime: ['#4F6B2A', '#86B04A', '#C2F970', '#E0FCB0'],
  neutral: ['#1C2619', '#3A4436', '#6E7868', '#EFFDD8'],
};
const L_FLOOR = 0.3; // every part stays >= 0.12 OK-lightness above the onyx background (L 0.17)

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgbHex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

/** sRGB [0..1] -> OKLCH [L, C, h°] */
export function oklch([r, g, b]) {
  [r, g, b] = [r, g, b].map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
/** OKLCH -> sRGB [0..1] (clipped) */
export function fromOklch([L, C, h]) {
  const A = C * Math.cos((h * Math.PI) / 180), B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => toSrgb(Math.min(1, Math.max(0, v))));
}

/**
 * Map CAD colours onto the site ladders.
 * @param {{key: string, rgb: number[], area: number, hint?: string}[]} parts  sRGB colours with their surface area
 * @param {{heroMax?: number}} [opt]  heroMax: the biggest saturated group turns lime only if it covers less than this share
 * @returns {Map<string, {hex: string, cls: string}>}
 */
export function paletteMap(parts, opt = {}) {
  const heroMax = opt.heroMax ?? 0.3;
  const total = parts.reduce((a, p) => a + p.area, 0) || 1;
  const info = parts.map((p) => {
    const [L, C, h] = oklch(p.rgb);
    let cls = C < 0.06 ? 'neutral' : h >= 60 && h <= 200 ? 'lime' : 'grape';
    if (p.hint === 'lime' || p.hint === 'grape' || p.hint === 'neutral') cls = p.hint;
    return { ...p, L, C, h, cls };
  });
  // The largest saturated group is the hero: lime accent, unless it is a big shell (lime stays an accent).
  const groups = {};
  for (const p of info) if (p.cls !== 'neutral') groups[p.cls + Math.round(p.h / 30)] = (groups[p.cls + Math.round(p.h / 30)] || 0) + p.area;
  const hero = Object.entries(groups).sort((a, b) => b[1] - a[1])[0];
  if (hero && hero[1] / total < heroMax) for (const p of info) if (p.cls !== 'neutral' && p.cls + Math.round(p.h / 30) === hero[0] && !p.hint) { p.cls = 'lime'; p.hero = true; }
  // Lime is capped near 25% of the area: the biggest lime parts beyond that fall back to grape.
  let lime = 0;
  for (const p of [...info].filter((x) => x.cls === 'lime').sort((a, b) => a.area - b.area)) {
    if (!p.hint && (lime + p.area) / total > 0.28) p.cls = 'grape'; else lime += p.area;
  }
  const out = new Map();
  for (const cls of Object.keys(LADDERS)) {
    const ladder = LADDERS[cls].map((hex) => oklch(hexRgb(hex)));
    const members = info.filter((p) => p.cls === cls).sort((a, b) => a.L - b.L);
    // Nearest ladder step by lightness (never darker than the previous, lighter part). Parts that share a
    // step are spread over +-0.05 lightness in their original order, so distinct parts stay distinct.
    const steps = new Map();
    let prevStep = 0;
    for (const p of members) {
      // The hero is the accent itself: it lands on the bright end of the lime ladder. Big parts (shells,
      // frames) stay mid-tone or lighter so they never read as a dark hole against the onyx page.
      const minL = p.hero ? 0.62 : p.area / total >= 0.08 ? 0.45 : 0;
      let step = 0, best = 9;
      ladder.forEach((s, i) => { const d = Math.abs(s[0] - Math.max(p.L, minL)) + (s[0] < minL ? 9 : 0); if (d < best) { best = d; step = i; } });
      if (!p.hero && !minL) { step = Math.max(step, prevStep); prevStep = step; }
      if (!steps.has(step)) steps.set(step, []);
      steps.get(step).push(p);
    }
    for (const [step, list] of steps) {
      const [L0, C0, h0] = ladder[step];
      const k = list.length, span = k > 1 ? 0.1 : 0;
      // keep the spread inside [floor, 0.97] by sliding it rather than clipping (clipping would merge colours)
      const lo = Math.min(Math.max(L0 - span / 2, L_FLOOR), 0.97 - span);
      list.forEach((p, i) => {
        const L = k > 1 ? lo + (span * i) / (k - 1) : Math.max(L0, L_FLOOR);
        const screen = p.hint === 'screen';
        out.set(p.key, { hex: screen ? '#C2F970' : rgbHex(fromOklch([L, C0, h0])), cls: screen ? 'screen' : cls });
      });
    }
  }
  return out;
}

// ---------- styles ----------
// All uniforms are shared objects: switching style (or tuning a value) touches every material at once.
const col = (h) => new Color(h);
export const STYLES = {
  // The chosen look: 3 hard bands, lime-tint rim on the lit side, one spec band, soft baked AO, onyx ink
  // (lime ink on the darkest parts).
  'cel+ink': {
    steps: [0.5, 0.8, 1.0], cuts: [0.42, 0.66], soft: 0.012, fill: 0.22, aoMin: 0.62, palK: 1, pastel: 0,
    rim: 0.45, rimEdge: [0.6, 0.68], spec: 0.16, specCut: 0.975, specSoft: 0.004, sil: 0,
    ink: '#0D160B', inkAlt: '#C2F970', inkAlpha: 0.9, inkAltAlpha: 0.45, darkLum: 0.06, lines: true,
  },
  // Alternate: punchier: deeper shadow band, heavier rim, more ink on dark parts, full-strength palette.
  'cel+ink bold': {
    steps: [0.38, 0.72, 1.05], cuts: [0.45, 0.7], soft: 0.006, fill: 0.18, aoMin: 0.5, palK: 1, pastel: 0,
    rim: 0.65, rimEdge: [0.58, 0.64], spec: 0.28, specCut: 0.985, specSoft: 0.002, sil: 0.6,
    ink: '#0D160B', inkAlt: '#C2F970', inkAlpha: 1, inkAltAlpha: 0.6, darkLum: 0.06, lines: true,
  },
  // Alternate: softer palette (CAD colours 50% through), lighter ink.
  'cel+ink soft': {
    steps: [0.58, 0.84, 1.0], cuts: [0.4, 0.64], soft: 0.03, fill: 0.25, aoMin: 0.66, palK: 0.55, pastel: 0,
    rim: 0.35, rimEdge: [0.62, 0.72], spec: 0.1, specCut: 0.975, specSoft: 0.01, sil: 0,
    ink: '#172315', inkAlt: '#C2F970', inkAlpha: 0.6, inkAltAlpha: 0.3, darkLum: 0.06, lines: true,
  },
  // Spec (e) alternative 1: designer-toy clay. Smooth wrap light, strong AO, broad soft rim, pastel, no lines.
  clay: {
    steps: [0.42, 0.8, 1.04], cuts: [0.3, 0.75], soft: 0.25, fill: 0.28, aoMin: 0.4, palK: 1, pastel: 0.35,
    rim: 0.35, rimEdge: [0.4, 0.9], spec: 0.12, specCut: 0.8, specSoft: 0.15, sil: 0,
    ink: '#0D160B', inkAlt: '#C2F970', inkAlpha: 0, inkAltAlpha: 0, darkLum: 0.06, lines: false,
  },
};
export const STYLE_NAMES = [...Object.keys(STYLES), 'original'];
export const DEFAULT_STYLE = 'cel+ink';

const U = {
  uKey: { value: new Vector3(-0.42, 0.72, 0.55).normalize() }, // view space: upper left, towards the camera
  uSteps: { value: new Vector3() }, uCuts: { value: [0, 0] }, uSoft: { value: 0 },
  uSky: { value: col('#8F86C0') }, uGround: { value: col('#263424') }, uFill: { value: 0 },
  uRimCol: { value: col('#EFFDD8') }, uRim: { value: 0 }, uRimEdge: { value: [0, 0] },
  uSpec: { value: 0 }, uSpecCut: { value: 0 }, uSpecSoft: { value: 0 },
  uAOMin: { value: 0 }, uPalK: { value: 1 }, uPastel: { value: 0 }, uSil: { value: 0 },
  uInk: { value: col('#0D160B') }, uInkAlt: { value: col('#C2F970') }, uInkAlpha: { value: 1 }, uInkAltAlpha: { value: 1 },
  uDarkLum: { value: 0.06 }, uLineFade: { value: 1 },
};
let current = DEFAULT_STYLE;
/** Point every toon material at a style's parameters (cheap: uniforms only). */
export function setStyle(name) {
  const s = STYLES[name] || STYLES[DEFAULT_STYLE];
  current = STYLES[name] ? name : DEFAULT_STYLE;
  U.uSteps.value.set(...s.steps); U.uCuts.value = s.cuts; U.uSoft.value = s.soft; U.uFill.value = s.fill;
  U.uRim.value = s.rim; U.uRimEdge.value = s.rimEdge; U.uSpec.value = s.spec; U.uSpecCut.value = s.specCut; U.uSpecSoft.value = s.specSoft;
  U.uAOMin.value = s.aoMin; U.uPalK.value = s.palK; U.uPastel.value = s.pastel; U.uSil.value = s.sil;
  U.uInk.value.set(s.ink); U.uInkAlt.value.set(s.inkAlt); U.uInkAlpha.value = s.inkAlpha; U.uInkAltAlpha.value = s.inkAltAlpha; U.uDarkLum.value = s.darkLum;
  return s;
}
setStyle(DEFAULT_STYLE);
/** Line opacity multiplier (fades ink on very small slots so it does not turn into hatching). */
export const setLineFade = (v) => { U.uLineFade.value = v; };

const VS_SURF = /* glsl */ `
  #ifdef VCOL
  attribute vec4 color; attribute vec4 _orig;
  #else
  uniform vec3 uPal, uOrigC;
  #endif
  #ifdef TMAP
  varying vec2 vUv;
  #endif
  varying vec3 vN, vNw, vV, vPal, vOrig; varying float vAO, vFlag;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalMatrix * normal; vNw = mat3(modelMatrix) * normal; vV = -mv.xyz;
    #ifdef VCOL
    vPal = color.rgb; vAO = color.a; vOrig = _orig.rgb; vFlag = _orig.a;
    #else
    vPal = uPal; vOrig = uOrigC; vAO = 1.0; vFlag = 1.0;
    #endif
    #ifdef TMAP
    vUv = uv;
    #endif
    gl_Position = projectionMatrix * mv;
  }`;
const FS_SURF = /* glsl */ `
  uniform vec3 uKey, uSteps, uSky, uGround, uRimCol; uniform vec2 uCuts, uRimEdge;
  uniform float uSoft, uFill, uRim, uSpec, uSpecCut, uSpecSoft, uAOMin, uPalK, uPastel, uSil, uAlpha;
  #ifdef TMAP
  uniform sampler2D map; uniform vec3 uLo, uHi; varying vec2 vUv;
  #endif
  varying vec3 vN, vNw, vV, vPal, vOrig; varying float vAO, vFlag;
  void main() {
    vec3 v = normalize(vV);
    vec3 n = normalize(vN);
    n = faceforward(n, -v, n); // CAD parts are double-sided: light the side we see
    vec3 base = mix(vOrig, vPal, uPalK);
    #ifdef TMAP
    vec3 tx = texture2D(map, vUv).rgb;
    float lum = dot(tx, vec3(0.2126, 0.7152, 0.0722));
    base = mix(tx, mix(uLo, uHi, smoothstep(0.0, 0.6, sqrt(lum))), uPalK);
    #endif
    base = mix(base, vec3(1.0), uPastel);
    if (vFlag < 0.5) { gl_FragColor = vec4(base, uAlpha); }
    else {
      float hl = dot(n, uKey) * 0.5 + 0.5; // half-Lambert: the shadow side is never black
      float b = mix(uSteps.x, uSteps.y, smoothstep(uCuts.x - uSoft, uCuts.x + uSoft, hl));
      b = mix(b, uSteps.z, smoothstep(uCuts.y - uSoft, uCuts.y + uSoft, hl));
      float ao = mix(uAOMin, 1.0, vAO);
      vec3 fill = mix(uGround, uSky, normalize(vNw).y * 0.5 + 0.5) * uFill;
      vec3 c = base * (b + fill) * ao;
      float ndv = max(dot(n, v), 0.0);
      c *= 1.0 - uSil * smoothstep(0.32, 0.18, ndv);
      c += uRimCol * uRim * smoothstep(uRimEdge.x, uRimEdge.y, 1.0 - ndv) * smoothstep(0.4, 0.7, hl);
      c += uSpec * smoothstep(uSpecCut, uSpecCut + uSpecSoft, dot(n, normalize(uKey + v))) * ao;
      gl_FragColor = vec4(c, uAlpha);
    }
    #include <colorspace_fragment>
  }`;
const VS_LINE = /* glsl */ `
  #ifdef VCOL
  attribute vec4 color;
  #else
  uniform vec3 uPal;
  #endif
  varying float vDark;
  void main() {
    #ifdef VCOL
    vec3 p = color.rgb;
    #else
    vec3 p = uPal;
    #endif
    vDark = dot(p, vec3(0.2126, 0.7152, 0.0722));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const FS_LINE = /* glsl */ `
  uniform vec3 uInk, uInkAlt; uniform float uInkAlpha, uInkAltAlpha, uDarkLum, uLineFade;
  varying float vDark;
  void main() {
    bool alt = vDark < uDarkLum;
    gl_FragColor = vec4(alt ? uInkAlt : uInk, (alt ? uInkAltAlpha : uInkAlpha) * uLineFade);
    #include <colorspace_fragment>
  }`;

/** A toon surface material. Pass `pal`/`orig` (hex) for meshes without baked colours. */
export function toonMaterial({ vcol = true, map = null, lo = '#4F6B2A', hi = '#EFFDD8', pal = '#8F86C0', orig = '#8F86C0', alpha = 1 } = {}) {
  const defines = {};
  if (vcol) defines.VCOL = '';
  if (map) defines.TMAP = '';
  const m = new ShaderMaterial({
    defines,
    uniforms: { ...U, uAlpha: { value: alpha }, map: { value: map }, uLo: { value: col(lo) }, uHi: { value: col(hi) }, uPal: { value: col(pal) }, uOrigC: { value: col(orig) } },
    vertexShader: VS_SURF, fragmentShader: FS_SURF,
    transparent: alpha < 1, depthWrite: alpha >= 1,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, // the ink lines win the depth test
  });
  m.userData.toon = true;
  return m;
}
export function inkMaterial({ vcol = true, pal = '#8F86C0' } = {}) {
  const m = new ShaderMaterial({
    defines: vcol ? { VCOL: '' } : {},
    uniforms: { ...U, uPal: { value: col(pal) } },
    vertexShader: VS_LINE, fragmentShader: FS_LINE, transparent: true, depthWrite: false,
  });
  m.userData.toon = true;
  return m;
}

// ---------- applying a style to a loaded scene ----------
const srgbOf = (c) => [toSrgb(c.r), toSrgb(c.g), toSrgb(c.b)];
const triArea = (g) => {
  const p = g.attributes.position, idx = g.index, n = idx ? idx.count : p.count;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let s = 0;
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(p, idx ? idx.getX(i) : i); b.fromBufferAttribute(p, idx ? idx.getX(i + 1) : i + 1); c.fromBufferAttribute(p, idx ? idx.getX(i + 2) : i + 2);
    s += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return s;
};
const shared = { ink: null, surf: null };

/**
 * Give a loaded model the toon materials once (keeps the file's own materials in userData.orig for 'original').
 * Baked files reuse two shared programs; unbaked files get per-material palette colours and runtime edges.
 * @param {import('three').Object3D} root
 * @param {{edges?: boolean, angle?: number}} [opt]
 */
export function prepare(root, opt = {}) {
  if (root.userData.toonReady) return root;
  root.userData.toonReady = true;
  const meshes = [];
  root.traverse((o) => { if (o.isMesh || o.isLineSegments) meshes.push(o); });
  const baked = meshes.some((o) => o.geometry.attributes._orig);
  if (baked) {
    shared.surf ??= toonMaterial();
    shared.ink ??= inkMaterial();
    for (const o of meshes) {
      o.userData.orig = o.material;
      if (o.isLineSegments) { o.material = shared.ink; o.userData.ink = true; o.renderOrder = 1; continue; }
      const src = o.material, map = src.map || null;
      const ex = src.userData?.toon || {};
      o.material = map || src.transparent ? toonMaterial({ map, lo: ex.lo, hi: ex.hi, alpha: src.transparent ? src.opacity : 1 }) : shared.surf;
    }
    return root;
  }
  // Unbaked: palette per source material, measured by surface area.
  const parts = new Map();
  for (const o of meshes) {
    if (!o.isMesh) continue;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const area = triArea(o.geometry) / mats.length;
    for (const m of mats) {
      const c = m.color || new Color(1, 1, 1), key = m.uuid;
      const p = parts.get(key) || { key, rgb: srgbOf(c), area: 0 };
      p.area += area; parts.set(key, p);
    }
  }
  const pal = paletteMap([...parts.values()]);
  for (const o of meshes) {
    if (!o.isMesh) continue;
    o.userData.orig = o.material;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const toon = mats.map((m) => toonMaterial({
      vcol: false, map: m.map || null, pal: pal.get(m.uuid)?.hex, orig: '#' + (m.color || new Color(1, 1, 1)).getHexString(SRGBColorSpace),
      alpha: m.transparent ? Math.max(0.15, m.opacity) : 1,
    }));
    o.material = Array.isArray(o.material) ? toon : toon[0];
    if (opt.edges !== false && !o.geometry.groups.length) {
      const lines = new LineSegments(new EdgesGeometry(o.geometry, opt.angle ?? 30), inkMaterial({ vcol: false, pal: pal.get(mats[0].uuid)?.hex }));
      lines.userData.ink = true; lines.userData.runtimeEdges = true; lines.renderOrder = 1;
      o.add(lines);
    }
  }
  return root;
}

/**
 * Switch a prepared model between a toon style and its original materials.
 * @param {import('three').Object3D} root
 * @param {string} name  a key of STYLES, or 'original'
 */
export function applyStyle(root, name) {
  const original = name === 'original';
  const s = original ? null : setStyle(name);
  root.traverse((o) => {
    if (!o.userData.orig && !o.userData.runtimeEdges) return;
    if (o.userData.ink || o.userData.runtimeEdges) { o.visible = !original && s.lines; return; }
    if (original) {
      o.userData.toonMat ??= o.material;
      o.material = originalMaterial(o);
    } else if (o.userData.toonMat) o.material = o.userData.toonMat;
  });
}
// 'original' for a baked file: the CAD colour comes from _orig, so use a standard material reading it.
function originalMaterial(o) {
  const g = o.geometry, src = o.userData.orig;
  if (!g.attributes._orig) return src;
  if (!o.userData.origMat) {
    const m = new MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.6, map: src.map || null, transparent: src.transparent, opacity: src.opacity });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute vec4 _orig;\n' + sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n vColor = vec4(_orig.rgb, 1.0);');
    };
    o.userData.origMat = m;
  }
  return o.userData.origMat;
}

// ---------- contact blob ----------
let blobMat = null;
/** A soft grape "glow pad" under the model (a baked radial gradient on a quad: no per-frame cost). */
export function contactBlob(box, { color = 'rgba(86,77,128,0.55)', size = 1.25 } = {}) {
  if (!blobMat) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, color); grd.addColorStop(0.55, color.replace(/[\d.]+\)$/, '0.22)')); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
    blobMat = new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
  }
  const sz = box.getSize(new Vector3());
  const m = new Mesh(new PlaneGeometry(1, 1), blobMat);
  m.rotation.x = -Math.PI / 2;
  const r = Math.max(sz.x, sz.z) * size;
  m.scale.set(r, r, 1);
  const c = box.getCenter(new Vector3());
  m.position.set(c.x, box.min.y - sz.y * 0.004, c.z);
  m.renderOrder = -1;
  m.userData.blob = true;
  return m;
}
export { Box3 };
