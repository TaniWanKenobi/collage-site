// A/B review tool (temporary). Tests live in src/data/ab.json; the inline <head> script in layouts/Base.astro
// sets html[data-ab-<id>] before first paint. This file wires the floating pill and the "hover" test's variant B.
// To remove a test: delete it from ab.json and delete its losing variant's CSS in styles/ab.css.

const KEY = (id: string) => `ab-${id}`;
const root = document.documentElement;

function setVariant(id: string, v: 'a' | 'b') {
  root.setAttribute(`data-ab-${id}`, v);
  try { localStorage.setItem(KEY(id), v); } catch { /* storage blocked: still switches for this page view */ }
  document.querySelectorAll<HTMLButtonElement>(`[data-ab-test="${id}"] [data-ab-v]`).forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.abV === v));
  });
  if (id === 'hover' && v !== 'b') document.querySelectorAll('.ab-hl.is-on').forEach((h) => h.classList.remove('is-on'));
}

function mountPill() {
  document.querySelectorAll<HTMLElement>('[data-ab-tool]').forEach((tool) => {
    if (tool.dataset.abMounted) return;
    tool.dataset.abMounted = '1';
    const toggle = tool.querySelector<HTMLButtonElement>('.ab-toggle')!;
    const panel = tool.querySelector<HTMLElement>('.ab-panel')!;
    const show = (open: boolean) => { panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
    toggle.addEventListener('click', () => show(panel.hidden));
    tool.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { show(false); toggle.focus(); } });
    document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !tool.contains(e.target as Node)) show(false); });
    tool.querySelectorAll<HTMLElement>('[data-ab-test]').forEach((fs) => {
      const id = fs.dataset.abTest!;
      const cur = root.getAttribute(`data-ab-${id}`) || 'a';
      fs.querySelectorAll<HTMLButtonElement>('[data-ab-v]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.abV === cur));
        b.addEventListener('click', () => setVariant(id, b.dataset.abV as 'a' | 'b'));
      });
    });
  });
}

// ---- Test "hover", variant B: a sliding highlight behind rows of any [data-hover-list] ----
// One delegated listener set on document, so lists added later (or rendered twice: desk + phone) just work.
// Measures only on pointer/focus entry (offsetTop/offsetHeight, i.e. the list's own coordinates, so the zoom
// world's CSS scale doesn't matter). Nothing runs on scroll.
const ROW = '[data-hover-list] > li, [data-hover-list] > button, [data-hover-list] > a';
const current = new WeakMap<Element, Element>();
const isB = () => root.getAttribute('data-ab-hover') === 'b';

function highlightFor(list: HTMLElement): HTMLElement {
  let hl = list.querySelector<HTMLElement>(':scope > .ab-hl');
  if (!hl) {
    if (getComputedStyle(list).position === 'static') list.style.position = 'relative';
    hl = document.createElement(list.tagName === 'UL' || list.tagName === 'OL' ? 'li' : 'span');
    hl.className = 'ab-hl is-snap';
    hl.setAttribute('aria-hidden', 'true');
    hl.setAttribute('role', 'presentation');
    list.append(hl); // last, so the rows' own :first-child / :nth-child styles are untouched
  }
  return hl;
}

function moveTo(row: HTMLElement) {
  const list = row.parentElement as HTMLElement;
  if (current.get(list) === row) return;
  current.set(list, row);
  const hl = highlightFor(list);
  const wasOff = !hl.classList.contains('is-on');
  // Coming in from nothing: appear in place (fade), don't slide in from the last row.
  if (wasOff) hl.classList.add('is-snap');
  hl.style.setProperty('--ab-x', `${row.offsetLeft}px`);
  hl.style.setProperty('--ab-y', `${row.offsetTop}px`);
  hl.style.setProperty('--ab-w', `${row.offsetWidth}px`);
  hl.style.setProperty('--ab-h', `${row.offsetHeight}px`);
  hl.classList.add('is-on');
  if (wasOff) requestAnimationFrame(() => requestAnimationFrame(() => hl.classList.remove('is-snap')));
}

function leave(list: HTMLElement) {
  current.delete(list);
  list.querySelector(':scope > .ab-hl')?.classList.remove('is-on');
}

function rowOf(t: EventTarget | null): HTMLElement | null {
  return t instanceof Element ? (t.closest(ROW) as HTMLElement | null) : null;
}

function mountHover() {
  if ((window as unknown as { __abHover?: boolean }).__abHover) return;
  (window as unknown as { __abHover?: boolean }).__abHover = true;
  document.addEventListener('pointerover', (e) => {
    if (!isB() || e.pointerType === 'touch') return;
    const row = rowOf(e.target);
    if (row) moveTo(row);
  });
  document.addEventListener('pointerout', (e) => {
    const row = rowOf(e.target);
    if (!row) return;
    const list = row.parentElement as HTMLElement;
    const to = e.relatedTarget as Node | null;
    if (!to || !list.contains(to) || !rowOf(to)) {
      // Keep it on a keyboard-focused row if there is one.
      const f = list.querySelector(':focus-visible');
      const fr = f ? rowOf(f) : null;
      if (fr && fr.parentElement === list) { current.delete(list); moveTo(fr); } else leave(list);
    }
  });
  document.addEventListener('focusin', (e) => {
    if (!isB()) return;
    const t = e.target as Element;
    const row = rowOf(t);
    if (row && t.matches(':focus-visible')) moveTo(row);
  });
  document.addEventListener('focusout', (e) => {
    const row = rowOf(e.target);
    if (!row) return;
    const list = row.parentElement as HTMLElement;
    const to = e.relatedTarget as Node | null;
    if (!to || !list.contains(to)) {
      if (!list.matches(':hover')) leave(list);
    }
  });
}

mountPill();
mountHover();
