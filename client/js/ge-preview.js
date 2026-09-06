/* ============================================================
   ge-preview.js — PREVIEW MODULE
   ------------------------------------------------------------
   The simplest module: a bar and a ball. Every frame we ask the
   curves module "what's the value right now?" and set the
   ball's CSS `left` to that percentage. That's the whole trick.
   ============================================================ */
window.GEPreview = (function () {
  "use strict";

  let state, ball, fill, label;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, b));

  function init(passedState) {
    state = passedState;
    ball  = document.getElementById('gePrevBall');
    fill  = document.getElementById('gePrevFill');
    label = document.getElementById('gePrevVal');
  }

  function render(tn) {
    const v = GECurves.evalAt(state, tn);

    // Ball position: clamp to -10%..110% so it never leaves sight,
    // but overshoot is still clearly visible past the end ticks.
    ball.style.left = clamp(v, -0.1, 1.1) * 100 + '%';

    // The amber fill only ever goes 0→100%, never past.
    fill.style.width = clamp(v, 0, 1) * 100 + '%';

    // Turn the ball red while it's outside the normal 0..1 range.
    ball.classList.toggle('over', v > 1.001 || v < -0.001);

    label.textContent = Math.round(v * 100) + '%';
  }

  return { init, render };
})();