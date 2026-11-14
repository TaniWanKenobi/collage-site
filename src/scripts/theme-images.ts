// Recolours the baked images on the home collage with the theme: the photo of me (.gr-me,
// components/collage/MePhoto.astro), the map card (.mapcard, components/collage/MapScrap.astro) and the cut-out
// stickers (img.sticker-art: trophy, cassette, book).
//
// Photo:
// The photo is a three-stop gradient map: dark (bg) -> grape (surface) -> lime, with a lime sticker outline and
// a soft drop shadow baked around it (scripts/bake-photo-outline.mjs -> tanishq-grape-cut.*). On a theme switch
// this redoes that bake in a canvas, once, from the un-outlined photo (tanishq-grape.png):
//  - each pixel's lightness picks a point on a new ramp whose three stops take the theme's hues (dark: bg on dark
//    themes, ink on light ones; mid: surface; light: accent) at the ORIGINAL stops' lightness (OKLab L), so the
//    face keeps its shading in any theme (a pale palette can't wash it out or invert it);
//  - the outline is the silhouette dilated 3px in the accent, the shadow the theme's shadow colour.
// The result is set as the img (and <source>) URL; the default theme puts the original files back. Nothing runs
// per frame: the zoomed collage paints a plain image, as before. Results are cached per theme.
// Photo tuning (DEFAULT_TUNE, PHOTO_TUNE per preset): olive's greens are kept low in chroma and its shadows lean into the purple
// page. Simultaneous contrast does the rest: a muted, near-grey green next to a purple surround (its complement)
// reads as clearly green, so the photo still looks olive without being as loud as the background.
//
// Map card: a dark baked OpenStreetMap image (scripts/map/render-card.mjs): near-black water, dim lime land. Each
// pixel's place between the water and land lightness is mapped onto the theme's bg-2 (water) -> surface (land),
// with land pushed apart from water when the two theme colours are too close in lightness to read as a map.
import { onTheme, rgbOf, type Theme } from './theme-vars';

const R = 2, PAD = { l: 30, r: 30, t: 10, b: 50 }, CSS_H = 470; // same as bake-photo-outline.mjs
const SHADOW = { dy: 18, sigma: 13 };

/* ---- OKLab (to keep the photo's lightness while taking the theme's hue) ---- */
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toLab([r, g, b]: number[]) {
  const R_ = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R_ + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R_ + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R_ + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function toRgb([L, a, b]: number[]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193263 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((c) => Math.max(0, Math.min(255, Math.round(gam(Math.max(0, Math.min(1, c)))))));
}

// The original ramp's three stops (measured from tanishq-grape.png): onyx, grape, lime-tint highlight.
const ORIG = [[21, 28, 24], [89, 81, 127], [212, 249, 149]].map(toLab);

/** A 256-entry RGB lookup: original OKLab L (0..1 scaled to 0..255) -> theme colour. */
// chroma multipliers per stop; midFromBg takes the mid-tones' hue from the page instead of the surface;
// lightRot turns the highlight hue (degrees in OKLab a/b; positive = towards yellow for greens)
type Tune = { dark: number; mid: number; light: number; midFromBg?: boolean; lightRot?: number };
const PHOTO_TUNE: Record<string, Tune> = {
  // shadows and mid-tones in the page's purple, highlights a quiet, warmer (olive, not mint) green: on the purple
  // page the low-chroma green still reads as green (complementary contrast), it just doesn't shout
  olive: { dark: 1, mid: 0.6, light: 0.6, midFromBg: true, lightRot: 25 },
};
// Every other theme gets the same idea without the hue turn: shadows and mid-tones take the page's hue (so the
// photo sits in the page), highlights the accent at 60% chroma (it still reads as the accent next to the page).
const DEFAULT_TUNE: Tune = { dark: 1, mid: 0.6, light: 0.6, midFromBg: true };

function ramp(t: Theme, light: boolean, tune: Tune = DEFAULT_TUNE) {
  const hue = [light ? t.ink : t.bg, tune.midFromBg ? t.bg : t.surface, t.accent].map((h) => toLab(rgbOf(h)));
  if (tune.lightRot) {
    const r = (-tune.lightRot * Math.PI) / 180, [, a, b] = hue[2];
    hue[2] = [hue[2][0], a * Math.cos(r) - b * Math.sin(r), a * Math.sin(r) + b * Math.cos(r)];
  }
  // each stop: original lightness, theme a/b (chroma scaled a little for the dark stop so it stays near-neutral)
  const mul = [tune.dark, tune.mid, tune.light];
  const stops = ORIG.map((o, i) => [o[0], hue[i][1] * mul[i], hue[i][2] * mul[i]]);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let k = 0; k < 256; k++) {
    const L = k / 255;
    let c: number[];
    if (L <= stops[0][0]) c = [L, stops[0][1], stops[0][2]];
    else if (L >= stops[2][0]) c = [L, stops[2][1], stops[2][2]];
    else {
      const [a, b] = L < stops[1][0] ? [stops[0], stops[1]] : [stops[1], stops[2]];
      const f = (L - a[0]) / (b[0] - a[0]);
      c = [L, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
    lut.set(toRgb(c), k * 3);
  }
  return lut;
}

let srcImg: Promise<HTMLImageElement> | null = null;
function loadSrc(cutUrl: string) {
  return (srcImg ??= new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im); im.onerror = rej;
    im.src = cutUrl.replace(/tanishq-grape-cut\.\w+$/, 'tanishq-grape.png');
  }));
}

