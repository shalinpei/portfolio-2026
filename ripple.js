/* Pastel-gradient water-ripple background.
 *
 * The site's signature background: soft pink -> purple -> blue ripples that
 * bloom from the cursor or a tap and fade back to white. A classic
 * two-buffer heightfield simulation runs on a low-res grid; the grid is
 * drawn to a tiny offscreen canvas and scaled up, which gives the chunky
 * pixel look. A cursor movement earns a single drop at its start, taps
 * make a splash, and idle droplets fall on their own. The canvas sits
 * BEHIND the content, so text stays perfectly crisp.
 *
 * Delete this file + the loader snippet in index.html to revert completely.
 *
 * Variant: ?net=1 starts in the elastic-net variant instead — touch pushes
 * the mesh down, release lets tension snap it back with a bounce. The pastel
 * gradient is painted on the stretching mesh.
 *
 * Double-tap anywhere toggles between the water and net variants. It's a
 * hidden Easter egg: no visible UI, no toggle button. The toggle
 * crossfades: the outgoing variant finishes its motion and fades out over
 * the incoming one instead of hard-cutting.
 *
 * All aesthetic knobs are in CONFIG below.
 */
(function () {
  'use strict';

  var CONFIG = {
    px: 11,            // pixel chunk size — bigger = chunkier
    damping: 0.986,    // wave decay per frame (lower = calmer, faster fade)
    hoverRadius: 2,    // hover drop radius, in cells
    hoverStrength: 30, // hover drop strength
    hoverRearm: 500,   // ms of stillness before a new cursor movement counts as
                       // a fresh start and earns a single drop (2026-09-22)
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

  // Net-variant stops — deeper than the water pastels so the thin mesh
  // lines carry visible color (2026-09-22, water palette unchanged).
  var NET_PINK = [232, 148, 188];
  var NET_PURPLE = [182, 152, 216];
  var NET_BLUE = [148, 182, 232];

  // ---------- real-net membrane model (?net=1) ----------
  // The net is an elastic membrane pinned at its frame. A touch pushes it
  // down; on release, tension snaps it back with a bounce. Vertices also
  // slide in 2D along the depth gradient, so the mesh visibly stretches
  // like fabric instead of just changing brightness.
  var NET_SPACING = 24;   // net cell size, px
  var NET_TENSION = 0.33; // wave-speed squared (must stay <= 0.5 for stability)
  var NET_DAMP = 0.975;   // velocity retained per frame (higher = bouncier)
  var NET_SETTLE = 0.09;  // extra damping near stillness — kills tertiary
                          // tremble while leaving the main motion lively
  var PRESS_R = 110;      // finger radius, px
  var PRESS_DEPTH = 40;   // full-press dent depth, in depth units
  var PRESS_K = 0.4;      // how fast the mesh follows the finger (position
                          // lerp — a contraction, so a held press can't oscillate)
  var NET_STRETCH = 30;   // px the mesh slides per unit of depth gradient
  var BRUSH_KICK = 1.6;   // velocity kick from a hover brush

  var nu = null, nv = null; // depth + velocity fields (nCOLS x nROWS in net mode)
  var netSX = NET_SPACING, netSY = NET_SPACING; // actual vertex spacing, px
  var netPts = [];        // recent touch points {x, y, t} in px — colors the gradient
  var pressing = false, pressX = 0, pressY = 0;
  var autoPress = { x: 0, y: 0, until: 0 }; // idle poke

  function stepNet(now) {
    // Finger press: force nearby vertices toward the target dent.
    var hasPress = pressing || autoPress.until > now;
    if (hasPress) {
      var fx = pressing ? pressX : autoPress.x;
      var fy = pressing ? pressY : autoPress.y;
      var depth = pressing ? PRESS_DEPTH : PRESS_DEPTH * 0.45;
      var R = PRESS_R;
      var x0 = Math.max(1, Math.floor((fx - R) / netSX));
      var x1 = Math.min(nCOLS - 2, Math.ceil((fx + R) / netSX));
      var y0 = Math.max(1, Math.floor((fy - R) / netSY));
      var y1 = Math.min(nROWS - 2, Math.ceil((fy + R) / netSY));
      for (var jy = y0; jy <= y1; jy++) {
        for (var ix = x0; ix <= x1; ix++) {
          var ddx = ix * netSX - fx, ddy = jy * netSY - fy;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd > R) continue;
          var fall = 0.5 * (1 + Math.cos(Math.PI * dd / R)); // smooth dent
          var i = jy * nCOLS + ix;
          // Kinematic press: ease the mesh toward the dent and bleed off
          // velocity. A held press holds still; release starts from rest.
          nu[i] += (-depth * fall - nu[i]) * PRESS_K;
          nv[i] *= 0.5;
        }
      }
    }
    // Tension propagates, damping settles. Edges stay pinned (net on a frame).
    // Damping is stronger near stillness so tertiary ripples die fast.
    var ten = NET_TENSION, damp = NET_DAMP, settle = NET_SETTLE;
    for (var y = 1; y < nROWS - 1; y++) {
      var row = y * nCOLS;
      for (var x = 1; x < nCOLS - 1; x++) {
        var i = row + x;
        var lap = (nu[i - 1] + nu[i + 1] + nu[i - nCOLS] + nu[i + nCOLS]) * 0.25 - nu[i];
        var v = nv[i] + lap * ten;
        nv[i] = v * damp * (1 - settle / (1 + Math.abs(v) * 0.5));
      }
    }
    for (var yy = 1; yy < nROWS - 1; yy++) {
      var rr = yy * nCOLS;
      for (var xx = 1; xx < nCOLS - 1; xx++) nu[rr + xx] += nv[rr + xx];
    }
  }

  // Hover brush: a light touch that ripples the net without denting it.
  function brush(bx, by) {
    var R = 42;
    var x0 = Math.max(1, Math.floor((bx - R) / netSX));
    var x1 = Math.min(nCOLS - 2, Math.ceil((bx + R) / netSX));
    var y0 = Math.max(1, Math.floor((by - R) / netSY));
    var y1 = Math.min(nROWS - 2, Math.ceil((by + R) / netSY));
    for (var jy = y0; jy <= y1; jy++) {
      for (var ix = x0; ix <= x1; ix++) {
        var dx = ix * netSX - bx, dy = jy * netSY - by;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > R) continue;
        nv[jy * nCOLS + ix] -= BRUSH_KICK * (1 - d / R);
      }
    }
  }

  // Variant mode: 'water' (default) or 'net'. ?net=1 starts in net mode.
  // Double-tap toggles between them at runtime (Easter egg, no UI).
  var mode = new URLSearchParams(location.search).has('net') ? 'net' : 'water';

  var gridMask = null, maskCtx = null, maskDpr = 1;
  var dpx = null, dpy = null; // displaced vertex positions, px

  function sizeGridMask() {
    maskDpr = Math.min(2, window.devicePixelRatio || 1);
    gridMask = document.createElement('canvas');
    gridMask.width = Math.max(1, Math.round(window.innerWidth * maskDpr));
    gridMask.height = Math.max(1, Math.round(window.innerHeight * maskDpr));
    maskCtx = gridMask.getContext('2d');
    dpx = new Float32Array(nCOLS * nROWS);
    dpy = new Float32Array(nCOLS * nROWS);
  }

  // Redraw the net with vertices slid along the depth gradient — the mesh
  // stretches into dents like real fabric.
  function drawNetMask() {
    var g = maskCtx;
    g.setTransform(maskDpr, 0, 0, maskDpr, 0, 0);
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    var st = NET_STRETCH;
    for (var y = 0; y < nROWS; y++) {
      for (var x = 0; x < nCOLS; x++) {
        var i = y * nCOLS + x;
        var xm = x > 0 ? nu[i - 1] : nu[i];
        var xp = x < nCOLS - 1 ? nu[i + 1] : nu[i];
        var ym = y > 0 ? nu[i - nCOLS] : nu[i];
        var yp = y < nROWS - 1 ? nu[i + nCOLS] : nu[i];
        dpx[i] = x * netSX - st * (xp - xm) / (2 * netSX);
        dpy[i] = y * netSY - st * (yp - ym) / (2 * netSY);
      }
    }
    // Build the mesh path once, then stroke it three times: wide faint
    // strokes fake the glow (shadowBlur is too slow per-frame in software).
    g.beginPath();
    for (var ry = 0; ry < nROWS; ry++) {
      var r0 = ry * nCOLS;
      g.moveTo(dpx[r0], dpy[r0]);
      for (var rx = 1; rx < nCOLS; rx++) g.lineTo(dpx[r0 + rx], dpy[r0 + rx]);
    }
    for (var cx = 0; cx < nCOLS; cx++) {
      g.moveTo(dpx[cx], dpy[cx]);
      for (var cy = 1; cy < nROWS; cy++) g.lineTo(dpx[cy * nCOLS + cx], dpy[cy * nCOLS + cx]);
    }
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 1;
    g.stroke();
    // knots where the lines cross
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath();
    for (var k = 0; k < nCOLS * nROWS; k++) {
      g.moveTo(dpx[k] + 1.5, dpy[k]);
      g.arc(dpx[k], dpy[k], 1.5, 0, 6.2832);
    }
    g.fill();
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
    'html{touch-action:manipulation;}' + // no double-tap zoom; it toggles variants
    'body.ripple-on main{position:relative;z-index:1;}';
  document.head.appendChild(style);

  var view = canvas.getContext('2d');
  view.imageSmoothingEnabled = (mode !== 'net'); // the net variant upscales softly under crisp lines

  var off = document.createElement('canvas');
  var octx = off.getContext('2d');

  var wCOLS = 0, wROWS = 0, nCOLS = 0, nROWS = 0, cur, nxt, img;

  // Crossfade state: while `trans` is set, the outgoing variant keeps
  // animating (no new input) on transCanvas while the incoming variant
  // renders fresh underneath. The old animation completes and fades out
  // instead of hard-cutting.
  var TRANS_MS = 900;
  var trans = null; // {from: 'water'|'net', t0}
  var transCanvas = document.createElement('canvas');
  var transCtx = transCanvas.getContext('2d');

  // The two variants use different sim-grid sizes; the shared wash canvas
  // is resized to fit whichever variant is being rendered.
  function ensureOff(cols, rows) {
    if (off.width !== cols || off.height !== rows) {
      off.width = cols; off.height = rows;
      img = octx.createImageData(cols, rows);
    }
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    transCanvas.width = window.innerWidth;
    transCanvas.height = window.innerHeight;
    // Water grid.
    wCOLS = Math.max(8, Math.ceil(window.innerWidth / CONFIG.px));
    wROWS = Math.max(8, Math.ceil(window.innerHeight / CONFIG.px));
    cur = new Float32Array(wCOLS * wROWS);
    nxt = new Float32Array(wCOLS * wROWS);
    // Net grid. The membrane vertices ARE the wash pixels: one net cell each.
    nCOLS = Math.max(8, Math.round(window.innerWidth / NET_SPACING) + 1);
    nROWS = Math.max(8, Math.round(window.innerHeight / NET_SPACING) + 1);
    netSX = window.innerWidth / (nCOLS - 1);
    netSY = window.innerHeight / (nROWS - 1);
    nu = new Float32Array(nCOLS * nROWS);
    nv = new Float32Array(nCOLS * nROWS);
    sizeGridMask();
  }
  resize();
  window.addEventListener('resize', resize);

  // ---------- interaction ----------
  var drops = []; // recent inputs: {cx, cy, t} — the gradient is measured from these
  function drop(px, py, radius, strength) {
    var cx = (px / CONFIG.px) | 0;
    var cy = (py / CONFIG.px) | 0;
    var r = Math.ceil(radius);
    for (var y = -r; y <= r; y++) {
      for (var x = -r; x <= r; x++) {
        var d = Math.sqrt(x * x + y * y);
        if (d > radius) continue;
        var gx = cx + x, gy = cy + y;
        if (gx <= 0 || gx >= wCOLS - 1 || gy <= 0 || gy >= wROWS - 1) continue;
        cur[gy * wCOLS + gx] += strength * (1 - d / radius);
      }
    }
    drops.push({ cx: cx, cy: cy, t: performance.now() });
    if (drops.length > 12) drops.shift();
    lastActive = performance.now();
  }

  var lastX = -1e9, lastY = -1e9, lastActive = 0, lastIdle = 0, lastMoveT = 0;
  function notePt(x, y) { // net variant: remember a touch point for the gradient
    netPts.push({ x: x, y: y, t: performance.now() });
    if (netPts.length > 12) netPts.shift();
    lastActive = performance.now();
  }
  // Double-tap toggles between the water and net variants — a hidden
  // Easter egg, no visible UI. The second tap of the pair is swallowed so
  // it doesn't also splash (water) or press (net).
  var lastDownT = 0, lastDownX = 0, lastDownY = 0, swallowUp = false;

  function setMode(m) {
    if (m === mode || trans) return;
    // Begin the crossfade: the outgoing variant keeps animating with no
    // new input while the incoming one starts flat underneath.
    trans = { from: mode, t0: performance.now() };
    mode = m;
    pressing = false;
    autoPress.until = 0;
    if (m === 'net') { nv.fill(0); nu.fill(0); netPts = []; }
    else { cur.fill(0); nxt.fill(0); drops = []; }
    lastX = -1e9; lastY = -1e9;
    lastDownT = 0;
    lastActive = performance.now();
    view.imageSmoothingEnabled = (mode !== 'net');
  }

  window.addEventListener('pointermove', function (e) {
    var now = performance.now();
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (mode === 'net') {
      if (pressing) { pressX = e.clientX; pressY = e.clientY; }
      if (dx * dx + dy * dy > 30 * 30) {
        if (!pressing) brush(e.clientX, e.clientY);
        notePt(e.clientX, e.clientY);
        lastX = e.clientX; lastY = e.clientY;
      }
    } else if (now - lastMoveT > CONFIG.hoverRearm) {
      // Single drop at the START of a cursor movement — no trailing wake
      // while the pointer keeps moving.
      drop(e.clientX, e.clientY, CONFIG.hoverRadius, CONFIG.hoverStrength);
      lastX = e.clientX; lastY = e.clientY;
    }
    lastMoveT = now;
  }, { passive: true });
  function pressOrDrop(e) {
    if (mode === 'net') {
      pressing = true; pressX = e.clientX; pressY = e.clientY;
      notePt(e.clientX, e.clientY);
    } else {
      drop(e.clientX, e.clientY, CONFIG.tapRadius, CONFIG.tapStrength);
    }
  }
  window.addEventListener('pointerdown', function (e) {
    if (trans) {
      // Mid-crossfade: normal input goes to the incoming variant, and no
      // toggle can pair across the transition boundary.
      lastDownT = 0;
      pressOrDrop(e);
      return;
    }
    var now = performance.now();
    var tdx = e.clientX - lastDownX, tdy = e.clientY - lastDownY;
    if (now - lastDownT < 320 && tdx * tdx + tdy * tdy < 48 * 48) {
      lastDownT = 0;
      swallowUp = true;
      setMode(mode === 'net' ? 'water' : 'net');
      return;
    }
    lastDownT = now; lastDownX = e.clientX; lastDownY = e.clientY;
    pressOrDrop(e);
  }, { passive: true });
  function endPress() {
    if (swallowUp) { swallowUp = false; return; }
    pressing = false;
  }
  window.addEventListener('pointerup', endPress);
  window.addEventListener('pointercancel', endPress);
  window.addEventListener('blur', endPress);

  // ---------- simulation ----------
  function step() {
    var damping = CONFIG.damping;
    for (var y = 1; y < wROWS - 1; y++) {
      var row = y * wCOLS;
      for (var x = 1; x < wCOLS - 1; x++) {
        var i = row + x;
        nxt[i] = ((cur[i - 1] + cur[i + 1] + cur[i - wCOLS] + cur[i + wCOLS]) * 0.5 - nxt[i]) * damping;
      }
    }
    // Absorbing border: waves fade out at the edges instead of reflecting.
    var ew = CONFIG.edgeWidth, ed = CONFIG.edgeDamp;
    for (var ey = 0; ey < wROWS; ey++) {
      var dy = Math.min(ey, wROWS - 1 - ey);
      for (var ex = 0; ex < wCOLS; ex++) {
        var dx = Math.min(ex, wCOLS - 1 - ex);
        var m = dx < dy ? dx : dy;
        if (m < ew) nxt[ey * wCOLS + ex] *= ed + (1 - ed) * (m / ew);
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
  // Renders into `target`, a full-size 2d context.
  function renderWater(target) {
    ensureOff(wCOLS, wROWS);
    var data = img.data;
    var now = performance.now();
    // prune expired drops
    while (drops.length && now - drops[0].t > 5000) drops.shift();
    var j = 0;
    for (var y = 0; y < wROWS; y++) {
      var row = y * wCOLS;
      for (var x = 0; x < wCOLS; x++) {
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
    octx.putImageData(img, 0, 0);
    target.drawImage(off, 0, 0, target.canvas.width, target.canvas.height);
  }

  // Net variant render: soft gradient color whose alpha follows membrane
  // energy (|depth| + |velocity|), painted through the stretched mesh.
  // Renders into `target`, a full-size 2d context.
  function renderNet(target) {
    ensureOff(nCOLS, nROWS);
    var data = img.data;
    var now = performance.now();
    while (netPts.length && now - netPts[0].t > 5000) netPts.shift();
    var j = 0;
    for (var y = 0; y < nROWS; y++) {
      var py = y * netSY;
      for (var x = 0; x < nCOLS; x++) {
        var i = y * nCOLS + x;
        var energy = (Math.abs(nu[i]) * 0.04 + Math.abs(nv[i]) * 0.10) * 1.5;
        var r = 255, g = 255, b = 255, a = 0;
        if (energy > 0.02) {
          var px = x * netSX;
          var dMin = 1e9;
          for (var n = 0; n < netPts.length; n++) {
            var dx = px - netPts[n].x, dy = py - netPts[n].y;
            var dd = Math.sqrt(dx * dx + dy * dy);
            if (dd < dMin) dMin = dd;
          }
          var t = dMin / 220;
          if (t > 1) t = 1;
          var ramp = t < 0.5
            ? lerpC(NET_PINK, NET_PURPLE, t * 2)
            : lerpC(NET_PURPLE, NET_BLUE, (t - 0.5) * 2);
          var k = energy > 1 ? 1 : energy;
          var fade = 1 - (dMin - 160) / 240;
          if (fade < 0) fade = 0; else if (fade > 1) fade = 1;
          k *= fade;
          r = ramp[0]; g = ramp[1]; b = ramp[2]; a = k;
        }
        data[j] = r; data[j + 1] = g; data[j + 2] = b; data[j + 3] = a * 255;
        j += 4;
      }
    }
    octx.putImageData(img, 0, 0);
    drawNetMask();
    // Paint the soft gradient through the crisp stretched net.
    var W = target.canvas.width, H = target.canvas.height;
    target.clearRect(0, 0, W, H);
    target.drawImage(off, 0, 0, W, H);
    target.globalCompositeOperation = 'destination-in';
    target.drawImage(gridMask, 0, 0, W, H);
    target.globalCompositeOperation = 'source-over';
  }

  // ---------- main loop ----------
  var raf = null, running = true;
  function stepRender(m, target, now) {
    if (m === 'net') { stepNet(now); renderNet(target); }
    else { step(); renderWater(target); }
  }
  function frame(now) {
    if (!running) return;
    if (trans) {
      // Crossfade: the outgoing variant finishes its motion with no new
      // input while the incoming variant animates fresh underneath.
      stepRender(trans.from, transCtx, now);
      stepRender(mode, view, now);
      var k = 1 - (now - trans.t0) / TRANS_MS;
      if (k <= 0) {
        trans = null;
        transCtx.clearRect(0, 0, transCanvas.width, transCanvas.height);
      } else {
        view.save();
        view.globalAlpha = k;
        view.drawImage(transCanvas, 0, 0, canvas.width, canvas.height);
        view.restore();
      }
    } else if (mode === 'net') {
      stepRender('net', view, now);
      // Idle poke: a gentle press that dents and releases on its own.
      if (CONFIG.idleEvery > 0 && now - lastIdle > CONFIG.idleEvery &&
          now - lastActive > CONFIG.idleEvery) {
        lastIdle = now;
        autoPress.x = Math.random() * canvas.width;
        autoPress.y = Math.random() * canvas.height;
        autoPress.until = now + 350;
        notePt(autoPress.x, autoPress.y);
      }
    } else {
      stepRender('water', view, now);
      if (CONFIG.idleEvery > 0 && now - lastIdle > CONFIG.idleEvery &&
          now - lastActive > CONFIG.idleEvery) {
        lastIdle = now;
        drop(Math.random() * canvas.width, Math.random() * canvas.height,
             CONFIG.idleRadius, CONFIG.idleStrength);
      }
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
