# collage-site

Tanishq's personal site: one collage you scroll to zoom into. Built with [Astro](https://astro.build), plain CSS, and React Three Fiber islands for 3D.

Live: https://taniwankenobi.github.io/collage-site/

## Run it

Needs Node 20 or newer. In PowerShell:

```powershell
cd C:\Users\tanis\Downloads\collage-site
npm install
npm run dev
```

Open http://localhost:4321/collage-site/ (the `/collage-site` base matches GitHub Pages).

Build and preview the production output:

```powershell
npm run build
npm run preview
```

The build goes to `dist\`.

## Deploy

`.github/workflows/deploy.yml` builds with `withastro/action` and publishes with `actions/deploy-pages` on every push to `main` (or by hand from the Actions tab).

The first time, set the source to **GitHub Actions** under the repo's **Settings → Pages → Build and deployment**. After that, pushing is the deploy:

```powershell
git push origin main
```

## Layout

| Path | What it is |
| --- | --- |
| `src/pages/index.astro` | Home: the zoom collage |
| `src/pages/[section].astro` | `/projects`, `/timeline`, `/photos`, `/writing`, `/map`, `/guestbook`, `/contact`: the same page, starting zoomed into that section |
| `src/components/Home.astro` | Page shell: phone layout and desktop zoom stage |
| `src/components/ZoomStage.astro` | Desktop scroll track, sticky stage, home pill, dot HUD. Loads the camera script |
| `src/scripts/zoom-camera.js` | Scroll → camera math, fly-to, dots, back, URL updates, and the `zoomcam` event for 3D |
| `src/components/collage/` | One component per collage piece (Polaroid, Ticket, PhotoStack, ...), used for both desktop and phone |
| `src/components/sections/` | One component per section page |
| `src/components/three/` | 3D islands: `Globe.tsx`, `ModelSlot.tsx`, shared `Stage.tsx` + `useZoomView.ts` |
| `src/content/projects/*.md` | Projects |
| `src/data/timeline.json`, `src/data/writing.json` | Timeline and writing/awards |
| `src/styles/global.css` | Palette tokens (`--onyx`, `--grape`, `--lime`, ...) and shared styles |
| `public/legacy/` | The original single-file pages (`zoom.html`, `grape.html`, `index.html`) |

## Add a project

Create `src/content/projects/my-thing.md`:

```md
---
title: My thing
blurb: One line about what it does.
tags: [Python, Arduino]
order: 7
image: projects/my-thing.png   # optional, file goes in public/projects/
model: models/my-thing.glb     # optional, for later 3D use
---
```

`order` sets its position. With no `image`, the card shows the `[Screenshot]` placeholder. Timeline and writing entries work the same way: add an object to the JSON file.

## Add a 3D model

Every 3D view goes through `Stage` (`src/components/three/Stage.tsx`). It:

- renders only when something changes;
- raises its pixel ratio as you zoom, so it stays sharp;
- hides while a section page is open over it;
- pauses when it's off-screen;
- doesn't load at all on phones or with reduced motion. The static fallback shows instead.

1. Put the file in `public/models/`, e.g. `public/models/badge.glb`.
2. In an `.astro` component, inside a positioned box marked `data-three-host`, add a fallback image with class `css-fallback` and the slot:

```astro
---
import ModelSlot from '../three/ModelSlot';
import { url } from '../../lib/sections';
---
<div data-three-host style="position: absolute; left: 100px; top: 100px; width: 300px; height: 300px">
  <img class="css-fallback" src={url('models/badge.png')} alt="" width="300" height="300" />
  <ModelSlot client:visible src={url('models/badge.glb')} size={300} />
</div>
```

The fallback hides once the model is drawing. For a custom scene that isn't a GLB, copy `Globe.tsx`: wrap your meshes in `<Stage size={...}>` and use `useFrame` for animation.

Always build URLs with `url()` from `src/lib/sections.ts` so they keep the `/collage-site` base.

## Fonts

Fonts are self-hosted from `public/fonts/` as Latin-only woff2 subsets (no Google Fonts request, nothing render-blocking). `bricolage.woff2` is preloaded in `src/layouts/Base.astro`. To add glyphs, re-subset the upstream variable fonts with fontTools (`pyftsubset … --flavor=woff2 --unicodes=U+0020-007E,U+00A0-00FF,U+2010-2027,U+20AC,U+2190-2193 --layout-features='*'`), keeping the `wght` axis ranges used in Base.astro.
