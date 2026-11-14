// ?bg=reveal: the dither background, but a soft flashlight round the pointer makes the dither denser and
// shifts it toward the accent. Its radius eases in/out with u_pk (shader-bg.ts). One length() per pixel extra.
import type { BgVariant } from './common.glsl';
import { ditherFrag } from './dither.glsl';

const glow = /* glsl */ `(u_pk > 0.0 ? u_pk * (1.0 - smoothstep(0.06 * u_pk, 0.28 * u_pk + 1e-3, length(ptrQ(fc)))) : 0.0)`;

export default { frag: ditherFrag(glow), speed: 1, pixelated: true, pointer: 'light' } satisfies BgVariant;
