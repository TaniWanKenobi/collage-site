// ?bg=ripple: the contours background, but the lines bend round the pointer like a finger dragged through
// water, with a short wake behind the motion, and spring back once it stops (strength u_pk decays in shader-bg.ts).
// Costs two exp() per pixel on top of contours (skipped entirely while u_pk is 0).
import type { BgVariant } from './common.glsl';
import { contoursFrag } from './contours.glsl';

const warp = /* glsl */ `
  float dent = 0.0;
  if (u_pk > 0.0) {
    vec2 q = ptrQ(fc);
    const float R2 = 0.2 * 0.2;
    float f = exp(-dot(q, q) / R2);             // dent: samples pulled in, so the lines bulge out round the pointer
    vec2 qb = q + u_pv * 0.1;                   // wake: centred a little behind the motion
    float fb = exp(-dot(qb, qb) / (R2 * 2.0));
    uv += (-q * f * 2.0 - u_pv * fb * 0.06) * u_pk * (1.0 - 0.12 * u_z);
    dent = f * u_pk;
  }`;
// A shallow dip in the height field under the pointer, so a few rings show even where the field is flat.
const lift = /* glsl */ `h -= 0.12 * dent;`;

export default { frag: contoursFrag(warp, lift), speed: 1, pointer: 'wake' } satisfies BgVariant;
