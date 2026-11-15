// Scroll-driven zoom camera for the collage (ported as-is from the legacy zoom.html, plus:
//  - publishes the camera to 3D slots (window "zoomcam" event + window.__zoomCam),
//  - deep links: /<section> routes start zoomed in, and the URL follows what you are looking at.
import { STACKED_MQ } from './slot-view.js';
import { initTx } from './zoom-tx.js';

export function initZoomCamera() {
  'use strict';
  if (!document.getElementById('zm-root')) return;
  var ORDER = ['projects', 'timeline', 'photos', 'writing', 'map', 'guestbook', 'contact'];
  var NAMES = { projects: 'Projects', timeline: 'Accomplishments', photos: 'Photos', writing: 'Blog', map: 'Places', guestbook: 'Guestbook', contact: 'Say hi' };

  var $ = function (id) { return document.getElementById(id); };
  var root = $('zm-root'), track = $('zm-track'), world = $('zm-world');
  var phWorld = $('ph-world'), hint = $('zm-hint'), arrow = $('zm-arrow'), home = $('zm-home'), whead = $('zm-whead');
  var hudNum = $('hud-num'), hudName = $('hud-name');
  var stage = $('zm-stage');
  var BASE = (root.getAttribute('data-base') || '/').replace(/\/$/, '');
  var urlKey = null;
  var els = {}, covers = {}, pages = {}, live = {};
  ORDER.forEach(function (k) {
    els[k] = world.querySelector('[data-jump="' + k + '"]');
    covers[k] = world.querySelector('[data-cover="' + k + '"]');
    pages[k] = world.querySelector('[data-page="' + k + '"]');
    live[k] = false;
  });
  var dots = Array.prototype.slice.call(document.querySelectorAll('[data-dot]'));
  // How a page enters/leaves its piece (?tx=, scripts/zoom-tx.js): sets the op windows below and draws each frame.
  var TX = null;
  // Camera targets: the 16:10 panel of each piece, measured from the markup so it never drifts.
  var PIECES = ORDER.map(function (k) {
    return { key: k, name: NAMES[k], rot: Number(els[k].getAttribute('data-rot')) || 0, cx: 720, cy: 450, px: 720, py: 450, pw: 1440, ph: 900 };
  });

  var cur0 = false; // the first camera placement is not motion
  var vw = 1440, stageH = 900, cur = null, hudI = -1, raf = 0, fl = null, bl = null;
  // Smoothed scroll: the camera follows sp, which eases toward the real scroll position once per animation
  // frame (exponential lerp, frame-rate independent), so wheel notches glide instead of jumping. trackTop is
  // cached in measure() so a frame reads only pageYOffset, never layout.
  var sp = null, lastT = 0, trackTop = 0, SMOOTH_TAU = 0.11;
  // ?smooth=<seconds> tunes the catch-up time for A/B (0 = old direct follow; 0.11 = default, picked by feel).
  // The Looks picker sets it live (window.__zoomSetSmooth / "looks:change"); '' or null = the default.
  function setSmooth(v) { SMOOTH_TAU = v === '' || v == null ? 0.11 : Math.min(0.5, parseFloat(v) || 0); }
  var smoothQ = /[?&]smooth=([\d.]+)/.exec(location.search);
  if (smoothQ) setSmooth(smoothQ[1]);
  window.__zoomSetSmooth = setSmooth;
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var ss = function (t) { return t * t * (3 - 2 * t); };
  var f = function (n) { return Number(n.toFixed(4)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var easeIO = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  var reduce = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };
  // Stacked (phone) layout: narrow or portrait screens. Same query as the CSS (.only-phone / .only-desk).
  var stackedMq = window.matchMedia(STACKED_MQ);
  var isPhone = function () { return stackedMq.matches; };
  var now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };

  function geom() {
    PIECES.forEach(function (p) {
      var el = els[p.key], pan = el.querySelector('.zpanel');
      if (!el.offsetWidth || !pan) return;
      var x = 0, y = 0, n = pan;
      while (n && n !== el) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      var W = el.offsetWidth, H = el.offsetHeight;
      // The section page is laid out at the real viewport size (vw x stageH) and scaled to the panel's width,
      // so when the camera lands (scale vw / pw) it is pixel-for-pixel the screen. It may hang below the panel.
      p.pw = pan.offsetWidth; p.ph = p.pw * stageH / vw;
      p.cx = el.offsetLeft + W / 2; p.cy = el.offsetTop + H / 2;
      var ox = x + p.pw / 2 - W / 2, oy = y + p.ph / 2 - H / 2;
      var a = p.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      p.px = p.cx + ox * c - oy * s;
      p.py = p.cy + ox * s + oy * c;
      var pg = pages[p.key];
      if (pg) { pg.style.width = vw + 'px'; pg.style.height = stageH + 'px'; pg.style.transform = 'scale(' + f(p.pw / vw) + ')'; }
    });
  }

  function s0() { return Math.min(vw / 1440, stageH / 900); }
  // World point -> screen point under camera c.
  function toScreen(c, x, y) {
    var a = -c.r * Math.PI / 180, co = Math.cos(a), si = Math.sin(a), dx = x - c.cx, dy = y - c.cy;
    return { x: vw / 2 + c.s * (dx * co - dy * si), y: stageH / 2 + c.s * (dx * si + dy * co) };
  }
  var homeAt = { x: 80, y: 44 };
  // Screens that are not 16:10 see more than the 1440x900 world at the overview. --ex/--ey (world px) push the
  // edge pieces (header, intro, "makes things.", stamp...) out to the real screen edges, so there are no dead bands.
  function extend() {
    var a = s0(), ex = clamp((vw / a - 1440) / 2, 0, 420), ey = clamp((stageH / a - 900) / 2, 0, 160);
    world.style.setProperty('--ex', f(ex) + 'px');
    world.style.setProperty('--ey', f(ey) + 'px');
    var hl = whead && whead.querySelector('a');
    if (hl) homeAt = { x: whead.offsetLeft + hl.offsetLeft + hl.offsetWidth / 2, y: whead.offsetTop + hl.offsetTop + hl.offsetHeight / 2 };
  }
  function zoomness(c) { return clamp(Math.log(c.s / s0()) / Math.log(1.8), 0, 1); }

  // Scroll-driven camera: 7 segments of 1.6 screens, each zooms in, holds, zooms out.
  function camAtP(P) {
    P = clamp(P, 0, 7);
    var i = Math.min(Math.floor(P), 6), u = P - i;
    var z = u < 0.35 ? ss(u / 0.35) : (u <= 0.65 ? 1 : ss((1 - u) / 0.35));
    var tp = PIECES[i], a = s0(), b = Math.min(vw / tp.pw, stageH / tp.ph);
    var s = Math.pow(a, 1 - z) * Math.pow(b, z);
    var den = 1 - a / b, g = Math.abs(den) < 1e-9 ? z : (1 - a / s) / den;
    var ops = {}; ops[tp.key] = clamp((z - TX.z[0]) / (TX.z[1] - TX.z[0]), 0, 1);
    return { i: i, s: s, cx: 720 + (tp.px - 720) * g, cy: 450 + (tp.py - 450) * g, r: tp.rot * g, ops: ops };
  }
  function scrollP() { return clamp((window.pageYOffset - trackTop) / (stageH * 1.6), 0, 7); }
  function topForP(P) { return trackTop + P * stageH * 1.6; }

  function setHud(i) {
    if (i === hudI) return;
    hudI = i;
    // i = -1: the zoomed-out collage, where no section is in view yet.
    hudNum.textContent = String(i + 1).padStart(2, '0');
    hudName.textContent = i < 0 ? 'Collage' : PIECES[i].name;
    dots.forEach(function (b, k) { b.setAttribute('aria-current', k === i ? 'true' : 'false'); });
  }

  // Style writes are skipped when the value has not changed, so a scroll frame touches only what moves.
  var lastW = {};
  function put(el, prop, val, id) {
    if (!el || lastW[id] === val) return false;
    lastW[id] = val;
    el.style[prop] = val;
    return true;
  }

  // While the camera moves, the world is its own compositor layer (will-change: transform), so a scroll or
  // flight frame only re-composites it instead of repainting and re-rasterising the whole collage (that was
  // ~25% dropped frames on scroll, mostly GPU raster). Such a layer keeps the scale it was rastered at, so:
  // when the zoom drifts past RASTER_DRIFT from it, the layer is dropped for one frame and re-made at the
  // new scale; and once the camera rests, it goes back to a normal layer and repaints pin-sharp.
  // Each re-make re-rasters the whole visible collage, which a weak GPU can't do mid-scroll (it was 4-15 times
  // per scroll at a drift of 1.45), so the drift is wide: text goes a little soft mid-motion and is sharp at rest.
  // A flight keeps one layer from take-off to landing (it is short, and lands sharp).
  // A one-off jump (a deep link, the scroll position snapping after a flight) is not motion: it repaints once.
  var RASTER_DRIFT = 3.5, RASTER_OUT = 1.45, REST_MS = 180, wc = { on: false, s: 1, timer: 0, at: -1e9 };
  function settleWorld() { wc.on = false; world.style.willChange = ''; }
  function worldMoved(s) {
    var t = now(), moving = t - wc.at < 100;
    wc.at = t;
    if (!wc.on) { if (moving) { wc.on = true; wc.s = s; world.style.willChange = 'transform'; } }
    else if (s > wc.s * RASTER_DRIFT || s < wc.s / RASTER_OUT) settleWorld();
    clearTimeout(wc.timer);
    wc.timer = setTimeout(settleWorld, REST_MS);
  }

  function applyCam(c) {
    cur = c;
    if (put(world, 'transform', 'translate(' + f(vw / 2) + 'px, ' + f(stageH / 2) + 'px) scale(' + f(c.s) + ') rotate(' + f(-c.r) + 'deg) translate(' + f(-c.cx) + 'px, ' + f(-c.cy) + 'px)', 'world') && cur0) worldMoved(c.s);
    cur0 = true;
    ORDER.forEach(function (k) {
      var op = c.ops[k] || 0, pg = pages[k], on = op >= 0.5;
      // The page's look at this progress (opacity / clip / mask / sheet) and its cover: zoom-tx.js.
      TX.page(k, pg, covers[k], op, vw, stageH);
      // A page at opacity 0 is skipped entirely (no paint, no layers: its sticky header and scroller used to be
      // composited layers on every frame of the collage). It keeps its layout, so fading in costs one paint.
      put(pg, 'contentVisibility', op > 0 ? 'visible' : 'hidden', 'v' + k);
      // Fully landed: the page scrolls on its own (and hands the wheel back to the camera at either end).
      var held = op >= 0.99;
      if (held !== pg.classList.contains('is-held')) { pg.classList.toggle('is-held', held); if (!held) pg.scrollTop = 0; }
      if (on !== live[k]) {
        live[k] = on;
        pg.style.pointerEvents = on ? 'auto' : 'none';
        if (on) { pg.removeAttribute('aria-hidden'); pg.inert = false; } else { pg.setAttribute('aria-hidden', 'true'); pg.inert = true; }
      }
    });
    TX.frame(c.ops, pageQuad, vw, stageH);
    var zn = zoomness(c);
    put(hint, 'opacity', String(f(1 - zn)), 'hint');
    // The scroll arrow fades three times as fast (it only invites the first scroll), then hides (its bounce stops).
    var ao = f(clamp(1 - zn * 3, 0, 1));
    if (put(arrow, 'opacity', String(ao), 'arrow') && arrow.classList.contains('is-off') !== (ao === 0)) arrow.classList.toggle('is-off', ao === 0);
    // The fixed "Tanishq" pill only appears once the in-world header's "Tanishq" has left the screen.
    // Hidden while a section page is open: the page has its own "back to collage" button.
    var anyOpen = false;
    ORDER.forEach(function (k) { if ((c.ops[k] || 0) > 0.05) anyOpen = true; });
    var hp = toScreen(c, homeAt.x, homeAt.y), off = !anyOpen && (hp.x < 0 || hp.y < 0 || hp.x > vw || hp.y > stageH);
    if (home.classList.contains('is-on') !== off) home.classList.toggle('is-on', off);
    if (whead && whead.inert !== (zn > 0.3)) whead.inert = zn > 0.3;
    // Pieces lift on hover only near the overview (global.css .zm-lift); toggled only when it changes.
    if (world.classList.contains('zm-lift') !== (zn <= 0.3)) world.classList.toggle('zm-lift', zn <= 0.3);
    setHud(zn >= 0.5 || anyOpen ? c.i : -1);
    publish(c, zn);
  }

  // Tell 3D islands where the camera is: world scale (for canvas resolution) and whether a page covers the world.
  function publish(c, zn) {
    var open = false;
    ORDER.forEach(function (k) { if ((c.ops[k] || 0) > 0.5) open = true; });
    // cx/cy/r/vw/h let 3D slots compute their own screen rect from the camera math (no layout reads per frame).
    // key/prog: the piece the camera is heading for and how far into it, in log scale (0 = overview, 1 = landed).
    var tp = PIECES[c.i], a0 = s0(), b0 = Math.min(vw / tp.pw, stageH / tp.ph);
    var prog = b0 > a0 * 1.001 ? clamp(Math.log(c.s / a0) / Math.log(b0 / a0), 0, 1) : 0;
    // still: this frame is where the scroll smoothing ends (its final snap), so 3D slots can draw sharp now.
    var cam = { s: c.s, open: open, zoom: zn, flying: !!fl, cx: c.cx, cy: c.cy, r: c.r, vw: vw, h: stageH, key: tp.key, prog: prog, p: sp, still: !fl && !bl && sp === scrollP() };
    window.__zoomCam = cam;
    window.dispatchEvent(new CustomEvent('zoomcam', { detail: cam }));
    // URL follows the view: a section route while its page is open, the home route at the overview.
    if (fl) return;
    var k = null;
    ORDER.forEach(function (key) { if ((c.ops[key] || 0) >= 0.5) k = key; });
    var want = k ? k : (zn < 0.05 ? '' : urlKey);
    if (want !== urlKey && want !== null) {
      urlKey = want;
      try { history.replaceState(null, '', BASE + '/' + want + location.search); } catch (err) {}
    }
  }

  // The current page rect of piece k on screen (4 corners), for the morph veil's hole.
  function pageQuad(k) {
    var p = PIECES[ORDER.indexOf(k)], a = p.rot * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (d) {
      var dx = d[0] * p.pw / 2, dy = d[1] * p.ph / 2;
      return toScreen(cur, p.px + dx * co - dy * si, p.py + dx * si + dy * co);
    });
  }

  function mix(a, b, t) {
    var ops = {};
    ORDER.forEach(function (k) { ops[k] = lerp(a.ops[k] || 0, b.ops[k] || 0, t); });
    return { i: b.i, s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), t)), cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), r: lerp(a.r, b.r, t), ops: ops };
  }

  // One frame loop for all three modes: flight (click), blend (flight cancelled by scrolling), scroll.
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }
  function tick(ts) {
    raf = 0;
    if (isPhone()) { lastT = 0; return; }
    var dt = lastT ? clamp((ts - lastT) / 1000, 0, 0.05) : 1 / 60;
    lastT = ts;
    if (fl) { flightFrame(); return; }
    var target = scrollP();
    if (bl) {
      var t = clamp((now() - bl.t0) / bl.dur, 0, 1);
      sp = target;
      applyCam(mix(bl.from, camAtP(target), easeOut(t)));
      if (t < 1) kick(); else { bl = null; lastT = 0; }
      return;
    }
    if (sp === null || !SMOOTH_TAU || reduce()) sp = target;
    else sp += (target - sp) * (1 - Math.exp(-dt / SMOOTH_TAU));
    if (Math.abs(target - sp) < 0.0004) sp = target;
    applyCam(camAtP(sp));
    if (sp !== target) kick(); else lastT = 0;
  }

  // Direct camera flight to scroll position P (k + 0.5 = holding on piece k, 0 = overview).
  // Scale moves in log space; piece-to-piece flights pull out partway mid-flight (a fly-to arc).
  // The centre is weighted by 1/scale so it travels while zoomed out, not while zoomed in.
  function flyTo(P, focusAfter) {
    if (isPhone() || fl || !cur) return;
    var dest = camAtP(P);
    if (reduce()) { jumpScroll(P); afterLand(P, focusAfter, cur); return; }
    if (!bl && Math.abs(scrollP() - P) < 0.002) { afterLand(P, focusAfter, cur); return; }
    bl = null;
    var from = cur, a = s0(), la = Math.log(from.s), lb = Math.log(dest.s);
    var inA = from.s > a * 1.25, inB = dest.s > a * 1.25, h = 0;
    if (inA && inB) {
      var lmid = 0.5 * (Math.log(a) + Math.min(la, lb));
      h = Math.max(0, (la + lb) / 2 - lmid);
    }
    var N = 64, U = [0], acc = 0, prev = Math.exp(-la);
    for (var k = 1; k <= N; k++) {
      var e = k / N, w = Math.exp(-(la + (lb - la) * e - h * 4 * e * (1 - e)));
      acc += (prev + w) / 2; U.push(acc); prev = w;
    }
    for (k = 0; k <= N; k++) U[k] = acc > 0 ? U[k] / acc : k / N;
    var dist = Math.hypot(dest.cx - from.cx, dest.cy - from.cy);
    var dur = inA && inB ? 900 : (dist < 1 && Math.abs(la - lb) < 0.01 ? 300 : 780);
    fl = { from: from, dest: dest, la: la, lb: lb, h: h, U: U, N: N, t0: now(), dur: dur, P: P, focus: focusAfter, fromI: from.i };
    setHud(dest.i);
    kick();
  }

  function flightFrame() {
    var t = clamp((now() - fl.t0) / fl.dur, 0, 1), e = easeIO(t);
    var A = fl.from, B = fl.dest;
    var x = e * fl.N, k = Math.min(Math.floor(x), fl.N - 1);
    var u = fl.U[k] + (fl.U[k + 1] - fl.U[k]) * (x - k);
    // Old page out over TX.fout, new page in over TX.fin (fractions of the flight; the default overlaps the end
    // of the zoom instead of starting once the camera has stopped).
    var fo = 1 - clamp((t - TX.fout[0]) / (TX.fout[1] - TX.fout[0]), 0, 1), fi = clamp((t - TX.fin[0]) / (TX.fin[1] - TX.fin[0]), 0, 1);
    var ops = {};
    ORDER.forEach(function (key) { ops[key] = Math.max((A.ops[key] || 0) * fo, (B.ops[key] || 0) * fi); });
    // Flying home, the HUD keeps the section being left (B.i would be 0, "Projects") until the zoom-out clears it.
    applyCam({ i: fl.P < 0.5 ? A.i : B.i, s: Math.exp(fl.la + (fl.lb - fl.la) * e - fl.h * 4 * e * (1 - e)), cx: lerp(A.cx, B.cx, u), cy: lerp(A.cy, B.cy, u), r: lerp(A.r, B.r, e), ops: ops });
    if (t < 1) { kick(); return; }
    var done = fl; fl = null;
    jumpScroll(done.P);
    afterLand(done.P, done.focus, done);
  }

  function jumpScroll(P) {
    var top = Math.round(topForP(P));
    try { window.scrollTo({ top: top, left: 0, behavior: 'instant' }); } catch (err) { window.scrollTo(0, top); }
    sp = scrollP();
    applyCam(camAtP(sp));
  }

  function afterLand(P, focusAfter, info) {
    if (!focusAfter) return;
    var c = camAtP(P), key = PIECES[c.i].key;
    var target = (c.ops[key] || 0) >= 0.5 ? pages[key].querySelector('[data-back]') : dots[info && info.fromI != null ? info.fromI : 0];
    if (target) { try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); } }
    if (stage) { stage.scrollTop = 0; stage.scrollLeft = 0; }
  }

  // Any user scrolling during a flight cancels it and eases back to the scroll-driven camera.
  function cancelFlight() {
    if (!fl) return;
    fl = null;
    bl = { from: cur, t0: now(), dur: 320 };
    kick();
  }
  window.addEventListener('scroll', function () { if (fl) cancelFlight(); kick(); }, { passive: true });
  window.addEventListener('wheel', cancelFlight, { passive: true });
  window.addEventListener('touchstart', cancelFlight, { passive: true });
  window.addEventListener('keydown', function (e) {
    if (fl && /^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| |Spacebar)$/.test(e.key)) cancelFlight();
  });

  function measure() {
    vw = Math.round(root.clientWidth || window.innerWidth || 1440);
    stageH = Math.round(window.innerHeight || 900);
    track.style.height = f(stageH * (1 + 7 * 1.6)) + 'px';
    stage.style.height = stageH + 'px';
    if (phWorld) phWorld.style.transform = 'scale(' + f(vw / 1440) + ')';
    trackTop = window.pageYOffset + track.getBoundingClientRect().top;
    if (isPhone()) return;
    extend();
    geom();
    if (!fl) { bl = null; sp = scrollP(); applyCam(camAtP(sp)); }
  }
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(root);
  stackedMq.addEventListener('change', function () { measure(); kick(); });

  var kb = function (e) { return e && e.detail === 0; };
  ORDER.forEach(function (key, idx) {
    els[key].addEventListener('click', function (e) {
      // Any piece is clickable at any zoom level, except the one whose page is already open.
      if (fl || !cur || live[key]) return;
      flyTo(idx + 0.5, kb(e));
    });
  });
  document.querySelectorAll('[data-back]').forEach(function (b) {
    b.addEventListener('click', function (e) { e.stopPropagation(); if (!fl) flyTo(0, kb(e)); });
  });
  dots.forEach(function (b, k) { b.addEventListener('click', function (e) { if (!fl) flyTo(k + 0.5, kb(e)); }); });
  document.querySelectorAll('[data-fly]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (fl) return;
      var t = a.getAttribute('data-fly');
      flyTo(t === 'home' ? 0 : ORDER.indexOf(t) + 0.5, kb(e));
    });
  });
  home.addEventListener('click', function (e) { e.preventDefault(); if (!fl) flyTo(0, kb(e)); });
  // For other islands (3D objects in the collage): fly to a section by key, or 'home'.
  window.__zoomFly = function (key) {
    if (fl || !cur || isPhone()) return;
    var i = ORDER.indexOf(key);
    if (key === 'home') flyTo(0); else if (i >= 0 && !live[key]) flyTo(i + 0.5);
  };

  // Deep link (/projects etc.): start already holding on that section, no flight.
  var initial = root.getAttribute('data-initial');
  if (initial && ORDER.indexOf(initial) < 0) initial = null;
  // Set before measure(): its first applyCam is at scroll 0 and must not rewrite the URL to home.
  urlKey = initial || '';
  TX = initTx({ root: root, stage: stage, pages: pages, covers: covers, order: ORDER, reduce: reduce() });
  measure();
  // The Looks picker (scripts/looks.ts) switches the transition and the smoothing live. A new transition is
  // redrawn at once for where the camera is (a flight in progress just carries on with it).
  window.addEventListener('looks:change', function (e) {
    var d = e.detail || {};
    if (d.key === 'smooth') setSmooth(d.value);
    if (d.key !== 'tx') return;
    TX.set(d.value || '');
    if (isPhone() || !cur) return;
    if (fl) { kick(); return; }
    bl = null;
    if (sp === null) sp = scrollP();
    applyCam(camAtP(sp));
  });
  if (initial) {
    if (isPhone()) {
      var sec = document.getElementById('sec-' + initial);
      if (sec) sec.scrollIntoView();
    } else {
      jumpScroll(ORDER.indexOf(initial) + 0.5);
    }
  }
}
