/* ============================================================
   ge-preview.js — PREVIEW MODULE
   ------------------------------------------------------------
   The simplest module: a bar and a ball. Every frame we ask the
   curves module "what's the value right now?" and set the
   ball's CSS `left` to that percentage. That's the whole trick.
   
   HOW IT WORKS:
   - init(): Grab references to the HTML elements (ball, fill bar, value text)
   - render(tn): tn = normalized time (0 to 1). We call GECurves.evalAt() 
     which returns the curve value at that time (can be <0 or >1 for overshoot)
   - The ball's left position is set to that value as a percentage
   - The amber fill only shows 0-100% progress (clamped)
   - Ball turns red when overshooting past 0% or 100%
   ============================================================ */
window.GEPreview = (function () {
  "use strict";
  
  // State reference and DOM element references
  // state: shared object containing all curve parameters
  // ball: the moving circle that shows current position
  // fill: the amber background bar that fills from 0-100%
  // label: the text showing "NN%" output value
  let state, ball, fill, label;
  
  // Utility: force a number to stay between a and b
  // Used to keep the ball visible even during extreme overshoot
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  
  // Initialize: store state reference and grab DOM elements by ID
  // Called once at startup from ge-main.js
  function init(passedState) {
    state = passedState;
    // Get references to the preview UI elements
    // These IDs must match the HTML exactly
    ball  = document.getElementById('gePrevBall');
    fill  = document.getElementById('gePrevFill');
    label = document.getElementById('gePrevVal');
  }
  
  // Render one frame: update ball position based on current curve value
  // tn = normalized time (0 = start, 1 = end)
  // This is called ~60 times per second by the transport loop
  function render(tn) {
    // Ask the curves module: "what's the progress value at this time?"
    // This is where the actual easing math happens (bezier, elastic, etc.)
    const v = GECurves.evalAt(state, tn);

    // Ball position: clamp to -10%..110% so it never leaves sight,
    // but overshoot is still clearly visible past the end ticks.
    // Example: if v = 1.2 (20% overshoot), ball shows at 110% (capped)
    // Example: if v = -0.15, ball shows at -10% (capped)
    ball.style.left = clamp(v, -0.1, 1.1) * 100 + '%';
  
    // The amber fill only ever goes 0→100%, never past.
    // This gives a clean visual of "how much is done" without overshoot confusion.
    fill.style.width = clamp(v, 0, 1) * 100 + '%';
  
    // Turn the ball red while it's outside the normal 0..1 range.
    // This visually indicates "overshoot" - going beyond start or end.
    // The tiny epsilon (0.001) prevents flickering right at the boundary.
    ball.classList.toggle('over', v > 1.001 || v < -0.001);
  
    // Update the percentage readout text (e.g., "73%")
    label.textContent = Math.round(v * 100) + '%';
  }
  
  // Public API: expose init and render so other modules can call them
  return { init, render };
})();
