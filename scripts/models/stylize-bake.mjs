// Bake the "cel + ink" data into a web GLB (see src/scripts/toon.js for the runtime half).
// Usage: node scripts/models/stylize-bake.mjs <in.glb> <out.glb> [options]
//   --angle <deg>      crease angle for ink lines (default 30): edges sharper than this are inked
//   --min-part <f>     skip edges of connected parts whose bounding box diagonal is under f x model diagonal (default 0.02)
//   --rays <n>         AO rays per vertex (default 32)
//   --ao-dist <f>      AO ray length as a fraction of the model diagonal (default 0.08)
//   --hero-max <f>     palette: the biggest saturated group turns lime only below this area share (default 0.3)
//   --hint name=cls    palette override for a source material (cls: lime|grape|neutral|screen); repeatable
//   --ao-cache <file>  reuse (or write) the AO result: a palette or edge tweak then skips the slow ray casting
// Output: one triangle primitive per surface kind (all opaque untextured parts merged into one), each with
//   COLOR_0 = palette colour (linear) + AO in alpha, _ORIG = original colour (linear) + flag (0 = screen),
// plus one LINES primitive of crease edges. Invisible (alpha ~0) parts are dropped. Textures are kept.
// Then weld, reorder, quantize and meshopt-compress. The input may already be quantized/compressed.
import { writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Document, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { dequantize, flatten, weld, reorder, quantize, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { BufferGeometry, BufferAttribute, EdgesGeometry, Matrix4, Matrix3, Vector3, Ray, DoubleSide } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { paletteMap } from '../../src/scripts/toon.js';

const args = process.argv.slice(2);
const VAL = /^--(angle|min-part|rays|ao-dist|hero-max|hint|ao-cache)$/;
const [input, output] = args.filter((a, i) => !a.startsWith('--') && !VAL.test(args[i - 1] || ''));
if (!input || !output) { console.error('usage: stylize-bake.mjs <in.glb> <out.glb> [--angle 30] [--min-part 0.02] [--rays 32] [--ao-dist 0.08] [--hint mat=cls]'); process.exit(1); }
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? Number(args[i + 1]) : d; };
const ANGLE = opt('angle', 30), MIN_PART = opt('min-part', 0.02), RAYS = opt('rays', 32), AO_DIST = opt('ao-dist', 0.08), HERO_MAX = opt('hero-max', 0.3);
const HINTS = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === '--hint' ? [a.split('=')] : [])));

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const t0 = Date.now();
const src = await io.read(input);
await src.transform(dequantize(), flatten());
const { size: bytesIn } = await stat(input);

// ---------- collect every triangle primitive in world space ----------
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const parts = []; // { name, mat, pos, nrm, uv, idx, rgbLin, alpha, blend, tex }
for (const node of src.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const M = new Matrix4().fromArray(node.getWorldMatrix());
  const N = new Matrix3().getNormalMatrix(M);
  for (const p of mesh.listPrimitives()) {
    if (p.getMode() !== Primitive.Mode.TRIANGLES) continue;
    const mat = p.getMaterial();
    const f = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
    const blend = mat && mat.getAlphaMode() === 'BLEND';
    if (blend && f[3] < 0.05) continue; // invisible in the original render
    const P = p.getAttribute('POSITION'), Nn = p.getAttribute('NORMAL'), T = p.getAttribute('TEXCOORD_0'), I = p.getIndices();
    const n = P.getCount(), v = new Vector3(), e = [0, 0, 0];
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      v.fromArray(P.getElement(i, e)).applyMatrix4(M); v.toArray(pos, i * 3);
      if (Nn) { v.fromArray(Nn.getElement(i, e)).applyMatrix3(N).normalize(); v.toArray(nrm, i * 3); }
    }
    const idx = I ? Uint32Array.from(I.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setIndex(new BufferAttribute(idx, 1));
    if (!Nn) { geo.computeVertexNormals(); nrm.set(geo.attributes.normal.array); }
    const tex = mat && mat.getBaseColorTexture();
    let uv = null;
    if (tex && T) { uv = new Float32Array(n * 2); for (let i = 0; i < n; i++) { const t = T.getElement(i, [0, 0]); uv[i * 2] = t[0]; uv[i * 2 + 1] = t[1]; } }
    parts.push({ name: mat ? mat.getName() || 'mat' : 'none', mat, pos, nrm, uv: tex && uv ? uv : null, idx, geo, rgbLin: f.slice(0, 3), alpha: f[3], blend: blend && f[3] < 0.95, tex: tex && uv ? tex : null });
  }
}

