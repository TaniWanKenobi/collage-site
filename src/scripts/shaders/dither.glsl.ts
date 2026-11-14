// ?bg=dither: a slow warped fbm field shown through an 8x8 ordered (Bayer) dither in lime on onyx,
// to match the collage's halftone/grain. Drawn at half resolution with nearest-neighbour upscaling, so each
// dither dot is a crisp 2x2 CSS-pixel block.
import type { BgVariant } from './common.glsl';

const frag = /* glsl */ `
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
vec3 shade(vec2 uv, vec2 fc) {
  float t = u_t;
  vec2 p = uv * 1.8;
  vec2 w = vec2(fbm3(p + 0.05 * t), fbm3(p + vec2(3.1, 7.7) - 0.04 * t));
  float f = fbm3(p + 1.6 * w + vec2(0.0, 0.03 * t));
  float lum = smoothstep(0.32, 0.78, f) * 0.6;
  float b = bayer8(fc);
  vec3 col = ONYX;
  col = mix(col, mix(ONYX2, LIME, 0.13), step(b, lum));
  col = mix(col, mix(ONYX2, TINT, 0.2), step(b, lum - 0.3));
  return col;
}
`;

export default { frag, speed: 1, pixelated: true } satisfies BgVariant;
