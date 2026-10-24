/* RoboCab UI: HUD, shop, goals, input, save/load, main loop, cheats and test hooks. */
(function (root) {
  'use strict';
  var ECON = root.RC_ECON, SFX = root.RC_SFX, Game = root.RC_GAME.Game, Renderer = root.RC_RENDER.Renderer;
  var SAVE_KEY = 'robocab-save-v1';
  var params = new URLSearchParams(root.location.search);
  var DEBUG = params.has('debug');
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return '$' + Math.floor(n).toLocaleString('en-US'); };

  // ---- Load ------------------------------------------------------------------
  var saved = null, settings = { muted: false, seenHelp: false };
  if (!params.has('fresh')) {
    try {
      var raw = root.localStorage.getItem(SAVE_KEY);
      if (raw) { var obj = JSON.parse(raw); saved = obj.s; settings.muted = !!obj.muted; settings.seenHelp = !!obj.seenHelp; }
    } catch (e) { saved = null; }
  }
  var game = new Game(saved);
  var canvas = $('game');
  var R = new Renderer(canvas, game);
  SFX.setMuted(settings.muted);
  var speedMult = 1;

  function save() {
    try { root.localStorage.setItem(SAVE_KEY, JSON.stringify({ s: game.s, muted: SFX.isMuted(), seenHelp: settings.seenHelp, savedAt: Date.now() })); }
    catch (e) { /* storage full/blocked: ignore */ }
  }

  // ---- Toasts / goal ---------------------------------------------------------
  var toastQ = [], toastT = 0;
  function toast(msg) { toastQ.push(msg); if (toastQ.length > 2) toastQ.splice(0, toastQ.length - 2); }
  function updateToast(dt) {
    var el = $('toast');
    toastT -= dt;
    if (toastT <= 0) {
      if (toastQ.length) { el.textContent = toastQ.shift(); el.classList.add('show'); toastT = 3.2; }
      else el.classList.remove('show');
    }
  }
  game.hooks.toast = toast;
  game.hooks.goal = function (g) {
    SFX.goal();
    var p = game.player; game.burst(p.x, p.y, '#fff', 40, 'confetti');
    var el = $('goal'); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    toast(g.id === 'done' ? 'All goals complete. You run the city!' : 'New goal: ' + g.title);
  };
  game.hooks.purchased = function () { save(); buildShopState(); };

  // ---- Shop --------------------------------------------------------------------
  var shopRows = {};
  function buildShop() {
    var list = $('shop-list'); list.innerHTML = '';
    ECON.items.forEach(function (it) {
      var row = document.createElement('div'); row.className = 'item'; row.dataset.id = it.id;
      row.innerHTML = '<div class="icon">' + it.icon + '</div><div class="info"><div class="name"></div><div class="desc"></div><div class="pips"></div></div><button class="buy"></button>';
      row.querySelector('.buy').addEventListener('click', function (e) { e.stopPropagation(); tryBuy(it.id); });
      list.appendChild(row);
      shopRows[it.id] = row;
    });
    buildShopState();
  }
  function buildShopState() {
    var s = game.s, affordable = 0, goal = ECON.currentGoal(s);
    ECON.items.forEach(function (it) {
      var row = shopRows[it.id]; if (!row) return;
      var cost = it.cost(s), req = cost === null ? null : it.req(s), lvl = it.level(s);
      var btn = row.querySelector('.buy');
      row.querySelector('.name').textContent = it.name + (it.maxLevel > 1 ? '  ·  Lv ' + lvl + '/' + it.maxLevel : '');
      row.querySelector('.desc').textContent = cost === null ? 'Maxed out' : (req ? '🔒 ' + req : it.desc(s));
      var pips = '';
      if (it.maxLevel > 1 && it.maxLevel <= 12) for (var i = 0; i < it.maxLevel; i++) pips += '<span class="' + (i < lvl ? 'on' : '') + '"></span>';
      row.querySelector('.pips').innerHTML = pips;
      var can = cost !== null && !req && s.cash >= cost;
      if (can) affordable++;
      btn.textContent = cost === null ? 'MAX' : fmt(cost);
      btn.disabled = !can;
      row.classList.toggle('locked', !!req);
      row.classList.toggle('maxed', cost === null);
      row.classList.toggle('can', can);
      row.classList.toggle('goal', goal.item === it.id && cost !== null);
    });
    var badge = $('shop-badge');
    badge.textContent = affordable; badge.style.display = affordable ? 'inline-block' : 'none';
  }
  function tryBuy(id) {
    SFX.unlock();
    var r = game.buy(id);
    if (!r.ok) { SFX.deny(); var row = shopRows[id]; if (row) { row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake'); } return false; }
    SFX.buy();
    var p = game.player; game.burst(p.x, p.y, '#fff', 24, 'confetti');
    game.popup(p.x, p.y - 30, '-' + fmt(r.cost), '#fca5a5', 1.1);
    buildShopState();
    return true;
  }
  function toggleShop(force) {
    var el = $('shop'); var open = force !== undefined ? force : !el.classList.contains('open');
    el.classList.toggle('open', open);
    if (open) buildShopState();
  }

  // ---- HUD ----------------------------------------------------------------------
  var shownCash = game.s.cash;
  function updateHud(dt) {
    var s = game.s, st = ECON.stats;
    shownCash += (s.cash - shownCash) * Math.min(1, dt * 8);
    if (Math.abs(s.cash - shownCash) < 1) shownCash = s.cash;
    $('cash').textContent = fmt(shownCash);
    $('rate').textContent = fmt(game.incomePerMin()) + '/min · ' + s.trips + ' trips';
    var g = ECON.currentGoal(s);
    $('goal-step').textContent = g.id === 'done' ? 'All goals done' : 'Goal ' + (g.index + 1) + '/' + g.total;
    $('goal-title').textContent = g.title;
    $('goal-hint').textContent = g.hint;
    var bar = $('goal-bar');
    if (g.cost) { bar.parentNode.style.display = 'block'; bar.style.width = Math.min(100, s.cash / g.cost * 100) + '%'; $('goal-cost').textContent = fmt(Math.min(s.cash, g.cost)) + ' / ' + fmt(g.cost); bar.classList.toggle('ready', s.cash >= g.cost); }
    else { bar.parentNode.style.display = 'none'; $('goal-cost').textContent = ''; }
    // battery / status
    var pc = game.playerCar(), cap = st.batteryCap(s);
    if (pc) {
      var f = Math.max(0, pc.battery / cap);
      $('batt').style.display = 'block';
      $('batt-fill').style.width = (f * 100) + '%';
      $('batt-fill').className = f > 0.5 ? 'hi' : f > 0.25 ? 'mid' : 'lo';
      $('batt-label').textContent = (pc.charging ? '⚡ Charging ' : '🔋 ') + Math.round(f * 100) + '%' + (pc.battery <= 0 ? ' · EMPTY: crawl home!' : '');
      $('seats').textContent = '🧍 ' + pc.onboard.length + '/' + st.seats(s) + ' riders';
      $('mode').textContent = 'Driving';
    } else {
      $('batt').style.display = 'none';
      $('seats').textContent = '';
      $('mode').textContent = 'On foot · plug in cabs that flash 🔌';
    }
    var driving = 0, charging = 0, waiting = 0;
    game.cars.forEach(function (c) {
      if (c.state === 'charging' || c.charging) charging++;
      else if (c.state === 'waitingPlug') waiting++;
      else driving++;
    });
    $('fleet').innerHTML = '🚕 ' + game.cars.length + ' cab' + (game.cars.length > 1 ? 's' : '') +
      ' <span class="dim">· ' + driving + ' working · ⚡' + charging + (waiting ? ' · <b class="warn">🔌' + waiting + ' need plug</b>' : '') + '</span>' +
      (game.robots.length ? ' <span class="dim">· 🦾' + game.robots.length + '</span>' : '');
    $('speed').textContent = speedMult !== 1 ? '⏩ ' + speedMult + 'x' : '';
    if (DEBUG) {
      $('debug').style.display = 'block';
      $('debug').textContent = 'fps ' + fps.toFixed(0) + ' · t ' + game.time.toFixed(1) + ' · riders ' + game.passengers.length + '\n' +
        game.cars.map(function (c) { return '#' + c.id + ' ' + c.state + ' b' + c.battery.toFixed(1) + ' on' + c.onboard.length; }).join('\n');
    }
  }

  // ---- Input -----------------------------------------------------------------------
  var keys = {};
  function onKey(e, down) {
    var k = e.code;
    if (down && e.shiftKey) {
      if (k === 'KeyM') { game.s.cash += 1000; toast('Cheat: +$1,000'); e.preventDefault(); return; }
      if (k === 'KeyK') { game.s.cash += 10000; toast('Cheat: +$10,000'); e.preventDefault(); return; }
      if (k === 'KeyT') { speedMult = speedMult >= 8 ? 1 : speedMult * 2; toast('Game speed ' + speedMult + 'x'); e.preventDefault(); return; }
      if (k === 'KeyR') { if (root.confirm('Reset all RoboCab progress?')) { root.localStorage.removeItem(SAVE_KEY); resetting = true; root.location.reload(); } return; }
    }
    if (down && !e.repeat) {
      if (k === 'KeyB' || k === 'KeyE') { toggleShop(); return; }
      if (k === 'Escape') { toggleShop(false); $('help').classList.remove('open'); return; }
      if (k === 'KeyH') { $('help').classList.toggle('open'); return; }
    }
    keys[k] = down;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(k) >= 0) e.preventDefault();
    if (down) SFX.unlock();
  }
  root.addEventListener('keydown', function (e) { onKey(e, true); });
  root.addEventListener('keyup', function (e) { onKey(e, false); });
  root.addEventListener('blur', function () { keys = {}; });

  function readKeys() {
    var up = keys.ArrowUp || keys.KeyW, dn = keys.ArrowDown || keys.KeyS, lf = keys.ArrowLeft || keys.KeyA, rt = keys.ArrowRight || keys.KeyD;
    game.input.thr = (up ? 1 : 0) - (dn ? 1 : 0);
    game.input.steer = (rt ? 1 : 0) - (lf ? 1 : 0);
    game.input.walkX = game.input.steer; game.input.walkY = -game.input.thr;
  }

  // Virtual joystick (touch or mouse drag on the map)
  var joy = { active: false, ox: 0, oy: 0, x: 0, y: 0, mag: 0, id: null };
  canvas.addEventListener('pointerdown', function (e) {
    SFX.unlock();
    joy.active = true; joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = 0; joy.y = 0; joy.mag = 0;
    game.input.joy = joy; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!joy.active || e.pointerId !== joy.id) return;
    var dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, d = Math.hypot(dx, dy);
    joy.mag = Math.min(1, d / 50); joy.x = d ? dx / d : 0; joy.y = d ? dy / d : 0;
  });
  function endJoy(e) { if (e.pointerId === joy.id) { joy.active = false; joy.mag = 0; game.input.joy = null; } }
  canvas.addEventListener('pointerup', endJoy);
  canvas.addEventListener('pointercancel', endJoy);

  $('shop-btn').addEventListener('click', function () { SFX.unlock(); toggleShop(); });
  $('shop-close').addEventListener('click', function () { toggleShop(false); });
  $('help-btn').addEventListener('click', function () { $('help').classList.toggle('open'); });
  $('help-close').addEventListener('click', function () { $('help').classList.remove('open'); settings.seenHelp = true; save(); SFX.unlock(); });
  $('mute-btn').addEventListener('click', function () { SFX.setMuted(!SFX.isMuted()); $('mute-btn').textContent = SFX.isMuted() ? '🔇' : '🔊'; save(); });
  $('mute-btn').textContent = SFX.isMuted() ? '🔇' : '🔊';
  $('goal').addEventListener('click', function () { toggleShop(true); });
  root.addEventListener('resize', function () { R.resize(); });
  var resetting = false;
  root.addEventListener('beforeunload', function () { if (!resetting) save(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

  // ---- Loop ---------------------------------------------------------------------------
  var last = performance.now(), fps = 60, saveT = 0, hudT = 0, shopT = 0;
  function frame(now) {
    var real = Math.min(0.05, (now - last) / 1000); last = now;
    fps += ((1 / Math.max(real, 1e-3)) - fps) * 0.05;
    readKeys();
    var total = real * speedMult;
    while (total > 1e-6) { var d = Math.min(total, 1 / 30); game.step(d); total -= d; }
    R.updateCamera(real);
    R.draw();
    hudT -= real; if (hudT <= 0) { updateHud(0.1); hudT = 0.05; }
    shopT -= real; if (shopT <= 0) { buildShopState(); shopT = 0.25; }
    updateToast(real);
    saveT -= real; if (saveT <= 0) { save(); saveT = 3; }
    root.requestAnimationFrame(frame);
  }

  buildShop();
  R.updateCamera(0, true);
  updateHud(1);
  if (!settings.seenHelp && !params.has('nohelp')) $('help').classList.add('open');

  // ---- Test / cheat API (also used by test/smoke.js) ----------------------------------------
  var UNLOCK_PLAN = {
    upgrades: ['motor', 'battery', 'charger', 'seats', 'fares'],
    selfDriving: ['motor', 'battery', 'charger', 'seats', 'fares', 'selfDriving'],
    lot: ['motor', 'battery', 'charger', 'seats', 'fares', 'selfDriving', 'lot', 'car', 'lotCharger'],
    robot: ['motor', 'battery', 'charger', 'seats', 'fares', 'motor', 'battery', 'selfDriving', 'lot', 'car', 'car', 'lotCharger', 'lotCharger', 'robot', 'car', 'car'],
    all: null
  };
  function unlock(level) {
    var plan = UNLOCK_PLAN[level];
    if (level === 'all') {
      plan = [];
      for (var i = 0; i < 60; i++) ECON.items.forEach(function (it) { plan.push(it.id); });
    }
    if (!plan) return false;
    plan.forEach(function (id) {
      var it = ECON.itemById[id], c = it.cost(game.s);
      if (c === null || it.req(game.s)) return;
      if (game.s.cash < c) game.s.cash += c - game.s.cash;
      game.buy(id);
    });
    buildShopState();
    return true;
  }
  root.RoboCab = {
    game: game, renderer: R, econ: ECON,
    state: function () { return game.s; },
    buy: tryBuy,
    toggleShop: toggleShop,
    cheat: {
      money: function (n) { game.s.cash += n; },
      unlock: unlock,
      speed: function (m) { speedMult = m; }
    },
    // Fast-forward the simulation synchronously (for tests/screenshots)
    sim: function (seconds) { var n = Math.round(seconds * 30); for (var i = 0; i < n; i++) game.step(1 / 30); R.updateCamera(0, true); R.draw(); updateHud(1); buildShopState(); },
    save: save
  };
  if (params.get('cheat')) { unlock(params.get('cheat')); }
  if (params.get('speed')) { speedMult = Math.max(1, Math.min(16, +params.get('speed') || 1)); }
  root.requestAnimationFrame(frame);
})(window);
