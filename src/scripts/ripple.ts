// Click ripple on [data-ripple] buttons: after Magic UI Ripple Button (MIT).
// One delegated click listener; each click adds a span at the pointer that runs `rippling` (global.css) once and is
// removed when it ends. Buttons can sit inside the scaled zoom world, so pointer px are divided by the scale.
const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function mountRipple() {
  const html = document.documentElement;
  if (html.dataset.rippleReady) return;
  html.dataset.rippleReady = '1';
  document.addEventListener('click', (e) => {
    if (reduce?.matches) return;
    const b = (e.target as Element | null)?.closest?.<HTMLElement>('[data-ripple]');
    if (!b) return;
    const r = b.getBoundingClientRect(), w = b.offsetWidth, h = b.offsetHeight;
    if (!r.width || !r.height) return;
    const size = Math.max(w, h);
    // Keyboard clicks (detail 0) have no pointer position: ripple from the middle.
    const x = e.detail === 0 ? w / 2 : (e.clientX - r.left) * w / r.width;
    const y = e.detail === 0 ? h / 2 : (e.clientY - r.top) * h / r.height;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.setAttribute('aria-hidden', 'true');
    s.style.cssText = `width:${size}px;height:${size}px;left:${x - size / 2}px;top:${y - size / 2}px`;
    b.appendChild(s);
    s.addEventListener('animationend', () => s.remove(), { once: true });
    setTimeout(() => s.remove(), 1000); // in case the button is hidden mid-animation
  });
}
