// How a section page enters and leaves its collage piece, picked with ?tx= while we choose one:
//   fade (default)  plain crossfade over the held cover (no double exposure), eased
//   morph           the piece's panel is the shared element: a rounded window opens from its centre to the full
//                   page while the rest of the collage dims around the panel (View-Transitions-style morph)
//   iris            circular reveal from the panel's centre with a thin lime rim
//   paper           the page arrives as a taped sheet sliding up over the piece, its tilt settling to 0
//   dither          the page dissolves in through a growing halftone dot mask (the .halftone pattern)
//   stagger         modifier, combines with any of the above (?tx=morph+stagger): once the page lands its
//                   title rises from a mask and its items cascade in (Magic UI blur-fade / text-animate, no blur)
// Everything but the stagger is a pure function of the page's progress (op, 0..1) that the camera computes from
// scroll or flight time, so it scrubs and reverses with the camera and costs nothing while the camera rests.
// The stagger is one-shot CSS keyed on .is-held, so it resets whenever the page is left.
import '../styles/transitions.css';

// z: the stretch of a scroll segment's zoom (0 = overview, 1 = landed) over which op goes 0 -> 1.
// fin / fout: the stretch of a click flight's time over which the destination page comes in / the old one goes.
var VARIANTS = {
  fade: { z: [0.7, 0.95], fin: [0.6, 1], fout: [0, 0.3] },
  morph: { z: [0.4, 0.97], fin: [0.4, 1], fout: [0, 0.45] },
  iris: { z: [0.55, 0.97], fin: [0.5, 1], fout: [0, 0.4] },
  paper: { z: [0.5, 0.97], fin: [0.45, 1], fout: [0, 0.4] },
  dither: { z: [0.55, 0.97], fin: [0.5, 1], fout: [0, 0.4] },
};

var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
var ss = function (t) { return t * t * (3 - 2 * t); };
var r2 = function (n) { return Math.round(n * 100) / 100; };

// Stagger items: below the title row, walk down single-child wrappers until a list or a row of 3+ blocks.
function staggerItems(zs) {
  var out = [];
  function walk(el, depth) {
    var kids = Array.prototype.filter.call(el.children, function (k) { return !/^(SCRIPT|STYLE|TEMPLATE)$/.test(k.tagName); });
    if (!kids.length || depth > 3) out.push(el);
    else if (/^(UL|OL)$/.test(el.tagName) || kids.length >= 3) kids.forEach(function (k) { out.push(k); });
    else kids.forEach(function (k) { walk(k, depth + 1); });
  }
  Array.prototype.forEach.call(zs.children, function (k) { if (!k.classList.contains('zs-head')) walk(k, 0); });
  return out;
}

