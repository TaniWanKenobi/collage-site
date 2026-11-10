// Tiny boot for the 3D models (Model3D.astro):
//  - desktop/tablet: the runtime and the collage's .glb files start loading the moment the page opens (the
//    posters show until the first real frame, which replaces them in place);
//  - phones: the cards in the stacked sections get a "Spin in 3D" button (one tap loads that model);
//  - reduced motion: posters only, nothing loads.
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const all = Array.from(document.querySelectorAll('[data-m3d]'));
// Model3D appears in both the desktop and phone trees; only the visible one counts.
const shown = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';

let rt = null;
const runtime = () => (rt = rt || import('./model-stage.ts'));

// Collage objects fly the camera to their section on click/Enter (the runtime swallows clicks that were drags).
all.filter((el) => el.dataset.flyTo).forEach((el) => {
  const fly = () => { const f = window.__zoomFly; if (f) f(el.dataset.flyTo); };
  el.addEventListener('click', fly);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fly(); } });
});

if (all.length && !reduce) {
  // Straight away: no idle wait. Meshes decode in workers and shaders compile in parallel (model-stage.ts),
  // so this costs the main thread little, and the posters cover the few hundred ms until the first frame.
  const auto = all.filter((el) => el.dataset.m3d !== 'flow' && shown(el));
  if (auto.length) runtime().then((m) => m.addSlots(auto));
  all.filter((el) => el.dataset.m3d === 'flow').forEach((el) => {
    const btn = el.querySelector('.m3d-load');
    if (!btn) return;
    btn.hidden = false;
    btn.addEventListener('click', () => {
      el.classList.add('is-loading');
      runtime().then((m) => m.addSlots([el]));
    }, { once: true });
  });
}
