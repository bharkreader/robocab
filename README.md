# RoboCab Tycoon (v1)

A top-down browser game about growing a one-car electric cab hustle into a self-driving robo cab fleet.

Plain HTML + JavaScript + Canvas 2D. No build step, no dependencies, no CDNs. Progress saves in `localStorage`.

## Run it

- Open `index.html` in a browser, **or**
- `python3 -m http.server 8000` in this folder and visit http://localhost:8000

URL options: `?fresh=1` (start a new game, ignoring the save) · `?debug=1` (FPS + car state overlay) · `?cheat=upgrades|selfDriving|lot|robot|all` (jump ahead) · `?speed=4` (game speed) · `?nohelp=1`.

## How to play

| Action | Keyboard | Touch / mouse |
|---|---|---|
| Drive / walk | WASD or arrow keys | Drag anywhere on the map (virtual joystick) |
| Shop | `B` (or `E`) | 🛒 Shop button, or tap the goal card |
| Help | `H` | `?` button |
| Close panels | `Esc` | ✕ |

1. **Drive your own cab.** Roll onto a waving rider (green arrow points to the nearest), then drive to their colored flag to get paid. Fare = distance-based, shown on the rider's tag.
2. **Charge at home.** Battery drains as you drive. Park on the yellow pad next to HOME. At 0% you crawl at 35% speed, so you can always limp home.
3. **Upgrade** (Shop): Motor tune (speed), Bigger battery (range), Faster chargers, More seats (carry up to 4 riders at once), Premium app listing (fare multiplier).
4. **Self-driving software.** Your cab drives fares on its own. You hop out and go on foot (hard hat). Cabs that need charging park at a charger and flash a 🔌 plug icon. Walk up to them to plug them in.
5. **Charging lot** next door (comes with 2 chargers). Then add cabs (up to 12) and chargers (up to 8 in the lot, plus 1 at home). Now your main job is plugging cabs in.
6. **Plug-in robot.** It walks to waiting cabs and plugs them in for you. Buy a second robot and robot servo upgrades for a big fleet.

The goal card at the top always shows the next milestone, its cost, and a progress bar.

## Progression and costs

| Item | Costs per level | Requires |
|---|---|---|
| Motor tune (speed +20%/lvl) | $50, $150, $400, $1,000, $2,400 | none |
| Bigger battery (+60% range/lvl) | $75, $220, $600, $1,500 | none |
| Faster chargers (+75% rate/lvl) | $100, $350, $900, $2,000 | none |
| More seats (1 to 4 riders) | $200, $800, $2,200 | none |
| Premium app listing (+25% fares/lvl) | $150, $450, $1,200, $3,000 | none |
| **Self-driving software** | $1,500 | Motor 1 + Battery 1 |
| **Charging lot** (+2 chargers) | $1,200 | Self-driving |
| Add a robo cab (to 12) | $800 x 1.38^(cabs-1), rounded to $50 ($800, $1,100, $1,500, ...) | Lot |
| Add a charger (to 8) | $300 x 1.35^(extra), rounded ($300, $400, $550, ...) | Lot |
| **Plug-in robot** (to 2) | $3,000, then $9,000 | Lot + 3 cabs |
| Robot servos | $1,500, $4,000 | Robot |

Goals: first rider → first upgrade → self-driving → lot → 3 cabs → robot → 6 cabs → 12 cabs.

Rough pacing from a simulated run (a bot driver at ~70% efficiency standing in for a human): first upgrade in about 20 s, self-driving in about 10 to 12 min, lot about 5 min later, robot around 15 min after self-driving, 12 cabs at about 1 hour total.

## Cheats / debug (for testing)

- `Shift+M` +$1,000 · `Shift+K` +$10,000 · `Shift+T` cycle game speed 1x/2x/4x/8x · `Shift+R` reset save
- Console: `RoboCab.cheat.unlock('robot')`, `RoboCab.cheat.money(5000)`, `RoboCab.sim(60)` (fast-forward 60 s), `RoboCab.buy('car')`

## Tests

- `node test/economy.test.js`: economy/progression unit checks (costs, gating, caps, goals, save repair).
- `node test/smoke.js`: headless Chrome (`/usr/bin/google-chrome` via `playwright-core`). Loads the page, fails on any console error, drives with the keyboard, plays fares, buys from the shop, unlocks self-driving/lot/robot, checks the player and robot plug cars in, runs a 4-minute 12-cab sim, checks the save survives a reload, and writes screenshots to `screenshots/`.

## Code layout

- `js/economy.js`: shop items, costs, stats, fares, goals (pure, Node-testable)
- `js/world.js`: city grid, road pathfinding (BFS), parking/charging spots, static map art
- `js/game.js`: simulation: player car physics, AI cabs, riders, charging, robots, FX
- `js/render.js`: camera and Canvas drawing, off-screen arrows, joystick
- `js/ui.js`: HUD, shop, goals, input, save/load, main loop, cheat/test API
- `js/audio.js`: WebAudio synth sound effects (no audio files)

## Future ideas (not in v1)

- **Rival taxis and buses**: compete with (or sabotage/"attack") rival cabs and buses to win more riders. Bobby's idea, parked until the core loop feels right.
- Traffic and stoplights, rush hours and surge pricing, weather.
- Multiple lots or a bigger city map, offline earnings, achievements.
- Hosting on GitHub Pages (pending Bobby's OK).
