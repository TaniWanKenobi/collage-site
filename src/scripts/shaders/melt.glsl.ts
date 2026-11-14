// ?bg=melt: port of "melted-planet" (Hack Club Shadergator ship 7) by iris / ingobeans,
// https://github.com/ingobeans/melted-planet. Changes: recoloured from lavender->pink to the site palette,
// the colour is cut into anti-aliased bands with faint lime edges (the original's unused colorBand idea),
// and the two attractors drift with scroll time.
//
// MIT License
//
// Copyright (c) 2026 iris
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import type { BgVariant } from './common.glsl';

const frag = /* glsl */ `
// messed up gravity formula because yes
const float g = 0.5;
void calcForces(vec2 pos, vec2 vel, inout vec2 forces, float time, vec2 body) {
  // to make it less symmetrical and boring
  pos.y = sin(pos.y + sin(pos.x) / 6.0);
  float body_mass = 100.0;
  float d = distance(pos, body) * 0.3;
  float f = g * body_mass / d;
  vec2 delta = (body - pos) / d;
  forces += f * delta;
}
void applyForces(inout vec2 pos, inout vec2 vel, inout vec2 forces, float time) {
  vel += forces * time;
  pos += vel * time;
}
vec3 shade(vec2 uv, vec2 fc) {
  float ar = u_res.y / u_res.x, t = u_t;
  // fragCoord / iResolution.x, as in the original (uv is already zoomed/panned with the camera).
  vec2 pos = (uv * u_res.y + 0.5 * u_res) / u_res.x;
  vec2 vel = vec2(0.0);
  const int steps = 5;
  float dt = 0.1 / float(steps);
  vec2 b1 = vec2(0.1, 0.1 * ar) + 0.05 * vec2(cos(0.5 * t), sin(0.4 * t));
  vec2 b2 = vec2(0.9, 0.9 * ar) + 0.05 * vec2(sin(0.35 * t), cos(0.45 * t));
  for (int i = 0; i < steps; i++) {
    vec2 forces = vec2(0.0);
    calcForces(pos, vel, forces, dt, b1);
    calcForces(pos, vel, forces, dt, b2);
    applyForces(pos, vel, forces, dt);
  }
  float c = pos.x + pos.y;
  // Recolour: onyx -> a lavender-tinged dark -> dim lime, in bands.
  float x = clamp(0.55 * c + 0.1, 0.0, 1.0);
  float q = quant(x, 7.0);
  vec3 mid = mix(ONYX, LAV, 0.04);
  vec3 col = q < 0.5 ? mix(ONYX, mid, q * 2.0) : mix(mid, mix(ONYX2, LIME, 0.05), q * 2.0 - 1.0);
  // Faint lime line on each band edge (the "melt" contours).
  float y = x * 7.0, e = abs(fract(y + 0.5) - 0.5) / max(fwidth(y), 1e-4);
  col += LIME * 0.025 * (1.0 - smoothstep(0.0, 1.2, e));
  return col;
}
`;

export default { frag, speed: 1 } satisfies BgVariant;
