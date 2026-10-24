/* RoboCab economy + progression rules.
 * Pure logic, no DOM. Works in the browser (window.RC_ECON) and in Node (module.exports)
 * so the unit checks in test/economy.test.js can exercise it directly.
 */
(function (root) {
  'use strict';

  var MAX_CARS = 12;
  var MAX_LOT_CHARGERS = 8;
  var LOT_STARTING_CHARGERS = 2;
  var MAX_ROBOTS = 2;

  function newState() {
    return {
      version: 1,
      cash: 0,
      totalEarned: 0,
      trips: 0,
      up: { motor: 0, battery: 0, seats: 0, charger: 0, fares: 0, robotSpeed: 0 },
      selfDriving: false,
      lot: false,
      cars: 1,
      chargers: 0,      // chargers at the lot (home garage always has 1)
      robots: 0,
      bought: 0         // number of purchases, used for "first upgrade" goal
    };
  }

  // Merge a saved object onto a fresh state so older/partial saves still load.
  function normalize(saved) {
    var s = newState();
    if (!saved || typeof saved !== 'object') return s;
    ['cash', 'totalEarned', 'trips', 'cars', 'chargers', 'robots', 'bought'].forEach(function (k) {
      if (typeof saved[k] === 'number' && isFinite(saved[k])) s[k] = saved[k];
    });
    s.selfDriving = !!saved.selfDriving;
    s.lot = !!saved.lot;
    if (saved.up) {
      Object.keys(s.up).forEach(function (k) {
        if (typeof saved.up[k] === 'number') s.up[k] = saved.up[k];
      });
    }
    s.cars = clamp(Math.floor(s.cars), 1, MAX_CARS);
    s.chargers = clamp(Math.floor(s.chargers), 0, MAX_LOT_CHARGERS);
    s.robots = clamp(Math.floor(s.robots), 0, MAX_ROBOTS);
    return s;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---- Derived stats -------------------------------------------------------
  var stats = {
    speed: function (s) { return 3.4 * (1 + 0.2 * s.up.motor); },            // tiles / second
    batteryCap: function (s) { return 10 * (1 + 0.6 * s.up.battery); },      // kWh
    drainPerTile: function () { return 0.1; },                                // kWh per tile driven
    seats: function (s) { return 1 + s.up.seats; },
    chargeRate: function (s) { return 1.3 * (1 + 0.75 * s.up.charger); },    // kWh / second
    fareMult: function (s) { return 1 + 0.25 * s.up.fares; },
    robotSpeed: function (s) { return 2.4 * (1 + 0.5 * s.up.robotSpeed); },  // tiles / second
    totalSpots: function (s) { return 1 + (s.lot ? s.chargers : 0); }
  };

  // Fare for a trip of `tiles` (manhattan distance in tiles).
  function fare(tiles, s) {
    return Math.max(5, Math.round((6 + tiles * 1.6) * stats.fareMult(s)));
  }

  // ---- Shop items -----------------------------------------------------------
  function levelItem(id, field, costs) {
    return function (s) {
      var lvl = s.up[field];
      return lvl < costs.length ? costs[lvl] : null;
    };
  }

  var LEVEL_COSTS = {
    motor: [50, 150, 400, 1000, 2400],
    battery: [75, 220, 600, 1500],
    seats: [200, 800, 2200],
    charger: [100, 350, 900, 2000],
    fares: [150, 450, 1200, 3000],
    robotSpeed: [1500, 4000]
  };

  var items = [
    {
      id: 'motor', icon: '🏎️', name: 'Motor tune',
      desc: function (s) { return 'Top speed ' + stats.speed(s).toFixed(1) + ' → ' + (3.4 * (1 + 0.2 * (s.up.motor + 1))).toFixed(1) + ' tiles/s'; },
      level: function (s) { return s.up.motor; }, maxLevel: LEVEL_COSTS.motor.length,
      cost: levelItem('motor', 'motor', LEVEL_COSTS.motor),
      req: function () { return null; },
      apply: function (s) { s.up.motor++; }
    },
    {
      id: 'battery', icon: '🔋', name: 'Bigger battery',
      desc: function (s) { return 'Range ' + stats.batteryCap(s).toFixed(0) + ' → ' + (10 * (1 + 0.6 * (s.up.battery + 1))).toFixed(0) + ' kWh'; },
      level: function (s) { return s.up.battery; }, maxLevel: LEVEL_COSTS.battery.length,
      cost: levelItem('battery', 'battery', LEVEL_COSTS.battery),
      req: function () { return null; },
      apply: function (s) { s.up.battery++; }
    },
    {
      id: 'charger', icon: '⚡', name: 'Faster chargers',
      desc: function (s) { return 'Charge rate ' + stats.chargeRate(s).toFixed(1) + ' → ' + (1.3 * (1 + 0.75 * (s.up.charger + 1))).toFixed(1) + ' kWh/s'; },
      level: function (s) { return s.up.charger; }, maxLevel: LEVEL_COSTS.charger.length,
      cost: levelItem('charger', 'charger', LEVEL_COSTS.charger),
      req: function () { return null; },
      apply: function (s) { s.up.charger++; }
    },
    {
      id: 'seats', icon: '💺', name: 'More seats',
      desc: function (s) { return 'Carry ' + stats.seats(s) + ' → ' + (stats.seats(s) + 1) + ' riders at once'; },
      level: function (s) { return s.up.seats; }, maxLevel: LEVEL_COSTS.seats.length,
      cost: levelItem('seats', 'seats', LEVEL_COSTS.seats),
      req: function () { return null; },
      apply: function (s) { s.up.seats++; }
    },
    {
      id: 'fares', icon: '⭐', name: 'Premium app listing',
      desc: function (s) { return 'Fares x' + stats.fareMult(s).toFixed(2) + ' → x' + (1 + 0.25 * (s.up.fares + 1)).toFixed(2); },
      level: function (s) { return s.up.fares; }, maxLevel: LEVEL_COSTS.fares.length,
      cost: levelItem('fares', 'fares', LEVEL_COSTS.fares),
      req: function () { return null; },
      apply: function (s) { s.up.fares++; }
    },
    {
      id: 'selfDriving', icon: '🤖', name: 'Self-driving software',
      desc: function () { return 'Your cab drives fares on its own. You go on foot and keep it charged.'; },
      level: function (s) { return s.selfDriving ? 1 : 0; }, maxLevel: 1,
      cost: function (s) { return s.selfDriving ? null : 1500; },
      req: function (s) { return (s.up.motor >= 1 && s.up.battery >= 1) ? null : 'Needs Motor tune 1 + Bigger battery 1'; },
      apply: function (s) { s.selfDriving = true; }
    },
    {
      id: 'lot', icon: '🅿️', name: 'Charging lot',
      desc: function () { return 'Buy the lot next door. Comes with ' + LOT_STARTING_CHARGERS + ' chargers.'; },
      level: function (s) { return s.lot ? 1 : 0; }, maxLevel: 1,
      cost: function (s) { return s.lot ? null : 1200; },
      req: function (s) { return s.selfDriving ? null : 'Needs Self-driving software'; },
      apply: function (s) { s.lot = true; s.chargers = Math.max(s.chargers, LOT_STARTING_CHARGERS); }
    },
    {
      id: 'car', icon: '🚕', name: 'Add a robo cab',
      desc: function (s) { return 'Fleet ' + s.cars + ' → ' + (s.cars + 1) + ' cars (max ' + MAX_CARS + ')'; },
      level: function (s) { return s.cars - 1; }, maxLevel: MAX_CARS - 1,
      cost: function (s) { return s.cars >= MAX_CARS ? null : Math.round(800 * Math.pow(1.38, s.cars - 1) / 50) * 50; },
      req: function (s) { return s.lot ? null : 'Needs Charging lot'; },
      apply: function (s) { s.cars++; }
    },
    {
      id: 'lotCharger', icon: '🔌', name: 'Add a charger',
      desc: function (s) { return 'Lot chargers ' + s.chargers + ' → ' + (s.chargers + 1) + ' (max ' + MAX_LOT_CHARGERS + ')'; },
      level: function (s) { return s.chargers; }, maxLevel: MAX_LOT_CHARGERS,
      cost: function (s) { return s.chargers >= MAX_LOT_CHARGERS ? null : Math.round(300 * Math.pow(1.35, Math.max(0, s.chargers - LOT_STARTING_CHARGERS)) / 50) * 50; },
      req: function (s) { return s.lot ? null : 'Needs Charging lot'; },
      apply: function (s) { s.chargers++; }
    },
    {
      id: 'robot', icon: '🦾', name: 'Plug-in robot',
      desc: function (s) { return s.robots === 0 ? 'A robot that plugs cars in for you.' : 'A second robot for a busy lot.'; },
      level: function (s) { return s.robots; }, maxLevel: MAX_ROBOTS,
      cost: function (s) { return s.robots >= MAX_ROBOTS ? null : (s.robots === 0 ? 3000 : 9000); },
      req: function (s) { return (s.lot && s.cars >= 3) ? null : 'Needs Charging lot + 3 cars'; },
      apply: function (s) { s.robots++; }
    },
    {
      id: 'robotSpeed', icon: '⚙️', name: 'Robot servos',
      desc: function (s) { return 'Robot speed ' + stats.robotSpeed(s).toFixed(1) + ' → ' + (2.4 * (1 + 0.5 * (s.up.robotSpeed + 1))).toFixed(1) + ' tiles/s'; },
      level: function (s) { return s.up.robotSpeed; }, maxLevel: LEVEL_COSTS.robotSpeed.length,
      cost: levelItem('robotSpeed', 'robotSpeed', LEVEL_COSTS.robotSpeed),
      req: function (s) { return s.robots >= 1 ? null : 'Needs Plug-in robot'; },
      apply: function (s) { s.up.robotSpeed++; }
    }
  ];

  var itemById = {};
  items.forEach(function (it) { itemById[it.id] = it; });

  // Returns {ok, reason, cost}
  function canBuy(s, id) {
    var it = itemById[id];
    if (!it) return { ok: false, reason: 'unknown', cost: null };
    var cost = it.cost(s);
    if (cost === null) return { ok: false, reason: 'maxed', cost: null };
    var r = it.req(s);
    if (r) return { ok: false, reason: r, cost: cost };
    if (s.cash < cost) return { ok: false, reason: 'cash', cost: cost };
    return { ok: true, reason: null, cost: cost };
  }

  function buy(s, id) {
    var c = canBuy(s, id);
    if (!c.ok) return c;
    s.cash -= c.cost;
    s.bought++;
    itemById[id].apply(s);
    return c;
  }

  function earn(s, amount) {
    s.cash += amount;
    s.totalEarned += amount;
  }

  // ---- Goals ----------------------------------------------------------------
  // Ordered milestones shown at the top of the screen.
  var goals = [
    { id: 'firstFare', title: 'Pick up your first rider', hint: 'Drive to a green rider pin, then to their flag.',
      done: function (s) { return s.trips >= 1; } },
    { id: 'firstUpgrade', title: 'Buy your first upgrade', hint: 'Open the Shop (B). Motor tune is $50.', item: 'motor',
      done: function (s) { return s.bought >= 1; } },
    { id: 'selfDriving', title: 'Unlock self-driving', hint: 'Needs Motor 1 + Battery 1, then $1,500.', item: 'selfDriving',
      done: function (s) { return s.selfDriving; } },
    { id: 'lot', title: 'Buy the charging lot', hint: 'Your cab earns while you keep it plugged in.', item: 'lot',
      done: function (s) { return s.lot; } },
    { id: 'cars3', title: 'Grow to 3 robo cabs', hint: 'More cabs = more fares. Walk over to plug them in.', item: 'car',
      done: function (s) { return s.cars >= 3; } },
    { id: 'robot', title: 'Buy a plug-in robot', hint: 'Let the robot handle the plugging.', item: 'robot',
      done: function (s) { return s.robots >= 1; } },
    { id: 'cars6', title: 'Grow to 6 robo cabs', hint: 'Add chargers too so nobody waits.', item: 'car',
      done: function (s) { return s.cars >= 6; } },
    { id: 'cars12', title: 'Robo cab tycoon: 12 cabs', hint: 'Fill the lot and own the city.', item: 'car',
      done: function (s) { return s.cars >= MAX_CARS; } }
  ];

  function currentGoal(s) {
    for (var i = 0; i < goals.length; i++) {
      if (!goals[i].done(s)) {
        var g = goals[i];
        var cost = g.item ? itemById[g.item].cost(s) : null;
        return { index: i, total: goals.length, id: g.id, title: g.title, hint: g.hint, cost: cost, item: g.item || null };
      }
    }
    return { index: goals.length, total: goals.length, id: 'done', title: 'You run the city! 🎉', hint: 'Every goal complete. Keep earning.', cost: null, item: null };
  }

  var ECON = {
    MAX_CARS: MAX_CARS, MAX_LOT_CHARGERS: MAX_LOT_CHARGERS, MAX_ROBOTS: MAX_ROBOTS,
    LOT_STARTING_CHARGERS: LOT_STARTING_CHARGERS, LEVEL_COSTS: LEVEL_COSTS,
    newState: newState, normalize: normalize, stats: stats, fare: fare,
    items: items, itemById: itemById, canBuy: canBuy, buy: buy, earn: earn,
    goals: goals, currentGoal: currentGoal
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ECON;
  else root.RC_ECON = ECON;
})(typeof window !== 'undefined' ? window : this);
