// STEP → web-ready GLB.
// Usage: node --max-old-space-size=8192 scripts/models/step-to-glb.mjs <in.step|in.glb> <out.glb> [options]
//   A .glb input (e.g. from step-to-gltf-native.py) skips tessellation and is only optimized.
//   --deflection <ratio>   linear deflection as a fraction of the bounding box (default 0.0008)
//   --angle <rad>          angular deflection in radians (default 0.35)
//   --ratio <0..1>         simplify target ratio of triangles to keep (default 0.5)
//   --error <0..1>         simplify max error, relative to mesh size (default 0.0005)
//   --no-simplify          skip decimation
// Output: Y-up, meters (STEP millimeters × 0.001), centered on the origin (bounding-box center, base at y=0 is NOT applied).
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import occtimportjs from 'occt-import-js';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, simplify, prune, center, quantize, reorder, sparse } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const [input, output] = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').match(/^--(deflection|angle|ratio|error)$/));
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : def; };
if (!input || !output) { console.error('usage: step-to-glb.mjs <in.step> <out.glb> [--deflection r] [--angle rad] [--ratio r] [--error e] [--no-simplify]'); process.exit(1); }
const deflection = opt('deflection', 0.0008), angle = opt('angle', 0.35), ratio = opt('ratio', 0.5), error = opt('error', 0.0005);
const doSimplify = !args.includes('--no-simplify');

const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m);

const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
await MeshoptSimplifier.ready; await MeshoptEncoder.ready; await MeshoptDecoder.ready;

let doc, triIn = 0, nMats = 0;
if (/\.glb$/i.test(input)) {
  // Pre-meshed input (e.g. from step-to-gltf-native.py): already Y-up meters; just optimize.
  doc = await io.read(input);
  for (const m of doc.getRoot().listMaterials()) m.setDoubleSided(true);
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); triIn += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
  nMats = doc.getRoot().listMaterials().length;
  log(`loaded ${path.basename(input)}: ${triIn.toLocaleString()} tris, ${nMats} materials`);
} else {
  // 1. Tessellate the STEP with OpenCascade (wasm).
  const occt = await occtimportjs();
  const buf = new Uint8Array(await readFile(input));
  log(`read ${(buf.byteLength / 1e6).toFixed(1)} MB`);
  const res = occt.ReadStepFile(buf, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: deflection,
    angularDeflection: angle,
  });
  if (!res.success) { console.error('OCCT failed to read the STEP file'); process.exit(2); }
  log(`tessellated: ${res.meshes.length} meshes`);

  // 2. Build a glTF document: one primitive per (mesh, color); materials shared per color.
  doc = new Document();
  const bufObj = doc.createBuffer();
  const scene = doc.createScene('model');
  const root = doc.createNode('root');
  scene.addChild(root);
  // STEP is Z-up in millimeters → glTF Y-up meters: rotate -90° about X, scale 0.001.
  const s = Math.SQRT1_2;
  root.setRotation([-s, 0, 0, s]).setScale([0.001, 0.001, 0.001]);

  const DEFAULT = [0.72, 0.74, 0.76];
  const mats = new Map();
  function material(rgb) {
    const c = (rgb || DEFAULT).map((v) => Math.min(1, Math.max(0, v)));
    const key = c.map((v) => v.toFixed(3)).join(',');
    if (!mats.has(key)) {
      // sRGB from STEP → linear for glTF baseColorFactor.
      const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      mats.set(key, doc.createMaterial('c_' + key).setBaseColorFactor([...lin, 1]).setMetallicFactor(0.1).setRoughnessFactor(0.6).setDoubleSided(true));
    }
    return mats.get(key);
  }

  res.meshes.forEach((m, mi) => {
    const pos = m.attributes.position.array, nrm = m.attributes.normal && m.attributes.normal.array, idx = m.index.array;
    triIn += idx.length / 3;
    // Group triangles by face color (brep_faces[].color overrides mesh color).
    const groups = new Map();
    const faces = m.brep_faces && m.brep_faces.length ? m.brep_faces : [{ first: 0, last: idx.length / 3 - 1, color: null }];
    for (const f of faces) {
      const col = f.color || m.color || null;
      const key = col ? col.join(',') : 'default';
      if (!groups.has(key)) groups.set(key, { col, tris: [] });
      const g = groups.get(key);
      for (let t = f.first; t <= f.last; t++) g.tris.push(t);
    }
    const node = doc.createNode(m.name || `part_${mi}`);
    const mesh = doc.createMesh(m.name || `part_${mi}`);
    for (const { col, tris } of groups.values()) {
      // Compact the vertex set used by this group.
      const remap = new Map(), P = [], N = [], I = new Uint32Array(tris.length * 3);
      let k = 0;
      for (const t of tris) for (let c = 0; c < 3; c++) {
        const v = idx[t * 3 + c];
        let nv = remap.get(v);
        if (nv === undefined) {
          nv = P.length / 3; remap.set(v, nv);
          P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
          if (nrm) N.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
        }
        I[k++] = nv;
      }
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(bufObj))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(I).setBuffer(bufObj))
        .setMaterial(material(col));
      if (nrm) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(N)).setBuffer(bufObj));
      mesh.addPrimitive(prim);
    }
    node.setMesh(mesh);
    root.addChild(node);
  });
  log(`built doc: ${triIn.toLocaleString()} tris in, ${mats.size} colors`);

  nMats = mats.size;
}

// 3. Optimize.
const steps = [dedup(), flatten(), join({ keepNamed: false }), weld()];
if (doSimplify) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
steps.push(center({ pivot: 'center' }), prune(), reorder({ encoder: MeshoptEncoder }), quantize({ quantizeNormal: 10, quantizePosition: 14 }), sparse());
await doc.transform(...steps);

let triOut = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); triOut += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }

doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await writeFile(output, await io.writeBinary(doc));
const { size } = await stat(output);
log(`wrote ${path.basename(output)}: ${(size / 1e6).toFixed(2)} MB, ${triOut.toLocaleString()} tris (from ${triIn.toLocaleString()}), ${nMats} materials`);
console.log(JSON.stringify({ file: output, bytes: size, triangles: triOut, trianglesIn: triIn, materials: nMats, deflection, angle, ratio: doSimplify ? ratio : 1, error: doSimplify ? error : 0 }));
