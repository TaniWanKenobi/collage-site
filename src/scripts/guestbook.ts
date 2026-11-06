// Guestbook client. Talks to the Cloudflare Worker in guestbook-worker/ at PUBLIC_GUESTBOOK_URL.
// Entries are fetched only once a guestbook is actually showing (same lazy pattern as places-map.ts), and every
// instance in the DOM (zoom page + phone layout) mounts independently. A note posted in one instance is
// announced with a `gb:new` event so the other instance shows it too.
type Entry = { id: number; name: string; message: string; link: string | null; created_at: number; doodle: boolean };
type Page = { entries: Entry[]; next: number | null };

const API = String(import.meta.env.PUBLIC_GUESTBOOK_URL || '').trim().replace(/\/+$/, '');
const PAPERS = ['is-lime', 'is-grape', 'is-tint'];
const TILTS = [0.8, -0.6, 1.4, -1.2, 0.4, -0.2];
const MAX_DOODLE_CHARS = 190_000; // keep the data URL under the Worker's ~150 KB PNG cap
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function mountGuestbook() {
  document.querySelectorAll<HTMLElement>('[data-gb]').forEach((el) => {
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

async function getJSON<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, init);
  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  return { ok: res.ok, status: res.status, data };
}

function noteEl(e: Entry, fresh = false): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `gb-note ${PAPERS[e.id % PAPERS.length]}` + (fresh ? ' is-fresh' : '');
  li.style.setProperty('--tilt', `${TILTS[e.id % TILTS.length]}deg`);
  li.dataset.id = String(e.id);
  const msg = document.createElement('p');
  msg.className = 'gb-msg';
  msg.textContent = e.message;
  li.append(msg);
  if (e.doodle) {
    const fig = document.createElement('div');
    fig.className = 'gb-doodle';
    const img = document.createElement('img');
    img.src = `${API}/doodle/${e.id}`;
    img.alt = `Doodle by ${e.name}`;
    img.width = 320; img.height = 200;
    img.loading = 'lazy'; img.decoding = 'async';
    fig.append(img);
    li.append(fig);
  }
  const meta = document.createElement('div');
  meta.className = 'gb-meta mono';
  let who: HTMLElement;
  if (e.link && /^https?:\/\//i.test(e.link)) {
    const a = document.createElement('a');
    a.href = e.link; a.rel = 'nofollow ugc noopener'; a.target = '_blank';
    who = a;
  } else who = document.createElement('span');
  who.textContent = e.name;
  const when = document.createElement('time');
  const d = new Date(e.created_at);
  when.dateTime = d.toISOString();
  when.textContent = dateFmt.format(d);
  meta.append(who, when);
  li.append(meta);
  return li;
}

