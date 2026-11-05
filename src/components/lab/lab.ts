// Shared data for the design lab (/lab). Nothing here is used by the main site.

/** 3D models the lab collages can show. Files live in public/models/ (added by the models pipeline). */
export const MODELS = {
  ice3dp: {
    label: 'ICE3DP',
    glb: 'models/ice3dp.glb',
    poster: 'models/ice3dp.webp',
    repo: 'https://github.com/TaniWanKenobi/ICE3DP',
  },
  tamagotchi: {
    label: 'Tamagotchi',
    glb: 'models/tamagotchi.glb',
    poster: 'models/tamagotchi.webp',
    repo: 'https://github.com/TaniWanKenobi/tamagotchi',
  },
} as const;
export type ModelKey = keyof typeof MODELS;

/** Collage variants, in order. The slug is the page URL: /lab/<slug>. */
export const VARIANTS = [
  { slug: 'collage-1', title: 'Bento grid', idea: 'Every card squared up in its own tile. Calm, scannable, still in the grape palette.' },
  { slug: 'collage-2', title: 'Scrapbook pile', idea: 'Everything dumped in the middle: heavy overlap, big rotations, tape everywhere.' },
  { slug: 'collage-3', title: 'Orbit', idea: 'The photo and globe in the centre, with the cards travelling around them on a ring.' },
  { slug: 'collage-4', title: 'ICE3DP hero', idea: 'The full ICE3DP model is the centrepiece, live in 3D; the cards frame it.' },
  { slug: 'collage-5', title: 'Workbench', idea: 'A cutting mat with the tamagotchi sitting on it like an object on the desk, papers pushed to the edges.' },
  { slug: 'collage-6', title: 'Model stickers', idea: 'Both models as die-cut stickers slapped among the cards, on the original layout.' },
] as const;

/** Original boxes of the collage pieces in the 1440x900 world: [left, top, width, height, rotation]. */
export const ORIG = {
  polaroid: [66, 390, 248, 216, -6],
  ticket: [300, 150, 236, 110, 4],
  photos: [880, 130, 194, 153, 7],
  note: [1150, 420, 220, 148, -3],
  map: [840, 575, 240, 150, -5],
  sticky: [370, 560, 204, 160, 8],
  stamp: [1230, 120, 170, 170, -12],
  me: [700, 436, 228, 470, 0],
  globe: [520, 210, 400, 400, 0],
  word: [36, 92, 965, 230, 0],
} as const;
export type PieceKey = keyof typeof ORIG;
