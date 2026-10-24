// Headless browser smoke test: loads the game in Chrome, checks for console errors,
// plays a few fares through the test API, uses the cheat unlocks, and saves screenshots.
// Usage: node test/smoke.js   (needs playwright-core + /usr/bin/google-chrome)
const path = require('path');
const assert = require('assert');
let chromium;
try { chromium = require('playwright-core').chromium; } catch (e) { chromium = require('/node_modules/playwright-core').chromium; }

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = path.join(ROOT, 'screenshots');

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, name) }); console.log('shot', name); };
  const S = () => page.evaluate(() => JSON.parse(JSON.stringify(RoboCab.state())));

  await page.goto(URL + '?fresh=1');
  await page.waitForFunction(() => window.RoboCab && RoboCab.game);
  await page.waitForTimeout(600);
  await shot('01-start-help.png');
  await page.click('#help-close');
  await page.waitForTimeout(400);
  await shot('02-start-garage.png');

  // Keyboard driving: reverse out of the garage then accelerate
  const before = await page.evaluate(() => ({ x: RoboCab.game.cars[0].x, y: RoboCab.game.cars[0].y }));
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(700); await page.keyboard.up('ArrowDown');
  const after = await page.evaluate(() => ({ x: RoboCab.game.cars[0].x, y: RoboCab.game.cars[0].y, b: RoboCab.game.cars[0].battery }));
  assert(Math.hypot(after.x - before.x, after.y - before.y) > 10, 'car should move with arrow keys');
  console.log('keyboard drive moved', Math.round(Math.hypot(after.x - before.x, after.y - before.y)), 'px');

  // Play 6 fares by placing the car on the rider and then on the destination
  const fares = await page.evaluate(() => {
    const G = RoboCab.game, c = G.cars[0]; let n = 0;
    for (let i = 0; i < 6; i++) {
      const p = G.passengers.find(q => q.state === 'waiting'); if (!p) break;
      const r1 = G.world.center(p.tile.x, p.tile.y); c.x = r1.x; c.y = r1.y; c.speed = 0; RoboCab.sim(0.1);
      if (p.state !== 'riding') continue;
      const r2 = G.world.center(p.dest.x, p.dest.y); c.x = r2.x; c.y = r2.y; c.speed = 0; RoboCab.sim(0.1);
      n++;
    }
    return n;
  });
  let st = await S();
  console.log('fares played', fares, 'trips', st.trips, 'cash', st.cash);
  assert(st.trips >= 5 && st.cash > 100, 'fares should pay out');
  // leave a rider on board for the screenshot
  await page.evaluate(() => {
    RoboCab.sim(6); const G = RoboCab.game, c = G.cars[0], p = G.passengers.find(q => q.state === 'waiting');
    const r1 = G.world.center(p.tile.x, p.tile.y); c.x = r1.x; c.y = r1.y; c.speed = 0; RoboCab.sim(0.6);
  });
  await shot('03-carrying-rider.png');

  // Shop: buy Motor tune with a real click
  await page.keyboard.press('KeyB');
  await page.waitForTimeout(400);
  await shot('04-shop.png');
  await page.click('.item[data-id="motor"] .buy');
  st = await S(); assert.strictEqual(st.up.motor, 1, 'motor bought via shop click');
  await page.keyboard.press('Escape');

  // Self-driving
  await page.evaluate(() => { RoboCab.cheat.unlock('selfDriving'); RoboCab.sim(25); });
  st = await S(); assert(st.selfDriving, 'self-driving unlocked');
  const mode = await page.evaluate(() => RoboCab.game.player.mode); assert.strictEqual(mode, 'walk');
  await shot('05-self-driving-on-foot.png');

  // Lot: run long enough that cars come in to charge, walk the player to plug them in
  await page.evaluate(() => { RoboCab.cheat.unlock('lot'); RoboCab.sim(5); });
  const plugged = await page.evaluate(() => {
    const G = RoboCab.game; let plugs = 0;
    G.cars.forEach(c => c.battery = 2); // force a charge trip
    for (let t = 0; t < 90; t++) {
      RoboCab.sim(0.5);
      const w = G.cars.find(c => c.state === 'waitingPlug');
      if (w && plugs < 1 && t > 2) { G.player.x = w.x; G.player.y = w.y + 30; RoboCab.sim(0.6); if (w.state === 'charging') plugs++; }
      if (plugs) break;
    }
    // stand in the lot for the screenshot
    G.player.x = 19.5 * 48; G.player.y = 15 * 48; RoboCab.sim(0.1);
    return plugs;
  });
  console.log('player plugged in cars:', plugged);
  assert(plugged >= 1, 'player should be able to plug in a car');
  await page.evaluate(() => { RoboCab.game.cars.forEach(c => { if (c.state !== 'charging') c.battery = 1.5; }); RoboCab.sim(12); });
  await shot('06-lot-plug-in.png');

  // Robot
  await page.evaluate(() => { RoboCab.cheat.unlock('robot'); RoboCab.game.cars.forEach(c => c.battery = 1.5); });
  const robot = await page.evaluate(() => {
    const G = RoboCab.game; G.player.x = 15 * 48; G.player.y = 20 * 48; // stay away from the lot
    let robotPlugs = 0; const orig = G.plug.bind(G);
    G.plug = (c, by) => { if (by === 'robot') robotPlugs++; return orig(c, by); };
    RoboCab.sim(40);
    G.player.x = 19.5 * 48; G.player.y = 15 * 48; RoboCab.sim(0.1);
    return { robotPlugs, cars: G.cars.length, robots: G.robots.length };
  });
  console.log('robot', robot);
  assert(robot.robotPlugs >= 1, 'robot should plug cars in');
  await shot('07-robot-lot.png');

  // Endgame: everything maxed, long sim
  const end = await page.evaluate(() => {
    RoboCab.cheat.unlock('all');
    const G = RoboCab.game, t0 = G.s.trips; RoboCab.sim(240);
    const bad = G.cars.filter(c => !isFinite(c.x) || !isFinite(c.y) || !isFinite(c.battery)).length;
    G.player.x = 21 * 48; G.player.y = 15 * 48; RoboCab.sim(0.1);
    return { trips: G.s.trips - t0, cars: G.cars.length, robots: G.robots.length, bad, states: G.cars.map(c => c.state) };
  });
  console.log('endgame', end);
  assert.strictEqual(end.bad, 0, 'no NaN positions');
  assert(end.trips > 20, 'fleet should complete trips on its own');
  await shot('08-endgame-fleet.png');
  await page.evaluate(() => RoboCab.toggleShop(true));
  await shot('09-endgame-shop.png');

  // Persistence: reload without ?fresh and check the save
  await page.evaluate(() => RoboCab.save());
  await page.goto(URL);
  await page.waitForFunction(() => window.RoboCab && RoboCab.game);
  const reloaded = await S();
  assert.strictEqual(reloaded.cars, 12, 'save persisted across reload');
  console.log('reload ok, cars', reloaded.cars, 'robots', reloaded.robots);

  // Mobile layout from a fresh start
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  mp.on('console', msg => { if (msg.type() === 'error') errors.push('[mobile] ' + msg.text()); });
  mp.on('pageerror', e => errors.push('[mobile] ' + e));
  await mp.goto(URL + '?fresh=1&nohelp=1');
  await mp.waitForTimeout(800);
  await mp.screenshot({ path: path.join(SHOTS, '10-mobile.png') }); console.log('shot 10-mobile.png');

  await browser.close();
  if (errors.length) { console.error('CONSOLE ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('SMOKE OK: no console errors');
})().catch(e => { console.error(e); process.exit(1); });
