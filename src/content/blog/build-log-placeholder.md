---
title: "How I built a cel-shaded 3D printer model"
date: 2026-09-15
kind: "build log"
excerpt: "Loading a STEP file in the browser, turning it into a mesh, and getting that flat cartoon look without the edges turning into a jagged mess. What broke, and the two-line fix that saved it."
readMins: 6
placeholder: true
---

*Placeholder post: this is sample text, not a real build log. Replace this file
(`src/content/blog/build-log-placeholder.md`) with a real post, or delete it.*

## The goal

I wanted the printer on my site to look hand-drawn: flat colors, a few bands of shade, and a thick outline,
like a cartoon. The model started life as a CAD file, so the first job was getting it into the browser at all.

## What went wrong

The first version loaded fine and looked awful. Every curved surface had hundreds of tiny triangles, and the
outline pass drew a line along every one of them. The fix was to merge vertices before computing normals:

```ts
const merged = mergeVertices(geometry, 1e-4);
merged.computeVertexNormals();
```

After that, the shading bands lined up and the outline only traced real edges.

## What I'd do next time

- Simplify the mesh before it ever reaches the browser.
- Test the look on a cheap laptop first, not my fastest machine.