// ---------- palette ----------
const area = (pt) => {
  const a = new Vector3(), b = new Vector3(), c = new Vector3(); let s = 0;
  for (let i = 0; i < pt.idx.length; i += 3) {
    a.fromArray(pt.pos, pt.idx[i] * 3); b.fromArray(pt.pos, pt.idx[i + 1] * 3); c.fromArray(pt.pos, pt.idx[i + 2] * 3);
    s += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return s;
};
// Textured parts are classified by their texture's average colour (the base factor is usually white).
async function texAverage(tex) {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(Buffer.from(tex.getImage())).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const s = [0, 0, 0];
  for (let i = 0; i < data.length; i += info.channels) for (let k = 0; k < 3; k++) s[k] += data[i + k] / 255;
  return s.map((x) => x / (data.length / info.channels));
}
const keyOf = (pt) => pt.name + '|' + pt.rgbLin.map((x) => x.toFixed(3)).join(',');
const byKey = new Map();
for (const pt of parts) {
  const k = keyOf(pt);
  const rgb = pt.tex ? await texAverage(pt.tex) : pt.rgbLin.map(toSrgb);
  const e = byKey.get(k) || { key: k, rgb, area: 0, hint: HINTS[pt.name] };
  e.area += area(pt); byKey.set(k, e);
}
const pal = paletteMap([...byKey.values()], { heroMax: HERO_MAX });
const lin = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

// ---------- ambient occlusion (vertex, cosine-weighted hemisphere, all opaque parts occlude each other) ----------
const opaque = parts.filter((p) => !p.blend);
let vtot = 0; for (const p of opaque) vtot += p.pos.length / 3;
const allPos = new Float32Array(vtot * 3), allIdx = [];
let off = 0;
for (const p of opaque) { allPos.set(p.pos, off * 3); for (const i of p.idx) allIdx.push(i + off); off += p.pos.length / 3; }
const big = new BufferGeometry();
big.setAttribute('position', new BufferAttribute(allPos, 3));
big.setIndex(new BufferAttribute(Uint32Array.from(allIdx), 1));
big.computeBoundingBox();
const DIAG = big.boundingBox.getSize(new Vector3()).length();
const bvh = new MeshBVH(big);
// Fixed cosine-weighted directions (Fibonacci spiral on the hemisphere), rotated into each normal's frame.
const DIRS = Array.from({ length: RAYS }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / RAYS), th = i * 2.399963229728653;
  return [r * Math.cos(th), r * Math.sin(th), Math.sqrt(1 - r * r)];
});
const aoCache = new Map();
const ray = new Ray(), t1 = new Vector3(), t2 = new Vector3(), nn = new Vector3(), up = new Vector3();
const EPS = DIAG * 2e-4, FAR = DIAG * AO_DIST;
const q = (x) => Math.round(x / (DIAG * 1e-5));
function aoAt(px, py, pz, nx, ny, nz) {
  const k = `${q(px)},${q(py)},${q(pz)},${Math.round(nx * 50)},${Math.round(ny * 50)},${Math.round(nz * 50)}`;
  const c = aoCache.get(k);
  if (c !== undefined) return c;
  nn.set(nx, ny, nz);
  up.set(Math.abs(nx) < 0.9 ? 1 : 0, Math.abs(nx) < 0.9 ? 0 : 1, 0);
  t1.crossVectors(up, nn).normalize(); t2.crossVectors(nn, t1);
  let occ = 0;
  for (const [a, b, c2] of DIRS) {
    ray.origin.set(px + nx * EPS, py + ny * EPS, pz + nz * EPS);
    ray.direction.set(t1.x * a + t2.x * b + nn.x * c2, t1.y * a + t2.y * b + nn.y * c2, t1.z * a + t2.z * b + nn.z * c2);
    const hit = bvh.raycastFirst(ray, DoubleSide, 0, FAR);
    if (hit) occ += 1 - (hit.distance / FAR) ** 2 * 0.5; // near hits count fully, far ones half
  }
  const ao = 1 - occ / RAYS;
  aoCache.set(k, ao);
  return ao;
}
const tAO = Date.now();
const cacheIdx = args.indexOf('--ao-cache'), cacheFile = cacheIdx >= 0 ? args[cacheIdx + 1] : null;
const { readFile } = await import('node:fs/promises');
const cached = cacheFile ? await readFile(cacheFile, 'utf8').then(JSON.parse).catch(() => null) : null;
const cacheKey = JSON.stringify([RAYS, AO_DIST, parts.map((p) => p.pos.length)]);
if (cached && cached.key === cacheKey) parts.forEach((p, i) => { p.ao = Float32Array.from(cached.ao[i]); });
else for (const p of parts) {
  const n = p.pos.length / 3;
  p.ao = new Float32Array(n);
  for (let i = 0; i < n; i++) p.ao[i] = p.blend ? 1 : aoAt(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2], p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]);
}
// Smooth: vertices at the same spot (split normals) share their average, which softens the facet look.
if (!(cached && cached.key === cacheKey)) {
  const acc = new Map();
  const key = (p, i) => `${q(p.pos[i * 3])},${q(p.pos[i * 3 + 1])},${q(p.pos[i * 3 + 2])}`;
  for (const p of parts) for (let i = 0; i < p.ao.length; i++) { const k = key(p, i), a = acc.get(k) || [0, 0]; a[0] += p.ao[i]; a[1]++; acc.set(k, a); }
  for (const p of parts) for (let i = 0; i < p.ao.length; i++) { const a = acc.get(key(p, i)); p.ao[i] = 0.5 * p.ao[i] + 0.5 * a[0] / a[1]; }
}
const aoMs = Date.now() - tAO;
if (cacheFile && !(cached && cached.key === cacheKey)) await writeFile(cacheFile, JSON.stringify({ key: cacheKey, ao: parts.map((p) => Array.from(p.ao, (x) => +x.toFixed(3))) }));

