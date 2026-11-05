# Design lab (`/lab/`)

A private playground for the home-page collage and for 3D files. Every lab page has
`noindex, nofollow`, and nothing in the site's nav links to it. Open it directly:

- local dev: `http://localhost:4321/collage-site/lab/`
- deployed: `https://taniwankenobi.github.io/collage-site/lab/`

## What's there

| Page | What it is |
| --- | --- |
| `/lab/` | Grid of thumbnails for every variant plus the viewer. Thumbnails are static (no three.js). |
| `/lab/collage-1` … `/lab/collage-6` | One 1440×900 collage composition each, scaled to fit the window. Prev / All / next in the top bar. |
| `/lab/viewer` | Drop-in 3D viewer for STEP, IGES, BREP, STL, OBJ(+MTL), GLB/GLTF, 3MF and PLY. |

## Files

```
src/components/lab/
  lab.ts             MODELS, VARIANTS (order, titles, one-line idea), ORIG (original card boxes)
  LabBase.astro      page shell: global.css, fonts, noindex, the stage-scaling script
  LabChrome.astro    top bar for variant pages
  Stage.astro        1440×900 world that scales to its container (fit="page" or "width")
  Place.astro        moves / rotates / scales an existing collage card without editing it
  ModelView.astro    a live 3D model slot (poster → canvas), shapes: rect, circle, sticker
  model-slots.ts     tiny loader: waits until a slot is near the viewport, then imports...
  model-runtime.ts   ...three.js, GLTFLoader + Meshopt; one shared WebGL renderer per page
  variants/CollageN.astro
  viewer/viewer.ts, occt.ts, duotone.ts
src/pages/lab/index.astro, [variant].astro, viewer.astro
```

The existing cards in `src/components/collage/` are imported as they are, never edited. Variants
render them with `mode="phone"` (plain links, no React islands).

## Add a collage variant

1. Create `src/components/lab/variants/Collage7.astro`. Everything inside is positioned in a
   1440×900 world. Accept `thumb?: boolean` and pass `live={!thumb}` to any `ModelView`, so
   the index thumbnail never loads three.js.
2. Place cards with `Place`. `k` is the card key from `ORIG` in `lab.ts`; `x`/`y` are the new
   centre in world pixels, `rot` the absolute rotation, `s` a scale, `z` the stacking order:

   ```astro
   <Place k="polaroid" x={240} y={250} rot={-10} s={1.1} z={12}><Polaroid mode="phone" /></Place>
   ```

3. Add a live model if you want one:

   ```astro
   <ModelView k="ice3dp" left={360} top={90} width={720} height={720}
              shape="rect" fill={0.9} elev={22} azim={35} live={live} />
   ```

   `fill` is how much of the box the model fills, `elev`/`azim` the starting camera angle in
   degrees. Until the GLB has loaded the slot shows `public/models/<name>.webp`; if that is
   missing too it shows a dashed placeholder, and "model not found" if the GLB 404s.
4. Register it: add an entry to `VARIANTS` in `lab.ts` (`slug: 'collage-7'`, `title`, `idea`),
   and add the component to the `COMPONENTS` maps in `src/pages/lab/[variant].astro` and
   `src/pages/lab/index.astro`. Prev/next and the index pick it up from `VARIANTS`.

Stay in the palette tokens from `global.css` (`--onyx`, `--onyx-2`, `--grape`, `--grape-deep`,
`--grape-lite`, `--lime`, `--lime-tint`, `--muted`). Don't use grape as text on onyx. No
generated art: only the existing cards, photos and the real CAD models.

### Models

`MODELS` in `lab.ts` points at `public/models/<name>.glb` and `<name>.webp` (made by the models
pipeline from the ICE3DP and tamagotchi repos). To add another, drop its `.glb` (Meshopt
compression is fine) and a `.webp` poster in `public/models/` and add an entry to `MODELS`.

All model slots on a page share one WebGL renderer: each slot is drawn into an offscreen buffer
and copied into its own 2D canvas, so cards can still overlap models normally. Rendering pauses
when a slot is off screen or the tab is hidden, and auto-rotate is off with reduced motion.

## Use the viewer

Open `/lab/viewer`, then choose files or drop them anywhere on the page. Nothing is uploaded.

- **STEP / IGES / BREP** go through [occt-import-js](https://github.com/kovacsv/occt-import-js)
  (OpenCascade in wasm). The 7.6 MB wasm only downloads the first time you open one of these,
  and parsing runs in a worker. "STEP detail" sets the tessellation (Draft / Normal / Fine);
  pick it before loading. Per-face colours in the STEP file are kept.
- **GLTF with external files / OBJ with MTL and textures**: select or drop all the files
  together (`.gltf` + `.bin` + images, or `.obj` + `.mtl` + images). They are matched by
  file name.
- **PLY** without faces is shown as a point cloud.
- **Up axis**: "Auto" treats STEP, IGES, STL and 3MF as Z-up (CAD convention) and the rest as
  Y-up. Switch it if the model lies on its side.

Panel: file, format, total size, triangle count, parse time (for CAD the first file also
includes the wasm download) and mesh count. Toggles for grid, wireframe, grape duotone
(a three-tone shader: onyx → grape → lime-tint, with a lime rim) and auto-rotate. Backgrounds:
onyx, grape, lime, or transparent (shown as a checkerboard; PNG export keeps the transparency).

Buttons: **Fit** re-frames, **Export PNG** saves the current view at canvas resolution,
**Export GLB** saves the model with its own materials (never the duotone shader) and the
current up-axis applied, **Clear** empties the scene.

Keyboard: every control is a native input. With the canvas focused, arrow keys orbit (Shift for
small steps), `+`/`-` zoom, `F` or `0` frames the model.

Not supported: Draco-compressed GLTF, KTX2 textures, and files that need a network fetch.
