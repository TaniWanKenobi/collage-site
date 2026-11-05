// Optimize an existing GLB for the web (no STEP step).
// Usage: node scripts/models/optimize-glb.mjs <in.glb> <out.glb> [--ratio 0.5] [--error 0.001] [--longest 0.12] [--tex 1024]
//   --ratio <0..1>    simplify target: fraction of triangles to keep (default 0.5)
//   --error <0..1>    simplify max error, relative to mesh size (default 0.001)
//   --longest <m>     scale so the longest bounding-box side is this many meters (default 0.12; 0 keeps the source scale)
//   --tex <px>        max texture side, textures are converted to webp (default 1024)
// Pipeline: dedup, flatten, join by material, weld, simplify, resize textures to webp, scale and center on the
// origin, prune, quantize, meshopt-compress. Y-up is assumed (glTF standard); the output is meters, centered on the bounding box.
import { writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, simplify, prune, center, quantize, reorder, textureCompress, getBounds, transformMesh } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const VALUE_FLAGS = /^--(ratio|error|longest|tex)$/;
const [input, output] = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.test(args[i - 1] || ''));
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? Number(args[i + 1]) : d; };
if (!input || !output) { console.error('usage: optimize-glb.mjs <in.glb> <out.glb> [--ratio r] [--error e] [--longest m] [--tex px]'); process.exit(1); }
const ratio = opt('ratio', 0.5), error = opt('error', 0.001), longest = opt('longest', 0.12), texMax = opt('tex', 1024);

await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
const root = doc.getRoot();
const countTris = () => { let t = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } return t; };
const triIn = countTris(), matsIn = root.listMaterials().length, meshesIn = root.listMeshes().length, texIn = root.listTextures().length;
const { size: bytesIn } = await stat(input);

// Bake every node transform (and the meter scale) into the vertices, so all nodes end up at identity.
// (join keeps the first node's transform, which mangles rotated/non-uniformly scaled parts, so bake first.)
await doc.transform(flatten());
const scene = root.listScenes()[0];
let scale = 1;
if (longest > 0) {
  const { min, max } = getBounds(scene);
  scale = longest / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  if (mesh.listParents().filter((p) => p.propertyType === 'Node').length > 1) throw new Error(`mesh ${mesh.getName()} is instanced; unsupported`);
  const m = node.getWorldMatrix().map((v, i) => (i % 4 === 3 ? v : v * scale));
  transformMesh(mesh, m);
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
// Merge meshes by material, weld, simplify.
await doc.transform(dedup(), join({ keepNamed: false }), weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
if (texIn) await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texMax, texMax], quality: 80 }));
await doc.transform(center({ pivot: 'center' }), prune(), reorder({ encoder: MeshoptEncoder }), quantize({ quantizeNormal: 10, quantizePosition: 14, quantizeTexcoord: 12 }));

doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await writeFile(output, await io.writeBinary(doc));
const { size } = await stat(output);
const out = { file: path.basename(output), bytesIn, bytes: size, trianglesIn: triIn, triangles: countTris(), meshesIn, meshes: root.listMeshes().length, materialsIn: matsIn, materials: root.listMaterials().length, texturesIn: texIn, textures: root.listTextures().length, ratio, error, longestM: longest };
console.log(JSON.stringify(out));
