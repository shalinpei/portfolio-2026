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
    idleRadius: 2.5
  };

  var ACCENT = [194, 17, 94]; // crimson magenta — matches link color

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
    var t = cur; cur = nxt; nxt = t;
  }

  function render() {
    var data = img.data;
    var shade = CONFIG.shade, aMax = CONFIG.accentMix;
    var j = 0;
    for (var y = 0; y < ROWS; y++) {
      var row = y * COLS;
      for (var x = 0; x < COLS; x++) {
        var i = row + x;
        var h = cur[i];
        // Directional-light shading from the horizontal gradient: wavefronts
        // read as alternating light/dark rings instead of a flat blob.
        var xl = x > 0 ? cur[i - 1] : h;
        var xr = x < COLS - 1 ? cur[i + 1] : h;
        var s = 255 - (xr - xl) * shade;
        s = s < 0 ? 0 : s > 255 ? 255 : s;
        // Whisper of crimson where the water is most disturbed.
        var a = Math.abs(h) * 0.001;
        if (a > aMax) a = aMax;
      data[j]     = s + (ACCENT[0] - s) * a;
      data[j + 1] = s + (ACCENT[1] - s) * a;
      data[j + 2] = s + (ACCENT[2] - s) * a;
      data[j + 3] = 255;
      j += 4;
      }
    }
    octx.putImageData(img, 0, 0);
    view.drawImage(off, 0, 0, canvas.width, canvas.height);
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
  btn.textContent = 'ripple: on';
  btn.addEventListener('click', function () {
    toggleOn = !toggleOn;
    btn.textContent = toggleOn ? 'ripple: on' : 'ripple: off';
    canvas.style.display = toggleOn ? '' : 'none';
    if (toggleOn) { running = true; raf = requestAnimationFrame(frame); }
    else { running = false; if (raf) cancelAnimationFrame(raf); }
  });
  document.body.appendChild(btn);

  raf = requestAnimationFrame(frame);
})();
