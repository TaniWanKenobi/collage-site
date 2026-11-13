// Scramble reveal for [data-hyper] titles: after Magic UI Hyper Text (MIT).
// Runs for 800ms on hover (if not already running) and once each time the camera lands on a section page
// (the .zpage gets .is-held from zoom-camera.js). At rest the title is plain text; the per-letter spans exist only
// while it runs, each fixed to its real glyph's width so the line never jitters. Screen readers get the real
// text from a visually hidden copy. rAF runs only during the 800ms; reduced motion turns it off.
const DURATION = 800;
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const running = new WeakSet<HTMLElement>();
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

function scramble(host: HTMLElement) {
  if (reduce.matches || running.has(host)) return;
  const text = host.dataset.hyperText ?? (host.dataset.hyperText = host.textContent?.trim() ?? '');
  if (!text) return;
  running.add(host);

  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = text;
  const vis = document.createElement('span');
  vis.setAttribute('aria-hidden', 'true');
  const chars: { el: HTMLElement; ch: string; upper: boolean }[] = [];
  text.split(' ').forEach((word, wi) => {
    if (wi) vis.append(' ');
    const w = document.createElement('span');
    w.className = 'ht-word';
    for (const ch of word) {
      const c = document.createElement('span');
      c.className = 'ht-ch';
      c.textContent = ch;
      w.append(c);
      chars.push({ el: c, ch, upper: ch !== ch.toLowerCase() });
    }
    vis.append(w);
  });
  host.replaceChildren(sr, vis);
  // One layout read: pin every letter to its real width before swapping glyphs.
  const widths = chars.map((c) => c.el.offsetWidth);
  chars.forEach((c, i) => { c.el.style.width = `${widths[i]}px`; });

  const start = performance.now();
  const tick = (now: number) => {
    const p = Math.min((now - start) / DURATION, 1);
    const shown = p * chars.length;
    chars.forEach((c, i) => {
      const r = UPPER[(Math.random() * 26) | 0];
      c.el.textContent = i <= shown || !/\p{L}|\p{N}/u.test(c.ch) ? c.ch : c.upper ? r : r.toLowerCase();
    });
    if (p < 1) requestAnimationFrame(tick);
    else { host.textContent = text; running.delete(host); }
  };
  requestAnimationFrame(tick);
}

export function mountHyperText() {
  document.querySelectorAll<HTMLElement>('[data-hyper]').forEach((host) => {
    if (host.dataset.hyperReady) return;
    host.dataset.hyperReady = '1';
    host.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') scramble(host); });
  });
  const html = document.documentElement;
  if (html.dataset.hyperPages) return;
  html.dataset.hyperPages = '1';
  const mo = new MutationObserver((records) => {
    records.forEach((r) => {
      const pg = r.target as HTMLElement;
      if (pg.classList.contains('is-held') && !/\bis-held\b/.test(r.oldValue ?? '')) {
        pg.querySelectorAll<HTMLElement>('[data-hyper]').forEach(scramble);
      }
    });
  });
  document.querySelectorAll('.zpage').forEach((pg) => mo.observe(pg, { attributes: true, attributeFilter: ['class'], attributeOldValue: true }));
}