// ---------- crease edges ----------
// Connected parts (by shared positions) smaller than MIN_PART of the model get no ink: tiny screws and SMD
// parts would only add hatching.
function components(p) {
  const n = p.pos.length / 3, parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const seen = new Map();
  for (let i = 0; i < n; i++) { const k = `${q(p.pos[i * 3])},${q(p.pos[i * 3 + 1])},${q(p.pos[i * 3 + 2])}`; const j = seen.get(k); if (j !== undefined) unite(i, j); else seen.set(k, i); }
  for (let i = 0; i < p.idx.length; i += 3) { unite(p.idx[i], p.idx[i + 1]); unite(p.idx[i], p.idx[i + 2]); }
  const box = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i); let b = box.get(r);
    if (!b) { b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; box.set(r, b); }
    for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], p.pos[i * 3 + k]); b[k + 3] = Math.max(b[k + 3], p.pos[i * 3 + k]); }
  }
  const small = new Set();
  for (const [r, b] of box) if (Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) < DIAG * MIN_PART) small.add(r);
  return { find, small };
}
let linePos = [], lineCol = [], lineOrig = [];
let segIn = 0;
for (const p of parts) {
  const { find, small } = components(p);
  // keep only triangles of big-enough parts; EdgesGeometry hashes positions to 1e-4 units, so scale up first
  const keep = [];
  for (let i = 0; i < p.idx.length; i += 3) if (!small.has(find(p.idx[i]))) keep.push(p.idx[i], p.idx[i + 1], p.idx[i + 2]);
  if (!keep.length) continue;
  const S = 1e4 / DIAG; // model diagonal = 10000 units: hashing precision ~1e-8 of the model
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p.pos.map((x) => x * S), 3));
  g.setIndex(keep);
  const eg = new EdgesGeometry(g, ANGLE);
  const a = eg.attributes.position.array;
  const k = keyOf(p), palHex = pal.get(k).hex;
  const pc = lin(palHex), oc = p.rgbLin;
  for (let i = 0; i < a.length; i += 3) {
    linePos.push(a[i] / S, a[i + 1] / S, a[i + 2] / S);
    lineCol.push(...pc, 1); lineOrig.push(...oc, 1);
  }
  segIn += a.length / 6;
}

