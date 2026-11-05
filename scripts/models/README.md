# Model conversion (STEP → GLB)

Turns CAD exports into small, web-ready GLB files for `public/models/`, plus a poster image for phones and still fallbacks.

## Pipeline

1. **`step-to-glb.mjs`** tessellates the STEP with OpenCascade (`occt-import-js`, wasm). It keeps each part's colors and builds a glTF with one shared material per color. Then it runs dedup → flatten → join → weld → simplify (meshoptimizer) → center → quantize, and writes the file with meshopt compression (`EXT_meshopt_compression`).
   It also accepts a `.glb` input: it skips tessellation and runs only the optimize steps.
2. **`step-to-gltf-native.py`** is for big assemblies that the wasm build can't mesh. ICE3DP came back with 0 triangles from `occt-import-js`. This script uses native OpenCascade (`pip install cadquery-ocp`) to write a raw Y-up, meter-scale GLB with part names and colors. Feed that GLB to `step-to-glb.mjs`.
3. **`render.mjs`** renders a 1200×900 poster `.webp` headlessly. It uses `render.html` (three.js) through `agent-browser`, served by `serve.mjs`.

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
| `tamagotchi.glb` | TaniWanKenobi/tamagotchi `CAD/Tamagotchi.step` | `--ratio 0.6` (281k → 170k triangles) |
| `ice3dp.glb` | TaniWanKenobi/ICE3DP `ICE3DP.step` | native: `0.08` mm / `0.3` rad, then `--ratio 0.18 --error 0.0015` (2.19M → 436k triangles) |

## Notes

- **Memory:** big STEPs (60MB+) need a big heap: keep `--max-old-space-size` high. The OpenCascade wasm itself can use about 4GB.
- **Materials:** they're double-sided, because CAD exports sometimes have inconsistent face winding. To check for flipped faces, open `render.html?...&single=1`, which renders front faces only.
