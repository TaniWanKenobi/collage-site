// ?bg=contours: faint topographic isolines over an fbm height field, every fifth line a little brighter.
// Technique similar to msw's (Max Wofford's) wpr-neon-contours; own implementation.
// contoursFrag(warp, lift) is shared with ?bg=ripple: `warp` is GLSL run first that may displace `uv`, `lift` is
// GLSL run after the height `h` is known that may change it.
import type { BgVariant } from './common.glsl';

export const contoursFrag = (warp = '', lift = '') => /* glsl */ `
vec3 shade(vec2 uv, vec2 fc) {
  float t = u_t;
  ${warp}
  vec2 p = uv * 1.3 + vec2(0.02 * t, 0.0);
  vec2 w = vec2(vnoise(p * 1.7 + 3.0), vnoise(p * 1.7 + 11.0));
  float h = fbm4(p + 0.6 * w);
  ${lift}
  vec3 col = mix(ONYX, ONYX2, smoothstep(0.3, 0.75, h)); // faint elevation shading
  float y = h * 16.0 - 0.15 * t; // lines creep as you scroll
  float fw = max(fwidth(y), 1e-4);
  float line = 1.0 - smoothstep(0.0, 1.0, abs(fract(y - 0.5) - 0.5) / fw);
  float major = step(mod(floor(y + 0.5), 5.0), 0.5);
  return mix(col, TINT, line * (0.09 + 0.09 * major));
}
`;

export default { frag: contoursFrag(), speed: 1 } satisfies BgVariant;