async function init(root: HTMLElement) {
  const $ = <T extends Element>(s: string) => root.querySelector(s) as T;
  const form = $<HTMLFormElement>('[data-gb-form]');
  const fields = $<HTMLFieldSetElement>('[data-gb-fields]');
  const status = $<HTMLElement>('[data-gb-status]');
  const list = $<HTMLOListElement>('[data-gb-list]');
  const empty = $<HTMLElement>('[data-gb-empty]');
  const more = $<HTMLButtonElement>('[data-gb-more]');
  const submit = $<HTMLButtonElement>('[data-gb-submit]');
  const pad = setupDoodle(root);

  if (!API) return; // not connected: keep the disabled form and the sample notes
  status.textContent = 'opening the guestbook…';

  let next: number | null = null;
  const seenIds = new Set<number>();
  const add = (entries: Entry[], where: 'append' | 'prepend', fresh = false) => {
    const els = entries.filter((e) => !seenIds.has(e.id)).map((e) => { seenIds.add(e.id); return noteEl(e, fresh); });
    if (where === 'prepend') list.prepend(...els); else list.append(...els);
    empty.hidden = seenIds.size > 0;
  };
  const load = async (before?: number) => {
    const q = new URLSearchParams({ limit: '30' });
    if (before) q.set('before', String(before));
    const r = await getJSON<Page>(`${API}/entries?${q}`);
    if (!r.ok || !r.data || !Array.isArray(r.data.entries)) throw new Error(`HTTP ${r.status}`);
    return r.data;
  };

  try {
    const first = await load();
    list.querySelectorAll('[data-gb-sample]').forEach((n) => n.remove());
    add(first.entries, 'append');
    next = first.next;
    more.hidden = next == null;
    fields.disabled = false;
    status.textContent = 'leave a note, a link, maybe a doodle. it shows up on the wall.';
  } catch {
    status.textContent = "the guestbook isn't connected right now, so these are sample notes. try again later!";
    return;
  }

  more.addEventListener('click', async () => {
    if (next == null) return;
    more.disabled = true; more.textContent = 'loading…';
    try {
      const p = await load(next);
      add(p.entries, 'append');
      next = p.next;
      more.hidden = next == null;
      more.textContent = 'load more notes';
    } catch {
      more.textContent = "couldn't load more. try again?";
    }
    more.disabled = false;
  });

  document.addEventListener('gb:new', (ev) => {
    const entry = (ev as CustomEvent<Entry>).detail;
    if (entry) add([entry], 'prepend', true);
  });

  // ---- form ----
  const nameIn = form.elements.namedItem('name') as HTMLInputElement;
  const msgIn = form.elements.namedItem('message') as HTMLTextAreaElement;
  const linkIn = form.elements.namedItem('link') as HTMLInputElement;
  const count = $<HTMLElement>('[data-gb-count]');
  const inputs: Record<string, HTMLElement | null> = { name: nameIn, message: msgIn, link: linkIn, doodle: pad.canvas, form: null };
  const setErr = (k: string, text: string) => {
    const p = root.querySelector<HTMLElement>(`[data-err="${k}"]`);
    if (p) p.textContent = text;
    const inp = inputs[k];
    if (inp) { if (text) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
  };
  const clearErrs = () => Object.keys(inputs).forEach((k) => setErr(k, ''));
  const cp = (s: string) => [...s].length;

  msgIn.addEventListener('input', () => { count.textContent = `${cp(msgIn.value)} / 500`; });
  [nameIn, msgIn, linkIn].forEach((i) => i.addEventListener('input', () => setErr(i.name, '')));

  const validate = () => {
    const errs: Record<string, string> = {};
    const name = nameIn.value.trim(), message = msgIn.value.trim(), link = linkIn.value.trim();
    if (!name) errs.name = 'Add your name (or a nickname).';
    else if (cp(name) > 40) errs.name = 'Names can be up to 40 characters.';
    if (!message) errs.message = 'Write a message first.';
    else if (cp(message) > 500) errs.message = 'Messages can be up to 500 characters.';
    if (link) {
      let ok = false;
      try { const u = new URL(link); ok = (u.protocol === 'http:' || u.protocol === 'https:') && link.length <= 200; } catch { /* bad */ }
      if (!ok) errs.link = link.length > 200 ? 'Links can be up to 200 characters.' : 'Links need to start with http:// or https://.';
    }
    return { errs, name, message, link };
  };

  let busy = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    clearErrs();
    const { errs, name, message, link } = validate();
    let doodle: string | null | undefined;
    if (pad.hasDrawing()) {
      doodle = pad.exportPNG();
      if (!doodle) errs.doodle = 'That doodle is too detailed to send. Try clearing a bit of it.';
    }
    const keys = Object.keys(errs);
    if (keys.length) {
      keys.forEach((k) => setErr(k, errs[k]));
      (inputs[keys[0]] as HTMLElement | null)?.focus?.();
      return;
    }
    busy = true; submit.disabled = true; submit.textContent = 'pinning…';
    try {
      const r = await getJSON<{ entry?: Entry; error?: string; message?: string; fields?: Record<string, string> }>(`${API}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message, link: link || undefined, doodle }),
      });
      if (r.ok && r.data?.entry) {
        document.dispatchEvent(new CustomEvent('gb:new', { detail: r.data.entry }));
        form.reset(); pad.clear();
        count.textContent = '0 / 500';
        setErr('form', '');
        status.textContent = 'thanks! your note is on the wall.';
        list.firstElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (r.data?.fields) {
        Object.entries(r.data.fields).forEach(([k, v]) => setErr(k, v));
      } else {
        setErr('form', r.data?.message || `Something went wrong (HTTP ${r.status}). Try again in a bit.`);
      }
    } catch {
      setErr('form', "Couldn't reach the guestbook. Check your connection and try again.");
    }
    busy = false; submit.disabled = false; submit.textContent = 'Pin it to the wall';
  });
}

// ---- doodle pad ----
type Stroke = { color: string; pts: [number, number][] };

function setupDoodle(root: HTMLElement) {
  const canvas = root.querySelector('[data-gb-canvas]') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const undoBtn = root.querySelector('[data-gb-undo]') as HTMLButtonElement;
  const clearBtn = root.querySelector('[data-gb-clear]') as HTMLButtonElement;
  const pens = Array.from(root.querySelectorAll<HTMLInputElement>('[data-gb-pen]'));
  const strokes: Stroke[] = [];
  let cur: Stroke | null = null;
  const W = canvas.width, H = canvas.height;
  const BG = '#EFFDD8';

  const paint = (c: CanvasRenderingContext2D, scale = 1) => {
    c.save();
    c.scale(scale, scale);
    c.fillStyle = BG;
    c.fillRect(0, 0, W, H);
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 6;
    for (const s of strokes) {
      c.strokeStyle = s.color; c.fillStyle = s.color;
      if (s.pts.length === 1) {
        c.beginPath(); c.arc(s.pts[0][0], s.pts[0][1], 3, 0, Math.PI * 2); c.fill();
        continue;
      }
      c.beginPath();
      c.moveTo(s.pts[0][0], s.pts[0][1]);
      for (let i = 1; i < s.pts.length; i++) c.lineTo(s.pts[i][0], s.pts[i][1]);
      c.stroke();
    }
    c.restore();
  };
  const sync = () => { undoBtn.disabled = clearBtn.disabled = strokes.length === 0; };
  const redraw = () => { paint(ctx); sync(); };
  redraw();

  // Map a pointer to canvas pixels; the zoom camera scales pages, so use the on-screen rect.
  const at = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const color = () => pens.find((p) => p.checked)?.value || '#0D160B';

  canvas.addEventListener('pointerdown', (e) => {
    if (canvas.closest('fieldset')?.disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    cur = { color: color(), pts: [at(e)] };
    strokes.push(cur);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ce of evs.length ? evs : [e]) cur.pts.push(at(ce));
    redraw();
  });
  const end = () => { cur = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);

  undoBtn.addEventListener('click', () => { strokes.pop(); redraw(); });
  clearBtn.addEventListener('click', () => { strokes.length = 0; redraw(); });

  return {
    canvas,
    hasDrawing: () => strokes.length > 0,
    clear: () => { strokes.length = 0; redraw(); },
    // Full resolution first; if a very busy doodle is too big, fall back to half size.
    exportPNG(): string | null {
      const full = canvas.toDataURL('image/png');
      if (full.length <= MAX_DOODLE_CHARS) return full;
      const small = document.createElement('canvas');
      small.width = W / 2; small.height = H / 2;
      paint(small.getContext('2d')!, 0.5);
      const half = small.toDataURL('image/png');
      return half.length <= MAX_DOODLE_CHARS ? half : null;
    },
  };
}
