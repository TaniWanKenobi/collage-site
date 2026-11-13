// Web-sized copies of the two photos on the collage's Photos card (PhotoStack.astro). The originals stay where they
// are: the Photos page (src/data/photos.json) uses them too.
// The card shows them through object-fit / background-size: cover on 176x110 surfaces (16:10), so only a 16:10
// crop of each is ever drawn. The crop is kept at the size it is drawn at when the camera zooms all the way into
// the card (the panel fills the 1440x900 screen, x8.2), so nothing is lost at any zoom; the oversized square
// ferry photo is cropped, and the raw JPEG cover becomes webp. The browser decodes and uploads far fewer pixels
// each time the zoomed collage is re-rastered.
// Usage (repo root): node scripts/collage/photo-stack-images.mjs -> src/assets/placeholder/photos/photo-stack-*.webp (placeholders, like their sources)
import sharp from 'sharp';

const SRC = 'src/assets/placeholder/photos/';
const W = 1600; // 16:10, about 176x110 CSS px at x8.2 zoom (1443x902) with a little to spare
for (const [name, out] of [['ferry-sky', 'photo-stack-back'], ['trail-overlook', 'photo-stack-cover']]) {
  const img = sharp(SRC + name + '.jpg');
  const m = await img.metadata();
  // cover crop, centred (object-position / background-position: center), never upscaled
  const cw = Math.min(m.width, Math.round(m.height * 1.6)), ch = Math.round(cw / 1.6);
  const left = Math.round((m.width - cw) / 2), top = Math.round((m.height - ch) / 2);
  const tw = Math.min(W, cw), th = Math.round(tw / 1.6);
  await img.extract({ left, top, width: cw, height: ch }).resize(tw, th, { kernel: 'lanczos3' }).webp({ quality: 82, effort: 6 }).toFile(`src/assets/placeholder/photos/${out}.webp`);
  console.log(name, `${m.width}x${m.height} -> crop ${cw}x${ch} -> ${tw}x${th}`);
}