async function bake(t: Theme, light: boolean, cutUrl: string, tune?: Tune): Promise<string> {
  const im = await loadSrc(cutUrl);
  const ph = CSS_H * R, pw = Math.round((im.naturalWidth / im.naturalHeight) * ph);
  const W = pw + (PAD.l + PAD.r) * R, H = ph + (PAD.t + PAD.b) * R, ox = PAD.l * R, oy = PAD.t * R;
  // 1. the photo, scaled up and gradient-mapped
  const p = document.createElement('canvas'); p.width = pw; p.height = ph;
  const pc = p.getContext('2d', { willReadFrequently: true })!;
  pc.imageSmoothingQuality = 'high';
  pc.drawImage(im, 0, 0, pw, ph);
  const d = pc.getImageData(0, 0, pw, ph), px = d.data, lut = ramp(t, light, tune);
  const lcache = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let k = lcache.get(key);
    if (k === undefined) { k = Math.round(Math.max(0, Math.min(1, toLab([px[i], px[i + 1], px[i + 2]])[0])) * 255); lcache.set(key, k); }
    px[i] = lut[k * 3]; px[i + 1] = lut[k * 3 + 1]; px[i + 2] = lut[k * 3 + 2];
  }
  pc.putImageData(d, 0, 0);
  // 2. the outline: the silhouette at the 3x3 grid of ±3px shifts, filled with the accent
  const o = document.createElement('canvas'); o.width = W; o.height = H;
  const oc = o.getContext('2d')!, s = 3 * R;
  for (const dy of [-s, 0, s]) for (const dx of [-s, 0, s]) oc.drawImage(p, ox + dx, oy + dy);
  oc.globalCompositeOperation = 'source-in';
  oc.fillStyle = t.accent; oc.fillRect(0, 0, W, H);
  // 3. shadow (canvas shadowBlur is 2 x sigma), outline, photo
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cc = c.getContext('2d')!;
  const [r, g, b] = rgbOf(t.shadow);
  cc.shadowColor = `rgba(${r},${g},${b},${light ? 0.4 : 0.65})`;
  cc.shadowBlur = 2 * SHADOW.sigma * R; cc.shadowOffsetY = SHADOW.dy * R;
  cc.drawImage(o, 0, 0);
  cc.shadowColor = 'transparent';
  cc.drawImage(p, ox, oy);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/webp', 0.9));
  if (!blob) throw new Error('toBlob failed');
  return URL.createObjectURL(blob);
}

const cache = new Map<string, Promise<string>>();
let want = '';

async function apply(t: Theme, spec: string, light: boolean) {
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.gr-me img'));
  if (!imgs.length) return;
  want = spec;
  for (const img of imgs) {
    // remember the original sources once
    const pic = img.parentElement?.tagName === 'PICTURE' ? img.parentElement : null;
    const sources = pic ? Array.from(pic.querySelectorAll('source')) : [];
    if (!img.dataset.origSrc) { img.dataset.origSrc = img.getAttribute('src') || ''; sources.forEach((s) => (s.dataset.origSrcset = s.getAttribute('srcset') || '')); }
    if (!spec) { img.src = img.dataset.origSrc; sources.forEach((s) => s.setAttribute('srcset', s.dataset.origSrcset || '')); continue; }
    const key = spec;
    if (!cache.has(key)) cache.set(key, bake(t, light, img.dataset.origSrc, PHOTO_TUNE[spec] || DEFAULT_TUNE));
    let url: string;
    try { url = await cache.get(key)!; } catch { cache.delete(key); return; }
    if (want !== spec) return; // switched again while baking
    sources.forEach((s) => s.setAttribute('srcset', url));
    img.src = url;
  }
}

/* ---- map card ---- */
const mapCache = new Map<string, Promise<string>>();
let mapWant = '';
const imgCache = new Map<string, Promise<HTMLImageElement>>();
const loadImg = (u: string) => {
  if (!imgCache.has(u)) imgCache.set(u, new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; }));
  return imgCache.get(u)!;
};

