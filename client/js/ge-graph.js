/* ============================================================
   ge-graph.js — GRAPH MODULE
   ------------------------------------------------------------
   Owns the big <canvas>: draws grid, curve, handles, playhead,
   and handles all mouse/touch interaction on it.
   ============================================================ */
window.GEGraph = (function () {
  "use strict";

  let canvas, ctx, state;
  let drag = null, scrub = false, wasPlaying = true;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const RANGE = { min: -0.5, max: 1.5 };   // value axis we show
  const PAD = { l: 48, r: 18, t: 16, b: 30 }; // margins for labels

  /* ---------- coordinate helpers ----------
     The math world is (time 0..1, value -0.5..1.5).
     The screen world is pixels. These two convert between them. */
  const X = tn => PAD.l + tn * (canvas.clientWidth - PAD.l - PAD.r);
  const Y = v  => PAD.t + (RANGE.max - v) / (RANGE.max - RANGE.min) * (canvas.clientHeight - PAD.t - PAD.b);

  function init(passedState, canvasEl) {
    state = passedState;
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    fit();
    // Re-measure whenever the container changes size (responsive!).
    new ResizeObserver(fit).observe(document.getElementById('geGraphWrap'));
    bindPointer();
    document.getElementById('geShowVel').addEventListener('change', e => state.showVel = e.target.checked);
  }

  /* Canvas pixels ≠ CSS pixels on retina screens. We scale the
     canvas buffer by devicePixelRatio so lines look crisp. */
  function fit() {
    const r = canvas.parentElement.getBoundingClientRect();
    if (r.width < 20) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- drawing primitives ---------- */
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const dot  = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  const diamond = (x, y, r) => { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); };

  /* Called once per frame by the transport. tn = normalized time,
     val = the curve value at that time. */
  function render(tn, val) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (W < 60) return;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '9.5px "JetBrains Mono",monospace';

    /* --- 1. grid --- */
    for (let i = 0; i <= 10; i++) {
      ctx.strokeStyle = i % 5 ? 'rgba(148,170,197,.06)' : 'rgba(148,170,197,.15)';
      line(X(i / 10), PAD.t, X(i / 10), H - PAD.b);
    }
    for (let vv = -2; vv <= 6; vv++) {
      const v = vv * .25;
      if (v === 0 || v === 1) { // dashed reference lines at 0% and 100%
        ctx.save(); ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(200,220,255,.22)';
        line(PAD.l, Y(v), W - PAD.r, Y(v)); ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(148,170,197,.06)';
        line(PAD.l, Y(v), W - PAD.r, Y(v));
      }
      ctx.fillStyle = 'rgba(139,152,171,.75)'; ctx.textAlign = 'right';
      ctx.fillText(Math.round(v * 100), PAD.l - 7, Y(v) + 3);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(139,152,171,.75)';
    for (let i = 0; i <= 4; i++) ctx.fillText((i / 4 * state.DUR).toFixed(1) + 's', X(i / 4), H - 9);

    /* --- 2. optional speed curve (dashed cyan) --- */
    if (state.showVel) {
      const N = 160, vs = []; let mx = 1e-6;
      for (let i = 0; i <= N; i++) { const v = GECurves.velocity(state, i / N); vs.push(v); mx = Math.max(mx, Math.abs(v)); }
      const s = (H - PAD.t - PAD.b) * .42 / mx; // normalize so the biggest spike fits
      ctx.save(); ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(65,224,255,.4)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      vs.forEach((v, i) => { const x = X(i / N), y = Y(v * s); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.restore();
    }

    /* --- 3. the curve itself (sampled into 220 points) --- */
    const N = 220, pts = [];
    for (let i = 0; i <= N; i++) pts.push([X(i / N), Y(GECurves.evalAt(state, i / N))]);
    // Soft fill between the curve and the 0% line.
    ctx.beginPath();
    pts.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
    ctx.lineTo(X(1), Y(0)); ctx.lineTo(X(0), Y(0)); ctx.closePath();
    const fg = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b);
    fg.addColorStop(0, 'rgba(255,176,46,.14)'); fg.addColorStop(1, 'rgba(255,176,46,0)');
    ctx.fillStyle = fg; ctx.fill();
    // Glowing stroke.
    const cg = ctx.createLinearGradient(PAD.l, 0, W - PAD.r, 0);
    cg.addColorStop(0, '#ffb02e'); cg.addColorStop(1, '#ff7a45');
    ctx.save(); ctx.shadowColor = 'rgba(255,176,46,.55)'; ctx.shadowBlur = 12;
    ctx.strokeStyle = cg; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
    ctx.stroke(); ctx.restore();

    /* --- 4. keys + handles (mode-dependent) --- */
    const handle = (x, y, r) => { ctx.fillStyle = '#0d131c'; ctx.strokeStyle = '#41e0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
    const key = (x, y, r) => {
      ctx.save(); ctx.shadowColor = 'rgba(255,176,46,.7)'; ctx.shadowBlur = 8;
      diamond(x, y, r); ctx.fillStyle = '#ffb02e'; ctx.fill(); ctx.restore();
      diamond(x, y, r); ctx.strokeStyle = '#1c1204'; ctx.lineWidth = 1.4; ctx.stroke();
    };
    if (state.mode === 'bezier') {
      const b = state.bezier;
      ctx.strokeStyle = 'rgba(65,224,255,.55)'; ctx.lineWidth = 1.3;
      line(X(0), Y(0), X(b.h1.x), Y(b.h1.y));
      line(X(1), Y(1), X(b.h2.x), Y(b.h2.y));
      handle(X(b.h1.x), Y(b.h1.y), 6); handle(X(b.h2.x), Y(b.h2.y), 6);
      key(X(0), Y(0), 6.5); key(X(1), Y(1), 6.5);
    } else if (state.mode === 'custom') {
      state.custom.keys.forEach(k => {
        ctx.strokeStyle = 'rgba(65,224,255,.55)'; ctx.lineWidth = 1.3;
        if (k.out.dt || k.out.dv) { line(X(k.t), Y(k.v), X(k.t + k.out.dt), Y(k.v + k.out.dv)); handle(X(k.t + k.out.dt), Y(k.v + k.out.dv), 5); }
        if (k.in.dt  || k.in.dv)  { line(X(k.t), Y(k.v), X(k.t - k.in.dt),  Y(k.v - k.in.dv));  handle(X(k.t - k.in.dt),  Y(k.v - k.in.dv), 5); }
        key(X(k.t), Y(k.v), 6.5);
      });
    } else {
      key(X(0), Y(GECurves.evalAt(state, 0)), 6);
      key(X(1), Y(GECurves.evalAt(state, 1)), 6);
    }

    /* --- 5. playhead + current-value dot --- */
    const px = X(tn), py = Y(val);
    ctx.strokeStyle = 'rgba(65,224,255,.7)'; ctx.lineWidth = 1.2;
    line(px, PAD.t, px, H - PAD.b);
    ctx.fillStyle = '#41e0ff';
    ctx.beginPath(); ctx.moveTo(px - 5, PAD.t); ctx.lineTo(px + 5, PAD.t); ctx.lineTo(px, PAD.t + 7); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(65,224,255,.3)'; line(PAD.l, py, px, py); ctx.restore();
    // Value label on the left axis.
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(3, py - 9, PAD.l - 9, 18, 5); } else ctx.rect(3, py - 9, PAD.l - 9, 18);
    ctx.fillStyle = '#0d131c'; ctx.fill();
    ctx.strokeStyle = 'rgba(65,224,255,.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#41e0ff'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(val * 100) + '%', PAD.l - 11, py + 3);
    // The bright dot riding on the curve.
    ctx.save(); ctx.shadowColor = 'rgba(255,255,255,.9)'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.strokeStyle = '#ffb02e'; ctx.lineWidth = 2; ctx.stroke();
  }

  /* ============================================================
     INTERACTION
     Idea: on pointerdown we ask "did they grab something?"
     (hitTest). If yes → drag it. If no → scrub the playhead.
     ============================================================ */
  function normFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    return {
      tn: (e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r),
      v: RANGE.max - (e.clientY - r.top - PAD.t) / (r.height - PAD.t - PAD.b) * (RANGE.max - RANGE.min)
    };
  }

  // Hit testing happens in PIXELS because pixels are a stable
  // distance on screen (10px feels the same at any canvas size).
  function hitTest(pt) {
    const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    if (state.mode === 'bezier') {
      const b = state.bezier;
      if (D(pt, { x: X(b.h1.x), y: Y(b.h1.y) }) < 12) return { type: 'bh', which: 1 };
      if (D(pt, { x: X(b.h2.x), y: Y(b.h2.y) }) < 12) return { type: 'bh', which: 2 };
      return null;
    }
    if (state.mode === 'custom') {
      const ks = state.custom.keys;
      for (let i = 0; i < ks.length; i++) {          // handles first (they sit on top)
        const k = ks[i];
        if (k.out.dt || k.out.dv) { const h = { x: X(k.t + k.out.dt), y: Y(k.v + k.out.dv) }; if (D(pt, h) < 10) return { type: 'h', idx: i, which: 'out' }; }
        if (k.in.dt  || k.in.dv)  { const h = { x: X(k.t - k.in.dt),  y: Y(k.v - k.in.dv) };  if (D(pt, h) < 10) return { type: 'h', idx: i, which: 'in' }; }
      }
      for (let i = 0; i < ks.length; i++) {
        if (D(pt, { x: X(ks[i].t), y: Y(ks[i].v) }) < 12) return { type: 'key', idx: i };
      }
    }
    return null;
  }

  // Moves whatever was grabbed to the new pointer position.
  function applyDrag(pt) {
    if (drag.type === 'bh') {
      const h = drag.which === 1 ? state.bezier.h1 : state.bezier.h2;
      h.x = clamp(pt.tn, 0, 1); h.y = clamp(pt.v, -0.5, 1.5);
    } else if (drag.type === 'key') {
      const ks = state.custom.keys, k = ks[drag.idx];
      // First/last key are pinned to t=0 / t=1.
      if (drag.idx === 0) k.t = 0;
      else if (drag.idx === ks.length - 1) k.t = 1;
      else k.t = clamp(pt.tn, ks[drag.idx - 1].t + .02, ks[drag.idx + 1].t - .02);
      k.v = clamp(pt.v, -0.48, 1.48);
    } else if (drag.type === 'h') {
      const k = state.custom.keys[drag.idx];
      if (drag.which === 'out') { k.out.dt = clamp(pt.tn - k.t, 0, .8); k.out.dv = clamp(pt.v - k.v, -1.4, 1.4); }
      else                      { k.in.dt  = clamp(k.t - pt.tn, 0, .8); k.in.dv  = clamp(k.v - pt.v, -1.4, 1.4); }
    }
  }

  function bindPointer() {
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId); // keep receiving moves even outside the canvas
      const pt = normFromEvent(e);
      const hit = hitTest({ x: X(pt.tn), y: Y(pt.v) });
      if (hit) { drag = hit; }
      else { // grabbed nothing → scrub the playhead
        scrub = true; wasPlaying = state.playing; state.playing = false;
        document.getElementById('gePlay').classList.remove('playing');
        state.t = clamp(pt.tn, 0, 1) * state.DUR;
      }
    });
    canvas.addEventListener('pointermove', e => {
      const pt = normFromEvent(e);
      if (drag) { applyDrag(pt); canvas.style.cursor = 'grabbing'; }
      else if (scrub) { state.t = clamp(pt.tn, 0, 1) * state.DUR; }
      else canvas.style.cursor = hitTest({ x: X(pt.tn), y: Y(pt.v) }) ? 'grab' : 'crosshair';
    });
    const endDrag = () => {
      if (scrub) {
        scrub = false; state.playing = wasPlaying;
        document.getElementById('gePlay').classList.toggle('playing', state.playing);
      }
      drag = null;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // Double-click: add or delete a custom key.
    canvas.addEventListener('dblclick', e => {
      if (state.mode !== 'custom') return;
      const pt = normFromEvent(e);
      const px = { x: X(pt.tn), y: Y(pt.v) }, ks = state.custom.keys;
      for (let i = 1; i < ks.length - 1; i++) {
        const kp = { x: X(ks[i].t), y: Y(ks[i].v) };
        if (Math.hypot(px.x - kp.x, px.y - kp.y) < 13) {
          ks.splice(i, 1); GECurves.smoothKeys(ks); return; // delete it
        }
      }
      if (pt.tn > .02 && pt.tn < .98) {                     // otherwise add one
        ks.push({ t: pt.tn, v: clamp(pt.v, -0.45, 1.45), in: { dt: 0, dv: 0 }, out: { dt: 0, dv: 0 } });
        ks.sort((a, b) => a.t - b.t);
        GECurves.smoothKeys(ks);
      }
    });
  }

  return { init, render };
})();