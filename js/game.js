/* RoboCab core simulation: cars, riders, charging, robots. No DOM here except via hooks. */
(function (root) {
  'use strict';
  var ECON = root.RC_ECON, W = root.RC_WORLD, SFX = root.RC_SFX;
  var T = W.T;
  var CAR_COLORS = ['#f5c518', '#4fc3f7', '#ff8a65', '#81c784', '#ba68c8', '#f06292', '#ffb74d', '#4db6ac', '#9575cd', '#e57373', '#aed581', '#64b5f6'];
  var RIDER_COLORS = ['#22c55e', '#06b6d4', '#a855f7', '#ef4444', '#f97316', '#ec4899', '#3b82f6', '#eab308'];

  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function angDiff(a, b) { var d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
  function approachAngle(a, b, step) { var d = angDiff(a, b); return Math.abs(d) <= step ? b : a + Math.sign(d) * step; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function Game(state) {
    this.s = ECON.normalize(state);
    this.world = new W.World();
    this.cars = []; this.passengers = []; this.robots = []; this.particles = []; this.popups = [];
    this.time = 0; this.nextPid = 1; this.spawnT = 0; this.incomeLog = [];
    this.player = { mode: 'drive', carId: 0, x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
    this.plugProgress = {};
    this.shake = 0; this.cashSoundT = 0; this.bumpT = 0;
    this.hooks = { toast: function () {}, goal: function () {}, purchased: function () {} };
    this.input = { thr: 0, steer: 0, joy: null };
    this.lastGoal = ECON.currentGoal(this.s).id;
    this.setup();
  }

  Game.prototype.stats = function () {
    var s = this.s, st = ECON.stats;
    return { speed: st.speed(s) * T, cap: st.batteryCap(s), drain: st.drainPerTile(s), seats: st.seats(s),
      rate: st.chargeRate(s), robotSpeed: st.robotSpeed(s) * T };
  };

  // ---- Setup -----------------------------------------------------------------
  Game.prototype.setup = function () {
    var s = this.s, w = this.world, self = this;
    w.setLot(s.lot, s.chargers);
    this.cars = []; this.robots = [];
    w.spots.forEach(function (sp) { sp.car = null; });
    for (var i = 0; i < s.cars; i++) this.makeCar(i);
    var garage = w.spots[0];
    if (!s.selfDriving) {
      var c = this.cars[0];
      c.auto = false; c.x = garage.x; c.y = garage.y; c.angle = Math.PI;
      this.player.mode = 'drive'; this.player.carId = c.id;
    } else {
      this.cars.forEach(function (car) {
        car.auto = true;
        var sp = self.freeSpot(car);
        if (sp) { self.parkAt(car, sp); car.state = 'idle'; }
        else { var r = w.center(W.LOT_ROAD.x, 8 + (car.id % 5)); car.x = r.x; car.y = r.y; car.angle = Math.PI / 2; car.state = 'idle'; }
      });
      this.player.mode = 'walk';
      this.player.x = (W.GARAGE_TILE.x + 0.5) * T; this.player.y = (W.GARAGE_TILE.y + 1.5) * T;
    }
    for (var r = 0; r < s.robots; r++) this.makeRobot();
    this.passengers = [];
    for (var k = 0; k < this.targetRiders(); k++) this.spawnRider();
  };

  Game.prototype.makeCar = function (i) {
    var cap = ECON.stats.batteryCap(this.s);
    var lr = this.world.center(W.LOT_ROAD.x, W.LOT_ROAD.y);
    var c = { id: i, x: lr.x, y: lr.y, angle: Math.PI / 2, speed: 0, battery: cap, onboard: [], auto: true,
      state: 'idle', wp: [], target: null, spot: null, reserved: null, color: CAR_COLORS[i % CAR_COLORS.length],
      replanT: Math.random() * 0.5, lidar: Math.random() * 6, charging: false, wasFull: true };
    this.cars.push(c);
    return c;
  };

  Game.prototype.makeRobot = function () {
    var i = this.robots.length;
    var dock = { x: 19.5 * T, y: (i === 0 ? 16.5 : 13.5) * T };
    var r = { id: i, x: dock.x, y: dock.y, dock: dock, target: null, plugT: 0, angle: 0, walk: 0 };
    this.robots.push(r);
    return r;
  };

  Game.prototype.carById = function (id) { for (var i = 0; i < this.cars.length; i++) if (this.cars[i].id === id) return this.cars[i]; return null; };
  Game.prototype.riderById = function (id) { for (var i = 0; i < this.passengers.length; i++) if (this.passengers[i].id === id) return this.passengers[i]; return null; };
  Game.prototype.playerCar = function () { return this.player.mode === 'drive' ? this.carById(this.player.carId) : null; };

  // ---- Riders ----------------------------------------------------------------
  Game.prototype.targetRiders = function () {
    return this.s.selfDriving ? Math.min(4 + this.s.cars * 2, 22) : 4;
  };

  Game.prototype.spawnRider = function () {
    var curbs = this.world.curbTiles(), self = this;
    for (var tries = 0; tries < 30; tries++) {
      var a = curbs[Math.floor(Math.random() * curbs.length)];
      var taken = this.passengers.some(function (p) { return (p.tile.x === a.x && p.tile.y === a.y) || (p.dest.x === a.x && p.dest.y === a.y); });
      if (taken) continue;
      // avoid spawning right under the player's car
      var pc = this.playerCar();
      if (pc && dist(pc.x, pc.y, (a.x + 0.5) * T, (a.y + 0.5) * T) < 2 * T) continue;
      var b = null;
      for (var t2 = 0; t2 < 30; t2++) {
        var cand = curbs[Math.floor(Math.random() * curbs.length)];
        var md = Math.abs(cand.x - a.x) + Math.abs(cand.y - a.y);
        if (md >= 7 && md <= 30) { b = cand; break; }
      }
      if (!b) continue;
      var md2 = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      var p = {
        id: this.nextPid++, tile: { x: a.x, y: a.y }, dest: { x: b.x, y: b.y },
        x: (a.x + 0.5 + a.sx * 0.4) * T, y: (a.y + 0.5 + a.sy * 0.4) * T,
        dx: (b.x + 0.5 + b.sx * 0.4) * T, dy: (b.y + 0.5 + b.sy * 0.4) * T,
        fare: ECON.fare(md2, this.s), color: RIDER_COLORS[this.nextPid % RIDER_COLORS.length],
        state: 'waiting', claimedBy: null, age: 0, bob: Math.random() * 6, spawnT: 0
      };
      this.passengers.push(p);
      return p;
    }
    return null;
  };

  Game.prototype.pickup = function (c, p) {
    if (p.claimedBy !== null && p.claimedBy !== c.id) {
      var other = this.carById(p.claimedBy);
      if (other && other.target === p.id) { other.target = null; other.wp = []; other.state = 'idle'; other.replanT = 0; }
    }
    p.state = 'riding'; p.claimedBy = c.id; c.onboard.push(p.id);
    this.popup(p.x, p.y - 20, 'Picked up!', '#ffffff', 0.9);
    this.burst(p.x, p.y, p.color, 10, 'confetti');
    if (!c.auto || this.onScreen(p.x, p.y)) SFX.pickup();
  };

  Game.prototype.dropoff = function (c, p) {
    c.onboard = c.onboard.filter(function (id) { return id !== p.id; });
    this.passengers = this.passengers.filter(function (q) { return q !== p; });
    ECON.earn(this.s, p.fare);
    this.s.trips++;
    this.incomeLog.push({ t: this.time, amt: p.fare });
    this.popup(c.x, c.y - 26, '+$' + p.fare, '#7CFC8A', 1.4);
    this.burst(c.x, c.y, '#ffd54a', 14, 'coin');
    if (this.cashSoundT <= 0 && (!c.auto || this.onScreen(c.x, c.y))) { SFX.cash(p.fare >= 60); this.cashSoundT = 0.15; }
  };

  // ---- Spots / charging -------------------------------------------------------
  Game.prototype.freeSpot = function (c) {
    var best = null, bd = 1e9;
    this.world.spots.forEach(function (sp) {
      if (!sp.active || sp.car !== null) return;
      var d = dist(c.x, c.y, sp.x, sp.y) + (sp.kind === 'garage' ? 0 : 1);
      if (d < bd) { bd = d; best = sp; }
    });
    return best;
  };
  Game.prototype.parkAt = function (c, sp) {
    sp.car = c.id; c.spot = sp; c.x = sp.x; c.y = sp.y; c.angle = sp.angle; c.speed = 0; c.wp = [];
  };
  Game.prototype.leaveSpot = function (c) {
    if (c.spot) { if (c.spot.car === c.id) c.spot.car = null; c.spot = null; }
  };

  Game.prototype.plug = function (c, by) {
    if (c.state !== 'waitingPlug') return;
    c.state = 'charging'; c.plugged = true;
    delete this.plugProgress[c.id];
    this.burst(c.spot ? c.spot.plugX : c.x, c.spot ? c.spot.plugY : c.y, '#ffe066', 12, 'spark');
    this.popup(c.x, c.y - 24, by === 'robot' ? 'Robot plugged in' : 'Plugged in!', '#ffe066', 1.0);
    if (by !== 'robot' || this.onScreen(c.x, c.y)) SFX.plug();
  };

  // ---- Routing ------------------------------------------------------------------
  Game.prototype.routeTo = function (c, tile, extra) {
    var w = this.world, pts = [], start;
    if (c.spot) { pts = c.spot.exit.map(function (p) { return { x: p.x, y: p.y }; }); start = c.spot.roadTile; }
    else {
      start = w.tileOf(c.x, c.y);
      if (!w.isRoad(start.x, start.y)) start = w.nearestRoad(c.x, c.y);
    }
    var path = w.path(start.x, start.y, tile.x, tile.y);
    if (!path) return false;
    this.leaveSpot(c);
    var wps = w.waypoints(path);
    if (!pts.length && wps.length > 1 && dist(c.x, c.y, wps[1].x, wps[1].y) < dist(wps[0].x, wps[0].y, wps[1].x, wps[1].y)) wps.shift();
    c.wp = pts.concat(wps, extra || []);
    return true;
  };

  Game.prototype.goCharge = function (c) {
    if (c.spot) { c.state = c.battery >= this.stats().cap * 0.99 ? 'idle' : 'waitingPlug'; return c.state === 'waitingPlug'; }
    var sp = this.freeSpot(c);
    if (!sp) return false;
    sp.car = c.id; c.reserved = sp;
    if (!this.routeTo(c, sp.roadTile, sp.entry.map(function (p) { return { x: p.x, y: p.y }; }))) { sp.car = null; c.reserved = null; return false; }
    c.state = 'toCharge';
    return true;
  };

  Game.prototype.plan = function (c) {
    var st = this.stats(), self = this;
    c.target = null;
    if (c.onboard.length === 0 && c.battery < st.cap * 0.28 && this.goCharge(c)) return;
    if (c.onboard.length === 0 && c.battery < st.cap * 0.08) { c.state = 'idle'; c.replanT = 1; return; } // stranded until a spot opens
    if (c.onboard.length < st.seats) {
      var range = c.onboard.length > 0 ? 7 : 1e9, ct = this.world.tileOf(c.x, c.y), best = null, bd = 1e9;
      this.passengers.forEach(function (p) {
        if (p.state !== 'waiting' || p.claimedBy !== null) return;
        var d = Math.abs(p.tile.x - ct.x) + Math.abs(p.tile.y - ct.y);
        if (d < bd && d <= range) { bd = d; best = p; }
      });
      if (best && this.routeTo(c, best.tile)) { best.claimedBy = c.id; c.target = best.id; c.state = 'toPickup'; return; }
    }
    if (c.onboard.length > 0) {
      var ct2 = this.world.tileOf(c.x, c.y), bp = null, bd2 = 1e9;
      c.onboard.forEach(function (id) {
        var p = self.riderById(id); if (!p) return;
        var d = Math.abs(p.dest.x - ct2.x) + Math.abs(p.dest.y - ct2.y);
        if (d < bd2) { bd2 = d; bp = p; }
      });
      if (bp && this.routeTo(c, bp.dest)) { c.target = bp.id; c.state = 'toDrop'; return; }
    }
    if (c.battery < st.cap * 0.75 && this.goCharge(c)) return;
    c.state = 'idle'; c.replanT = 0.6;
  };

  // ---- Per-frame updates --------------------------------------------------------
  Game.prototype.step = function (dt) {
    this.time += dt;
    this.cashSoundT -= dt; this.bumpT -= dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    var self = this;
    this.updatePlayer(dt);
    this.cars.forEach(function (c) { if (c.auto) self.updateAutoCar(c, dt); });
    this.robots.forEach(function (r) { self.updateRobot(r, dt); });
    this.updateRiders(dt);
    this.updateFx(dt);
    // goals
    var g = ECON.currentGoal(this.s);
    if (g.id !== this.lastGoal) { this.lastGoal = g.id; this.hooks.goal(g); }
    // trim income log
    while (this.incomeLog.length && this.incomeLog[0].t < this.time - 60) this.incomeLog.shift();
  };

  Game.prototype.incomePerMin = function () {
    var span = Math.min(60, Math.max(10, this.time));
    var sum = 0; this.incomeLog.forEach(function (e) { sum += e.amt; });
    return sum * 60 / span;
  };

  Game.prototype.updateRiders = function (dt) {
    var self = this;
    this.passengers.forEach(function (p) { p.age += dt; p.spawnT += dt; });
    // impatient unclaimed riders eventually leave so the map refreshes
    this.passengers = this.passengers.filter(function (p) {
      if (p.state === 'waiting' && p.claimedBy === null && p.age > 150) { self.popup(p.x, p.y - 10, 'bye!', '#ddd', 0.8); return false; }
      return true;
    });
    this.spawnT -= dt;
    var waiting = this.passengers.filter(function (p) { return p.state === 'waiting'; }).length;
    if (waiting < this.targetRiders() && this.spawnT <= 0) { this.spawnRider(); this.spawnT = this.s.selfDriving ? 0.6 : 1.2; }
  };

  Game.prototype.updatePlayer = function (dt) {
    var p = this.player, w = this.world, inp = this.input, st = this.stats();
    if (p.mode === 'drive') {
      var c = this.carById(p.carId); if (!c) return;
      var maxV = st.speed * (c.battery <= 0 ? 0.35 : 1);
      var thr = inp.thr, steer = inp.steer;
      if (inp.joy && inp.joy.mag > 0.15) {
        var ta = Math.atan2(inp.joy.y, inp.joy.x), d = angDiff(c.angle, ta);
        steer = Math.max(-1, Math.min(1, d * 2.2));
        thr = inp.joy.mag * (Math.abs(d) > 2.4 && c.speed < 30 ? -0.6 : 1);
        if (Math.abs(d) > 2.4 && c.speed < 30) steer = -steer;
      }
      var accel = maxV * 1.5;
      if (thr > 0) c.speed += thr * accel * dt * (c.speed < 0 ? 2.5 : 1);
      else if (thr < 0) c.speed += thr * accel * dt * (c.speed > 0 ? 2.5 : 0.8);
      else c.speed *= Math.max(0, 1 - 2.2 * dt);
      c.speed = Math.max(-maxV * 0.45, Math.min(maxV, c.speed));
      var turnFactor = Math.max(-1, Math.min(1, c.speed / (maxV * 0.25 + 1)));
      c.angle += steer * 3.4 * dt * turnFactor;
      var mx = Math.cos(c.angle) * c.speed * dt, my = Math.sin(c.angle) * c.speed * dt;
      var moved = this.tryMove(c, mx, my, function (x, y) { return w.drivableAt(x, y); }, 0.24 * T);
      if (!moved.full) {
        if (Math.abs(c.speed) > maxV * 0.45 && this.bumpT <= 0) { SFX.bump(); this.shake = 6; this.bumpT = 0.4; }
        c.speed *= moved.any ? 0.85 : -0.25;
      }
      c.battery = Math.max(0, c.battery - (moved.d / T) * st.drain);
      // charging when parked on the home pad (or an active lot charger)
      var spot = this.spotUnder(c);
      c.charging = !!spot && Math.abs(c.speed) < 25 && c.battery < st.cap;
      if (c.charging) {
        c.battery = Math.min(st.cap, c.battery + st.rate * dt);
        if (Math.random() < dt * 8) this.burst(spot.plugX, spot.plugY, '#ffe066', 1, 'spark');
        if (c.battery >= st.cap) { SFX.full(); this.popup(c.x, c.y - 24, 'Fully charged', '#7fe3ff', 1); }
      }
      // riders
      var self = this, seats = st.seats;
      if (Math.abs(c.speed) < maxV * 0.8) {
        this.passengers.slice().forEach(function (q) {
          if (q.state === 'waiting' && c.onboard.length < seats && dist(c.x, c.y, q.x, q.y) < 0.85 * T) self.pickup(c, q);
          else if (q.state === 'riding' && q.claimedBy === c.id && dist(c.x, c.y, q.dx, q.dy) < 0.95 * T) self.dropoff(c, q);
        });
      }
      p.x = c.x; p.y = c.y; p.angle = c.angle;
    } else {
      var spd = 3.6 * T, vx = 0, vy = 0;
      if (inp.joy && inp.joy.mag > 0.1) { vx = inp.joy.x * inp.joy.mag; vy = inp.joy.y * inp.joy.mag; }
      else { vx = inp.walkX || 0; vy = inp.walkY || 0; var l = Math.hypot(vx, vy); if (l > 1) { vx /= l; vy /= l; } }
      var r = this.tryMove(p, vx * spd * dt, vy * spd * dt, function (x, y) { return w.walkableAt(x, y); }, 0.15 * T);
      if (r.d > 0.1) { p.angle = Math.atan2(vy, vx); p.walk = (p.walk || 0) + r.d * 0.08; }
      // auto-plug nearby cars
      var self2 = this;
      this.cars.forEach(function (car) {
        if (car.state !== 'waitingPlug') return;
        var tx = car.spot ? car.spot.plugX : car.x, ty = car.spot ? car.spot.plugY : car.y;
        var near = dist(p.x, p.y, car.x, car.y) < 0.9 * T || dist(p.x, p.y, tx, ty) < 0.7 * T;
        if (near) {
          self2.plugProgress[car.id] = (self2.plugProgress[car.id] || 0) + dt / 0.45;
          if (self2.plugProgress[car.id] >= 1) self2.plug(car, 'player');
        } else if (self2.plugProgress[car.id]) {
          self2.plugProgress[car.id] = Math.max(0, self2.plugProgress[car.id] - dt * 3);
        }
      });
    }
  };

  // Axis-separated movement with a small collision radius. Returns {full, any, d}.
  Game.prototype.tryMove = function (e, mx, my, ok, rad) {
    function fits(x, y) { return ok(x + rad, y) && ok(x - rad, y) && ok(x, y + rad) && ok(x, y - rad) && ok(x, y); }
    var ox = e.x, oy = e.y;
    if (fits(e.x + mx, e.y + my)) { e.x += mx; e.y += my; return { full: true, any: true, d: Math.hypot(mx, my) }; }
    var any = false;
    if (fits(e.x + mx, e.y)) { e.x += mx; any = true; }
    else if (fits(e.x, e.y + my)) { e.y += my; any = true; }
    return { full: false, any: any, d: Math.hypot(e.x - ox, e.y - oy) };
  };

  Game.prototype.spotUnder = function (c) {
    var best = null;
    this.world.spots.forEach(function (sp) {
      if (!sp.active) return;
      if ((sp.car === null || sp.car === c.id) && dist(c.x, c.y, sp.x, sp.y) < 0.5 * T) best = sp;
    });
    return best;
  };

  Game.prototype.updateAutoCar = function (c, dt) {
    var st = this.stats();
    c.lidar += dt * 6;
    if (c.state === 'charging') {
      c.battery = Math.min(st.cap, c.battery + st.rate * dt);
      if (Math.random() < dt * 6 && c.spot) this.burst(c.spot.plugX, c.spot.plugY, '#ffe066', 1, 'spark');
      if (c.battery >= st.cap - 1e-6) {
        c.plugged = false; c.state = 'idle'; c.replanT = 0.3;
        this.popup(c.x, c.y - 24, 'Full!', '#7fe3ff', 0.8);
      }
      return;
    }
    if (c.state === 'waitingPlug') {
      if (c.spot) c.angle = approachAngle(c.angle, c.spot.angle, 6 * dt);
      return;
    }
    if (c.state === 'toPickup') {
      var p = this.riderById(c.target);
      if (!p || p.state !== 'waiting' || p.claimedBy !== c.id) { c.wp = []; c.state = 'idle'; c.replanT = 0; }
    }
    if (c.wp.length) { this.moveAlong(c, dt, st); return; }
    // arrived
    var self = this;
    if (c.state === 'toPickup') {
      var q = this.riderById(c.target);
      if (q && q.state === 'waiting' && dist(c.x, c.y, q.x, q.y) < 1.4 * T) this.pickup(c, q);
      this.plan(c);
    } else if (c.state === 'toDrop') {
      c.onboard.slice().forEach(function (id) {
        var r = self.riderById(id);
        if (r && dist(c.x, c.y, r.dx, r.dy) < 1.4 * T) self.dropoff(c, r);
      });
      this.plan(c);
    } else if (c.state === 'toCharge') {
      var sp = c.reserved; c.reserved = null;
      if (sp) { sp.car = c.id; c.spot = sp; }
      c.speed = 0;
      if (c.battery >= st.cap * 0.99) { c.state = 'idle'; c.replanT = 0.2; }
      else { c.state = 'waitingPlug'; this.popup(c.x, c.y - 24, 'Plug me in!', '#ffe066', 1.0); }
    } else {
      c.speed = 0;
      c.replanT -= dt;
      if (c.replanT <= 0) this.plan(c);
    }
  };

  Game.prototype.moveAlong = function (c, dt, st) {
    var maxV = st.speed * (c.battery <= 0 ? 0.35 : 1);
    c.speed = Math.min(maxV, c.speed + maxV * 2 * dt);
    var budget = c.speed * dt, moved = 0;
    while (budget > 0 && c.wp.length) {
      var tgt = c.wp[0], dx = tgt.x - c.x, dy = tgt.y - c.y, d = Math.hypot(dx, dy);
      if (d > 0.5) c.angle = approachAngle(c.angle, Math.atan2(dy, dx), 10 * dt);
      if (budget >= d) { c.x = tgt.x; c.y = tgt.y; c.wp.shift(); budget -= d; moved += d; }
      else { c.x += dx / d * budget; c.y += dy / d * budget; moved += budget; budget = 0; }
    }
    if (!c.wp.length) c.speed = 0;
    c.battery = Math.max(0, c.battery - (moved / T) * st.drain);
  };

  Game.prototype.updateRobot = function (r, dt) {
    var st = this.stats(), self = this;
    var car = r.target !== null ? this.carById(r.target) : null;
    if (car && car.state !== 'waitingPlug') { car = null; r.target = null; r.plugT = 0; }
    if (!car) {
      var best = null, bd = 1e9;
      this.cars.forEach(function (c) {
        if (c.state !== 'waitingPlug' || !c.spot) return;
        if (self.robots.some(function (o) { return o !== r && o.target === c.id; })) return;
        var d = dist(r.x, r.y, c.spot.plugX, c.spot.plugY);
        if (d < bd) { bd = d; best = c; }
      });
      if (best) { r.target = best.id; car = best; r.plugT = 0; }
    }
    var gx = car ? car.spot.plugX : r.dock.x, gy = car ? car.spot.plugY : r.dock.y;
    var dx = gx - r.x, dy = gy - r.y, d = Math.hypot(dx, dy), step = st.robotSpeed * dt;
    if (d > 2) {
      r.angle = Math.atan2(dy, dx); r.walk += dt * 10;
      if (step >= d) { r.x = gx; r.y = gy; } else { r.x += dx / d * step; r.y += dy / d * step; }
    } else if (car) {
      r.plugT += dt;
      if (r.plugT >= 0.6) { this.plug(car, 'robot'); r.target = null; r.plugT = 0; }
    }
  };

  // ---- FX -------------------------------------------------------------------
  Game.prototype.popup = function (x, y, text, color, scale) {
    this.popups.push({ x: x, y: y, text: text, color: color || '#fff', life: 1.3, max: 1.3, scale: scale || 1 });
  };
  Game.prototype.burst = function (x, y, color, n, kind) {
    var confetti = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'];
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = kind === 'spark' ? rand(30, 90) : rand(60, 180);
      this.particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'coin' ? 60 : 0),
        life: kind === 'spark' ? rand(0.2, 0.45) : rand(0.6, 1.0), max: 1, kind: kind,
        color: kind === 'confetti' ? confetti[i % confetti.length] : color, size: kind === 'coin' ? rand(3, 5) : rand(2, 4), rot: Math.random() * 6 });
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  };
  Game.prototype.updateFx = function (dt) {
    this.particles.forEach(function (p) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= (1 - 2.5 * dt); p.vy *= (1 - 2.5 * dt);
      if (p.kind === 'coin') p.vy += 120 * dt;
      p.life -= dt; p.rot += dt * 8;
    });
    this.particles = this.particles.filter(function (p) { return p.life > 0; });
    this.popups.forEach(function (p) { p.y -= 34 * dt; p.life -= dt; });
    this.popups = this.popups.filter(function (p) { return p.life > 0; });
  };
  Game.prototype.onScreen = function () { return true; }; // replaced by renderer

  // ---- Purchases ----------------------------------------------------------------
  Game.prototype.buy = function (id) {
    var r = ECON.buy(this.s, id);
    if (!r.ok) return r;
    this.applyPurchase(id);
    return r;
  };

  Game.prototype.applyPurchase = function (id) {
    var s = this.s, w = this.world, st = this.stats(), self = this;
    if (id === 'selfDriving') {
      var c = this.cars[0];
      c.auto = true; c.speed = 0; c.wp = [];
      var sp = this.spotUnder(c);
      if (sp) { this.parkAt(c, sp); c.state = c.battery < st.cap * 0.99 ? 'waitingPlug' : 'idle'; }
      else c.state = 'idle';
      c.replanT = 0.5;
      this.player.mode = 'walk';
      // step out next to the car on something walkable
      var px = c.x, py = c.y;
      [[0, 0.7], [0, -0.7], [0.7, 0], [-0.7, 0]].some(function (o) {
        if (w.walkableAt(c.x + o[0] * T, c.y + o[1] * T)) { px = c.x + o[0] * T; py = c.y + o[1] * T; return true; }
        return false;
      });
      this.player.x = px; this.player.y = py;
      this.hooks.toast('Self-driving online! Your cab works on its own now. Walk over and plug it in when it parks.');
    } else if (id === 'lot') {
      w.setLot(true, s.chargers);
      this.hooks.toast('You bought the lot! ' + s.chargers + ' chargers are ready.');
    } else if (id === 'lotCharger') {
      w.setLot(true, s.chargers);
      // any car waiting for a spot will find it on its next plan
    } else if (id === 'car') {
      var nc = this.makeCar(this.cars.length);
      nc.replanT = 0.2;
      this.burst(nc.x, nc.y, '#fff', 20, 'confetti');
      this.hooks.toast('New robo cab on the road! Fleet: ' + s.cars);
    } else if (id === 'robot') {
      var r = this.makeRobot();
      this.burst(r.x, r.y, '#fff', 20, 'confetti');
      this.hooks.toast(s.robots === 1 ? 'Your plug-in robot reports for duty.' : 'Robot #2 joins the crew.');
    } else if (id === 'battery') {
      // new capacity: top up proportionally so the bar doesn't look emptier
      this.cars.forEach(function (c) { c.battery = Math.min(st.cap, c.battery * st.cap / (10 * (1 + 0.6 * (s.up.battery - 1)))); });
    }
    this.hooks.purchased(id);
    void self;
  };

  root.RC_GAME = { Game: Game, dist: dist, angDiff: angDiff };
})(typeof window !== 'undefined' ? window : this);
