/* ============================================================
   ge-curves.js — MATH MODULE (no HTML, no drawing)
   ------------------------------------------------------------
   Every easing curve is a function that takes a normalized
   time t (0 = start, 1 = end) and returns a progress value
   (0 = start value, 1 = end value). Values CAN go below 0 or
   above 1 — that is called "overshoot".
   ============================================================ */
window.GECurves = (function () {
  "use strict";

  // Utility: force a number to stay between a and b.
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- 1. BEZIER ----------
     Same math CSS uses for cubic-bezier(). Tricky part: the
     curve is parameterized by u (0..1 along the curve), but we
     know the TIME t and need to find which u has x(u) = t.
     We guess with Newton's method, fall back to bisection. */
  function bezVal(t, h1, h2) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Convert the two handles into polynomial coefficients.
    const cx = 3 * h1.x, bx = 3 * (h2.x - h1.x) - cx, ax = 1 - cx - bx;
    const cy = 3 * h1.y, by = 3 * (h2.y - h1.y) - cy, ay = 1 - cy - by;
    const fx = u => ((ax * u + bx) * u + cx) * u; // x position at u
    const fy = u => ((ay * u + by) * u + cy) * u; // y position at u
    // Newton's method: repeatedly improve our guess for u.
    let u = t;
    for (let i = 0; i < 8; i++) {
      const dx = (3 * ax * u + 2 * bx) * u + cx;   // derivative of x(u)
      if (Math.abs(dx) < 1e-6) break;
      u = clamp(u - (fx(u) - t) / dx, 0, 1);
    }
    // Safety net: if Newton didn't land, binary-search instead.
    if (Math.abs(fx(u) - t) > 1e-4) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) {
        u = (lo + hi) / 2;
        if (fx(u) < t) lo = u; else hi = u;
      }
    }
    return fy(u);
  }

  /* ---------- 2. ELASTIC ----------
     A cosine wave (the wiggle) multiplied by a decaying
     exponential (so the wiggle fades out).
     osc = number of wiggles, ov = how big the overshoot is. */
  function elasticOut(t, osc, ov) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const d = Math.max(1.5, 11 - 4.5 * ov); // bigger ov => slower decay => bigger overshoot
    return 1 - Math.exp(-d * t) * Math.cos(2 * Math.PI * osc * t);
  }

  /* ---------- 3. BOUNCE ----------
     A fast rise, then a row of parabolic arcs. Each next arc
     is shorter and lower: time scales with sqrt(r), height
     with r — just like a real losing-energy ball. */
  function bounceOut(t, n, r) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Step 1: figure out how long each arc lasts (normalized).
    const L = [0.5]; let sum = 0.5; // first arc is a half-arc
    for (let k = 1; k < n; k++) { const w = Math.pow(r, k / 2); L.push(w); sum += w; }
    // Step 2: rising first arc (quadratic = constant acceleration).
    const seg0 = L[0] / sum;
    if (t <= seg0) { const q = t / seg0; return q * q; }
    // Step 3: dipping arcs — value goes 1 → (1 - height) → 1.
    let a = seg0;
    for (let k = 1; k < n; k++) {
      const len = L[k] / sum;
      if (t <= a + len || k === n - 1) {
        const q = Math.min(1, (t - a) / len);
        return 1 - Math.pow(r, k) * 4 * q * (1 - q); // 4q(1-q) is an arch peaking at 1
      }
      a += len;
    }
    return 1;
  }

  /* ---------- 4. STEP ----------
     The value jumps between flat levels. "rise" lets each jump
     take a tiny ramp instead of being perfectly instant. */
  function stepVal(t, n, rise) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const seg = 1 / n;
    const i = Math.min(n - 1, Math.floor(t / seg)); // which level are we on?
    const q = (t - i * seg) / seg;                  // position inside that level
    const lvl = i / (n - 1);
    const prev = i === 0 ? 0 : (i - 1) / (n - 1);
    const rs = Math.max(rise, 1e-4);
    if (q < rs) return prev + (lvl - prev) * (q / rs); // ramping up
    return lvl;                                        // holding flat
  }

  /* ---------- 5. CUSTOM ----------
     A sorted list of keyframes; each neighbouring pair is
     joined by one bezier segment with its own handles. */
  function customVal(keys, t) {
    if (t <= keys[0].t) return keys[0].v;
    const last = keys[keys.length - 1];
    if (t >= last.t) return last.v;
    // Find which segment t falls inside.
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1];
    // Turn the key handles into absolute control points.
    const p1 = { x: a.t + a.out.dt, y: a.v + a.out.dv };
    const p2 = { x: b.t - b.in.dt,  y: b.v - b.in.dv };
    // Same "find u from x" trick as bezVal, bisection only.
    const fx = u => { const j = 1 - u; return j*j*j*a.t + 3*j*j*u*p1.x + 3*j*u*u*p2.x + u*u*u*b.t; };
    const fy = u => { const j = 1 - u; return j*j*j*a.v + 3*j*j*u*p1.y + 3*j*u*u*p2.y + u*u*u*b.v; };
    let lo = 0, hi = 1, u = 0.5;
    for (let k = 0; k < 40; k++) { u = (lo + hi) / 2; if (fx(u) < t) lo = u; else hi = u; }
    return fy(u);
  }

  /* Auto-compute handles so the spline flows smoothly through
     every key (Catmull-Rom → bezier conversion). */
  function smoothKeys(keys) {
    keys.forEach((k, i) => {
      const a = keys[i - 1], b = keys[i + 1];
      if (a && b) {          // middle keys: tangent = direction to neighbours
        const dt = (b.t - a.t) / 6, dv = (b.v - a.v) / 6;
        k.out = { dt, dv }; k.in = { dt, dv };
      } else if (b) { k.out = { dt: (b.t - k.t) / 3, dv: (b.v - k.v) / 3 }; k.in = { dt: 0, dv: 0 }; }
      else if (a)   { k.in  = { dt: (k.t - a.t) / 3, dv: (k.v - a.v) / 3 }; k.out = { dt: 0, dv: 0 }; }
    });
  }

  // Factory for the default custom keys (fresh copy each call).
  function defaultKeys() {
    return [{ t: 0, v: 0 }, { t: .3, v: .9 }, { t: .62, v: .42 }, { t: 1, v: 1 }]
      .map(k => ({ t: k.t, v: k.v, in: { dt: 0, dv: 0 }, out: { dt: 0, dv: 0 } }));
  }

  /* THE ROUTER — the only function the other modules really need.
     It looks at state.mode and calls the matching formula. */
  function evalAt(state, t) {
    switch (state.mode) {
      case 'bezier':  return bezVal(t, state.bezier.h1, state.bezier.h2);
      case 'elastic': { const e = state.elastic; return e.side === 'out' ? elasticOut(t, e.osc, e.ov) : 1 - elasticOut(1 - t, e.osc, e.ov); }
      case 'bounce':  { const b = state.bounce;  return b.side === 'out' ? bounceOut(t, b.n, b.r)    : 1 - bounceOut(1 - t, b.n, b.r); }
      case 'step':    return stepVal(t, state.step.n, state.step.rise);
      case 'custom':  return customVal(state.custom.keys, t);
    }
  }

  /* Velocity = how fast the value changes. We approximate the
     derivative by sampling two points very close together. */
  function velocity(state, t) {
    const e = 0.0025;
    const a = Math.max(0, t - e), b = Math.min(1, t + e);
    return (evalAt(state, b) - evalAt(state, a)) / (b - a);
  }

  // Bezier presets: just handle positions.
  const PRESETS = {
    linear: { h1: { x: .33, y: .33 }, h2: { x: .67, y: .67 } },
    in:     { h1: { x: .42, y: 0 },   h2: { x: 1,   y: 1 } },
    out:    { h1: { x: 0,   y: 0 },   h2: { x: .18, y: 1 } },
    inout:  { h1: { x: .45, y: 0 },   h2: { x: .55, y: 1 } },
    back:   { h1: { x: .3,  y: 0 },   h2: { x: .32, y: 1.35 } }
  };

  // Public API — everything other files may use.
  return { clamp, evalAt, velocity, smoothKeys, defaultKeys, PRESETS };
})();