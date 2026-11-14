// ?bg=satin: folded satin. Look inspired by msw's (Max Wofford's) wpr-satin wallpaper
// (github.com/maxwofford/wpr-satin): double domain-warped fbm into a stepped palette ramp, plus grain.
// Own implementation of the technique (that repo has no license); recoloured to the site palette.
// Five fbm calls per pixel is too heavy per scroll frame (~5 ms on an integrated GPU): baked once, then
// only panned/zoomed with the camera (baked: true).
import type { BgVariant } from './common.glsl';

const frag = /* glsl */ `
vec3 ramp(float x) {
  vec3 a = ONYX, b = mix(ONYX2, LAV, 0.05), c = mix(ONYX2, LIME, 0.09), d = mix(ONYX2, TINT, 0.2);
  x = clamp(x, 0.0, 1.0);
  return x < 0.45 ? mix(a, b, x / 0.45) : x < 0.8 ? mix(b, c, (x - 0.45) / 0.35) : mix(c, d, (x - 0.8) / 0.2);
}
vec3 shade(vec2 uv, vec2 fc) {
  float t = u_t;
  vec2 p = uv * 1.5;
  // Warp 1: an fbm vector field.
  vec2 q = vec2(fbm4(p + vec2(0.0, 0.05 * t)), fbm4(p + vec2(5.2, 1.3) - 0.04 * t));
  // Warp 2: fbm sampled through warp 1.
  vec2 r = vec2(fbm4(p + 3.5 * q + vec2(1.7, 9.2) + 0.07 * t), fbm4(p + 3.5 * q + vec2(8.3, 2.8) - 0.05 * t));
  float f = fbm4(p + 3.0 * r);
  // Folds: a sine of the warped field gives long bent fabric bands; blend with the raw field for depth.
  float folds = 0.5 + 0.5 * sin(6.2832 * (1.4 * f + 0.4 * r.x));
  float v = mix(f * 1.25 - 0.15, folds, 0.65) * smoothstep(0.1, 0.75, f + 0.2);
  return ramp(quant(v, 7.0));
}
`;

export default { frag, baked: true } satisfies BgVariant;
