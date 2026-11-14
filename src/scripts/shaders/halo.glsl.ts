// ?bg=halo: a quantised light halo round a dark crescent moon, in a soft noise cloud.
// Look inspired by msw's (Max Wofford's) wpr-crescent wallpaper (github.com/maxwofford/wpr-crescent):
// hard anti-aliased halo bands + value-noise cloud. Own implementation (that repo has no license).
import type { BgVariant } from './common.glsl';

const frag = /* glsl */ `
vec3 shade(vec2 uv, vec2 fc) {
  float t = u_t, asp = u_res.x / u_res.y;
  vec2 c0 = vec2(0.36 * asp, 0.24) + 0.03 * vec2(sin(0.3 * t), cos(0.23 * t));
  float cloud = fbm4(uv * 2.2 + vec2(0.06 * t, -0.03 * t));
  float d = length(uv - c0);
  // Halo: exponential falloff, bent by the cloud, cut into hard bands.
  float L = exp(-1.9 * (d + 0.25 * (cloud - 0.5)));
  float bands = quant(L, 8.0);
  vec3 col = mix(ONYX, mix(ONYX2, LIME, 0.13), bands * bands);
  // Soft cloud: faint lift where the noise is thick (a breath of lavender in it).
  col += mix(LIME, LAV, 0.5) * 0.025 * smoothstep(0.45, 0.8, cloud);
  // The moon: a dark disc with a lit crescent rim facing the light.
  float R = 0.13, w = fwidth(d);
  float disc = 1.0 - smoothstep(R - w, R + w, d);
  float d2 = length(uv - c0 - vec2(0.02, -0.017));
  float rim = disc * smoothstep(R - 0.006 - w, R - 0.006 + w, d2);
  col = mix(col, ONYX * 0.85, disc);
  col = mix(col, mix(ONYX2, TINT, 0.3), rim);
  return col;
}
`;

export default { frag, speed: 1 } satisfies BgVariant;
