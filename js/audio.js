/* Tiny WebAudio synth for game juice. All sounds are generated, no files. */
(function (root) {
  'use strict';
  var ctx = null, master = null, muted = false;

  function ensure() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.25; master.connect(ctx.destination); }
    catch (e) { ctx = null; }
    return ctx;
  }

  function tone(freq, dur, type, vol, when, slideTo) {
    if (muted) return;
    var c = ensure(); if (!c) return;
    if (c.state === 'suspended') c.resume();
    var t0 = c.currentTime + (when || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.5, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  var SFX = {
    unlock: function () { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    pickup: function () { tone(660, 0.12, 'triangle', 0.4); tone(990, 0.16, 'triangle', 0.35, 0.08); },
    cash: function (big) {
      tone(1320, 0.08, 'square', 0.18); tone(1760, 0.18, 'square', 0.16, 0.07);
      if (big) tone(2200, 0.22, 'square', 0.12, 0.15);
    },
    buy: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.3, i * 0.06); }); },
    deny: function () { tone(180, 0.15, 'sawtooth', 0.2, 0, 120); },
    plug: function () { tone(220, 0.06, 'square', 0.25); tone(880, 0.25, 'sine', 0.3, 0.05, 1600); },
    full: function () { tone(784, 0.1, 'sine', 0.25); tone(1175, 0.18, 'sine', 0.25, 0.08); },
    bump: function () { tone(90, 0.12, 'sawtooth', 0.25, 0, 60); },
    goal: function () { [392, 523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.3, 'triangle', 0.28, i * 0.07); }); },
    setMuted: function (m) { muted = !!m; },
    isMuted: function () { return muted; }
  };
  root.RC_SFX = SFX;
})(typeof window !== 'undefined' ? window : this);