// Drop ink that can never be seen: segments whose end points and middle are all enclosed by other parts (the
// PCB inside the tamagotchi shell, screws inside brackets). A point counts as visible if any of 48 rays spread
// over the whole sphere escapes the model.
let segHidden = 0;
{
  const SPH = Array.from({ length: 48 }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / 48, r = Math.sqrt(1 - y * y), th = i * 2.399963229728653;
    return [r * Math.cos(th), y, r * Math.sin(th)];
  });
  const vis = new Map();
  const visible = (x, y, z) => {
    const k = `${q(x)},${q(y)},${q(z)}`;
    if (vis.has(k)) return vis.get(k);
    let v = false;
    for (const [a, b, c] of SPH) {
      ray.direction.set(a, b, c);
      ray.origin.set(x + a * EPS * 3, y + b * EPS * 3, z + c * EPS * 3);
      if (!bvh.raycastFirst(ray, DoubleSide)) { v = true; break; }
    }
    vis.set(k, v);
    return v;
  };
  const keepIdx = [];
  for (let s = 0; s < linePos.length / 6; s++) {
    const o = s * 6, P = linePos;
    if (visible(P[o], P[o + 1], P[o + 2]) || visible(P[o + 3], P[o + 4], P[o + 5]) || visible((P[o] + P[o + 3]) / 2, (P[o + 1] + P[o + 4]) / 2, (P[o + 2] + P[o + 5]) / 2)) keepIdx.push(s);
  }
  segHidden = linePos.length / 6 - keepIdx.length;
  const pick = (arr, w) => { const out = []; for (const s of keepIdx) for (let i = s * 2 * w; i < (s + 1) * 2 * w; i++) out.push(arr[i]); return out; };
  linePos = pick(linePos, 3); lineCol = pick(lineCol, 4); lineOrig = pick(lineOrig, 4);
}

