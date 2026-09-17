/* Pastel-gradient water-ripple background.
 *
 * The site's signature background: soft pink -> purple -> blue ripples that
 * bloom from the cursor or a tap and fade back to white. A classic
 * two-buffer heightfield simulation runs on a low-res grid; the grid is
 * drawn to a tiny offscreen canvas and scaled up with smoothing off, which
 * gives the chunky pixel look. Pointer moves leave a wake, taps make a
 * splash, and idle droplets fall on their own. The canvas sits BEHIND the
 * content, so text stays perfectly crisp.
 *
 * Delete this file + the loader snippet in index.html to revert completely.
 *
 * Variant: ?net=1 paints the same gradient on the invisible net instead of
 * flat color — identical water physics, new texture.
 *
 * All aesthetic knobs are in CONFIG below.
 */
(function () {
  'use strict';

  var CONFIG = {
    px: 11,            // pixel chunk size — bigger = chunkier
    damping: 0.986,    // wave decay per frame (lower = calmer, faster fade)
    hoverRadius: 2,    // hover wake radius, in cells
    hoverStrength: 45, // hover wake strength
    tapRadius: 5,      // tap splash radius, in cells
    tapStrength: 260,  // tap splash strength
    idleEvery: 3400,   // ms between idle droplets (0 = off)
    idleStrength: 90,  // idle droplet strength
    idleRadius: 2.5,
    edgeWidth: 6,      // cells of absorbing border so waves don't bounce off walls
    edgeDamp: 0.75     // height multiplier at the very edge (1.0 = no absorption)
  };

  // Pastel stops, lightened 2026-09-17
  var PASTEL_PINK = [248, 201, 222];
  var PASTEL_PURPLE = [220, 200, 238];
  var PASTEL_BLUE = [200, 222, 246];

  // ---------- singular ripple model (net variant) ----------
  // The heightfield makes wave trains; here each touch emits ONE clean ring:
  // a gaussian crest with a slight trailing trough, amplitude spreading as
  // 1/sqrt(r) like real ripples, plus a gentle angular wobble so it feels
  // like water instead of UI.
  var RIPPLE_SPEED = 420; // px/s
  var RIPPLE_WIDTH = 26;  // ring thickness, px (gaussian sigma)
  var RIPPLE_TAU = 1.5;   // amplitude decay time, s
  var RIPPLE_LIFE = 2.8;  // prune ripples older than this, s
  var RIPPLE_H0 = 30;     // crest height in wave units at birth

  var ripples = []; // {x, y, t0, s} — px, seconds, strength (tap = 1)
  var hgt = null;   // analytic heights for the net variant

  function computeHeights(nowMs) {
    var now = nowMs / 1000;
    while (ripples.length && now - ripples[0].t0 > RIPPLE_LIFE) ripples.shift();
    hgt.fill(0);
    if (!ripples.length) return;
    var cell = CONFIG.px, W = RIPPLE_WIDTH;
    for (var n = 0; n < ripples.length; n++) {
      var rp = ripples[n];
      var age = now - rp.t0;
      if (age <= 0) continue;
      var R = RIPPLE_SPEED * age;
      var decay = Math.exp(-age / RIPPLE_TAU);
      var spread = 1 / Math.sqrt(Math.max(R, 40) / 40);
      var base = RIPPLE_H0 * rp.s * decay * spread;
      var reach = R + W * 4;
      var x0 = Math.max(0, Math.floor((rp.x - reach) / cell));
      var x1 = Math.min(COLS - 1, Math.ceil((rp.x + reach) / cell));
      var y0 = Math.max(0, Math.floor((rp.y - reach) / cell));
      var y1 = Math.min(ROWS - 1, Math.ceil((rp.y + reach) / cell));
      for (var cy = y0; cy <= y1; cy++) {
        for (var cx = x0; cx <= x1; cx++) {
          var dx = cx * cell - rp.x, dy = cy * cell - rp.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          var th = Math.atan2(dy, dx);
          var wob = 1 + 0.10 * Math.sin(3 * th + 2.0 * age)
                      + 0.06 * Math.sin(5 * th - 1.3 * age);
          var Rw = R * (1 + 0.04 * Math.sin(2 * th + 1.1 * age));
          var dd = (d - Rw) / W;
          var h = base * wob * Math.exp(-dd * dd);
          // slight trailing trough just inside the crest
          var dt = (d - (Rw - W * 1.5)) / W;
          h -= base * 0.35 * Math.exp(-dt * dt);
          // impact flash right at the touch while the ring is young
          if (age < 0.3) {
            var fr = d / (W * 2);
            h += base * 1.4 * (1 - age / 0.3) * Math.exp(-fr * fr);
          }
          hgt[cy * COLS + cx] += h;
        }
      }
    }
  }

  // Variant flag: ?net=1 paints the gradient on the invisible net.
  var NET = new URLSearchParams(location.search).has('net');

  var gridMask = null;
  var GRID_SPACING = 24; // net cell size, px
  function buildGridMask() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    gridMask = document.createElement('canvas');
    gridMask.width = Math.max(1, Math.round(window.innerWidth * dpr));
    gridMask.height = Math.max(1, Math.round(window.innerHeight * dpr));
    var g = gridMask.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 1;
    g.shadowColor = 'rgba(255,255,255,0.95)';
    g.shadowBlur = 6;
    g.beginPath();
    for (var x = GRID_SPACING / 2; x < window.innerWidth; x += GRID_SPACING) {
      g.moveTo(x, 0); g.lineTo(x, window.innerHeight);
    }
    for (var y = GRID_SPACING / 2; y < window.innerHeight; y += GRID_SPACING) {
      g.moveTo(0, y); g.lineTo(window.innerWidth, y);
    }
    g.stroke();
    // slightly brighter knots where the lines cross
    g.fillStyle = 'rgba(255,255,255,1)';
    g.shadowBlur = 2;
    for (var dx = GRID_SPACING / 2; dx < window.innerWidth; dx += GRID_SPACING) {
      for (var dy = GRID_SPACING / 2; dy < window.innerHeight; dy += GRID_SPACING) {
        g.beginPath(); g.arc(dx, dy, 1.5, 0, 6.2832); g.fill();
      }
    }
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // ---------- setup ----------
  var canvas = document.createElement('canvas');
  canvas.id = 'ripple';
  document.body.appendChild(canvas);
  document.body.classList.add('ripple-on');

  var style = document.createElement('style');
  style.textContent =
    '#ripple{position:fixed;inset:0;width:100%;height:100%;z-index:0;' +
    'pointer-events:none;image-rendering:pixelated;image-rendering:crisp-edges;}' +
    'body.ripple-on main{position:relative;z-index:1;}';
  document.head.appendChild(style);

  var view = canvas.getContext('2d');
  view.imageSmoothingEnabled = !NET; // the net variant upscales softly under crisp lines

  var off = document.createElement('canvas');
  var octx = off.getContext('2d');

  var COLS = 0, ROWS = 0, cur, nxt, img;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    COLS = Math.max(8, Math.ceil(window.innerWidth / CONFIG.px));
    ROWS = Math.max(8, Math.ceil(window.innerHeight / CONFIG.px));
    off.width = COLS;
    off.height = ROWS;
    cur = new Float32Array(COLS * ROWS);
    nxt = new Float32Array(COLS * ROWS);
    hgt = new Float32Array(COLS * ROWS);
    img = octx.createImageData(COLS, ROWS);
    if (NET) buildGridMask();
  }
  resize();
  window.addEventListener('resize', resize);

  // ---------- interaction ----------
  var drops = []; // recent inputs: {cx, cy, t} — the gradient is measured from these
  function drop(px, py, radius, strength) {
    if (NET) {
      // singular ring for the net variant (strength normalized to tap = 1)
      ripples.push({ x: px, y: py, t0: performance.now() / 1000, s: strength / 260 });
      if (ripples.length > 16) ripples.shift();
    } else {
      var cx = (px / CONFIG.px) | 0;
      var cy = (py / CONFIG.px) | 0;
      var r = Math.ceil(radius);
      for (var y = -r; y <= r; y++) {
        for (var x = -r; x <= r; x++) {
          var d = Math.sqrt(x * x + y * y);
          if (d > radius) continue;
          var gx = cx + x, gy = cy + y;
          if (gx <= 0 || gx >= COLS - 1 || gy <= 0 || gy >= ROWS - 1) continue;
          cur[gy * COLS + gx] += strength * (1 - d / radius);
        }
      }
    }
    drops.push({ cx: (px / CONFIG.px) | 0, cy: (py / CONFIG.px) | 0, t: performance.now() });
    if (drops.length > 12) drops.shift();
    lastActive = performance.now();
  }

  var lastX = -1e9, lastY = -1e9, lastActive = 0, lastIdle = 0;
  window.addEventListener('pointermove', function (e) {
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (dx * dx + dy * dy > 30 * 30) {
      drop(e.clientX, e.clientY, CONFIG.hoverRadius, CONFIG.hoverStrength);
      lastX = e.clientX; lastY = e.clientY;
    }
  }, { passive: true });
  window.addEventListener('pointerdown', function (e) {
    drop(e.clientX, e.clientY, CONFIG.tapRadius, CONFIG.tapStrength);
  }, { passive: true });

  // ---------- simulation ----------
  function step() {
    var damping = CONFIG.damping;
    for (var y = 1; y < ROWS - 1; y++) {
      var row = y * COLS;
      for (var x = 1; x < COLS - 1; x++) {
        var i = row + x;
        nxt[i] = ((cur[i - 1] + cur[i + 1] + cur[i - COLS] + cur[i + COLS]) * 0.5 - nxt[i]) * damping;
      }
    }
    // Absorbing border: waves fade out at the edges instead of reflecting.
    var ew = CONFIG.edgeWidth, ed = CONFIG.edgeDamp;
    for (var ey = 0; ey < ROWS; ey++) {
      var dy = Math.min(ey, ROWS - 1 - ey);
      for (var ex = 0; ex < COLS; ex++) {
        var dx = Math.min(ex, COLS - 1 - ex);
        var m = dx < dy ? dx : dy;
        if (m < ew) nxt[ey * COLS + ex] *= ed + (1 - ed) * (m / ew);
      }
    }
    var t = cur; cur = nxt; nxt = t;
  }

  function lerpC(c1, c2, t) {
    return [c1[0] + (c2[0] - c1[0]) * t,
            c1[1] + (c2[1] - c1[1]) * t,
            c1[2] + (c2[2] - c1[2]) * t];
  }

  // Pastel gradient: pink near the input -> purple -> blue further out.
  // Only disturbed cells pay the distance cost; the rest stay white.
  function render() {
    var data = img.data;
    var now = performance.now();
    // prune expired drops
    while (drops.length && now - drops[0].t > 5000) drops.shift();
    var src = NET ? hgt : cur; // analytic rings vs. heightfield
    var j = 0;
    for (var y = 0; y < ROWS; y++) {
      var row = y * COLS;
      for (var x = 0; x < COLS; x++) {
        var i = row + x;
        var ah = Math.abs(src[i]);
        var r = 255, g = 255, b = 255, a = 1;
        if (NET) a = 0; // invisible until the water moves
        if (ah >= 1.5) {
          var dMin = 1e9;
          for (var d = 0; d < drops.length; d++) {
            var dr = drops[d];
            var dx = x - dr.cx, dy = y - dr.cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < dMin) dMin = dist;
          }
          var t = dMin / 45;
          if (t > 1) t = 1;
          var ramp = t < 0.5
            ? lerpC(PASTEL_PINK, PASTEL_PURPLE, t * 2)
            : lerpC(PASTEL_PURPLE, PASTEL_BLUE, (t - 0.5) * 2);
          var k = ah * (NET ? 0.06 : 0.02);
          if (k > (NET ? 1 : 0.8)) k = (NET ? 1 : 0.8);
          // Fade the color out beyond the gradient's range so far-travelled
          // waves settle back to white instead of tinting the whole pond.
          var fade = 1 - (dMin - 30) / 60;
          if (fade < 0) fade = 0; else if (fade > 1) fade = 1;
          k *= fade;
          if (NET) {
            // Full-strength gradient color; the wave height drives opacity,
            // so the net shimmers with the ripples.
            r = ramp[0]; g = ramp[1]; b = ramp[2]; a = k;
          } else {
            r = 255 + (ramp[0] - 255) * k;
            g = 255 + (ramp[1] - 255) * k;
            b = 255 + (ramp[2] - 255) * k;
          }
        }
        data[j] = r; data[j + 1] = g; data[j + 2] = b; data[j + 3] = a * 255;
        j += 4;
      }
    }
    octx.putImageData(img, 0, 0);
    if (NET) {
      // Paint the soft gradient through the crisp net mask.
      view.clearRect(0, 0, canvas.width, canvas.height);
      view.drawImage(off, 0, 0, canvas.width, canvas.height);
      view.globalCompositeOperation = 'destination-in';
      view.drawImage(gridMask, 0, 0, canvas.width, canvas.height);
      view.globalCompositeOperation = 'source-over';
    } else {
      view.drawImage(off, 0, 0, canvas.width, canvas.height);
    }
  }

  // ---------- main loop ----------
  var raf = null, running = true;
  function frame(now) {
    if (!running) return;
    if (NET) computeHeights(now);
    else step();
    render();
    if (CONFIG.idleEvery > 0 && now - lastIdle > CONFIG.idleEvery &&
        now - lastActive > CONFIG.idleEvery) {
      lastIdle = now;
      drop(Math.random() * canvas.width, Math.random() * canvas.height,
           CONFIG.idleRadius, CONFIG.idleStrength);
    }
    raf = requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      running = false;
      if (raf) cancelAnimationFrame(raf);
    } else {
      running = true;
      raf = requestAnimationFrame(frame);
    }
  });

  raf = requestAnimationFrame(frame);
})();
