// Music + UI sounds, opt-in by URL (A/B like ?nav= / ?bg=). Loaded by Base.astro only when one of these is set
// (or when the Looks picker, scripts/looks.ts, turns one on; it then switches them live via "looks:change"):
//   ?music=explore|shop|voting|waves|off   looping track (public/sounds/music-*.mp3, credits in public/sounds/CREDITS.md)
//   ?sfx=tap|stopwatch|tick|synth|off      hover/press ticks (synth = procedural, no file). Default: tick (always on;
//                                          ?sfx=off turns it off). Not in the Looks picker any more.
//   ?whoosh=air|swish|swoop|gust|zip|off   a whoosh when a collage piece is clicked (the camera flies into it);
//                                          all synthesized (filtered noise sweeps), no files. Default: swoop.
//   ?whoosh-at=<ms>  when it plays, in ms after the press (default 200; the camera starts on release, ~100 ms in).
//                    A press that turns into a drag (orbiting a 3D model) before then plays nothing.
//   ?whoosh-vol=<%>  its volume (default 100).
// Plain Web Audio: one AudioContext, created on the first user gesture (browsers block audio before that).
// Music plays from a decoded buffer so the loop is gapless; a track switch fades the old one out as the new one
// fades in. Tab hidden or muted -> the context is suspended. The mute pill shows only while music or sfx is on.
// No idle cost: no timers/rAF; with sfx only, the context suspends itself 3 s after the last sound.
// Debug: window.__sfx (counts per kind, context state, music state); window.__sfxCount = total sounds played.
import '../styles/sound.css';

type Kind = 'hover' | 'press' | 'land';
const MUSIC: Record<string, string> = { explore: 'music-explore.mp3', shop: 'music-shop.mp3', voting: 'music-voting.mp3', waves: 'music-waves.mp3' };
const FILES: Record<string, string> = { tap: 'tap.mp3', stopwatch: 'stopwatch.mp3', tick: 'tick.mp3' };
const GAIN: Record<Kind, number> = { hover: 0.05, press: 0.22, land: 0.3 };
const MUSIC_GAIN = 0.25;
const MUTE_KEY = 'sound-muted';
// What counts as interactive for hover/press ticks.
const HIT = 'a[href], button, [role="button"], .hud-dot, .ihb, [data-fly], summary, select, input:not([type="hidden"])';

