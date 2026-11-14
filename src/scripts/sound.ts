// Music + UI sounds, opt-in by URL (A/B like ?nav= / ?bg=). Loaded by Base.astro only when one of these is set:
//   ?music=explore|shop|voting|waves|off   looping track (public/sounds/music-*.mp3, credits in public/sounds/CREDITS.md)
//   ?sfx=tap|stopwatch|tick|synth|off      hover/press ticks + a "landed" chime (synth = procedural, no file)
// Plain Web Audio: one AudioContext, created on the first user gesture (browsers block audio before that).
// Music plays from a decoded buffer so the loop is gapless. Tab hidden or muted -> the context is suspended.
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

const q = new URLSearchParams(location.search);
const musicFile = MUSIC[q.get('music') || ''] || null;
const sfxArg = q.get('sfx') || '';
const sfx = sfxArg === 'synth' || FILES[sfxArg] ? sfxArg : null;
const BASE = (import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/') + 'sounds/';

const dbg = { hover: 0, press: 0, land: 0, ctx: 'none' as string, music: 'off' as string, muted: false };
const w = window as unknown as { __sfx: typeof dbg; __sfxCount: number };
w.__sfx = dbg;
w.__sfxCount = 0;

if (musicFile || sfx) init();

function init() {
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* storage blocked: default unmuted */ }
  dbg.muted = muted;

  let ctx: AudioContext | null = null;
  let master: GainNode;
  let musicGain: GainNode;
  let musicSrc: AudioBufferSourceNode | null = null;
  let musicLoading = false;
  const buffers: Partial<Record<Kind, AudioBuffer>> = {};
  let noise: AudioBuffer | null = null;
  let idle = 0;

  const setCtxState = () => { dbg.ctx = ctx ? ctx.state : 'none'; };

  async function load(name: string) {
    const r = await fetch(BASE + name);
    if (!r.ok) throw new Error('sound: ' + name + ' ' + r.status);
    return ctx!.decodeAudioData(await r.arrayBuffer());
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
      musicGain = ctx.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(master);
      if (sfx && sfx !== 'synth') {
        load(FILES[sfx]).then((b) => { buffers.hover = buffers.press = b; }).catch(() => {});
        load('success.mp3').then((b) => { buffers.land = b; }).catch(() => {});
      }
      if (sfx === 'synth') {
        noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      }
    }
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
    if (!musicFile || !ctx || musicSrc || musicLoading || muted) return;
    musicLoading = true;
    dbg.music = 'loading';
    try {
      const buf = await load(musicFile);
      if (musicSrc) return;
      musicSrc = ctx.createBufferSource();
      musicSrc.buffer = buf;
      musicSrc.loop = true;
      musicSrc.connect(musicGain);
      musicSrc.start();
      fadeMusicIn();
    } catch (e) {
      dbg.music = 'error';
    } finally {
      musicLoading = false;
    }
  }
  function fadeMusicIn() {
    if (!ctx || !musicSrc) return;
    const t = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(0, t);
    musicGain.gain.linearRampToValueAtTime(MUSIC_GAIN, t + 1.5);
    dbg.music = muted || document.hidden ? 'paused' : 'playing';
  }

  // Wake the context for a sound; with no music, let it sleep again 3 s after the last one.
  function wake() {
    if (!ctx || muted || document.hidden) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!musicFile) {
      clearTimeout(idle);
      idle = window.setTimeout(() => { if (ctx && !musicFile) ctx.suspend().catch(() => {}); }, 3000);
    }
    return true;
  }

  function play(kind: Kind) {
    if (!sfx || !wake()) return;
    const c = ctx!;
    const t = c.currentTime + 0.005;
    if (sfx === 'synth') synth(c, kind, t);
    else {
      const b = buffers[kind];
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

  // ---- Hooks: delegated at document level ----
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  let hovered: Element | null = null;
  let lastHover = 0;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || !finePointer.matches) return;
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
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = (e.target as Element).closest?.(HIT);
    if (el && !el.closest('.snd-toggle')) play('press');
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
    const el = document.activeElement;
    if (el && el.matches(HIT) && !el.closest('.snd-toggle')) play('press');
  });
  // Landed: a section page is open and the camera has stopped flying (during a fly-to the old page briefly reports
  // open with the new key, so "open" alone fires twice). Fires on that rising edge, or if the landed section changes.
  type Cam = { open: boolean; key: string; flying: boolean };
  const landed = (c?: Cam) => !!c && c.open && !c.flying;
  const cam0 = (window as unknown as { __zoomCam?: Cam }).__zoomCam;
  let wasLanded = landed(cam0), landKey = cam0?.key ?? '';
  window.addEventListener('zoomcam', (e) => {
    const c = (e as CustomEvent).detail as Cam, now = landed(c);
    if (now && (!wasLanded || c.key !== landKey)) play('land');
    wasLanded = now;
    if (now) landKey = c.key;
  });

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
}
