/* Pixelated water-ripple background — PROTOTYPE.
 *
 * Enabled by adding ?ripple to the URL (e.g. /?ripple=1). Nothing changes
 * on the default page. Delete this file + the loader snippet in index.html
 * to revert completely.
 *
 * How it works: a classic two-buffer heightfield simulation runs on a
 * low-res grid; the grid is drawn to a tiny offscreen canvas and scaled up
 * with smoothing off, which gives the chunky pixel look. Pointer moves
 * leave a wake, taps make a splash, and idle droplets fall on their own.
 * The canvas sits BEHIND the content, so text stays perfectly crisp.
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
    shade: 1.4,         // ripple visibility (higher = stronger light/shadow)
    accentMix: 0.22,   // how much crimson tints disturbed water (0..1)
    idleEvery: 3400,   // ms between idle droplets (0 = off)
    idleStrength: 90,  // idle droplet strength
    idleRadius: 2.5,
    edgeWidth: 6,      // cells of absorbing border so waves don't bounce off walls
    edgeDamp: 0.75     // height multiplier at the very edge (1.0 = no absorption)
  };

  var ACCENT = [194, 17, 94]; // crimson magenta — matches link color

  // Render mode from the URL: ?ripple=1 (or bare ?ripple) = monochromatic
  // crimson tint; ?ripple=2 = pastel pink->purple->blue gradient by distance
  // from the input; ?ripple=0 = original gray shading.
  var MODE = (function () {
    var m = new URLSearchParams(location.search).get('ripple');
    return m === '2' ? 2 : m === '0' ? 0 : 1;
  })();

  // Palettes
  var TINT = [243, 207, 223];      // light crimson (~20% accent over white)
  var TINT_DEEP = [238, 185, 208]; // deeper crimson tint for strong disturbance
  var PASTEL_PINK = [242, 164, 200];
  var PASTEL_PURPLE = [196, 164, 224];
  var PASTEL_BLUE = [164, 200, 240];

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
    'body.ripple-on main{position:relative;z-index:1;}' +
    '#ripple-toggle{position:fixed;right:12px;bottom:12px;z-index:2;' +
    'font-family:"Space Mono",ui-monospace,monospace;font-size:11px;' +
    'background:#fff;border:1px solid #e2e2e2;border-radius:6px;' +
    'padding:4px 10px;cursor:pointer;color:#1a1a1a;opacity:.75;}' +
    '#ripple-toggle:hover{opacity:1;}';
  document.head.appendChild(style);

  var view = canvas.getContext('2d');
  view.imageSmoothingEnabled = false;

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
    img = octx.createImageData(COLS, ROWS);
  }
  resize();
  window.addEventListener('resize', resize);

  // ---------- interaction ----------
  var drops = []; // recent inputs for the gradient mode: {cx, cy, t}
  function drop(px, py, radius, strength) {
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
    drops.push({ cx: cx, cy: cy, t: performance.now() });
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

  function render() {
    var data = img.data;
    var shade = CONFIG.shade, aMax = CONFIG.accentMix;
    var j = 0;
    if (MODE === 2) { renderGradient(data); }
    else {
      for (var y = 0; y < ROWS; y++) {
        var row = y * COLS;
        for (var x = 0; x < COLS; x++) {
          var i = row + x;
          var h = cur[i];
          var ah = Math.abs(h);
          var r, g, b;
          if (MODE === 1) {
            // Monochromatic: alternating white / light-crimson rings from the
            // signed wave gradient (directional, like raking light) — no dark
            // shadows anywhere, plus a soft tint where strongly disturbed.
            var xl = x > 0 ? cur[i - 1] : h;
            var xr = x < COLS - 1 ? cur[i + 1] : h;
            var grad = xr - xl;
            var k = (grad > 0 ? grad * 0.025 : 0) + ah * 0.0008;
            if (k > 0.5) k = 0.5;
            // Strong disturbance gets the deeper tint tier.
            var c = ah > 150 ? TINT_DEEP : TINT;
            r = 255 + (c[0] - 255) * k;
            g = 255 + (c[1] - 255) * k;
            b = 255 + (c[2] - 255) * k;
          } else {
            // Original gray shading (kept for reference).
            var xl0 = x > 0 ? cur[i - 1] : h;
            var xr0 = x < COLS - 1 ? cur[i + 1] : h;
            var s = 255 - (xr0 - xl0) * shade;
            s = s < 0 ? 0 : s > 255 ? 255 : s;
            var a = ah * 0.001;
            if (a > aMax) a = aMax;
            r = s + (ACCENT[0] - s) * a;
            g = s + (ACCENT[1] - s) * a;
            b = s + (ACCENT[2] - s) * a;
          }
          data[j] = r; data[j + 1] = g; data[j + 2] = b; data[j + 3] = 255;
          j += 4;
        }
      }
    }
    octx.putImageData(img, 0, 0);
    view.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  // Pastel gradient: pink near the input -> purple -> blue further out.
  // Only disturbed cells pay the distance cost; the rest stay white.
  function renderGradient(data) {
    var now = performance.now();
    // prune expired drops
    while (drops.length && now - drops[0].t > 5000) drops.shift();
    var j = 0;
    for (var y = 0; y < ROWS; y++) {
      var row = y * COLS;
      for (var x = 0; x < COLS; x++) {
        var i = row + x;
        var ah = Math.abs(cur[i]);
        var r = 255, g = 255, b = 255;
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
          var k = ah * 0.02;
          if (k > 0.8) k = 0.8;
          // Fade the color out beyond the gradient's range so far-travelled
          // waves settle back to white instead of tinting the whole pond.
          var fade = 1 - (dMin - 30) / 60;
          if (fade < 0) fade = 0; else if (fade > 1) fade = 1;
          k *= fade;
          r = 255 + (ramp[0] - 255) * k;
          g = 255 + (ramp[1] - 255) * k;
          b = 255 + (ramp[2] - 255) * k;
        }
        data[j] = r; data[j + 1] = g; data[j + 2] = b; data[j + 3] = 255;
        j += 4;
      }
    }
  }

  // ---------- main loop ----------
  var raf = null, running = true;
  function frame(now) {
    if (!running) return;
    step();
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
    } else if (toggleOn) {
      running = true;
      raf = requestAnimationFrame(frame);
    }
  });

  // ---------- tiny toggle ----------
  var toggleOn = true;
  var btn = document.createElement('button');
  btn.id = 'ripple-toggle';
  var modeName = MODE === 2 ? 'gradient' : MODE === 0 ? 'gray' : 'mono';
  btn.textContent = 'ripple: ' + modeName;
  btn.addEventListener('click', function () {
    toggleOn = !toggleOn;
    btn.textContent = toggleOn ? 'ripple: ' + modeName : 'ripple: off';
    canvas.style.display = toggleOn ? '' : 'none';
    if (toggleOn) { running = true; raf = requestAnimationFrame(frame); }
    else { running = false; if (raf) cancelAnimationFrame(raf); }
  });
  document.body.appendChild(btn);

  raf = requestAnimationFrame(frame);
})();
