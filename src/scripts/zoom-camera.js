// Scroll-driven zoom camera for the collage (ported as-is from the legacy zoom.html, plus:
//  - publishes the camera to 3D slots (window "zoomcam" event + window.__zoomCam),
//  - deep links: /<section> routes start zoomed in, and the URL follows what you are looking at.
import { STACKED_MQ } from './slot-view.js';

export function initZoomCamera() {
  'use strict';
  if (!document.getElementById('zm-root')) return;
  var ORDER = ['projects', 'timeline', 'photos', 'writing', 'map', 'guestbook', 'contact'];
  var NAMES = { projects: 'Projects', timeline: 'Timeline', photos: 'Photos', writing: 'Writing', map: 'Places', guestbook: 'Guestbook', contact: 'Say hi' };

  var $ = function (id) { return document.getElementById(id); };
  var root = $('zm-root'), track = $('zm-track'), world = $('zm-world');
  var phWorld = $('ph-world'), hint = $('zm-hint'), home = $('zm-home'), whead = $('zm-whead');
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
  // Camera targets: the 16:10 panel of each piece, measured from the markup so it never drifts.
  var PIECES = ORDER.map(function (k) {
    return { key: k, name: NAMES[k], rot: Number(els[k].getAttribute('data-rot')) || 0, cx: 720, cy: 450, px: 720, py: 450, pw: 1440, ph: 900 };
  });

  var vw = 1440, stageH = 900, cur = null, hudI = -1, raf = 0, fl = null, bl = null;
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
    var ops = {}; ops[tp.key] = clamp((z - 0.7) / 0.25, 0, 1);
    return { i: i, s: s, cx: 720 + (tp.px - 720) * g, cy: 450 + (tp.py - 450) * g, r: tp.rot * g, ops: ops };
  }
  function scrollP() { return clamp(-track.getBoundingClientRect().top / (stageH * 1.6), 0, 7); }
  function topForP(P) { return window.pageYOffset + track.getBoundingClientRect().top + P * stageH * 1.6; }

  function setHud(i) {
    if (i === hudI) return;
    hudI = i;
    hudNum.textContent = String(i + 1).padStart(2, '0');
    hudName.textContent = PIECES[i].name;
    dots.forEach(function (b, k) {
      var on = k === i, dot = b.firstElementChild;
      b.setAttribute('aria-current', on ? 'true' : 'false');
      dot.style.width = dot.style.height = on ? '10px' : '7px';
      dot.style.backgroundColor = on ? '#C2F970' : '#8F86C0';
    });
  }

  // Style writes are skipped when the value has not changed, so a scroll frame touches only what moves.
  var lastW = {};
  function put(el, prop, val, id) {
    if (!el || lastW[id] === val) return;
    lastW[id] = val;
    el.style[prop] = val;
  }

  function applyCam(c) {
    cur = c;
    put(world, 'transform', 'translate(' + f(vw / 2) + 'px, ' + f(stageH / 2) + 'px) scale(' + f(c.s) + ') rotate(' + f(-c.r) + 'deg) translate(' + f(-c.cx) + 'px, ' + f(-c.cy) + 'px)', 'world');
    ORDER.forEach(function (k) {
      var op = c.ops[k] || 0, pg = pages[k], on = op >= 0.5;
      put(pg, 'opacity', String(f(op)), 'p' + k);
      // Fully landed: the page scrolls on its own (and hands the wheel back to the camera at either end).
      var held = op >= 0.99;
      if (held !== pg.classList.contains('is-held')) { pg.classList.toggle('is-held', held); if (!held) pg.scrollTop = 0; }
      put(covers[k], 'opacity', String(f(1 - op)), 'c' + k);
      if (on !== live[k]) {
        live[k] = on;
        pg.style.pointerEvents = on ? 'auto' : 'none';
        if (on) { pg.removeAttribute('aria-hidden'); pg.inert = false; } else { pg.setAttribute('aria-hidden', 'true'); pg.inert = true; }
      }
    });
    var zn = zoomness(c);
    put(hint, 'opacity', String(f(1 - zn)), 'hint');
    // The fixed "Tanishq" pill only appears once the in-world header's "Tanishq" has left the screen.
    // Hidden while a section page is open: the page has its own "back to collage" button.
    var anyOpen = false;
    ORDER.forEach(function (k) { if ((c.ops[k] || 0) > 0.05) anyOpen = true; });
    var hp = toScreen(c, homeAt.x, homeAt.y), off = !anyOpen && (hp.x < 0 || hp.y < 0 || hp.x > vw || hp.y > stageH);
    if (home.classList.contains('is-on') !== off) home.classList.toggle('is-on', off);
    if (whead && whead.inert !== (zn > 0.3)) whead.inert = zn > 0.3;
    setHud(c.i);
    publish(c, zn);
  }

  // Tell 3D islands where the camera is: world scale (for canvas resolution) and whether a page covers the world.
  function publish(c, zn) {
    var open = false;
    ORDER.forEach(function (k) { if ((c.ops[k] || 0) > 0.5) open = true; });
    // cx/cy/r/vw/h let 3D slots compute their own screen rect from the camera math (no layout reads per frame).
    var cam = { s: c.s, open: open, zoom: zn, flying: !!fl, cx: c.cx, cy: c.cy, r: c.r, vw: vw, h: stageH };
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

  function mix(a, b, t) {
    var ops = {};
    ORDER.forEach(function (k) { ops[k] = lerp(a.ops[k] || 0, b.ops[k] || 0, t); });
    return { i: b.i, s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), t)), cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), r: lerp(a.r, b.r, t), ops: ops };
  }

  // One frame loop for all three modes: flight (click), blend (flight cancelled by scrolling), scroll.
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }
  function tick() {
    raf = 0;
    if (isPhone()) return;
    if (fl) { flightFrame(); return; }
    if (bl) {
      var t = clamp((now() - bl.t0) / bl.dur, 0, 1);
      applyCam(mix(bl.from, camAtP(scrollP()), easeOut(t)));
      if (t < 1) kick(); else bl = null;
      return;
    }
    applyCam(camAtP(scrollP()));
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
    var fo = 1 - clamp(t / 0.22, 0, 1), fi = clamp((t - 0.78) / 0.22, 0, 1);
    var ops = {};
    ORDER.forEach(function (key) { ops[key] = Math.max((A.ops[key] || 0) * fo, (B.ops[key] || 0) * fi); });
    applyCam({ i: B.i, s: Math.exp(fl.la + (fl.lb - fl.la) * e - fl.h * 4 * e * (1 - e)), cx: lerp(A.cx, B.cx, u), cy: lerp(A.cy, B.cy, u), r: lerp(A.r, B.r, e), ops: ops });
    if (t < 1) { kick(); return; }
    var done = fl; fl = null;
    jumpScroll(done.P);
    afterLand(done.P, done.focus, done);
  }

  function jumpScroll(P) {
    var top = Math.round(topForP(P));
    try { window.scrollTo({ top: top, left: 0, behavior: 'instant' }); } catch (err) { window.scrollTo(0, top); }
    applyCam(camAtP(scrollP()));
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
    if (isPhone()) return;
    extend();
    geom();
    if (!fl) { bl = null; applyCam(camAtP(scrollP())); }
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
  measure();
  if (initial) {
    if (isPhone()) {
      var sec = document.getElementById('sec-' + initial);
      if (sec) sec.scrollIntoView();
    } else {
      jumpScroll(ORDER.indexOf(initial) + 0.5);
    }
  }
}
