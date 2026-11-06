// Re-simplify an already web-ready GLB (from step-to-glb.mjs) to a lighter one for the live collage.
// Usage: node scripts/models/shrink.mjs <in.glb> <out.glb> --ratio 0.2 [--error 0.004]
//   dequantize -> weld -> simplify (meshoptimizer) -> prune -> reorder -> quantize -> meshopt compression (filters on).
import { writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dequantize, weld, simplify, prune, reorder, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? Number(args[i + 1]) : d; };
const [input, output] = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').match(/^--(ratio|error)$/));
if (!input || !output) { console.error('usage: shrink.mjs <in.glb> <out.glb> --ratio r [--error e]'); process.exit(1); }
const ratio = opt('ratio', 0.25), error = opt('error', 0.004);

await MeshoptSimplifier.ready; await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const tris = (doc) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);

const doc = await io.read(input);
const before = tris(doc);
await doc.transform(
  dequantize(), weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }),
  prune(), reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizeNormal: 8, quantizePosition: 14 }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await writeFile(output, await io.writeBinary(doc));
const { size } = await stat(output);
console.log(JSON.stringify({ file: path.basename(output), bytes: size, triangles: tris(doc), trianglesIn: before, ratio, error }));