// ---------- build the output document ----------
const doc = new Document();
const buf = doc.createBuffer();
const outMesh = doc.createMesh('model');
const u8 = (arr) => Uint8Array.from(arr, (x) => Math.round(Math.min(1, Math.max(0, x)) * 255));
const acc = (type, array, normalized = false) => doc.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buf);
const texMap = new Map();
function copyTexture(t) {
  if (!texMap.has(t)) texMap.set(t, doc.createTexture(t.getName()).setImage(t.getImage()).setMimeType(t.getMimeType()));
  return texMap.get(t);
}
const groups = new Map(); // kind -> parts
for (const p of parts) {
  const kind = p.tex ? 'tex:' + parts.indexOf(p) : p.blend ? 'blend:' + p.alpha.toFixed(2) : 'toon';
  if (!groups.has(kind)) groups.set(kind, []);
  groups.get(kind).push(p);
}
const extras = {};
for (const [kind, list] of groups) {
  let nv = 0, ni = 0;
  for (const p of list) { nv += p.pos.length / 3; ni += p.idx.length; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), c0 = new Float32Array(nv * 4), c1 = new Float32Array(nv * 4), idx = new Uint32Array(ni);
  const uv = list[0].uv ? new Float32Array(nv * 2) : null;
  let vo = 0, io2 = 0;
  for (const p of list) {
    const n = p.pos.length / 3, k = keyOf(p), pe = pal.get(k), pc = lin(pe.hex), screen = pe.cls === 'screen';
    pos.set(p.pos, vo * 3); nrm.set(p.nrm, vo * 3);
    if (uv) uv.set(p.uv, vo * 2);
    for (let i = 0; i < n; i++) {
      c0.set([pc[0], pc[1], pc[2], p.ao[i]], (vo + i) * 4);
      c1.set([...(p.tex ? [1, 1, 1] : p.rgbLin), screen ? 0 : 1], (vo + i) * 4);
    }
    for (let i = 0; i < p.idx.length; i++) idx[io2 + i] = p.idx[i] + vo;
    vo += n; io2 += p.idx.length;
  }
  const m = doc.createMaterial(kind === 'toon' ? 'toon' : list[0].name).setBaseColorFactor([1, 1, 1, 1]).setDoubleSided(true).setMetallicFactor(0.1).setRoughnessFactor(0.6);
  if (kind.startsWith('blend')) m.setAlphaMode('BLEND').setBaseColorFactor([...list[0].rgbLin, list[0].alpha]);
  if (kind.startsWith('tex')) {
    m.setBaseColorTexture(copyTexture(list[0].tex));
    // texture palette: map its luminance onto the dark..light end of its class ladder
    const pe = pal.get(keyOf(list[0]));
    const ladder = { lime: ['#2E4019', '#E0FCB0'], grape: ['#2B2640', '#C9C3E6'], neutral: ['#263424', '#EFFDD8'], screen: ['#263424', '#EFFDD8'] }[pe.cls];
    m.setExtras({ toon: { lo: ladder[0], hi: ladder[1], cls: pe.cls } });
  }
  const prim = doc.createPrimitive().setMaterial(m)
    .setAttribute('POSITION', acc('VEC3', pos)).setAttribute('NORMAL', acc('VEC3', nrm))
    .setAttribute('COLOR_0', acc('VEC4', u8(c0), true)).setAttribute('_ORIG', acc('VEC4', u8(c1), true))
    .setIndices(acc('SCALAR', idx));
  if (uv) prim.setAttribute('TEXCOORD_0', acc('VEC2', uv));
  outMesh.addPrimitive(prim);
  extras[kind] = list.map((p) => `${p.name}->${pal.get(keyOf(p)).hex}(${pal.get(keyOf(p)).cls})`);
}
// Lines: dedupe the segment end points so the index buffer does the work.
{
  const map = new Map(), P = [], C = [], O = [], I = [];
  for (let i = 0; i < linePos.length / 3; i++) {
    const k = `${q(linePos[i * 3])},${q(linePos[i * 3 + 1])},${q(linePos[i * 3 + 2])}|${lineCol.slice(i * 4, i * 4 + 3).join()}|${lineOrig.slice(i * 4, i * 4 + 3).join()}`;
    let j = map.get(k);
    if (j === undefined) { j = P.length / 3; map.set(k, j); P.push(linePos[i * 3], linePos[i * 3 + 1], linePos[i * 3 + 2]); C.push(...lineCol.slice(i * 4, i * 4 + 4)); O.push(...lineOrig.slice(i * 4, i * 4 + 4)); }
    I.push(j);
  }
  if (I.length) {
    const m = doc.createMaterial('ink').setBaseColorFactor([0.004, 0.008, 0.004, 1]);
    outMesh.addPrimitive(doc.createPrimitive().setMode(Primitive.Mode.LINES).setMaterial(m)
      .setAttribute('POSITION', acc('VEC3', Float32Array.from(P)))
      .setAttribute('COLOR_0', acc('VEC4', u8(C), true)).setAttribute('_ORIG', acc('VEC4', u8(O), true))
      .setIndices(acc('SCALAR', Uint32Array.from(I))));
  }
}
const node = doc.createNode('model').setMesh(outMesh);
doc.createScene('model').addChild(node);
doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);
doc.getRoot().setExtras({ toonBake: { angle: ANGLE, minPart: MIN_PART, rays: RAYS, aoDist: AO_DIST, segments: segIn - segHidden } });

await doc.transform(
  weld(), prune(), reorder({ encoder: MeshoptEncoder }),
  quantize({ pattern: /^(POSITION|NORMAL|TEXCOORD_0)$/, quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
if ([...texMap.values()].some((t) => t.getMimeType() === 'image/webp')) doc.createExtension(EXTTextureWebP).setRequired(true);
await writeFile(output, await io.writeBinary(doc));
const { size } = await stat(output);
let tris = 0;
for (const p of outMesh.listPrimitives()) if (p.getMode() === Primitive.Mode.TRIANGLES) tris += p.getIndices().getCount() / 3;
console.log(JSON.stringify({
  file: path.basename(output), bytesIn, bytes: size, growth: +(size / bytesIn - 1).toFixed(3), triangles: tris,
  segments: segIn - segHidden, hiddenSegments: segHidden, primitives: outMesh.listPrimitives().length, aoMs, totalMs: Date.now() - t0, angle: ANGLE, minPart: MIN_PART,
}));
if (args.includes('--verbose')) console.log(JSON.stringify(extras, null, 1));
