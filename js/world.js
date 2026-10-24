/* RoboCab world: city grid, tiles, pathfinding, parking spots, static map art. */
(function (root) {
  'use strict';

  var T = 48;            // tile size in world pixels
  var COLS = 37, ROWS = 31;
  var BLOCK = 6;         // road every 6 tiles -> 5x5 blocks

  var GRASS = 0, ROAD = 1, BUILDING = 2, GARAGE = 3, LOT = 4, YARD = 5, PARK = 6;

  // Home block (bx=2,by=2) tiles x13..17 y13..17; lot block (bx=3,by=2) tiles x19..23 y13..17
  var HOME = { x0: 13, y0: 13, x1: 17, y1: 17 };
  var LOTB = { x0: 19, y0: 13, x1: 23, y1: 17 };
  var GARAGE_TILE = { x: 17, y: 15 };
  var GARAGE_ROAD = { x: 18, y: 15 };
  var LOT_ROAD = { x: 18, y: 14 };     // lot entrance from road x=18
  var AISLE_Y = 14.5 + 0.5;            // aisle runs between tiles y14 and y15 (centre line at y=15.0 tiles)

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function World() {
    this.T = T; this.COLS = COLS; this.ROWS = ROWS;
    this.tiles = new Uint8Array(COLS * ROWS);
    this.blocks = [];
    this.lotOwned = false;
    this.rng = mulberry32(1337);
    this.generate();
    this.buildSpots();
  }

  World.prototype.idx = function (x, y) { return y * COLS + x; };
  World.prototype.get = function (x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return -1;
    return this.tiles[y * COLS + x];
  };
  World.prototype.set = function (x, y, v) { this.tiles[y * COLS + x] = v; };

  World.prototype.generate = function () {
    var rng = this.rng, x, y;
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) {
      this.set(x, y, (x % BLOCK === 0 || y % BLOCK === 0) ? ROAD : BUILDING);
    }
    var palette = ['#e8b4a0', '#f2d49b', '#a9c8e8', '#c7b8e0', '#b9dcc2', '#f0c1cf', '#d9d2c3', '#9fc3c9', '#efe2b8'];
    for (var by = 0; by < (ROWS - 1) / BLOCK; by++) {
      for (var bx = 0; bx < (COLS - 1) / BLOCK; bx++) {
        var b = { bx: bx, by: by, x0: bx * BLOCK + 1, y0: by * BLOCK + 1, kind: 'city', buildings: [] };
        if (bx === 2 && by === 2) b.kind = 'home';
        else if (bx === 3 && by === 2) b.kind = 'lot';
        else if (rng() < 0.14) b.kind = 'park';
        if (b.kind === 'park') {
          for (y = b.y0; y < b.y0 + 5; y++) for (x = b.x0; x < b.x0 + 5; x++) this.set(x, y, PARK);
          b.trees = [];
          for (var i = 0; i < 9; i++) b.trees.push({ x: (b.x0 + 0.5 + rng() * 4) * T, y: (b.y0 + 0.5 + rng() * 4) * T, r: 10 + rng() * 9 });
        } else if (b.kind === 'city') {
          // split the 5x5 block into a few buildings
          var splitX = rng() < 0.5, cut = 2 + Math.floor(rng() * 2);
          var parts = splitX
            ? [[0, 0, cut, 5], [cut, 0, 5 - cut, 5]]
            : [[0, 0, 5, cut], [0, cut, 5, 5 - cut]];
          var out = [];
          parts.forEach(function (p) {
            if (rng() < 0.55 && (p[2] >= 2 && p[3] >= 2)) {
              if (p[2] >= p[3]) { var h = Math.floor(p[2] / 2); out.push([p[0], p[1], h, p[3]]); out.push([p[0] + h, p[1], p[2] - h, p[3]]); }
              else { var v = Math.floor(p[3] / 2); out.push([p[0], p[1], p[2], v]); out.push([p[0], p[1] + v, p[2], p[3] - v]); }
            } else out.push(p);
          });
          b.buildings = out.map(function (p) {
            return { x: p[0], y: p[1], w: p[2], h: p[3], color: palette[Math.floor(rng() * palette.length)], height: 6 + Math.floor(rng() * 10) };
          });
        }
        this.blocks.push(b);
      }
    }
    // Home: house + yard + garage tile
    for (y = HOME.y0; y <= HOME.y1; y++) for (x = HOME.x0; x <= HOME.x1; x++) this.set(x, y, x === 17 ? YARD : BUILDING);
    this.set(GARAGE_TILE.x, GARAGE_TILE.y, GARAGE);
    // Lot: walkable "for sale" until bought
    for (y = LOTB.y0; y <= LOTB.y1; y++) for (x = LOTB.x0; x <= LOTB.x1; x++) this.set(x, y, LOT);
  };

  World.prototype.isRoad = function (x, y) { return this.get(x, y) === ROAD; };
  World.prototype.isIntersection = function (x, y) { return x % BLOCK === 0 && y % BLOCK === 0; };

  World.prototype.drivableTile = function (x, y) {
    var t = this.get(x, y);
    return t === ROAD || t === GARAGE || (t === LOT && this.lotOwned);
  };
  World.prototype.walkableTile = function (x, y) {
    var t = this.get(x, y);
    return t !== -1 && t !== BUILDING;
  };
  World.prototype.drivableAt = function (px, py) {
    return this.drivableTile(Math.floor(px / T), Math.floor(py / T));
  };
  World.prototype.walkableAt = function (px, py) {
    return this.walkableTile(Math.floor(px / T), Math.floor(py / T));
  };
  World.prototype.tileOf = function (px, py) { return { x: Math.floor(px / T), y: Math.floor(py / T) }; };
  World.prototype.center = function (tx, ty) { return { x: (tx + 0.5) * T, y: (ty + 0.5) * T }; };

  World.prototype.nearestRoad = function (px, py) {
    var tx = Math.floor(px / T), ty = Math.floor(py / T), best = null, bd = 1e9;
    for (var r = 0; r < 8 && !best; r++) {
      for (var y = ty - r; y <= ty + r; y++) for (var x = tx - r; x <= tx + r; x++) {
        if (this.isRoad(x, y)) {
          var d = Math.abs(x - tx) + Math.abs(y - ty);
          if (d < bd) { bd = d; best = { x: x, y: y }; }
        }
      }
    }
    return best || { x: 0, y: 0 };
  };

  // BFS over road tiles. Returns array of tiles from start (inclusive) to goal (inclusive) or null.
  World.prototype.path = function (sx, sy, gx, gy) {
    if (!this.isRoad(sx, sy) || !this.isRoad(gx, gy)) return null;
    var start = sy * COLS + sx, goal = gy * COLS + gx;
    if (start === goal) return [{ x: sx, y: sy }];
    var prev = new Int32Array(COLS * ROWS).fill(-1);
    var q = [start]; prev[start] = start;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var h = 0; h < q.length; h++) {
      var c = q[h]; if (c === goal) break;
      var cx = c % COLS, cy = (c / COLS) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        var n = ny * COLS + nx;
        if (prev[n] !== -1 || this.tiles[n] !== ROAD) continue;
        prev[n] = c; q.push(n);
      }
    }
    if (prev[goal] === -1) return null;
    var out = [], k = goal;
    while (k !== start) { out.push({ x: k % COLS, y: (k / COLS) | 0 }); k = prev[k]; }
    out.push({ x: sx, y: sy });
    return out.reverse();
  };

  // Convert a tile path to pixel waypoints driving on the right-hand lane.
  World.prototype.waypoints = function (tilePath) {
    var pts = [], off = 0.2 * T;
    for (var i = 0; i < tilePath.length; i++) {
      var p = tilePath[i], dx = 0, dy = 0;
      if (i < tilePath.length - 1) { dx += tilePath[i + 1].x - p.x; dy += tilePath[i + 1].y - p.y; }
      if (i > 0) { dx += p.x - tilePath[i - 1].x; dy += p.y - tilePath[i - 1].y; }
      var len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      // right-hand perpendicular (screen coords, y down): (-dy, dx)
      pts.push({ x: (p.x + 0.5) * T - dy * off, y: (p.y + 0.5) * T + dx * off });
    }
    return pts;
  };

  // Road tiles where riders can spawn (not intersections, next to a city block).
  World.prototype.curbTiles = function () {
    if (this._curbs) return this._curbs;
    var out = [];
    for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) {
      if (!this.isRoad(x, y) || this.isIntersection(x, y)) continue;
      if (x === LOT_ROAD.x && (y === LOT_ROAD.y || y === GARAGE_ROAD.y)) continue;
      var horiz = (y % BLOCK === 0);
      var sides = horiz ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
      sides.forEach(function (s) {
        var t = this.get(x + s[0], y + s[1]);
        if (t === BUILDING || t === PARK) out.push({ x: x, y: y, sx: s[0], sy: s[1] });
      }, this);
    }
    this._curbs = out;
    return out;
  };

  // ---- Parking / charging spots -------------------------------------------
  World.prototype.buildSpots = function () {
    var spots = [];
    var gc = this.center(GARAGE_TILE.x, GARAGE_TILE.y), gr = this.center(GARAGE_ROAD.x, GARAGE_ROAD.y);
    spots.push({ id: 0, kind: 'garage', x: gc.x - 4, y: gc.y, angle: Math.PI, roadTile: GARAGE_ROAD,
      entry: [{ x: gc.x - 4, y: gc.y }], exit: [{ x: gr.x, y: gr.y }], car: null, active: true,
      plugX: gc.x - 4 - 0.42 * T, plugY: gc.y - 0.38 * T });
    var lr = this.center(LOT_ROAD.x, LOT_ROAD.y), aisleY = AISLE_Y * T;
    var n = 1;
    // 8 spots: top row tiles y=13 (x 20..23), bottom row tiles y=16 (x 20..23). Aisle between.
    [13, 16].forEach(function (ty) {
      for (var tx = 20; tx <= 23; tx++) {
        var c = { x: (tx + 0.5) * T, y: (ty + (ty === 13 ? 0.6 : 0.4)) * T };
        spots.push({ id: n++, kind: 'lot', x: c.x, y: c.y, angle: ty === 13 ? -Math.PI / 2 : Math.PI / 2, roadTile: LOT_ROAD,
          entry: [{ x: 19.3 * T, y: aisleY }, { x: c.x, y: aisleY }, { x: c.x, y: c.y }],
          exit: [{ x: c.x, y: aisleY }, { x: 19.3 * T, y: aisleY }, { x: lr.x, y: lr.y }],
          car: null, active: false,
          plugX: c.x + 0.36 * T, plugY: ty === 13 ? (ty) * T + 6 : (ty + 1) * T - 6 });
      }
    });
    this.spots = spots;
  };

  World.prototype.setLot = function (owned, chargers) {
    this.lotOwned = owned;
    var lotSpots = this.spots.filter(function (s) { return s.kind === 'lot'; });
    // Fill order alternates rows so the lot looks balanced
    var order = [0, 4, 1, 5, 2, 6, 3, 7];
    lotSpots.forEach(function (s) { s.active = false; });
    for (var i = 0; i < (owned ? chargers : 0) && i < order.length; i++) lotSpots[order[i]].active = true;
  };

  // ---- Static map art --------------------------------------------------------
  World.prototype.renderStatic = function () {
    var c = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = COLS * T; c.height = ROWS * T;
    var g = c.getContext('2d'), x, y, self = this;
    g.fillStyle = '#86bf65'; g.fillRect(0, 0, c.width, c.height);

    // roads
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) {
      if (!this.isRoad(x, y)) continue;
      g.fillStyle = '#3f4552'; g.fillRect(x * T, y * T, T, T);
    }
    // lane dashes + crosswalks
    g.fillStyle = '#e9d27a';
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) {
      if (!this.isRoad(x, y) || this.isIntersection(x, y)) continue;
      var horiz = y % BLOCK === 0;
      if (horiz) { g.fillRect(x * T + 8, (y + 0.5) * T - 1.5, T - 16, 3); }
      else { g.fillRect((x + 0.5) * T - 1.5, y * T + 8, 3, T - 16); }
    }
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) {
      if (!this.isIntersection(x, y)) continue;
      // zebra stripes on the four approaches
      for (var k = 0; k < 5; k++) {
        var o = 6 + k * 8;
        if (this.isRoad(x + 1, y)) g.fillRect((x + 1) * T + 2, y * T + o, 7, 4);
        if (this.isRoad(x - 1, y)) g.fillRect(x * T - 9, y * T + o, 7, 4);
        if (this.isRoad(x, y + 1)) g.fillRect(x * T + o, (y + 1) * T + 2, 4, 7);
        if (this.isRoad(x, y - 1)) g.fillRect(x * T + o, y * T - 9, 4, 7);
      }
    }

    this.blocks.forEach(function (b) {
      var bx = b.x0 * T, by = b.y0 * T, bw = 5 * T;
      // sidewalk
      g.fillStyle = '#cfcabd'; roundRect(g, bx - 1, by - 1, bw + 2, bw + 2, 6); g.fill();
      if (b.kind === 'park') {
        g.fillStyle = '#6fb257'; roundRect(g, bx + 6, by + 6, bw - 12, bw - 12, 10); g.fill();
        g.strokeStyle = '#e2d6b4'; g.lineWidth = 6; g.beginPath();
        g.moveTo(bx + 6, by + bw / 2); g.quadraticCurveTo(bx + bw / 2, by + bw * 0.2, bx + bw - 6, by + bw / 2); g.stroke();
        b.trees.forEach(function (t) {
          g.fillStyle = 'rgba(0,0,0,0.15)'; g.beginPath(); g.arc(t.x + 4, t.y + 5, t.r, 0, 7); g.fill();
          g.fillStyle = '#3f8f3c'; g.beginPath(); g.arc(t.x, t.y, t.r, 0, 7); g.fill();
          g.fillStyle = '#58a84f'; g.beginPath(); g.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.55, 0, 7); g.fill();
        });
      } else if (b.kind === 'city') {
        b.buildings.forEach(function (p) {
          var px = bx + p.x * T + 5, py = by + p.y * T + 5, pw = p.w * T - 10, ph = p.h * T - 10;
          g.fillStyle = 'rgba(0,0,0,0.18)'; roundRect(g, px + p.height * 0.6, py + p.height, pw, ph, 5); g.fill();
          g.fillStyle = shade(p.color, -0.18); roundRect(g, px, py, pw, ph, 5); g.fill();
          g.fillStyle = p.color; roundRect(g, px + 3, py + 3, pw - 6, ph - 6, 4); g.fill();
          // roof details
          g.fillStyle = shade(p.color, -0.1);
          var n = Math.max(1, Math.floor((pw * ph) / 6000));
          for (var i = 0; i < n; i++) {
            var rx = px + 10 + ((i * 37) % Math.max(1, pw - 34)), ry = py + 10 + ((i * 53) % Math.max(1, ph - 30));
            g.fillRect(rx, ry, 14, 10);
          }
        });
      } else if (b.kind === 'home') {
        // house body covers x13..16
        var hx = bx + 6, hy = by + 6, hw = 4 * T - 12, hh = bw - 12;
        g.fillStyle = '#9fd07f'; g.fillRect(bx + 4 * T, by, T, bw); // yard
        g.fillStyle = 'rgba(0,0,0,0.18)'; roundRect(g, hx + 8, hy + 10, hw, hh, 6); g.fill();
        g.fillStyle = '#c4643f'; roundRect(g, hx, hy, hw, hh, 6); g.fill();
        g.fillStyle = '#d97b55';
        g.beginPath(); g.moveTo(hx + 4, hy + 4); g.lineTo(hx + hw / 2, hy + hh / 2); g.lineTo(hx + hw - 4, hy + 4); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(hx + 4, hy + hh - 4); g.lineTo(hx + hw / 2, hy + hh / 2); g.lineTo(hx + hw - 4, hy + hh - 4); g.closePath(); g.fill();
        g.fillStyle = '#fff'; g.font = 'bold 18px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText('HOME', hx + hw / 2, hy + hh / 2 + 6);
        // garage pad
        var gx = GARAGE_TILE.x * T, gy = GARAGE_TILE.y * T;
        g.fillStyle = '#b9b5ab'; g.fillRect(gx - 4, gy - 6, T + 6, T + 12);
        g.fillStyle = '#d8d4ca'; g.fillRect(gx, gy - 2, T + 2, T + 4);
        g.strokeStyle = '#f2c94c'; g.lineWidth = 2; g.setLineDash([5, 4]); g.strokeRect(gx + 3, gy + 1, T - 4, T - 2); g.setLineDash([]);
        // stepping stones in yard
        g.fillStyle = '#d9cfb5';
        for (var s = 0; s < 4; s++) { g.beginPath(); g.arc(gx + T / 2, by + 10 + s * 22, 6, 0, 7); g.fill(); }
      }
    });
    return c;
  };

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
    var f = function (v) { return Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt)))); };
    return 'rgb(' + f(r) + ',' + f(gg) + ',' + f(b) + ')';
  }

  root.RC_WORLD = {
    World: World, T: T, COLS: COLS, ROWS: ROWS, LOTB: LOTB, HOME: HOME, GARAGE_TILE: GARAGE_TILE,
    GARAGE_ROAD: GARAGE_ROAD, LOT_ROAD: LOT_ROAD,
    tiles: { GRASS: GRASS, ROAD: ROAD, BUILDING: BUILDING, GARAGE: GARAGE, LOT: LOT, YARD: YARD, PARK: PARK },
    roundRect: roundRect, shade: shade
  };
})(typeof window !== 'undefined' ? window : this);