const pickMusic = (v: string | null) => MUSIC[v || ''] || null;
const SFX_DEF = 'tick';
const pickSfx = (v: string | null) => (v === null || v === '' ? SFX_DEF : v === 'synth' || FILES[v] ? v : null);
const WHOOSH = ['air', 'swish', 'swoop', 'gust', 'zip'] as const;
type Whoosh = (typeof WHOOSH)[number];
const WHOOSH_DEF: Whoosh = 'swoop';
const numParam = (k: string, def: number) => { const v = parseFloat(new URLSearchParams(location.search).get(k) ?? ''); return isFinite(v) ? v : def; };
let whooshAt = numParam('whoosh-at', 200), whooshVol = numParam('whoosh-vol', 100) / 100;
const pickWhoosh = (v: string | null): Whoosh | null => (v === null || v === '' ? WHOOSH_DEF : (WHOOSH as readonly string[]).includes(v) ? (v as Whoosh) : null);
const q = new URLSearchParams(location.search);
let musicFile = pickMusic(q.get('music'));
let sfx = pickSfx(q.get('sfx'));
let whoosh = pickWhoosh(q.get('whoosh'));
const BASE = (import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/') + 'sounds/';

const dbg = { hover: 0, press: 0, land: 0, whoosh: 0, ctx: 'none' as string, music: 'off' as string, muted: false };
const w = window as unknown as { __sfx: typeof dbg; __sfxCount: number };
w.__sfx = dbg;
w.__sfxCount = 0;

let update: (() => void) | null = null;
if (musicFile || sfx || whoosh) update = init();

// The Looks picker switches music / sfx live (the engine is set up the first time either is turned on).
window.addEventListener('looks:change', (e) => {
  const d = (e as CustomEvent<{ key: string; value: string }>).detail;
  if (d?.key === 'music') { const f = pickMusic(d.value); if (f === musicFile) return; musicFile = f; }
  else if (d?.key === 'sfx') { const s = pickSfx(d.value); if (s === sfx) return; sfx = s; }
  else if (d?.key === 'whoosh-at') { whooshAt = numParam('whoosh-at', 200); return; }
  else if (d?.key === 'whoosh-vol') { whooshVol = numParam('whoosh-vol', 100) / 100; return; }
  else if (d?.key === 'whoosh') {
    const v = pickWhoosh(d.value); if (v === whoosh) return; whoosh = v;
    if (v) window.dispatchEvent(new CustomEvent('sound:preview-whoosh')); // let the picker click be heard
  }
  else return;
  if (!update) { if (!musicFile && !sfx && !whoosh) return; update = init(); }
  update();
});

function init() {
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* storage blocked: default unmuted */ }
  dbg.muted = muted;

  let ctx: AudioContext | null = null;
  let master: GainNode;
  // The playing track and its own gain (each track gets one, so a switch can fade one out while the next comes in).
  let musicSrc: AudioBufferSourceNode | null = null;
  let musicGain: GainNode | null = null;
  let musicReq = 0;
  const decoded = new Map<string, Promise<AudioBuffer>>();
  let noise: AudioBuffer | null = null;
  let idle = 0;

  const setCtxState = () => { dbg.ctx = ctx ? ctx.state : 'none'; };

  function load(name: string) {
    let p = decoded.get(name);
    if (!p) {
      p = fetch(BASE + name).then((r) => {
        if (!r.ok) throw new Error('sound: ' + name + ' ' + r.status);
        return r.arrayBuffer();
      }).then((b) => ctx!.decodeAudioData(b));
      p.catch(() => decoded.delete(name));
      decoded.set(name, p);
    }
    return p;
  }

  // The click sound for the current set: a decoded file, or the noise burst for synth (made once).
  const sfxBufs: Record<string, AudioBuffer> = {};
  function prepSfx() {
    if (!ctx || !sfx) return;
    if (sfx === 'synth') {
      if (noise) return;
      noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    } else {
      const f = FILES[sfx];
      if (!sfxBufs[f]) load(f).then((b) => { sfxBufs[f] = b; }).catch(() => {});
    }
  }

  // First gesture: build the graph, decode the click file(s), start the music.
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      ctx.addEventListener('statechange', setCtxState);
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
    }
    prepSfx();
    if (muted || document.hidden) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); }
    else if (ctx.state !== 'running') ctx.resume().catch(() => {});
    startMusic();
    setCtxState();
    if (ctx.state === 'running' || ctx.state === 'closed') stopUnlock();
  }
  const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const;
  function stopUnlock() { GESTURES.forEach((g) => document.removeEventListener(g, unlock, true)); }
  GESTURES.forEach((g) => document.addEventListener(g, unlock, { capture: true, passive: true }));

  async function startMusic() {
    if (!musicFile || !ctx || musicSrc || muted) return;
    const file = musicFile, req = ++musicReq;
    dbg.music = 'loading';
    try {
      const buf = await load(file);
      // Switched (or started by another call) while loading: that one wins.
      if (req !== musicReq || musicSrc || file !== musicFile) return;
      musicGain = ctx.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(master);
      musicSrc = ctx.createBufferSource();
      musicSrc.buffer = buf;
      musicSrc.loop = true;
      musicSrc.connect(musicGain);
      musicSrc.start();
      fadeMusicIn();
    } catch (e) {
      if (req === musicReq) dbg.music = 'error';
    }
  }
  function fadeMusicIn() {
    if (!ctx || !musicSrc || !musicGain) return;
    const t = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(musicGain.gain.value, t);
    musicGain.gain.linearRampToValueAtTime(MUSIC_GAIN, t + 1.5);
    dbg.music = muted || document.hidden ? 'paused' : 'playing';
  }
  // Fade the playing track out (0.4 s) and drop it; a pending load is cancelled.
  function stopMusic() {
    musicReq++;
    const src = musicSrc, g = musicGain;
    musicSrc = null; musicGain = null;
    dbg.music = 'off';
    if (!src || !g || !ctx) return;
    src.onended = () => g.disconnect();
    if (ctx.state !== 'running') { src.stop(); return; }
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + 0.4);
    src.stop(t + 0.45);
  }

  // With no music, let the context sleep 3 s after the last sound.
  function sleepSoon() {
    clearTimeout(idle);
    idle = window.setTimeout(() => { if (ctx && !musicFile) ctx.suspend().catch(() => {}); }, 3000);
  }
  // Wake the context for a sound.
  function wake() {
    if (!ctx || muted || document.hidden) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!musicFile) sleepSoon();
    return true;
  }

  function play(kind: Kind) {
    if (!sfx || !wake()) return;
    const c = ctx!;
    const t = c.currentTime + 0.005;
    if (sfx === 'synth') synth(c, kind, t);
    else {
      const b = sfxBufs[FILES[sfx]];
      if (!b) return;
      const s = c.createBufferSource();
      s.buffer = b;
      s.playbackRate.value = kind === 'land' ? 1 : 1 + (Math.random() * 2 - 1) * 0.07;
      const g = c.createGain();
      g.gain.value = GAIN[kind];
      s.connect(g).connect(master);
      s.start(t);
    }
    dbg[kind]++;
    w.__sfxCount++;
  }

  function blip(c: AudioContext, type: OscillatorType, f: number, t: number, peak: number, decay: number) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = f * (1 + (Math.random() * 2 - 1) * 0.06);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + decay + 0.02);
  }
  function synth(c: AudioContext, kind: Kind, t: number) {
    if (kind === 'hover') blip(c, 'triangle', 1100, t, GAIN.hover, 0.04);
    else if (kind === 'press') {
      blip(c, 'square', 650, t, 0.06, 0.05);
      if (noise) {
        const n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
        n.buffer = noise;
        n.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.06;
        bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2;
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
        n.connect(bp).connect(g).connect(master);
        n.start(t);
      }
    } else {
      // Landed: two rising notes (a fifth apart).
      blip(c, 'triangle', 660, t, 0.18, 0.25);
      blip(c, 'triangle', 990, t + 0.09, 0.18, 0.35);
    }
  }

  // ---- Whoosh: white noise through a swept filter, swelled in and out, panned across ----
  let wnoise: AudioBuffer | null = null;
  function whooshNow(kind: Whoosh) {
    if (!wake()) return;
    const c = ctx!;
    if (!wnoise) {
      wnoise = c.createBuffer(1, Math.round(c.sampleRate * 1.5), c.sampleRate);
      const d = wnoise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    // [filter, from Hz, to Hz, Q, duration s, peak at (0..1 of duration), gain, pan from, pan to, back-to Hz]
    const P: Record<Whoosh, [BiquadFilterType, number, number, number, number, number, number, number, number, number?]> = {
      // peaks come early (60-150 ms) so the whoosh lands with the click instead of swelling in after it
      air:   ['bandpass', 500, 2600, 0.9, 0.55, 0.2, 0.5, -0.5, 0.5],
      swish: ['bandpass', 1400, 6000, 1.3, 0.3, 0.2, 0.42, -0.7, 0.7],
      swoop: ['lowpass', 260, 1900, 1.6, 0.75, 0.2, 0.7, -0.6, 0.6, 500],
      gust:  ['bandpass', 300, 1200, 0.6, 0.95, 0.16, 0.6, -0.3, 0.3, 700],
      zip:   ['bandpass', 700, 7000, 5, 0.26, 0.25, 0.35, -0.8, 0.8],
    };
    const [type, f0, f1, Qv, dur, pk, peak0, p0, p1, fBack] = P[kind];
    const peak = Math.max(0.0002, peak0 * whooshVol);
    const t = c.currentTime, tp = t + dur * pk, te = t + dur;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = wnoise;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.05;
    f.type = type; f.Q.value = Qv;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, tp);
    f.frequency.exponentialRampToValueAtTime(fBack ?? f1 * 1.15, te);
    // a quick linear attack from an audible start (an exponential ramp from ~0 stays silent for most of its length)
    g.gain.setValueAtTime(peak * 0.25, t);
    g.gain.linearRampToValueAtTime(peak, tp);
    g.gain.exponentialRampToValueAtTime(0.0001, te);
    let node: AudioNode = src.connect(f).connect(g);
    if (c.createStereoPanner) {
      const pan = c.createStereoPanner();
      pan.pan.setValueAtTime(p0, t);
      pan.pan.linearRampToValueAtTime(p1, te);
      node = node.connect(pan);
    }
    node.connect(master);
    src.start(t, Math.random() * 0.3);
    src.stop(te + 0.05);
    dbg.whoosh++;
    w.__sfxCount++;
  }
  window.addEventListener('sound:preview-whoosh', () => { if (whoosh && ctx) whooshNow(whoosh); });

  // ---- Hooks: delegated at document level (they do nothing while sfx is off) ----
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  let hovered: Element | null = null;
  let lastHover = 0;
  document.addEventListener('pointerover', (e) => {
    if (!sfx || e.pointerType !== 'mouse' || !finePointer.matches) return;
    const el = (e.target as Element).closest?.(HIT);
    if (!el || el === hovered || el.closest('.snd-toggle')) { if (!el) hovered = null; return; }
    hovered = el;
    const now = performance.now();
    if (now - lastHover < 50) return;
    lastHover = now;
    play('hover');
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    if (hovered && !(e.relatedTarget instanceof Node && hovered.contains(e.relatedTarget))) hovered = null;
  }, { passive: true });
  // Wake the (sleeping) audio context as soon as the pointer is on a collage piece, so the whoosh isn't delayed by
  // the resume on click.
  document.addEventListener('pointerover', (e) => {
    if (!whoosh || !ctx || ctx.state !== 'suspended' || muted || document.hidden) return;
    if ((e.target as Element).closest?.('[data-jump]')) { ctx.resume().catch(() => {}); if (!musicFile) sleepSoon(); }
  }, { passive: true });
  // Whoosh on pressing a collage piece the camera flies into ([data-jump]): whooshAt ms after the press (0 = at once),
  // unless the press turns into a drag first (orbiting a 3D model). Keyboard activation plays it at once.
  let pendingWhoosh = 0, downX = 0, downY = 0;
  const cancelWhoosh = () => { clearTimeout(pendingWhoosh); pendingWhoosh = 0; };
  document.addEventListener('pointerdown', (e) => {
    if (!whoosh || e.button !== 0 || !(e.target as Element).closest?.('[data-jump]')) return;
    cancelWhoosh();
    downX = e.clientX; downY = e.clientY;
    const kind = whoosh;
    if (whooshAt <= 0) whooshNow(kind);
    else pendingWhoosh = window.setTimeout(() => { pendingWhoosh = 0; whooshNow(kind); }, whooshAt);
  }, { passive: true });
  document.addEventListener('pointermove', (e) => {
    if (pendingWhoosh && Math.hypot(e.clientX - downX, e.clientY - downY) > 6) cancelWhoosh();
  }, { passive: true });
  document.addEventListener('pointercancel', cancelWhoosh, { passive: true });
  document.addEventListener('click', (e) => {
    if (whoosh && e.detail === 0 && (e.target as Element).closest?.('[data-jump]')) whooshNow(whoosh);
  }, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    if (!sfx || e.button !== 0) return;
    const el = (e.target as Element).closest?.(HIT);
    if (el && !el.closest('.snd-toggle')) play('press');
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (!sfx || (e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
    const el = document.activeElement;
    if (el && el.matches(HIT) && !el.closest('.snd-toggle')) play('press');
  });
  // (The "landed" chime that played when a section finished opening was removed: it rang on every nav click.)

  // ---- Tab hidden: pause everything (suspending the context pauses the music in place) ----
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      ctx.suspend().catch(() => {});
      if (musicSrc) dbg.music = 'paused';
    } else if (!muted && musicFile) {
      ctx.resume().then(fadeMusicIn).catch(() => {});
    }
  });

  // ---- Mute toggle (bottom-left, next to the A/B pill) ----
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'snd-toggle';
  const render = () => {
    btn.setAttribute('aria-pressed', String(!muted));
    btn.setAttribute('aria-label', 'Sound');
    btn.title = muted ? 'Sound is off (click to turn on)' : 'Sound is on (click to mute)';
    btn.innerHTML = '<span aria-hidden="true">' + (muted ? '&#9834; off' : '&#9834; on') + '</span>';
  };
  render();
  btn.addEventListener('click', () => {
    muted = !muted;
    dbg.muted = muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* not persisted */ }
    render();
    if (!ctx) { unlock(); if (!ctx) return; }
    const c = ctx, t = c.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(muted ? 1 : 0, t);
    if (muted) {
      master.gain.linearRampToValueAtTime(0, t + 0.15);
      clearTimeout(idle);
      setTimeout(() => { if (muted) c.suspend().catch(() => {}); }, 200);
      if (musicSrc) dbg.music = 'paused';
    } else {
      master.gain.setValueAtTime(1, t);
      c.resume().then(() => { if (musicSrc) fadeMusicIn(); else startMusic(); play('press'); }).catch(() => {});
    }
  });
  const place = () => {
    const ab = document.querySelector('.ab-toggle');
    const r = ab ? ab.getBoundingClientRect() : null;
    btn.style.left = (r && r.width ? Math.round(r.right + 8) : 10) + 'px';
  };
  document.body.appendChild(btn);
  place();
  window.addEventListener('resize', place, { passive: true });

  // Apply the current musicFile / sfx (called again by the Looks picker after either changes).
  let playing: string | null = musicFile;
  function apply() {
    const on = !!(musicFile || sfx || whoosh);
    btn.style.display = on ? '' : 'none';
    if (musicFile !== playing) { playing = musicFile; stopMusic(); }
    // The picker click was a gesture, so the context may start now; otherwise the first gesture starts it.
    const active = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive;
    if (on && (ctx || active)) {
      unlock();
      if (!musicFile) sleepSoon();
    } else if (!on && ctx) {
      clearTimeout(idle);
      setTimeout(() => { if (ctx && !musicFile && !sfx && !whoosh) ctx.suspend().catch(() => {}); }, 500);
    }
  }
  apply();
  return apply;
}
