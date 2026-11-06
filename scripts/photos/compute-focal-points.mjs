/**
 * Photo album prep: finds each photo's focal point with smartcrop and writes it back into
 * src/data/photos.json, so the polaroid crops (CSS object-position) keep the subject in frame.
 *
 * Adapted, with permission, from Clay Nicholson's scripts/compute-focal-points.mjs
 * (https://github.com/claynicholson/claynicholson-personal). Changes: reads/writes photos.json instead of a
 * public/ scan, crops to the aspect the polaroid actually shows (not always square), records an aspect bucket
 * (portrait / landscape / square) plus pixel size, and uses smartcrop core with sharp 0.35 (the version Astro
 * already ships) instead of smartcrop-sharp, which pins sharp 0.32.
 *
 * Usage: npm run photos
 *   - Every entry in photos.json gets: focus ("x% y%"), bucket, width, height.
 *   - Any image in src/assets/photos/ not listed yet is appended with an empty caption for you to fill in.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import sharp from 'sharp';
import smartcrop from 'smartcrop';

const ASSETS = 'src/assets';
const NEW_PHOTOS_DIR = 'photos'; // under src/assets; drop real photos here
const DATA = 'src/data/photos.json';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
// Window shape the polaroid shows for each bucket (width / height). Keep in sync with src/styles/photos.css.
const WINDOW = { landscape: 4 / 3, portrait: 3 / 4, square: 1 };
const ANALYSE_PX = 256; // smartcrop works on a small copy; plenty for finding a subject

function bucketFor(w, h) {
  const r = w / h;
  if (r > 1.15) return 'landscape';
  if (r < 0.87) return 'portrait';
  return 'square';
}

// smartcrop's image adapter: hand it a pre-shrunk RGBA buffer so it never needs to resample.
function sharpOps(raw) {
  return {
    open: async () => ({ width: raw.info.width, height: raw.info.height }),
    resample: async (img) => img,
    getData: async () => new smartcrop.ImgData(raw.info.width, raw.info.height, raw.data),
  };
}

async function analyse(file) {
  const path = join(ASSETS, file);
  // EXIF orientations 5-8 are rotated 90°, so phone photos are measured the way they display.
  const meta = await sharp(path).metadata();
  const turned = (meta.orientation ?? 1) >= 5;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;
  const bucket = bucketFor(width, height);
  const raw = await sharp(path)
    .rotate()
    .resize(ANALYSE_PX, ANALYSE_PX, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const aspect = WINDOW[bucket];
  const { topCrop: c } = await smartcrop.crop(null, {
    width: aspect >= 1 ? 100 : Math.round(100 * aspect),
    height: aspect >= 1 ? Math.round(100 / aspect) : 100,
    prescale: false,
    imageOperations: sharpOps(raw),
  });
  // Crop centre as percentages of the image = an object-position that keeps that region in view.
  const x = Math.round(((c.x + c.width / 2) / raw.info.width) * 100);
  const y = Math.round(((c.y + c.height / 2) / raw.info.height) * 100);
  return { focus: `${x}% ${y}%`, bucket, width, height };
}

async function main() {
  const photos = JSON.parse(await readFile(DATA, 'utf8'));
  const listed = new Set(photos.map((p) => p.file));

  const dir = join(ASSETS, NEW_PHOTOS_DIR);
  if (existsSync(dir)) {
    for (const f of (await readdir(dir)).sort()) {
      const file = `${NEW_PHOTOS_DIR}/${f}`;
      if (IMAGE_EXTS.has(extname(f).toLowerCase()) && !listed.has(file)) {
        photos.push({ file, caption: '', place: '', date: '' });
        console.log(`  + added ${file} (fill in caption, place, date)`);
      }
    }
  }

  console.log(`Analysing ${photos.length} photos...`);
  let done = 0;
  const BATCH = 8;
  for (let i = 0; i < photos.length; i += BATCH) {
    await Promise.all(
      photos.slice(i, i + BATCH).map(async (p) => {
        try {
          Object.assign(p, await analyse(p.file));
        } catch (err) {
          console.error(`\n  SKIP ${p.file}: ${err.message}`);
          p.focus ??= '50% 50%';
          p.bucket ??= 'landscape';
        }
        process.stdout.write(`\r  ${++done}/${photos.length}`);
      }),
    );
  }

  await writeFile(DATA, JSON.stringify(photos, null, 2) + '\n');
  console.log(`\nDone. Wrote ${photos.length} entries to ${DATA}`);
}

main();
