// Bakes the collage's small map card (public/map-card.webp) from OpenStreetMap tiles, styled dark to match the site.
// The pins are not baked in: MapScrap.astro places them from src/data/places.json with the same projection
// (src/lib/map-card.ts), so adding a place only needs a re-run if it falls outside the current crop.
// Run: node scripts/map/render-card.mjs
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { CARD } from '../../src/lib/map-card.ts';

const { z, x0, y0, w, h } = CARD;
const T = 256;
const tx0 = Math.floor(x0 / T), ty0 = Math.floor(y0 / T);
const tx1 = Math.floor((x0 + w - 1) / T), ty1 = Math.floor((y0 + h - 1) / T);
const tiles = [];
for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
  const r = await fetch(`https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`, { headers: { 'User-Agent': 'collage-site-build/1.0 (one-off static render)' } });
  if (!r.ok) throw new Error(`tile ${z}/${tx}/${ty}: ${r.status}`);
  tiles.push({ input: Buffer.from(await r.arrayBuffer()), left: (tx - tx0) * T, top: (ty - ty0) * T });
}
const big = await sharp({ create: { width: (tx1 - tx0 + 1) * T, height: (ty1 - ty0 + 1) * T, channels: 3, background: '#fff' } })
  .composite(tiles).png().toBuffer();
// Crop and shrink, then recolour by hand: each pixel's brightness picks a colour between the site's onyx (water,
// which is light in OSM) and a dim lime (land), so it reads as the dark lime-on-onyx collage style.
const { data, info } = await sharp(big)
  .extract({ left: Math.round(x0 - tx0 * T), top: Math.round(y0 - ty0 * T), width: w, height: h })
  .resize(CARD.outW, CARD.outH).greyscale().raw().toBuffer({ resolveWithObject: true });
const ONYX = [13, 22, 11], LAND = [44, 66, 26], LINE = [155, 214, 63];
const px = Buffer.alloc(info.width * info.height * 3);
for (let i = 0; i < info.width * info.height; i++) {
  const v = data[i * info.channels] / 255;
  // OSM: water ~0.8, land ~0.93, roads/borders darker or brighter lines. Water -> onyx, land -> dim green,
  // dark ink (borders, labels) -> lime.
  const c = v < 0.6 ? LINE : v < 0.86 ? ONYX : LAND;
  px.set(c, i * 3);
}
const out = await sharp(px, { raw: { width: info.width, height: info.height, channels: 3 } }).webp({ quality: 85 }).toBuffer();
await writeFile(new URL('../../public/map-card.webp', import.meta.url), out);
console.log('wrote public/map-card.webp', out.length, 'bytes');
