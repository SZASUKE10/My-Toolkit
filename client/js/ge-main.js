/* ============================================================
   ge-main.js — BOOTSTRAP (runs last)
   ------------------------------------------------------------
   Three jobs:
   1. Create the STATE — one single object that holds every
      editable value. This is the "single source of truth":
      widgets write into it, renderers read from it.
   2. Hand that state to each module's init().
   3. Subscribe each renderer to the transport's tick.
   ============================================================ */
(function () {
  "use strict";

  /* --- 1. THE STATE --- */
  const state = {
    mode: 'bezier',          // which curve family is active
    t: 0,                    // current playhead time (seconds)
    DUR: 2,                  // total duration (seconds)
    playing: true,
    loop: true,
    showVel: true,           // draw the dashed speed curve?
    bezier:  { h1: { x: .35, y: 0 }, h2: { x: .65, y: 1 } },
    elastic: { osc: 4.2, ov: 1, side: 'out' },
    bounce:  { n: 4, r: .5, side: 'out' },
    step:    { n: 5, rise: .12 },
    custom:  { keys: GECurves.defaultKeys() }
  };
  GECurves.smoothKeys(state.custom.keys); // give default keys nice handles

  /* --- 2. INIT EVERY MODULE --- */
  GEGraph.init(state, document.getElementById('geCanvas'));
  GEPreview.init(state);
  GEControls.init(state);
  GETransport.init(state);

  /* --- 3. CONNECT THE FRAME LOOP ---
     Every frame, the transport calls these with the fresh
     time/value/velocity. Order doesn't matter here. */
  GETransport.onTick((tn, val, vel) => {
    GEGraph.render(tn, val);
    GEPreview.render(tn);
    GEControls.updateReadouts(tn, val, vel);
  });

  GETransport.start(); // 🎬 go
})();