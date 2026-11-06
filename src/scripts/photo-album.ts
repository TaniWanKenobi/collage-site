// Photo album lightbox. The section renders twice (zoom page + phone stack), so every album is mounted once,
// independently. PhotoSwipe's JS (~15 KB gz) is imported on the first click only; its CSS is bundled statically
// by Photos.astro (a lazily imported CSS chunk 404s on GitHub Pages). Without JS each polaroid is a plain link.
type Slide = { src: string; width: number; height: number; alt: string; caption: string; meta: string };

export function mountAlbums() {
  document.querySelectorAll<HTMLElement>('[data-album]').forEach((album) => {
    if (album.dataset.mounted) return;
    album.dataset.mounted = '1';
    const links = Array.from(album.querySelectorAll<HTMLAnchorElement>('a.pol-link'));
    links.forEach((a, i) => {
      a.addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // let "open in new tab" work
        e.preventDefault();
        open(links, i, a);
      });
    });
  });
}

let busy = false;
async function open(links: HTMLAnchorElement[], index: number, from: HTMLElement) {
  if (busy) return;
  busy = true;
  try {
    const { default: PhotoSwipe } = await import('photoswipe');
    const dataSource: Slide[] = links.map((a) => ({
      src: a.dataset.pswpSrc || a.href,
      width: Number(a.dataset.pswpWidth) || 1600,
      height: Number(a.dataset.pswpHeight) || 1200,
      alt: a.querySelector('img')?.alt || '',
      caption: a.dataset.caption || '',
      meta: a.dataset.meta || '',
    }));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pswp = new PhotoSwipe({
      dataSource,
      index,
      bgOpacity: 0.94,
      showHideAnimationType: reduce ? 'none' : 'fade',
      zoomAnimationDuration: reduce ? 0 : 333,
      padding: { top: 24, bottom: 96, left: 16, right: 16 }, // room for the caption strip
      arrowPrevTitle: 'Previous photo',
      arrowNextTitle: 'Next photo',
      closeTitle: 'Close',
      mainClass: 'pswp--album',
    });
    pswp.on('uiRegister', () => {
      pswp.ui?.registerElement({
        name: 'album-caption',
        order: 9,
        isButton: false,
        appendTo: 'root',
        html: '',
        onInit: (el) => {
          el.setAttribute('aria-live', 'polite');
          const cap = document.createElement('p');
          cap.className = 'pswp-cap-text';
          const meta = document.createElement('p');
          meta.className = 'pswp-cap-meta';
          el.append(cap, meta);
          pswp.on('change', () => {
            const s = pswp.currSlide?.data as Partial<Slide> | undefined;
            cap.textContent = s?.caption || '';
            meta.textContent = s?.meta || '';
          });
        },
      });
    });
    pswp.on('destroy', () => from.isConnected && links[pswp.currIndex]?.focus({ preventScroll: true }));
    pswp.init();
  } finally {
    busy = false;
  }
}
