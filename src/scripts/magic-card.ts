// Pointer spotlight on cards: after Magic UI Magic Card (MIT).
// One delegated pointermove listener per [data-mc-list], throttled to one style write per frame. The cards sit
// inside the scaled zoom world, so client px are divided by the card's on-screen scale to get its own CSS px.
// Nothing runs unless the pointer moves over a list; the glow itself is pure CSS (.mc in global.css).
export function mountMagicCards(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-mc-list]').forEach((list) => {
    if (list.dataset.mcReady) return;
    list.dataset.mcReady = '1';
    let card: HTMLElement | null = null, cx = 0, cy = 0, raf = 0;
    const write = () => {
      raf = 0;
      if (!card) return;
      const r = card.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = (cx - r.left) * card.offsetWidth / r.width, y = (cy - r.top) * card.offsetHeight / r.height;
      card.style.setProperty('--mx', `${x.toFixed(1)}px`);
      card.style.setProperty('--my', `${y.toFixed(1)}px`);
    };
    list.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      card = (e.target as Element).closest<HTMLElement>('.mc');
      if (!card || !list.contains(card)) return;
      cx = e.clientX; cy = e.clientY;
      if (!raf) raf = requestAnimationFrame(write);
    }, { passive: true });
  });
}
