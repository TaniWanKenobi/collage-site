// Places map. Leaflet (~40 KB gz + CSS) is imported only when a map container is actually showing: the Places
// page is open in the zoom world, or scrolled to in the phone layout. Tiles: standard OpenStreetMap, recoloured
// dark (onyx water, grape land) in CSS (global.css, "Places map").
type Place = { id: string; name: string; lat: number; lng: number; when: string; note: string; home?: boolean; placeholder?: boolean };

export function mountPlaces() {
  document.querySelectorAll<HTMLElement>('[data-places-map]').forEach((el) => {
    if (el.dataset.watch) return;
    el.dataset.watch = '1';
    const page = el.closest<HTMLElement>('[data-page]');
    const ready = () => el.offsetWidth > 0 && !(page && page.getAttribute('aria-hidden') === 'true');
    let started = false, seen = false;
    const go = () => {
      if (started || !seen || !ready()) return;
      started = true; io.disconnect(); mo?.disconnect(); init(el);
    };
    const io = new IntersectionObserver((es) => { seen = es.some((e) => e.isIntersecting); go(); });
    io.observe(el);
    const mo = page ? new MutationObserver(go) : null;
    if (page && mo) mo.observe(page, { attributes: true, attributeFilter: ['aria-hidden'] });
  });
}

async function init(el: HTMLElement) {
  const { default: L } = await import('leaflet');
  const root = el.closest('.places') as HTMLElement;
  const data: Place[] = JSON.parse(root.parentElement?.querySelector('[data-places-data]')?.textContent || '[]');
  el.querySelector('.places-fallback')?.remove();
  const map = L.map(el, {
    center: [30, -20], zoom: 2, minZoom: 2, maxZoom: 12, worldCopyJump: true,
    zoomControl: false, scrollWheelZoom: false, dragging: !L.Browser.mobile,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  // The wheel zooms the map only after it is clicked, so scrolling the page never gets trapped by it.
  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());

  const card = el.querySelector('[data-places-card]') as HTMLElement;
  const set = (k: string, v: string) => { (card.querySelector(`[data-f="${k}"]`) as HTMLElement).textContent = v; };
  const pins: Record<string, ReturnType<typeof L.marker>> = {};
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-place]'));
  let openId = '';
  const mark = (id: string) => {
    Object.entries(pins).forEach(([k, m]) => m.getElement()?.classList.toggle('is-on', k === id));
    rows.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.place === id)));
  };
  const open = (p: Place) => {
    openId = p.id;
    set('name', p.name); set('when', p.when); set('note', p.note);
    card.hidden = false;
    mark(p.id);
    map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), p.home ? 6 : 5), { duration: 0.8 });
  };
  const close = () => { openId = ''; card.hidden = true; mark(''); };
  for (const p of data) {
    const cls = 'places-pin' + (p.home ? ' is-home' : '') + (p.placeholder ? ' is-ph' : '');
    const icon = L.divIcon({ className: cls, html: '<i></i>', iconSize: [22, 22], iconAnchor: [11, 11] });
    const m = L.marker([p.lat, p.lng], { icon, title: p.name, keyboard: true }).addTo(map);
    m.bindTooltip(p.name, { direction: 'top', offset: [0, -12], className: 'places-tip' });
    m.on('click', () => (openId === p.id ? close() : open(p)));
    pins[p.id] = m;
  }
  card.querySelector('[data-places-close]')?.addEventListener('click', close);
  rows.forEach((b) => b.addEventListener('click', () => {
    const p = data.find((x) => x.id === b.dataset.place);
    if (p) open(p);
  }));
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // The zoom world resizes pages with the viewport: keep Leaflet's idea of its size current.
  new ResizeObserver(() => map.invalidateSize()).observe(el);
}