async function bakeMap(t: Theme, light: boolean, src: string): Promise<string> {
  const im = await loadImg(src);
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const cc = c.getContext('2d', { willReadFrequently: true })!;
  cc.drawImage(im, 0, 0);
  const d = cc.getImageData(0, 0, c.width, c.height), px = d.data;
  const Lw = toLab([14, 22, 13])[0], Ll = toLab([44, 66, 27])[0]; // the baked water and land (measured)
  const water = toLab(rgbOf(t.bg2)), land = toLab(rgbOf(t.surface));
  // keep at least .12 OKLab lightness between water and land so the coastline reads
  const gap = 0.12, dir = light ? -1 : 1; // land darker than water on light themes, lighter on dark ones
  if ((land[0] - water[0]) * dir < gap) land[0] = Math.max(0, Math.min(1, water[0] + dir * gap));
  const lut = new Uint8ClampedArray(256 * 3);
  for (let k = 0; k < 256; k++) {
    const f = (k / 255 - Lw) / (Ll - Lw); // 0 = water, 1 = land, beyond = brighter details
    const fc = Math.max(0, Math.min(1, f));
    lut.set(toRgb([water[0] + (land[0] - water[0]) * f, water[1] + (land[1] - water[1]) * fc, water[2] + (land[2] - water[2]) * fc]), k * 3);
  }
  const lc = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let k = lc.get(key);
    if (k === undefined) { k = Math.round(Math.max(0, Math.min(1, toLab([px[i], px[i + 1], px[i + 2]])[0])) * 255); lc.set(key, k); }
    px[i] = lut[k * 3]; px[i + 1] = lut[k * 3 + 1]; px[i + 2] = lut[k * 3 + 2];
  }
  cc.putImageData(d, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/webp', 0.9));
  if (!blob) throw new Error('toBlob failed');
  return URL.createObjectURL(blob);
}

async function applyMap(t: Theme, spec: string, light: boolean) {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.mapcard'));
  mapWant = spec;
  for (const el of cards) {
    // computed, not el.style: the inline `background:` shorthand holds a var(), so its longhands read back empty
    if (el.dataset.origBg === undefined) el.dataset.origBg = getComputedStyle(el).backgroundImage;
    if (!spec) { el.style.backgroundImage = el.dataset.origBg; continue; }
    const src = (el.dataset.origBg.match(/url\(["']?([^"')]+)/) || [])[1];
    if (!src) continue;
    if (!mapCache.has(spec)) mapCache.set(spec, bakeMap(t, light, src));
    let u: string;
    try { u = await mapCache.get(spec)!; } catch { mapCache.delete(spec); return; }
    if (mapWant !== spec) return;
    el.style.backgroundImage = `url(${u})`;
  }
}

/* ---- cut-out stickers (trophy, cassette, book: .sticker-art) ---- */
// Same gradient map as the photo (same ramp and tuning), so they read as one set: each pixel keeps its lightness and
// alpha (their baked drop shadows included) and takes the theme's hue for that lightness.
const stickerCache = new Map<string, Promise<string>>();
let stickerWant = '';

async function bakeSticker(t: Theme, light: boolean, src: string, tune: Tune): Promise<string> {
  const im = await loadImg(src);
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const cc = c.getContext('2d', { willReadFrequently: true })!;
  cc.drawImage(im, 0, 0);
  const d = cc.getImageData(0, 0, c.width, c.height), px = d.data, lut = ramp(t, light, tune);
  const lc = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let k = lc.get(key);
    if (k === undefined) { k = Math.round(Math.max(0, Math.min(1, toLab([px[i], px[i + 1], px[i + 2]])[0])) * 255); lc.set(key, k); }
    px[i] = lut[k * 3]; px[i + 1] = lut[k * 3 + 1]; px[i + 2] = lut[k * 3 + 2];
  }
  cc.putImageData(d, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/webp', 0.9));
  if (!blob) throw new Error('toBlob failed');
  return URL.createObjectURL(blob);
}

async function applyStickers(t: Theme, spec: string, light: boolean) {
  stickerWant = spec;
  await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('img.sticker-art')).map(async (img) => {
    if (!img.dataset.origSrc) img.dataset.origSrc = img.currentSrc || img.src;
    const src = img.dataset.origSrc;
    if (!spec) { img.src = src; return; }
    const key = spec + '|' + src;
    if (!stickerCache.has(key)) stickerCache.set(key, bakeSticker(t, light, src, PHOTO_TUNE[spec] || DEFAULT_TUNE));
    let u: string;
    try { u = await stickerCache.get(key)!; } catch { stickerCache.delete(key); return; }
    if (stickerWant === spec) img.src = u;
  }));
}

onTheme((colors, d) => { void apply(colors, d.spec, d.mode === 'light'); void applyMap(colors, d.spec, d.mode === 'light'); void applyStickers(colors, d.spec, d.mode === 'light'); });
// theme.ts sends theme:change on load too, so a page opened with ?theme= is recoloured as well.
