// Unit-ish checks for the economy/progression rules. Run: node test/economy.test.js
const assert = require('assert');
const E = require('../js/economy.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('new state starts with 1 car, no cash, nothing unlocked', () => {
  const s = E.newState();
  assert.strictEqual(s.cash, 0); assert.strictEqual(s.cars, 1); assert(!s.selfDriving && !s.lot);
  assert.strictEqual(E.currentGoal(s).id, 'firstFare');
});

t('level costs strictly increase and items max out', () => {
  Object.entries(E.LEVEL_COSTS).forEach(([k, arr]) => arr.forEach((c, i) => { if (i) assert(c > arr[i - 1], k); }));
  const s = E.newState(); s.cash = 1e9;
  for (let i = 0; i < 10; i++) E.buy(s, 'motor');
  assert.strictEqual(s.up.motor, E.LEVEL_COSTS.motor.length);
  assert.strictEqual(E.canBuy(s, 'motor').reason, 'maxed');
});

t('buying deducts cash and refuses when broke', () => {
  const s = E.newState(); s.cash = 49;
  assert.strictEqual(E.canBuy(s, 'motor').reason, 'cash');
  s.cash = 60; assert(E.buy(s, 'motor').ok);
  assert.strictEqual(s.cash, 10); assert.strictEqual(s.up.motor, 1); assert.strictEqual(s.bought, 1);
});

t('progression gates: self-driving -> lot -> cars/chargers -> robot', () => {
  const s = E.newState(); s.cash = 1e9;
  assert(!E.canBuy(s, 'selfDriving').ok, 'needs motor+battery');
  assert(!E.canBuy(s, 'lot').ok); assert(!E.canBuy(s, 'car').ok); assert(!E.canBuy(s, 'robot').ok);
  E.buy(s, 'motor'); E.buy(s, 'battery');
  assert(E.buy(s, 'selfDriving').ok);
  assert(E.buy(s, 'lot').ok); assert.strictEqual(s.chargers, E.LOT_STARTING_CHARGERS);
  assert(!E.canBuy(s, 'robot').ok, 'robot needs 3 cars');
  E.buy(s, 'car'); E.buy(s, 'car'); assert.strictEqual(s.cars, 3);
  assert(E.buy(s, 'robot').ok);
  assert(E.buy(s, 'robotSpeed').ok);
});

t('car and charger caps', () => {
  const s = E.normalize({ selfDriving: true, lot: true, chargers: 2, cars: 1, cash: 1e9 });
  for (let i = 0; i < 30; i++) { E.buy(s, 'car'); E.buy(s, 'lotCharger'); }
  assert.strictEqual(s.cars, E.MAX_CARS); assert.strictEqual(s.chargers, E.MAX_LOT_CHARGERS);
});

t('car prices escalate', () => {
  const s = E.normalize({ selfDriving: true, lot: true, chargers: 2 });
  const prices = [];
  for (let c = 1; c < E.MAX_CARS; c++) { s.cars = c; prices.push(E.itemById.car.cost(s)); }
  prices.forEach((p, i) => { if (i) assert(p > prices[i - 1]); });
});

t('fares scale with distance and the Premium upgrade', () => {
  const s = E.newState();
  assert(E.fare(20, s) > E.fare(8, s));
  const base = E.fare(15, s); s.up.fares = 2;
  assert(E.fare(15, s) > base * 1.4);
});

t('pacing: first upgrade costs about 2 typical fares', () => {
  const s = E.newState();
  const typical = E.fare(15, s); // ~15 tile trip
  const cheapest = Math.min(...E.items.map(i => i.cost(s)).filter(c => c !== null));
  assert(cheapest <= typical * 2, `cheapest ${cheapest} vs fare ${typical}`);
});

t('stats improve with upgrades', () => {
  const s = E.newState(), a = { ...Object.fromEntries(Object.keys(E.stats).map(k => [k, E.stats[k](s)])) };
  s.up = { motor: 2, battery: 2, seats: 2, charger: 2, fares: 2, robotSpeed: 1 };
  ['speed', 'batteryCap', 'seats', 'chargeRate', 'fareMult', 'robotSpeed'].forEach(k => assert(E.stats[k](s) > a[k], k));
});

t('goals advance in order and finish', () => {
  const s = E.newState(); const seen = [E.currentGoal(s).id];
  s.trips = 1; seen.push(E.currentGoal(s).id);
  s.cash = 1e9; E.buy(s, 'motor'); seen.push(E.currentGoal(s).id);
  E.buy(s, 'battery'); E.buy(s, 'selfDriving'); seen.push(E.currentGoal(s).id);
  E.buy(s, 'lot'); seen.push(E.currentGoal(s).id);
  E.buy(s, 'car'); E.buy(s, 'car'); seen.push(E.currentGoal(s).id);
  E.buy(s, 'robot'); seen.push(E.currentGoal(s).id);
  while (s.cars < 6) E.buy(s, 'car'); seen.push(E.currentGoal(s).id);
  while (s.cars < 12) E.buy(s, 'car'); seen.push(E.currentGoal(s).id);
  assert.deepStrictEqual(seen, ['firstFare', 'firstUpgrade', 'selfDriving', 'lot', 'cars3', 'robot', 'cars6', 'cars12', 'done']);
});

t('normalize repairs bad saves', () => {
  const s = E.normalize({ cash: 'abc', cars: 99, chargers: -3, up: { motor: 2 } });
  assert.strictEqual(s.cash, 0); assert.strictEqual(s.cars, E.MAX_CARS); assert.strictEqual(s.chargers, 0); assert.strictEqual(s.up.motor, 2);
  assert.strictEqual(E.normalize(null).cars, 1);
});

console.log(`\n${n} economy checks passed`);
