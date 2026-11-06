// Bake the collage photo's lime sticker outline and soft drop shadow into the image itself.
// They used to be a five-step CSS `filter: drop-shadow(...)` chain on .gr-me img, which the browser re-ran on
// every repaint of the zoomed collage (the costliest single paint item on scroll). This reproduces that chain:
//   4 x drop-shadow(±3px, lime) applied in sequence = the silhouette dilated by {-3,0,3}² px, in lime;
//   then drop-shadow(0 18px 26px rgba(4,8,3,.65)) of that = blurred (sigma 13px) dark copy 18px lower.
// Output is 2 image px per CSS px, padded so the shadow fits: 30px left/right, 10px top, 50px bottom.
// Usage (repo root): node scripts/bake-photo-outline.mjs   -> public/tanishq-grape-cut.{avif,webp,png}
import sharp from 'sharp';
import path from 'node:path';

const SRC = 'public/tanishq-grape.png';
const OUT = 'public/tanishq-grape-cut';
const R = 2; // image px per CSS px
const CSS_H = 470; // displayed photo height in CSS px (.gr-me is 470px tall)
const PAD = { l: 30, r: 30, t: 10, b: 50 }; // CSS px
const LIME = [0xc2, 0xf9, 0x70];
const SHADOW = { dy: 18, sigma: 13, rgb: [4, 8, 3], a: 0.65 };

const ph = CSS_H * R;
const photo = await sharp(SRC).resize({ height: ph, kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const pw = photo.info.width;
const W = pw + (PAD.l + PAD.r) * R, H = ph + (PAD.t + PAD.b) * R;
const ox = PAD.l * R, oy = PAD.t * R;

// Silhouette alpha on the padded canvas.
const A = new Float32Array(W * H);
for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) A[(y + oy) * W + x + ox] = photo.data[(y * pw + x) * 4 + 3] / 255;
// Sequential drop-shadows with offsets ±3px in x then y: max over the 3x3 grid of shifts.
const s = 3 * R, D = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let m = 0;
  for (const dy of [-s, 0, s]) for (const dx of [-s, 0, s]) {
    const X = x - dx, Y = y - dy;
    if (X >= 0 && Y >= 0 && X < W && Y < H) { const v = A[Y * W + X]; if (v > m) m = v; }
  }
  D[y * W + x] = m;
}
// Shadow: D shifted down, gaussian blurred (sharp does the blur on a 1-channel image).
const shifted = Buffer.alloc(W * H);
const dyPx = SHADOW.dy * R;
for (let y = dyPx; y < H; y++) for (let x = 0; x < W; x++) shifted[y * W + x] = Math.round(D[(y - dyPx) * W + x] * 255);
const blurred = await sharp(shifted, { raw: { width: W, height: H, channels: 1 } }).blur(SHADOW.sigma * R).extractChannel(0).raw().toBuffer(); // blur() hands back 3 channels

// Composite (premultiplied "over"): shadow, then the lime outline, then the photo.
const out = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  let r = 0, g = 0, b = 0, a = 0;
  const over = (cr, cg, cb, ca) => { r = cr * ca + r * (1 - ca); g = cg * ca + g * (1 - ca); b = cb * ca + b * (1 - ca); a = ca + a * (1 - ca); };
  over(...SHADOW.rgb, (blurred[i] / 255) * SHADOW.a);
  over(...LIME, D[i]);
  const x = (i % W) - ox, y = Math.floor(i / W) - oy;
  if (x >= 0 && y >= 0 && x < pw && y < ph) { const j = (y * pw + x) * 4; over(photo.data[j], photo.data[j + 1], photo.data[j + 2], photo.data[j + 3] / 255); }
  out[i * 4] = a ? Math.round(r / a) : 0; out[i * 4 + 1] = a ? Math.round(g / a) : 0; out[i * 4 + 2] = a ? Math.round(b / a) : 0; out[i * 4 + 3] = Math.round(a * 255);
}
const img = () => sharp(out, { raw: { width: W, height: H, channels: 4 } });
await img().avif({ quality: 60, effort: 6 }).toFile(OUT + '.avif');
await img().webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(OUT + '.webp');
await img().png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(OUT + '.png');
console.log(JSON.stringify({ width: W, height: H, cssWidth: W / R, cssHeight: H / R, photoCssWidth: pw / R, out: path.basename(OUT) }));
