/* RoboCab renderer: camera, world, entities, FX and off-screen arrows. */
(function (root) {
  'use strict';
  var W = root.RC_WORLD, ECON = root.RC_ECON, T = W.T, rr = W.roundRect;

  function Renderer(canvas, game) {
    this.canvas = canvas; this.g = canvas.getContext('2d'); this.game = game;
    this.map = game.world.renderStatic();
    this.cam = { x: game.player.x || 0, y: game.player.y || 0, zoom: 1 };
    this.vw = 0; this.vh = 0; this.dpr = 1;
    var self = this;
    game.onScreen = function (x, y) { return self.onScreen(x, y, 40); };
    this.resize();
  }

  Renderer.prototype.resize = function () {
    var dpr = Math.min(2, root.devicePixelRatio || 1);
    var w = this.canvas.clientWidth || root.innerWidth, h = this.canvas.clientHeight || root.innerHeight;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.vw = w; this.vh = h; this.dpr = dpr;
    this.cam.zoom = Math.max(0.6, Math.min(1.25, Math.min(w, h) / (11 * T)));
  };

  Renderer.prototype.onScreen = function (x, y, m) {
    var z = this.cam.zoom, hw = this.vw / 2 / z, hh = this.vh / 2 / z;
    return x > this.cam.x - hw - m && x < this.cam.x + hw + m && y > this.cam.y - hh - m && y < this.cam.y + hh + m;
  };

  Renderer.prototype.updateCamera = function (dt, snap) {
    var p = this.game.player, z = this.cam.zoom;
    var tx = p.x, ty = p.y;
    var pc = this.game.playerCar();
    if (pc) { tx += Math.cos(pc.angle) * pc.speed * 0.35; ty += Math.sin(pc.angle) * pc.speed * 0.35; }
    var k = snap ? 1 : Math.min(1, dt * 5);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    var hw = this.vw / 2 / z, hh = this.vh / 2 / z, mw = W.COLS * T, mh = W.ROWS * T;
    this.cam.x = hw * 2 >= mw ? mw / 2 : Math.max(hw, Math.min(mw - hw, this.cam.x));
    this.cam.y = hh * 2 >= mh ? mh / 2 : Math.max(hh, Math.min(mh - hh, this.cam.y));
  };

  Renderer.prototype.draw = function () {
    var g = this.g, game = this.game, z = this.cam.zoom, self = this, t = game.time;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#5c8f47'; g.fillRect(0, 0, this.vw, this.vh);
    var sx = game.shake ? (Math.random() - 0.5) * game.shake : 0, sy = game.shake ? (Math.random() - 0.5) * game.shake : 0;
    g.save();
    g.translate(this.vw / 2 + sx, this.vh / 2 + sy); g.scale(z, z); g.translate(-this.cam.x, -this.cam.y);
    // static map (only visible part)
    var hw = this.vw / 2 / z + 2, hh = this.vh / 2 / z + 2;
    var x0 = Math.max(0, this.cam.x - hw), y0 = Math.max(0, this.cam.y - hh);
    var x1 = Math.min(this.map.width, this.cam.x + hw), y1 = Math.min(this.map.height, this.cam.y + hh);
    if (x1 > x0 && y1 > y0) g.drawImage(this.map, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);

    this.drawLot(g, t);
    this.drawGarageCharger(g, t);
    // rider destinations for the player's car, then waiting riders
    var pc = game.playerCar();
    game.passengers.forEach(function (p) {
      if (p.state === 'riding') {
        var mine = pc && p.claimedBy === pc.id;
        if (mine) self.drawDest(g, p, t, true);
      }
    });
    game.passengers.forEach(function (p) { if (p.state === 'waiting') self.drawRider(g, p, t); });
    // cables
    game.cars.forEach(function (c) { if (c.state === 'charging' && c.spot) self.drawCable(g, c, t); });
    if (pc && pc.charging) { var sp = game.spotUnder(pc); if (sp) self.drawCable(g, { x: pc.x, y: pc.y, spot: sp }, t); }
    game.cars.forEach(function (c) { self.drawCar(g, c, t, c === pc); });
    game.robots.forEach(function (r) { self.drawRobot(g, r, t); });
    if (game.player.mode === 'walk') this.drawWalker(g, game.player, t);
    game.cars.forEach(function (c) { self.drawCarBadge(g, c, t, c === pc); });
    this.drawParticles(g);
    this.drawPopups(g);
    g.restore();
    this.drawArrows(g, t);
    this.drawJoystick(g);
  };

  Renderer.prototype.drawLot = function (g, t) {
    var game = this.game, w = game.world, L = W.LOTB, s = game.s;
    var x = L.x0 * T, y = L.y0 * T, sz = 5 * T;
    if (!w.lotOwned) {
      g.fillStyle = '#b8a77f'; rr(g, x + 2, y + 2, sz - 4, sz - 4, 6); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.06)';
      for (var i = 0; i < 18; i++) { g.beginPath(); g.arc(x + 20 + (i * 53) % (sz - 40), y + 20 + (i * 97) % (sz - 40), 6 + (i % 3) * 3, 0, 7); g.fill(); }
      // sign
      var cx = x + sz / 2, cy = y + sz / 2;
      g.fillStyle = '#6b4f2a'; g.fillRect(cx - 3, cy, 6, 34);
      g.fillStyle = '#fff'; rr(g, cx - 70, cy - 40, 140, 52, 8); g.fill();
      g.strokeStyle = '#e04f3a'; g.lineWidth = 4; rr(g, cx - 70, cy - 40, 140, 52, 8); g.stroke();
      g.fillStyle = '#e04f3a'; g.font = 'bold 17px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText('FOR SALE', cx, cy - 18);
      g.fillStyle = '#333'; g.font = '13px system-ui, sans-serif';
      g.fillText(s.selfDriving ? 'Charging lot $1,200' : 'Needs self-driving', cx, cy + 2);
      return;
    }
    g.fillStyle = '#4a505c'; rr(g, x + 1, y + 1, sz - 2, sz - 2, 6); g.fill();
    g.fillStyle = '#6aa65a'; g.fillRect(x + 4, (L.y0 + 4) * T + 10, sz - 8, T - 14); // planter strip
    for (var k = 0; k < 5; k++) { g.fillStyle = '#3f8f3c'; g.beginPath(); g.arc(x + 30 + k * 48, (L.y0 + 4.6) * T, 10, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.font = 'bold 14px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText('ROBOCAB LOT', x + 8, (L.y0 + 2) * T + 5);
    w.spots.forEach(function (sp) {
      if (sp.kind !== 'lot') return;
      var top = sp.angle < 0, sx = sp.x - T / 2 + 3, sy = top ? L.y0 * T + 3 : (L.y0 + 3) * T + 4, sw = T - 6, sh = T * 1.0 - 6;
      g.strokeStyle = sp.active ? '#f4f1e8' : 'rgba(244,241,232,0.35)'; g.lineWidth = 2;
      if (!sp.active) g.setLineDash([5, 5]);
      g.strokeRect(sx, sy, sw, sh); g.setLineDash([]);
      if (sp.active) {
        // charger post
        g.fillStyle = '#1f2937'; rr(g, sp.plugX - 7, sp.plugY - 7, 14, 14, 3); g.fill();
        var busy = sp.car !== null;
        g.fillStyle = busy ? '#ffd23f' : '#4ade80';
        g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 4 + sp.id);
        g.beginPath(); g.arc(sp.plugX, sp.plugY, 3.5, 0, 7); g.fill(); g.globalAlpha = 1;
      } else {
        g.fillStyle = 'rgba(255,255,255,0.3)'; g.font = 'bold 18px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText('+', sp.x, sp.y + 6);
      }
    });
  };

  Renderer.prototype.drawGarageCharger = function (g, t) {
    var sp = this.game.world.spots[0];
    g.fillStyle = '#1f2937'; rr(g, sp.plugX - 7, sp.plugY - 7, 14, 14, 3); g.fill();
    g.fillStyle = sp.car !== null || (this.game.playerCar() && this.game.playerCar().charging) ? '#ffd23f' : '#4ade80';
    g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 4); g.beginPath(); g.arc(sp.plugX, sp.plugY, 3.5, 0, 7); g.fill(); g.globalAlpha = 1;
  };

  Renderer.prototype.drawCable = function (g, c, t) {
    var sp = c.spot;
    g.strokeStyle = '#111827'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(sp.plugX, sp.plugY);
    g.quadraticCurveTo((sp.plugX + c.x) / 2, (sp.plugY + c.y) / 2 + 10, c.x, c.y); g.stroke();
    g.strokeStyle = 'rgba(255,224,102,' + (0.5 + 0.5 * Math.sin(t * 10)) + ')'; g.lineWidth = 1.5; g.stroke();
  };

  Renderer.prototype.drawRider = function (g, p, t) {
    var pop = Math.min(1, p.spawnT * 4), bob = Math.sin(t * 5 + p.bob) * 2;
    var x = p.x, y = p.y;
    g.save(); g.translate(x, y); g.scale(pop, pop);
    // pulse ring
    var pr = 14 + ((t * 1.2 + p.bob) % 1) * 14;
    g.strokeStyle = p.claimedBy !== null ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,' + (0.8 - ((t * 1.2 + p.bob) % 1) * 0.8) + ')';
    g.lineWidth = 2; g.beginPath(); g.arc(0, 0, pr, 0, 7); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(2, 9, 9, 4, 0, 0, 7); g.fill();
    g.fillStyle = p.color; g.beginPath(); g.arc(0, 2 + bob * 0.3, 9, 0, 7); g.fill();
    g.fillStyle = '#ffe0bd'; g.beginPath(); g.arc(0, -8 + bob * 0.3, 6, 0, 7); g.fill();
    // waving arm
    g.strokeStyle = '#ffe0bd'; g.lineWidth = 3; g.beginPath(); g.moveTo(6, 0);
    g.lineTo(13, -9 + Math.sin(t * 9 + p.bob) * 3); g.stroke();
    // fare tag
    if (p.claimedBy === null || this.game.player.mode === 'drive') {
      var label = '$' + p.fare; g.font = 'bold 12px system-ui, sans-serif';
      var tw = g.measureText(label).width + 10;
      g.fillStyle = 'rgba(17,24,39,0.85)'; rr(g, -tw / 2, -34 + bob, tw, 17, 8); g.fill();
      g.fillStyle = '#86efac'; g.textAlign = 'center'; g.fillText(label, 0, -21.5 + bob);
    }
    g.restore();
  };

  Renderer.prototype.drawDest = function (g, p, t, mine) {
    var x = p.dx, y = p.dy;
    g.save(); g.translate(x, y);
    var pr = 16 + Math.sin(t * 4) * 3;
    g.fillStyle = p.color; g.globalAlpha = 0.25; g.beginPath(); g.arc(0, 0, pr + 6, 0, 7); g.fill(); g.globalAlpha = 1;
    g.strokeStyle = p.color; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, pr, 0, 7); g.stroke();
    // flag
    g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.moveTo(-2, 8); g.lineTo(-2, -22); g.stroke();
    g.fillStyle = p.color; g.beginPath(); g.moveTo(-2, -22); g.lineTo(14, -16); g.lineTo(-2, -10); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('DROP $' + p.fare, 0, 26);
    g.restore();
  };

  Renderer.prototype.drawCar = function (g, c, t, isPlayer) {
    var L = 0.66 * T, Wd = 0.38 * T;
    g.save(); g.translate(c.x, c.y); g.rotate(c.angle);
    g.fillStyle = 'rgba(0,0,0,0.28)'; rr(g, -L / 2 + 3, -Wd / 2 + 4, L, Wd, 6); g.fill();
    // wheels
    g.fillStyle = '#111';
    [[-L * 0.3, -Wd / 2 - 1.5], [L * 0.22, -Wd / 2 - 1.5], [-L * 0.3, Wd / 2 - 2.5], [L * 0.22, Wd / 2 - 2.5]].forEach(function (w) { g.fillRect(w[0], w[1], 7, 4); });
    g.fillStyle = W.shade(c.color, -0.2); rr(g, -L / 2, -Wd / 2, L, Wd, 6); g.fill();
    g.fillStyle = c.color; rr(g, -L / 2 + 1.5, -Wd / 2 + 1.5, L - 3, Wd - 3, 5); g.fill();
    // glass
    g.fillStyle = '#26364a'; rr(g, L * 0.06, -Wd / 2 + 3, L * 0.18, Wd - 6, 3); g.fill();
    rr(g, -L * 0.36, -Wd / 2 + 3.5, L * 0.12, Wd - 7, 2); g.fill();
    // roof
    g.fillStyle = W.shade(c.color, 0.25); rr(g, -L * 0.22, -Wd / 2 + 3, L * 0.27, Wd - 6, 3); g.fill();
    if (c.auto) {
      g.fillStyle = '#222'; g.beginPath(); g.arc(-L * 0.085, 0, 4.2, 0, 7); g.fill();
      g.strokeStyle = '#5eead4'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-L * 0.085, 0);
      g.lineTo(-L * 0.085 + Math.cos(c.lidar) * 5, Math.sin(c.lidar) * 5); g.stroke();
    } else {
      g.fillStyle = '#fff'; rr(g, -L * 0.14, -4, 7, 8, 2); g.fill();
      g.fillStyle = '#111'; g.font = 'bold 6px sans-serif'; g.textAlign = 'center';
    }
    // lights
    g.fillStyle = '#fff6b0'; g.fillRect(L / 2 - 3, -Wd / 2 + 2, 3, 4); g.fillRect(L / 2 - 3, Wd / 2 - 6, 3, 4);
    g.fillStyle = '#ff4d4d'; g.fillRect(-L / 2, -Wd / 2 + 2, 2, 4); g.fillRect(-L / 2, Wd / 2 - 6, 2, 4);
    if (isPlayer && c.speed > 40) {
      g.fillStyle = 'rgba(255,246,176,0.12)';
      g.beginPath(); g.moveTo(L / 2, -Wd / 2); g.lineTo(L / 2 + 50, -Wd); g.lineTo(L / 2 + 50, Wd); g.lineTo(L / 2, Wd / 2); g.closePath(); g.fill();
    }
    g.restore();
  };

  // Battery bar + status icon above a car (not rotated)
  Renderer.prototype.drawCarBadge = function (g, c, t, isPlayer) {
    var game = this.game, cap = ECON.stats.batteryCap(game.s), f = Math.max(0, c.battery / cap);
    var x = c.x, y = c.y - 0.55 * T;
    var show = c.auto || f < 0.35 || c.charging;
    if (show) {
      g.fillStyle = 'rgba(17,24,39,0.8)'; rr(g, x - 16, y - 3, 32, 6, 3); g.fill();
      g.fillStyle = f > 0.5 ? '#4ade80' : f > 0.25 ? '#facc15' : '#f87171';
      rr(g, x - 15, y - 2, 30 * f, 4, 2); g.fill();
    }
    if (c.onboard.length) {
      for (var i = 0; i < c.onboard.length; i++) {
        var p = game.riderById(c.onboard[i]);
        g.fillStyle = p ? p.color : '#fff'; g.beginPath(); g.arc(x - (c.onboard.length - 1) * 4 + i * 8, y - 9, 3, 0, 7); g.fill();
      }
    }
    if (c.state === 'waitingPlug') {
      var pulse = 1 + 0.15 * Math.sin(t * 8);
      g.save(); g.translate(x, y - 16); g.scale(pulse, pulse);
      g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(0, 0, 11, 0, 7); g.fill();
      g.strokeStyle = '#7a5b00'; g.lineWidth = 2; g.stroke();
      drawPlug(g, '#3b2f00');
      g.restore();
      var prog = game.plugProgress[c.id] || 0;
      if (prog > 0) {
        g.strokeStyle = '#22c55e'; g.lineWidth = 4; g.beginPath();
        g.arc(x, y - 16, 15, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); g.stroke();
      }
    } else if (c.state === 'charging' || c.charging) {
      g.save(); g.translate(x, y - 14);
      g.fillStyle = 'rgba(17,24,39,0.85)'; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill();
      drawBolt(g, '#ffe066', 0.9 + 0.1 * Math.sin(t * 10));
      g.restore();
    }
  };

  function drawBolt(g, color, s) {
    g.save(); g.scale(s, s); g.fillStyle = color; g.beginPath();
    g.moveTo(2, -7); g.lineTo(-4, 1); g.lineTo(0, 1); g.lineTo(-2, 7); g.lineTo(4, -1); g.lineTo(0, -1); g.closePath(); g.fill();
    g.restore();
  }
  function drawPlug(g, color) {
    g.fillStyle = color; rr(g, -5, -3, 10, 7, 2); g.fill();
    g.fillRect(-3, -7, 2, 4); g.fillRect(1, -7, 2, 4); g.fillRect(-1, 4, 2, 4);
  }

  Renderer.prototype.drawRobot = function (g, r, t) {
    var bob = Math.sin(r.walk) * 1.5;
    g.save(); g.translate(r.x, r.y + bob);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(2, 12 - bob, 12, 5, 0, 0, 7); g.fill();
    g.fillStyle = '#cbd5e1'; rr(g, -11, -10, 22, 20, 6); g.fill();
    g.fillStyle = '#94a3b8'; rr(g, -11, 4, 22, 6, 3); g.fill();
    g.fillStyle = '#0f172a'; rr(g, -7, -6, 14, 7, 3); g.fill();
    g.fillStyle = r.target !== null ? '#facc15' : '#22d3ee';
    g.beginPath(); g.arc(-3, -2.5, 1.8, 0, 7); g.arc(3, -2.5, 1.8, 0, 7); g.fill();
    g.strokeStyle = '#64748b'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -10); g.lineTo(0, -16); g.stroke();
    g.fillStyle = '#ef4444'; g.beginPath(); g.arc(0, -17, 2.5, 0, 7); g.fill();
    if (r.plugT > 0) {
      g.strokeStyle = '#facc15'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 16, -Math.PI / 2, -Math.PI / 2 + (r.plugT / 0.6) * Math.PI * 2); g.stroke();
    }
    g.restore();
  };

  Renderer.prototype.drawWalker = function (g, p, t) {
    var bob = Math.sin((p.walk || 0) * 6) * 1.5;
    g.save(); g.translate(p.x, p.y);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(2, 10, 9, 4, 0, 0, 7); g.fill();
    g.fillStyle = '#2563eb'; g.beginPath(); g.arc(0, 2 + bob * 0.3, 9, 0, 7); g.fill();
    g.fillStyle = '#facc15'; g.fillRect(-9, -1 + bob * 0.3, 18, 3); // hi-vis stripe
    g.fillStyle = '#ffd7b0'; g.beginPath(); g.arc(0, -9, 6.5, 0, 7); g.fill();
    g.fillStyle = '#f59e0b'; g.beginPath(); g.arc(0, -11, 6.5, Math.PI, 0); g.fill(); // hard hat
    g.fillStyle = '#fff'; g.font = 'bold 10px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('YOU', 0, 24);
    g.restore();
  };

  Renderer.prototype.drawParticles = function (g) {
    this.game.particles.forEach(function (p) {
      var a = Math.max(0, Math.min(1, p.life / 0.4));
      g.globalAlpha = a; g.fillStyle = p.color;
      if (p.kind === 'confetti') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.size, -p.size / 2, p.size * 2, p.size); g.restore(); }
      else if (p.kind === 'coin') { g.beginPath(); g.arc(p.x, p.y, p.size, 0, 7); g.fill(); g.fillStyle = '#b8860b'; g.fillRect(p.x - 0.8, p.y - p.size * 0.5, 1.6, p.size); }
      else { g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    });
    g.globalAlpha = 1;
  };

  Renderer.prototype.drawPopups = function (g) {
    this.game.popups.forEach(function (p) {
      var age = p.max - p.life, pop = age < 0.15 ? 0.6 + age / 0.15 * 0.6 : 1.2 - Math.min(0.2, (age - 0.15));
      g.save(); g.translate(p.x, p.y); g.scale(pop * p.scale, pop * p.scale);
      g.globalAlpha = Math.min(1, p.life / 0.4);
      g.font = 'bold 16px system-ui, sans-serif'; g.textAlign = 'center';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(p.text, 0, 0);
      g.fillStyle = p.color; g.fillText(p.text, 0, 0);
      g.restore();
    });
    g.globalAlpha = 1;
  };

  // Edge-of-screen arrows pointing at what matters right now.
  Renderer.prototype.drawArrows = function (g, t) {
    var game = this.game, self = this, targets = [], st = ECON.stats, s = game.s;
    var pc = game.playerCar();
    if (pc) {
      pc.onboard.forEach(function (id) { var p = game.riderById(id); if (p) targets.push({ x: p.dx, y: p.dy, color: p.color, label: 'DROP' }); });
      if (pc.onboard.length < st.seats(s)) {
        var best = null, bd = 1e9;
        game.passengers.forEach(function (p) { if (p.state !== 'waiting') return; var d = Math.hypot(p.x - pc.x, p.y - pc.y); if (d < bd) { bd = d; best = p; } });
        if (best) targets.push({ x: best.x, y: best.y, color: '#22c55e', label: 'RIDER' });
      }
      if (pc.battery < st.batteryCap(s) * 0.25) { var sp = game.world.spots[0]; targets.push({ x: sp.x, y: sp.y, color: '#facc15', label: 'CHARGE' }); }
    } else {
      game.cars.forEach(function (c) { if (c.state === 'waitingPlug') targets.push({ x: c.x, y: c.y, color: '#facc15', label: 'PLUG' }); });
    }
    // keep arrows inside a safe rect that avoids the HUD panels
    var z = this.cam.zoom, small = this.vw < 760;
    var L = 30, Rt = this.vw - 30, Tp = small ? 220 : 140, Bt = this.vh - (small ? 190 : 150);
    var rcx = (L + Rt) / 2, rcy = (Tp + Bt) / 2, hwR = (Rt - L) / 2, hhR = Math.max(20, (Bt - Tp) / 2);
    targets.forEach(function (tg) {
      if (self.onScreen(tg.x, tg.y, -20)) return;
      var px = self.vw / 2 + (tg.x - self.cam.x) * z, py = self.vh / 2 + (tg.y - self.cam.y) * z;
      var dx = px - rcx, dy = py - rcy;
      var k = Math.min(hwR / Math.abs(dx || 1e-6), hhR / Math.abs(dy || 1e-6));
      var ax = rcx + dx * k, ay = rcy + dy * k, a = Math.atan2(dy, dx);
      g.save(); g.translate(ax, ay);
      g.fillStyle = 'rgba(17,24,39,0.75)'; g.beginPath(); g.arc(0, 0, 18, 0, 7); g.fill();
      g.rotate(a); g.fillStyle = tg.color; g.beginPath(); g.moveTo(14, 0); g.lineTo(-6, -9); g.lineTo(-2, 0); g.lineTo(-6, 9); g.closePath(); g.fill();
      g.restore();
      g.fillStyle = tg.color; g.font = 'bold 10px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText(tg.label, ax, ay + 30);
    });
  };

  Renderer.prototype.drawJoystick = function (g) {
    var j = this.game.input.joy;
    if (!j || !j.active) return;
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.arc(j.ox, j.oy, 55, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(j.ox + j.x * j.mag * 50, j.oy + j.y * j.mag * 50, 24, 0, 7); g.fill();
  };

  root.RC_RENDER = { Renderer: Renderer };
})(typeof window !== 'undefined' ? window : this);
