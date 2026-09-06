/* ============================================================
   ge-controls.js — CONTROLS MODULE
   ------------------------------------------------------------
   All the "normal HTML" wiring: tabs, sliders, preset buttons,
   toggles, reset. Each widget simply writes into the shared
   state object — the render loop reads state every frame, so
   the graph updates automatically. No manual refreshing needed.
   ============================================================ */
window.GEControls = (function () {
  "use strict";

  let state;
  const $ = id => document.getElementById(id);

  const HINTS = {
    bezier:  'drag handles to shape · drag empty space to scrub',
    elastic: 'tune sliders · drag empty space to scrub',
    bounce:  'tune sliders · drag empty space to scrub',
    step:    'tune sliders · drag empty space to scrub',
    custom:  'dbl-click: add / remove key · drag keys & handles'
  };
  const LABELS = { bezier: 'BEZIER', elastic: 'ELASTIC', bounce: 'BOUNCE', step: 'STEP', custom: 'CUSTOM' };

  function init(passedState) {
    state = passedState;
    wireTabs();
    wirePresets();
    wireSliders();
    wireSegments();
    wireButtons();
    setMode('bezier'); // make sure chip + hint match the default tab
  }

  /* ----- mode tabs ----- */
  function setMode(m) {
    state.mode = m;
    // Update tab button active states - only the clicked tab gets 'active' class
    document.querySelectorAll('.ge-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    // Show/hide control panels based on which mode is selected
    document.querySelectorAll('.ge-controls').forEach(c => c.classList.toggle('active', c.dataset.for === m));
    // Update the mode chip text (e.g., "BEZIER", "ELASTIC")
    $('geModeChip').textContent = LABELS[m];
    // Update the hint text at bottom of canvas
    $('geHint').textContent = HINTS[m];
    
    // IMPORTANT: Set data-mode attribute on wrapper for CSS theme switching
    // This allows CSS to apply different colors based on current mode
    document.querySelector('.ge-wrap').setAttribute('data-mode', m);
  }
  function wireTabs() {
    document.querySelectorAll('.ge-tab').forEach(b =>
      b.addEventListener('click', () => setMode(b.dataset.mode)));
  }

  /* ----- bezier preset chips ----- */
  function wirePresets() {
    document.querySelectorAll('.ge-chipbtn').forEach(b =>
      b.addEventListener('click', () => {
        // Deep-copy so editing state later never mutates the preset.
        state.bezier = JSON.parse(JSON.stringify(GECurves.PRESETS[b.dataset.preset]));
      }));
  }

  /* ----- sliders -----
     bindRange connects one <input type=range> to one state value,
     plus updates the number label and the filled-track effect. */
  function bindRange(id, outId, setter, fmt) {
    const el = $(id), out = $(outId);
    const update = () => {
      const v = parseFloat(el.value);
      setter(v);                       // write into state
      out.textContent = fmt(v);        // show the number
      const pct = (el.value - el.min) / (el.max - el.min) * 100;
      el.style.background = `linear-gradient(90deg, var(--ge-amber) ${pct}%, #263140 ${pct}%)`;
    };
    el.addEventListener('input', update);
    update(); // run once so the initial look is correct
  }
  function wireSliders() {
    bindRange('geOsc',  'geOscV',  v => state.elastic.osc  = v, v => v.toFixed(1));
    bindRange('geOv',   'geOvV',   v => state.elastic.ov   = v, v => v.toFixed(2));
    bindRange('geBn',   'geBnV',   v => state.bounce.n     = v, v => v.toFixed(0));
    bindRange('geEn',   'geEnV',   v => state.bounce.r     = v, v => v.toFixed(2));
    bindRange('geSt',   'geStV',   v => state.step.n       = v, v => v.toFixed(0));
    bindRange('geRise', 'geRiseV', v => state.step.rise    = v, v => Math.round(v * 100) + '%');
  }

  /* ----- OUT / IN segmented toggles ----- */
  function wireSegments() {
    document.querySelectorAll('.ge-seg').forEach(seg =>
      seg.querySelectorAll('button').forEach(b =>
        b.addEventListener('click', () => {
          seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          state[seg.dataset.group].side = b.dataset.val;
        })));
  }

  /* ----- misc buttons ----- */
  function wireButtons() {
    $('geReset').addEventListener('click', () => {
      switch (state.mode) {
        case 'bezier':  state.bezier  = { h1: { x: .35, y: 0 }, h2: { x: .65, y: 1 } }; break;
        case 'elastic': state.elastic = { osc: 4.2, ov: 1, side: 'out' }; break;
        case 'bounce':  state.bounce  = { n: 4, r: .5, side: 'out' }; break;
        case 'step':    state.step    = { n: 5, rise: .12 }; break;
        case 'custom':  state.custom.keys = GECurves.defaultKeys(); GECurves.smoothKeys(state.custom.keys); break;
      }
    });
    $('geSmooth').addEventListener('click', () => GECurves.smoothKeys(state.custom.keys));
    $('geAddKey').addEventListener('click', () => {
      state.custom.keys.push({ t: .5, v: .5, in: { dt: 0, dv: 0 }, out: { dt: 0, dv: 0 } });
      state.custom.keys.sort((a, b) => a.t - b.t);
      GECurves.smoothKeys(state.custom.keys);
    });
  }

  /* ----- live text readouts (called every frame) ----- */
  function formula() {
    switch (state.mode) {
      case 'bezier': { const b = state.bezier;
        return `cubic-bezier(${b.h1.x.toFixed(2)}, ${b.h1.y.toFixed(2)}, ${b.h2.x.toFixed(2)}, ${b.h2.y.toFixed(2)})`; }
      case 'elastic': { const e = state.elastic;
        return `1 − e^(−${Math.max(1.5, 11 - 4.5 * e.ov).toFixed(1)}t) · cos(2π·${e.osc.toFixed(1)}t)  [${e.side}]`; }
      case 'bounce': { const b = state.bounce; return `parabolic decay × ${b.n}  r=${b.r.toFixed(2)}  [${b.side}]`; }
      case 'step':   return `hold × ${state.step.n}  rise=${Math.round(state.step.rise * 100)}%`;
      case 'custom': return `spline · ${state.custom.keys.length} keyframes`;
    }
  }
  function updateReadouts(tn, val, vel) {
    $('roT').textContent = state.t.toFixed(2) + 's';
    $('roV').textContent = val.toFixed(3);
    $('roS').textContent = vel.toFixed(2);
    $('geFormula').textContent = formula();
  }

  return { init, updateReadouts };
})();