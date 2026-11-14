// ?bg=dither: a slow warped fbm field shown through an 8x8 ordered (Bayer) dither in lime on onyx,
// to match the collage's halftone/grain. Drawn at half resolution with nearest-neighbour upscaling, so each
// dither dot is a crisp 2x2 CSS-pixel block.
// ditherFrag(glow) is shared with ?bg=reveal: `glow` is a GLSL float expression 0..1 (0 = the plain look) that
// makes the dither denser and shifts it toward the accent.
import type { BgVariant } from './common.glsl';

export const ditherFrag = (glow = '0.0') => /* glsl */ `
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
vec3 shade(vec2 uv, vec2 fc) {
  float t = u_t;
  vec2 p = uv * 1.8;
  vec2 w = vec2(fbm3(p + 0.05 * t), fbm3(p + vec2(3.1, 7.7) - 0.04 * t));
  float f = fbm3(p + 1.6 * w + vec2(0.0, 0.03 * t));
  float lum = smoothstep(0.32, 0.78, f) * 0.6;
  float g = ${glow};
  lum = mix(lum, 0.3 + 0.7 * lum, g);
  float b = bayer8(fc);
  vec3 col = ONYX;
  col = mix(col, mix(mix(ONYX2, LIME, 0.13), LIME, 0.6 * g), step(b, lum));
  col = mix(col, mix(mix(ONYX2, TINT, 0.2), LIME, 0.35 * g), step(b, lum - 0.3));
  return col;
}
`;

export default { frag: ditherFrag(), speed: 1, pixelated: true } satisfies BgVariant;
