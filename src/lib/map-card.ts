// The crop of the world (web-mercator pixels at zoom z) shown on the collage map card, shared by the bake script
// (scripts/map/render-card.mjs) and MapScrap.astro, so pins land on the right spot of the baked image.
export const CARD = { z: 3, x0: 230, y0: 380, w: 1360, h: 850, outW: 720, outH: 450 };

/** lat/lng -> position on the card, as fractions (0..1) of its width and height. */
export function cardPos(lat: number, lng: number) {
  const n = 256 * 2 ** CARD.z;
  const s = Math.sin((lat * Math.PI) / 180);
  const x = ((lng + 180) / 360) * n;
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { fx: (x - CARD.x0) / CARD.w, fy: (y - CARD.y0) / CARD.h };
}
