// Usage: node scripts/collage/sticker.mjs <in> <out.webp> [border px]. Turns a cut-out photo into a collage sticker.
// Cut the dark object out of a light background (halftone-safe: close the dot gaps, fill holes, keep the biggest
// piece), then give it an even white sticker border R px wide and a soft drop-shadow-ready alpha edge.
import sharp from 'sharp';
const [src, out, Rarg] = process.argv.slice(2);
const R = Number(Rarg || 14), CLOSE = 7;
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;
const dark = new Uint8Array(N);
for (let p = 0; p < N; p++) { const i = p * 4; const l = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]; dark[p] = l < 175 ? 1 : 0; }
function dist(mask) { // chamfer distance to the nearest set pixel
  const D = new Float32Array(N); for (let p = 0; p < N; p++) D[p] = mask[p] ? 0 : 1e9;
  const a = 1, b = 1.414;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; let d = D[p];
    if (x > 0) d = Math.min(d, D[p - 1] + a); if (y > 0) { d = Math.min(d, D[p - W] + a); if (x > 0) d = Math.min(d, D[p - W - 1] + b); if (x < W - 1) d = Math.min(d, D[p - W + 1] + b); } D[p] = d; }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const p = y * W + x; let d = D[p];
    if (x < W - 1) d = Math.min(d, D[p + 1] + a); if (y < H - 1) { d = Math.min(d, D[p + W] + a); if (x < W - 1) d = Math.min(d, D[p + W + 1] + b); if (x > 0) d = Math.min(d, D[p + W - 1] + b); } D[p] = d; }
  return D;
}
// close: dilate by CLOSE then erode by CLOSE
let D = dist(dark); const dil = new Uint8Array(N); for (let p = 0; p < N; p++) dil[p] = D[p] <= CLOSE ? 1 : 0;
// fill holes: flood the outside through non-mask pixels
const out1 = new Uint8Array(N); const q = [];
for (let x = 0; x < W; x++) q.push(x, (H - 1) * W + x); for (let y = 0; y < H; y++) q.push(y * W, y * W + W - 1);
while (q.length) { const p = q.pop(); if (out1[p] || dil[p]) continue; out1[p] = 1; const x = p % W, y = (p / W) | 0;
  if (x > 0) q.push(p - 1); if (x < W - 1) q.push(p + 1); if (y > 0) q.push(p - W); if (y < H - 1) q.push(p + W); }
const filled = new Uint8Array(N); for (let p = 0; p < N; p++) filled[p] = out1[p] ? 0 : 1;
// erode back
const inv = new Uint8Array(N); for (let p = 0; p < N; p++) inv[p] = filled[p] ? 0 : 1;
D = dist(inv); const obj = new Uint8Array(N); for (let p = 0; p < N; p++) obj[p] = D[p] > CLOSE ? 1 : 0;
// keep the largest connected piece (drops stray text like a stock ID strip)
const lab = new Int32Array(N); let best = 0, bestN = 0, L = 0;
for (let s = 0; s < N; s++) { if (!obj[s] || lab[s]) continue; L++; let n = 0; const st = [s]; lab[s] = L;
  while (st.length) { const p = st.pop(); n++; const x = p % W, y = (p / W) | 0;
    for (const r of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (r >= 0 && obj[r] && !lab[r]) { lab[r] = L; st.push(r); } }
  if (n > bestN) { bestN = n; best = L; } }
for (let p = 0; p < N; p++) obj[p] = lab[p] === best ? 1 : 0;
// sticker: white ring of R px around the object
D = dist(obj);
const pad = R + 4, OW = W + pad * 2, OH = H + pad * 2, o = Buffer.alloc(OW * OH * 4);
for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) { const sx = x - pad, sy = y - pad, j = (y * OW + x) * 4;
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue; const p = sy * W + sx, i = p * 4;
  if (obj[p]) { o[j] = data[i]; o[j + 1] = data[i + 1]; o[j + 2] = data[i + 2]; o[j + 3] = 255; }
  else if (D[p] <= R + 1) { const a = Math.max(0, Math.min(1, R + 1 - D[p])); o[j] = o[j + 1] = o[j + 2] = 255; o[j + 3] = Math.round(a * 255); } }
await sharp(o, { raw: { width: OW, height: OH, channels: 4 } }).trim().webp({ quality: 88, alphaQuality: 95 }).toFile(out);
const m = await sharp(out).metadata(); console.log(out, m.width, m.height);
