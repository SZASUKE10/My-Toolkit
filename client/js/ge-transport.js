/* ============================================================
   ge-transport.js — TRANSPORT MODULE
   ------------------------------------------------------------
   Owns TIME. It runs the requestAnimationFrame loop, advances
   state.t while playing, and then calls every registered
   "tick" listener so all modules can redraw themselves.
   ------------------------------------------------------------
   Key concept — requestAnimationFrame:
   The browser calls your function right before each screen
   refresh (~60x/sec). We measure how much real time passed
   since the last call (delta time) so playback speed is
   identical on slow and fast machines.
   ============================================================ */
window.GETransport = (function () {
  "use strict";

  let state;
  const listeners = []; // functions that want to know about each frame
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function init(passedState) {
    state = passedState;

    $('gePlay').addEventListener('click', togglePlay);
    $('geRestart').addEventListener('click', () => { state.t = 0; });
    $('geLoop').addEventListener('click', e => {
      state.loop = !state.loop;
      e.currentTarget.classList.toggle('active', state.loop);
    });
    $('geDurSel').addEventListener('change', e => {
      state.DUR = parseFloat(e.target.value);
      state.t = Math.min(state.t, state.DUR);
    });

    // Click OR drag the thin seek bar to jump to that time.
    const bar = $('geDurBar');
    const seek = e => {
      const r = bar.getBoundingClientRect();
      state.t = clamp((e.clientX - r.left) / r.width, 0, 1) * state.DUR;
    };
    bar.addEventListener('pointerdown', e => { bar.setPointerCapture(e.pointerId); seek(e); });
    bar.addEventListener('pointermove', e => { if (e.buttons) seek(e); }); // e.buttons = mouse held down

    // Space bar toggles playback (unless you're typing somewhere).
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) {
        e.preventDefault();
        togglePlay();
      }
    });
  }

  function togglePlay() {
    if (!state.playing && state.t >= state.DUR) state.t = 0; // replay from start
    state.playing = !state.playing;
    updatePlayUI();
  }
  function updatePlayUI() {
    $('gePlay').classList.toggle('playing', state.playing); // CSS swaps the icon
    $('geTimeMax').textContent = state.DUR.toFixed(2);
  }

  // Other modules register themselves here instead of us
  // hard-coding them — that's what makes it modular.
  function onTick(fn) { listeners.push(fn); }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); // seconds since last frame
    last = now;

    // 1. Advance time if playing.
    if (state.playing) {
      state.t += dt;
      if (state.t >= state.DUR) {
        if (state.loop) state.t %= state.DUR; // wrap around
        else { state.t = state.DUR; state.playing = false; updatePlayUI(); }
      }
    }

    // 2. Evaluate the curve once, share the results.
    const tn  = clamp(state.t / state.DUR, 0, 1);
    const val = GECurves.evalAt(state, tn);
    const vel = GECurves.velocity(state, tn);

    // 3. Update the time text + seek fill.
    $('geTime').textContent = state.t.toFixed(2);
    $('geDurFill').style.width = (tn * 100) + '%';

    // 4. Tell every listener to redraw.
    listeners.forEach(fn => fn(tn, val, vel));

    requestAnimationFrame(frame); // schedule the next frame
  }

  function start() { updatePlayUI(); requestAnimationFrame(frame); }

  return { init, onTick, start };
})();