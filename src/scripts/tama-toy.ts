// The Tamagotchi on the home collage as a tiny working toy: its OLED shows a live pixel screen, and its three
// buttons can be clicked (A = next, B = select, C = back), with a short buzzer beep like the real board.
// Loaded by model-stage.ts for slots with data-toy, after the model is in its scene.
// Everything here is in the model's own coordinates (metres, flat CAD: the face points +Y, the buttons sit
// toward +Z, the top of the screen toward -Z), so it stays glued to the model while it sways or is dragged.
import {
  CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, CylinderGeometry, Raycaster, Vector2, NearestFilter, SRGBColorSpace,
  type Object3D, type PerspectiveCamera,
} from 'three';

interface Opts { el: HTMLElement; canvas: HTMLCanvasElement; camera: PerspectiveCamera; model: Object3D; redraw: () => void }

// Measured from the model (scripts: screen = the vertices flagged "screen" in _ORIG; buttons from a top view).
const SCREEN = { x: -0.0002, z: -0.0052, y: 0.0142, w: 0.0236, h: 0.0168 };
const BUTTONS = [
  { id: 'A', x: -0.0145, z: 0.0195 },
  { id: 'B', x: 0, z: 0.0205 },
  { id: 'C', x: 0.0145, z: 0.0195 },
] as const;
const BTN_Y = 0.0125, BTN_R = 0.0055;

// The OLED: 96 x 64 logical pixels, drawn 4x so the texture stays crisp at any zoom.
const PW = 96, PH = 64, K = 4;
const INK = '#0D160B', LIT = '#C2F970';

type Item = 'FEED' | 'PLAY' | 'WORK' | 'HI';
const MENU: Item[] = ['FEED', 'PLAY', 'WORK', 'HI'];