export function initTx(o) {
  var m = /[?&]tx=([\w+, -]+)/.exec(location.search);
  var parts = m ? decodeURIComponent(m[1]).toLowerCase().split(/[+, ]+/) : [];
  var name = parts.filter(function (p) { return VARIANTS[p]; })[0] || 'fade';
  var stagger = parts.indexOf('stagger') >= 0;
  // Reduced motion: a plain quick fade, no movement.
  if (o.reduce) { name = 'fade'; stagger = false; }
  var V = VARIANTS[name];
  o.root.classList.add('tx-' + name);
  if (stagger) o.root.classList.add('tx-stagger');

  var last = {};
  function put(el, prop, val, id) {
    if (!el || last[id] === val) return;
    last[id] = val;
    el.style[prop] = val;
  }

  var extra = {};
  o.order.forEach(function (k) {
    var pg = o.pages[k];
    if (!pg) return;
    var zs = pg.querySelector('.zs');
    extra[k] = { zs: zs, ring: null };
    if (stagger && zs) staggerItems(zs).forEach(function (el, i) { el.classList.add('tx-it'); el.style.setProperty('--tx-i', String(Math.min(i, 12))); });
    if (name === 'iris') {
      var ring = document.createElement('div');
      ring.className = 'tx-ring';
      ring.setAttribute('aria-hidden', 'true');
      pg.insertBefore(ring, pg.firstChild);
      extra[k].ring = ring;
    }
  });

  // morph: a veil over the stage with a hole the shape of the target panel (on-screen quad, even-odd polygon).
  var veil = null;
  if (name === 'morph') {
    veil = document.createElement('div');
    veil.className = 'tx-veil';
    veil.setAttribute('aria-hidden', 'true');
    o.stage.appendChild(veil);
  }

  // One page, one camera frame. op: 0 = collage piece, 1 = page fully in. w x h: the page's layout size.
  function page(k, pg, cover, op, w, h) {
    var e = ss(op), mid = op > 0 && op < 1, x = extra[k];
    // The cover stays solid under the incoming page (no muddy double exposure) and drops once it is hidden.
    put(cover, 'opacity', op >= 1 ? '0' : '1', 'c' + k);
    if (name === 'fade') { put(pg, 'opacity', String(r2(e)), 'o' + k); return; }
    put(pg, 'opacity', op <= 0 ? '0' : '1', 'o' + k);
    if (name === 'morph') {
      // A rounded window opens from the middle of the panel to the full page.
      var a = 1 - e;
      put(pg, 'clipPath', mid ? 'inset(' + r2(a * 40) + '% ' + r2(a * 34) + '% round ' + r2(a * 56) + 'px)' : '', 'k' + k);
    } else if (name === 'iris') {
      var R = e * (Math.hypot(w, h) / 2 + 4);
      put(pg, 'clipPath', mid ? 'circle(' + r2(R) + 'px at 50% 50%)' : '', 'k' + k);
      put(x.ring, 'display', mid ? 'block' : 'none', 'rd' + k);
      if (mid) put(x.ring, 'background', 'radial-gradient(circle at 50% 50%, transparent ' + r2(R - 5) + 'px, #C2F970 ' + r2(R - 4) + 'px, #C2F970 ' + r2(R) + 'px, transparent ' + r2(R) + 'px)', 'rb' + k);
    } else if (name === 'dither') {
      // Two offset dot grids (10px cells, the second shifted half a cell): sparse dots, then the gaps, then solid.
      var ra = clamp(e / 0.65, 0, 1) * 5.4, rb = clamp((e - 0.35) / 0.65, 0, 1) * 5.4;
      var dot = function (r) { return 'radial-gradient(circle, #000 ' + r2(r) + 'px, transparent ' + r2(r + 0.9) + 'px)'; };
      var mk = mid ? dot(ra) + ', ' + dot(rb) : '';
      put(pg, 'maskImage', mk, 'm' + k);
      put(pg, 'webkitMaskImage', mk, 'wm' + k);
    } else if (name === 'paper' && x.zs) {
      // The sheet slides up from below the panel, tilted, and settles; .tx-moving lets it hang outside the panel.
      if (mid !== pg.classList.contains('tx-moving')) pg.classList.toggle('tx-moving', mid);
      var b = 1 - e;
      put(x.zs, 'transform', mid ? 'translate(' + r2(b * 4) + '%, ' + r2(b * 62) + '%) rotate(' + r2(b * -9) + 'deg)' : '', 'z' + k);
      put(x.zs, 'opacity', mid ? String(r2(clamp(op * 5, 0, 1))) : '', 'zo' + k);
    }
  }

  // After all pages: the morph veil. quad(k) = the page's four corners on screen.
  function frame(ops, quad, w, h) {
    if (!veil) return;
    var k = null, op = 0;
    o.order.forEach(function (key) { if ((ops[key] || 0) > op) { op = ops[key]; k = key; } });
    var on = op > 0 && op < 1;
    put(veil, 'display', on ? 'block' : 'none', 'vd');
    if (!on) return;
    put(veil, 'opacity', String(r2(0.86 * clamp(op * 2.5, 0, 1))), 'vo');
    var q = quad(k), P = function (pt) { return r2(pt.x) + 'px ' + r2(pt.y) + 'px'; };
    put(veil, 'clipPath', 'polygon(evenodd, 0 0, ' + w + 'px 0, ' + w + 'px ' + h + 'px, 0 ' + h + 'px, 0 0, ' + q.map(P).join(', ') + ', ' + P(q[0]) + ')', 'vc');
  }

  return { name: name, stagger: stagger, z: V.z, fin: V.fin, fout: V.fout, page: page, frame: frame };
}
