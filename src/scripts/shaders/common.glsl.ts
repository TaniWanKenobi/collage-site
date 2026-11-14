// Shared GLSL for the ?bg= shader backgrounds (scripts/shader-bg.ts). GLSL ES 3.00 (WebGL2).
// Every variant file defines `vec3 shade(vec2 uv, vec2 fc)`: uv is centred, y-up, 1 unit = viewport height
// (already zoomed/panned with the camera); fc is the canvas pixel. u_t is scroll-driven time.

export const HEAD = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_t;
uniform float u_z;
uniform vec2 u_pan;
out vec4 o_col;

// Palette (sRGB 0..1), set by shader-bg.ts from the colour theme (scripts/theme-vars.ts): ONYX = bg, ONYX2 = bg-2,
// LIME = accent, TINT = text, LAV = deco (use sparingly). Default theme: #0D160B, #172315, #C2F970, #EFFDD8, #8F86C0.
uniform vec3 ONYX, ONYX2, LIME, TINT, LAV;

// Pointer (variants with a "pointer" kind; shader-bg.ts eases these): u_ptr = pointer in canvas px, u_pk = strength
// 0..1 (0 = no effect), u_pv = pointer velocity in viewport heights per second (y-up).
uniform vec2 u_ptr;
uniform float u_pk;
uniform vec2 u_pv;
// Screen-space offset of this pixel from the pointer, in viewport heights (independent of the camera zoom/pan).
vec2 ptrQ(vec2 fc) { return (fc - u_ptr) / u_res.y; }

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);
// Octaves are capped at 4: the canvas is drawn at half resolution, finer octaves would only alias.
float fbm3(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = ROT * p * 2.03 + 17.1; a *= 0.5; } return v; }
float fbm4(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = ROT * p * 2.03 + 17.1; a *= 0.5; } return v; }
// x quantised into n hard steps with a ~1px anti-aliased edge.
float quant(float x, float n) { float y = x * n, w = clamp(fwidth(y), 1e-4, 1.0); return (floor(y) + smoothstep(1.0 - w, 1.0, fract(y))) / n; }
`;

// Live variants follow the camera in the shader (zoom + pan). Baked ("static") variants are drawn once over a
// slightly larger area (extent > 1) with no camera, and shader-bg.ts pans/zooms the resulting texture instead.
export const main = (extent: number, camera: boolean) => /* glsl */ `
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - 0.5 * u_res) / u_res.y * ${extent.toFixed(3)};
  ${camera ? 'uv = uv * (1.0 - 0.12 * u_z) + u_pan;' : ''}
  vec3 c = shade(uv, fc);
  c += (h21(fc + 0.5) - 0.5) * (2.5 / 255.0); // dither away 8-bit banding in the dark gradients
  o_col = vec4(c, 1.0);
}
`;

export interface BgVariant {
  /** GLSL defining `vec3 shade(vec2 uv, vec2 fc)` (plus helpers). */
  frag: string;
  /** Multiplier on scroll-driven time. */
  speed?: number;
  /** Nearest-neighbour upscaling (for the dither pattern). */
  pixelated?: boolean;
  /** Too heavy to redraw per frame: bake once into a texture, then only pan/zoom it with the camera. */
  baked?: boolean;
  /** Reacts to the (mouse/pen) pointer: 'wake' = a dent while it moves that springs back after it stops,
   *  'light' = a glow that stays while it is over the page. Live variants only. */
  pointer?: 'wake' | 'light';
}
