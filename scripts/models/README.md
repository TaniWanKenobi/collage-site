# Model conversion (STEP → GLB)

Turns CAD exports into small, web-ready GLB files for `public/models/`, plus a poster image for phones and still fallbacks.

## Pipeline

1. **`step-to-glb.mjs`** tessellates the STEP with OpenCascade (`occt-import-js`, wasm). It keeps each part's colors and builds a glTF with one shared material per color. Then it runs dedup → flatten → join → weld → simplify (meshoptimizer) → center → quantize, and writes the file with meshopt compression (`EXT_meshopt_compression`).
   It also accepts a `.glb` input: it skips tessellation and runs only the optimize steps.
2. **`step-to-gltf-native.py`** is for big assemblies that the wasm build can't mesh. ICE3DP came back with 0 triangles from `occt-import-js`. This script uses native OpenCascade (`pip install cadquery-ocp`) to write a raw Y-up, meter-scale GLB with part names and colors. Feed that GLB to `step-to-glb.mjs`.
3. **`optimize-glb.mjs`** optimizes any existing GLB (no STEP step), e.g. a model downloaded from GitHub. It bakes node transforms and the meter scale into the vertices, then runs dedup → join by material → weld → simplify (meshoptimizer) → textures to webp (≤1024px) → center → prune → quantize, and writes meshopt-compressed output. It assumes the input is already Y-up.
4. **`render.mjs`** renders a 1200×900 poster `.webp` headlessly. It uses `render.html` (three.js) through `agent-browser`, served by `serve.mjs`.

## Output conventions

- **Units:** meters (STEP millimeters × 0.001).
- **Axes:** Y-up. STEP Z-up is rotated −90° about X.
- **Position:** centered on the origin, at the bounding-box center.
- **Loader:** GLBs need three's `MeshoptDecoder` (`GLTFLoader.setMeshoptDecoder`). drei's `useGLTF` sets it up by default.

## Run it (PowerShell, from the repo root)

```powershell
npm install
node --max-old-space-size=12288 scripts/models/step-to-glb.mjs C:\path\to\Part.step public\models\part.glb --ratio 0.5
node scripts/models/render.mjs part --az 35 --el 22
```

For a big assembly, go through native OpenCascade first:

```powershell
python -m venv .occ-venv; .\.occ-venv\Scripts\pip install cadquery-ocp
.\.occ-venv\Scripts\python -I scripts\models\step-to-gltf-native.py C:\path\to\Big.step $env:TEMP\big-raw.glb 0.08 0.3
node --max-old-space-size=12288 scripts/models/step-to-glb.mjs $env:TEMP\big-raw.glb public\models\big.glb --ratio 0.18 --error 0.0015
```

Optimize an existing GLB (here Hack Club's Sprig, MIT, from `hackclub/sprig` `public/sprig.glb`):

```powershell
node scripts/models/optimize-glb.mjs C:\path\to\in.glb public\models\sprig.glb --ratio 0.5 --error 0.004 --longest 0.12 --tex 1024
node scripts/models/render.mjs sprig --az 20 --el 38 --fit 0.8
```

`--longest` is the target length of the longest side in meters (`0` keeps the source scale).

Then add an entry to `src/data/models.json`.

## Options for `step-to-glb.mjs`

| Flag | Default | What it does |
|---|---|---|
| `--deflection` | `0.0008` | Tessellation chord error as a fraction of the model's bounding box. Lower is smoother and heavier. |
| `--angle` | `0.35` | Angular deflection in radians. Lower gives rounder curves. |
| `--ratio` | `0.5` | Simplify target: the fraction of triangles to keep. |
| `--error` | `0.0005` | Simplify max error, relative to mesh size. Simplify stops at whichever limit it hits first. |
| `--no-simplify` | | Skip decimation. |

## Settings used for the shipped models

| Model | Source | Command flags |
|---|---|---|
| `sprig.glb` | hackclub/sprig `public/sprig.glb` (9.3MB, 77k tris, 22 materials, two 4556² PNGs) | `optimize-glb.mjs --ratio 0.5 --error 0.004 --longest 0.12` (1.39MB, 75k tris, 15 materials) |
| `tamagotchi.glb` | TaniWanKenobi/tamagotchi `CAD/Tamagotchi.step` | `--ratio 0.6` (281k → 170k triangles), then `shrink.mjs --ratio 0.35 --error 0.01` (→ 62k, 0.44 MB) |
| `ice3dp.glb` | TaniWanKenobi/ICE3DP `ICE3DP.step` | native: `0.08` mm / `0.3` rad, then `--ratio 0.18 --error 0.0015` (2.19M → 436k triangles), then `shrink.mjs --ratio 0.15 --error 0.02` (→ 165k, 1.29 MB) |

**`shrink.mjs`** re-simplifies a finished GLB for the live collage (dequantize → weld → simplify → quantize → meshopt with filters): `node scripts/models/shrink.mjs in.glb out.glb --ratio 0.15 --error 0.02`. ICE3DP bottoms out near 165k triangles because the simplifier keeps the hard CAD edges.

## Notes

- **Memory:** big STEPs (60MB+) need a big heap: keep `--max-old-space-size` high. The OpenCascade wasm itself can use about 4GB.
- **Materials:** they're double-sided, because CAD exports sometimes have inconsistent face winding. To check for flipped faces, open `render.html?...&single=1`, which renders front faces only.
