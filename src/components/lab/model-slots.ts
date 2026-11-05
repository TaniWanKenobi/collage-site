// Finds every live model slot on the page and loads the 3D runtime only when one comes near the viewport.
const slots = Array.from(document.querySelectorAll<HTMLElement>('[data-lab-model]'));

// A poster that already failed before the inline onerror could run.
document.querySelectorAll<HTMLImageElement>('.lab-model-poster').forEach((img) => {
  if (img.complete && img.naturalWidth === 0) img.parentElement?.classList.add('no-poster');
});

if (slots.length) {
  let started = false;
  const io = new IntersectionObserver((entries) => {
    if (started || !entries.some((e) => e.isIntersecting)) return;
    started = true;
    io.disconnect();
    import('./model-runtime').then((rt) => rt.start(slots));
  }, { rootMargin: '300px' });
  slots.forEach((s) => io.observe(s));
}
