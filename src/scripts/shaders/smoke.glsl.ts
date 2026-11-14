// ?bg=smoke: port of "The-Hiss" (Hack Club Shadergator ship 17) by JustMedansh,
// https://github.com/JustMedansh/The-Hiss. Changes: retinted from red to dim lime on onyx, fbm capped at
// 4 octaves (canvas is half resolution), vignette fades to onyx instead of black, uses the shared noise.
// Too heavy to redraw every scroll frame (~4-5 ms on an integrated GPU), so it is baked once and only
// panned/zoomed with the camera (baked: true): the smoke holds still instead of drifting.
//
// MIT License
//
// Copyright (c) 2026 JustMedansh
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
vec3 shade(vec2 uv, vec2 fc) {
  float t = u_t;
  vec2 flow = vec2(fbm4(uv * 2.0 + vec2(t * 0.12, 0.0)), fbm4(uv * 2.0 + vec2(5.2, -t * 0.10)));
  vec2 q = uv + (flow - 0.5) * 0.65;
  float clouds = fbm4(q * 4.0 + vec2(t * 0.08, -t * 0.16));
  float detail = fbm4(q * 10.0 - vec2(t * 0.22, t * 0.12));
  float fineDetail = vnoise(q * 25.0 + vec2(-t * 0.3, t * 0.2));
  float field = clouds * 0.65 + detail * 0.28 + fineDetail * 0.07;
  float filaments = 1.0 - smoothstep(0.025, 0.22, abs(field - 0.52));
  float mass = smoothstep(0.30, 0.68, field);
  float wisps = smoothstep(0.40, 0.73, field + filaments * 0.35);
  float streaks = 0.5 + 0.5 * sin(q.y * 32.0 + q.x * 9.0 + flow.x * 12.0 - t * 1.4);
  vec3 deep = mix(ONYX, LIME, 0.03);
  vec3 hot = mix(ONYX2, LIME, 0.08);
  vec3 col = mix(ONYX, deep, mass);
  col = mix(col, hot, wisps * 0.65);
  col += LIME * 0.04 * filaments * streaks;
  float vignette = 1.0 - smoothstep(0.35, 0.95, length(uv));
  col = mix(ONYX, col, 0.45 + vignette * 0.55);
  col = mix(ONYX, col, 0.92 + 0.08 * sin(t * 1.7 + flow.x * 4.0));
  return col;
}
`;

export default { frag, baked: true } satisfies BgVariant;