export function attachToy({ el, canvas, camera, model, redraw }: Opts) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const oled = document.createElement('canvas');
  oled.width = PW * K; oled.height = PH * K;
  const g = oled.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const tex = new CanvasTexture(oled);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.minFilter = NearestFilter;

  const screen = new Mesh(new PlaneGeometry(SCREEN.w, SCREEN.h), new MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.rotation.x = -Math.PI / 2; // plane faces +Z; lay it on the face (+Y), texture top toward -Z
  screen.position.set(SCREEN.x, SCREEN.y, SCREEN.z);
  screen.renderOrder = 2;
  model.add(screen);

  // Invisible hit targets over the three buttons (drawn with no colour, so the ray still finds them).
  const hitMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const hits = BUTTONS.map((b) => {
    const m = new Mesh(new CylinderGeometry(BTN_R, BTN_R, 0.004, 16), hitMat);
    m.position.set(b.x, BTN_Y, b.z);
    m.userData.btn = b.id;
    model.add(m);
    return m;
  });

  // ---- state ----
  let mode: 'pet' | 'menu' | 'show' = 'pet';
  let sel = 0;
  let shown: Item = 'HI';
  let showUntil = 0;
  let hunger = 2, joy = 2; // 0..4 pips
  let jumpAt = -1e9, pressedAt = -1e9, lastPress: string | null = null;

  const px = (x: number, y: number, w = 1, h = 1) => g.fillRect(x * K, y * K, w * K, h * K);
  // Big, bold type: the collage shows this screen only ~60 px wide, so everything is drawn chunky.
  const text = (s: string, x: number, y: number, size = 11, align: CanvasTextAlign = 'center') => {
    g.font = `800 ${size * K}px "Bricolage Grotesque", system-ui, sans-serif`;
    g.textBaseline = 'top'; g.textAlign = align;
    g.fillText(s, x * K, y * K);
  };

  // A chunky pixel pet (drawn on a 2x grid) that blinks, bobs while idle and hops when played with.
  function pet(cx: number, cy: number, t: number) {
    const hop = t - jumpAt < 700 ? Math.round(Math.sin(((t - jumpAt) / 700) * Math.PI) * 12) : 0;
    const bob = reduce ? 0 : Math.round(Math.sin(t / 380));
    const y = cy - hop + bob;
    const q = (x: number, yy: number, w = 1, h = 1) => px(cx + x * 2, y + yy * 2, w * 2, h * 2);
    g.fillStyle = LIT;
    q(-4, -5, 8); q(-5, -4, 10); q(-6, -3, 12, 7); q(-5, 4, 10); q(-5, 5, 2); q(3, 5, 2);
    g.fillStyle = INK;
    const blink = !reduce && t % 3600 < 160;
    if (blink) { q(-3, -1, 2); q(1, -1, 2); } else { q(-3, -2, 2, 2); q(1, -2, 2, 2); }
    if (joy >= 3) { q(-2, 2, 4); q(-3, 1); q(2, 1); } else q(-1, 2, 2);
  }
  // Two bars in the corners: food (left) and fun (right).
  function bars() {
    g.fillStyle = LIT;
    for (let i = 0; i < 4; i++) {
      if (i < hunger) px(3 + i * 6, 3, 5, 5); else { px(3 + i * 6, 3, 5, 1); px(3 + i * 6, 7, 5, 1); }
      if (i < joy) px(70 + i * 6, 3, 5, 5); else { px(70 + i * 6, 3, 5, 1); px(70 + i * 6, 7, 5, 1); }
    }
  }

  function draw(t: number) {
    g.fillStyle = INK; g.fillRect(0, 0, oled.width, oled.height);
    g.fillStyle = LIT;
    if (mode === 'show' && t > showUntil) mode = 'pet';
    if (mode === 'pet') {
      bars(); pet(48, 36, t);
    } else if (mode === 'menu') {
      // One item at a time, big, with arrows: A moves on, B picks it, C backs out.
      text(MENU[sel], 48, 22, 18);
      px(6, 28, 4, 6); px(4, 30, 2, 2); px(86, 28, 4, 6); px(90, 30, 2, 2);
      MENU.forEach((_, i) => { if (i === sel) px(36 + i * 7, 54, 5, 5); else { px(36 + i * 7, 54, 5, 1); px(36 + i * 7, 58, 5, 1); } });
    } else {
      const s = { FEED: 'NOM NOM', PLAY: 'WHEE!', WORK: 'B: MY WORK', HI: 'HI THERE!' }[shown];
      if (shown !== 'WORK') pet(48, 26, t);
      g.fillStyle = LIT;
      text(s, 48, shown === 'WORK' ? 24 : 46, shown === 'WORK' ? 14 : 12);
      if (shown === 'FEED') { px(76, 18, 8, 8); g.fillStyle = INK; px(80, 18, 4, 4); }
    }
    // The button that was just pressed flashes as a small marker along the bottom edge.
    if (lastPress && t - pressedAt < 220) {
      const i = BUTTONS.findIndex((b) => b.id === lastPress);
      g.fillStyle = LIT; px(14 + i * 30, PH - 3, 12, 3);
    }
    tex.needsUpdate = true;
  }

  // ---- buzzer ----
  let audio: AudioContext | null = null;
  function beep(f: number) {
    try {
      audio = audio || new AudioContext();
      const o = audio.createOscillator(), v = audio.createGain();
      o.type = 'square'; o.frequency.value = f;
      v.gain.setValueAtTime(0.035, audio.currentTime);
      v.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.09);
      o.connect(v).connect(audio.destination);
      o.start(); o.stop(audio.currentTime + 0.1);
    } catch { /* no audio: still works silently */ }
  }

  function show(it: Item, ms = 2200) { shown = it; mode = 'show'; showUntil = performance.now() + ms; }
  function press(id: string) {
    const t = performance.now();
    lastPress = id; pressedAt = t;
    beep(id === 'A' ? 1320 : id === 'B' ? 1760 : 990);
    if (mode === 'pet') {
      if (id === 'A') { mode = 'menu'; sel = 0; }
      else if (id === 'B') { jumpAt = t; joy = Math.min(4, joy + 1); }
    } else if (mode === 'menu') {
      if (id === 'A') sel = (sel + 1) % MENU.length;
      else if (id === 'C') mode = 'pet';
      else {
        const it = MENU[sel];
        if (it === 'FEED') hunger = Math.min(4, hunger + 1);
        if (it === 'PLAY') { jumpAt = t; joy = Math.min(4, joy + 1); hunger = Math.max(0, hunger - 1); }
        show(it, it === 'WORK' ? 6000 : 2200);
      }
    } else {
      if (id === 'B' && shown === 'WORK') { const f = (window as unknown as { __zoomFly?: (k: string) => void }).__zoomFly; if (f) f('projects'); }
      mode = id === 'C' ? 'menu' : 'pet';
    }
    draw(t);
    redraw();
  }

  // Click: a ray from the pointer; a hit on a button presses it and keeps the click from flying to Projects.
  const ray = new Raycaster(), ndc = new Vector2();
  const hitAt = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects([...hits, screen], false)[0];
    return h ? (h.object.userData.btn as string | undefined) ?? 'screen' : null;
  };
  el.addEventListener('click', (e) => {
    const h = hitAt(e);
    if (!h) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (h !== 'screen') press(h);
  }, true);
  el.addEventListener('pointermove', (e) => { if (!e.buttons) canvas.style.cursor = hitAt(e) ? 'pointer' : ''; });

  // Keyboard, while the model has focus: 1 / 2 / 3 press A / B / C.
  el.addEventListener('keydown', (e) => {
    const id = ({ '1': 'A', '2': 'B', '3': 'C' } as Record<string, string>)[e.key];
    if (id) { e.preventDefault(); press(id); }
  });

  // The screen animates a few times a second while the page is visible. The sway already redraws the model, which
  // picks up the new texture, so this never wakes the render loop by itself (it sleeps after 20 s without input).
  draw(performance.now());
  setInterval(() => { if (!document.hidden) draw(performance.now()); }, reduce ? 1000 : 125);
  // Needs drift slowly, like a real pet.
  setInterval(() => { hunger = Math.max(0, hunger - 1); joy = Math.max(0, joy - 1); }, 90000);
}
