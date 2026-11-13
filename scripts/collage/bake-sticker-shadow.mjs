// Bake the cut-out stickers' drop shadow into the art (trophy, book, cassette).
// It used to be `filter: drop-shadow(0 12px 14px rgba(4,8,3,.55))` on .zp.sticker / .sticker-deco. Those pieces are
// composited layers in the zoomed collage, so the GPU re-ran that blur every frame of a scroll, at the zoom scale.
// A CSS drop-shadow blur radius of 14px is a gaussian with sigma 7px, offset 12px down, in the piece's own
// (unrotated) frame, which is the frame the image is drawn in, so baking it gives the same pixels.
// Output keeps the source resolution and is padded so the shadow fits; the <img> hangs out of its box by PAD.
// Usage (repo root): node scripts/collage/bake-sticker-shadow.mjs -> src/assets/collage/<name>-shadow.webp
import sharp from 'sharp';

// CSS box each sticker is shown in (keep in sync with Trophy/Book/Cassette.astro).
const ITEMS = [
  { name: 'trophy', w: 134, h: 231 },
  { name: 'book', w: 160, h: 155 },
  { name: 'cassette', w: 196, h: 125 },
];
export const PAD = { l: 22, r: 22, t: 10, b: 34 }; // CSS px: 3 sigma around the shadow, which sits 12px lower
const SHADOW = { dy: 12, sigma: 7, rgb: [4, 8, 3], a: 0.55 };

for (const it of ITEMS) {
  const src = await sharp(`src/assets/collage/${it.name}.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const iw = src.info.width, ih = src.info.height;
  // object-fit: contain inside the CSS box: R image px per CSS px, image centred in the box.
  const R = Math.max(iw / it.w, ih / it.h);
  const W = Math.round((it.w + PAD.l + PAD.r) * R), H = Math.round((it.h + PAD.t + PAD.b) * R);
  const ox = Math.round(PAD.l * R + (it.w * R - iw) / 2), oy = Math.round(PAD.t * R + (it.h * R - ih) / 2);
  const dy = Math.round(SHADOW.dy * R);
  // Silhouette shifted down by the shadow offset, then blurred.
  const sil = Buffer.alloc(W * H);
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
    const Y = y + oy + dy, X = x + ox;
    if (Y < H && X < W) sil[Y * W + X] = src.data[(y * iw + x) * 4 + 3];
  }
  const blurred = await sharp(sil, { raw: { width: W, height: H, channels: 1 } }).blur(SHADOW.sigma * R).extractChannel(0).raw().toBuffer();
  // Premultiplied "over": shadow, then the art.
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    const over = (cr, cg, cb, ca) => { r = cr * ca + r * (1 - ca); g = cg * ca + g * (1 - ca); b = cb * ca + b * (1 - ca); a = ca + a * (1 - ca); };
    over(...SHADOW.rgb, (blurred[i] / 255) * SHADOW.a);
    const x = (i % W) - ox, y = Math.floor(i / W) - oy;
    if (x >= 0 && y >= 0 && x < iw && y < ih) { const j = (y * iw + x) * 4; over(src.data[j], src.data[j + 1], src.data[j + 2], src.data[j + 3] / 255); }
    out[i * 4] = a ? Math.round(r / a) : 0; out[i * 4 + 1] = a ? Math.round(g / a) : 0; out[i * 4 + 2] = a ? Math.round(b / a) : 0; out[i * 4 + 3] = Math.round(a * 255);
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(`src/assets/collage/${it.name}-shadow.webp`);
  console.log(it.name, `${W}x${H}`, 'R', R.toFixed(3));
}
