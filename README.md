# Plane Evolution 3D ✈️

A **3D** browser slingshot launch-and-fly distance game, built to play on an iPhone (or any phone/desktop) with no install. Inspired by the launch-and-fly arcade genre — all 3D geometry is built procedurally with [Three.js](https://threejs.org/); no external 3D assets and all game code here is original.

## How to play

1. **Launch** — on the runway, **drag back and release** (like a slingshot). A power meter fills as you pull; a harder pull launches faster and steeper.
2. **Fly** — once airborne, touch **anywhere on the right half** to spawn a joystick under your finger: push **down to climb, up to dive** (flight-sim style), left/right to bank. Touch **anywhere on the left half** to **boost** (once you've bought a Boost upgrade) — it burns fuel for thrust. A **shadow + altitude line** on the ground show exactly how high you are. Real arcade flight physics: thrust, gravity, drag, lift, and terrain bounces. **A stock plane barely flies — upgrades are what unlock real distance.**
3. **Weave through the city** — a winding, Boston-style skyline rises ahead. Thread the gaps between buildings; clipping one knocks you back hard and bleeds your speed.
4. **Collect coins** floating through the 3D sky — they trace the safe lane between the buildings. Grab **flame fuel pickups** to refill your boost tank, fly through **glowing rings** to build a coin-multiplier combo and get a speed kick, and ride **thermal updrafts** for free altitude.
5. **Don't crash!** Clipping a building, blimp, crane, or bird flock ends the run instantly (with a debris burst and a beat of slow-mo).
6. **Travel through biomes** as you fly farther: City → Coast → Mountains → Space, each with its own sky, ground, and skyline.

> Flight tip: point the nose **down to pick up speed**, and **up to trade speed for height** — manage your energy to glide farther.

### Progression
- **Coins** buy upgrades: Launch Power, Boost Thrust, Fuel Tank, Aerodynamics, Wings & Lift, **Coin Magnet**, and **Coin Multiplier**.
- **Evolution** is earned by flying far — each best-distance milestone evolves your plane to a stronger, cooler tier (7 total).
- **Missions** (fly X meters, collect X coins, pass X rings) and a **daily login bonus** keep the coins flowing.
- Sound effects play throughout; phones that support web vibration get haptic feedback on rings, pickups, and crashes.
5. **Land** — when your plane comes to rest, you bank your **distance** and **coins earned** (collected coins + a distance bonus).
6. **Upgrade & evolve** — spend coins in the hangar on Launch Power, Boost Thrust, Fuel Tank, Aerodynamics, and Wings & Lift. Every few upgrades your plane **evolves** into a new, better-looking tier (7 tiers total).

Coins, upgrades, evolution tier, and your best distance are all saved on your device.

## Play it

It's a fully self-contained static site (`index.html`, `game.js`, plus a couple of assets). Three.js (r128, MIT-licensed) is **vendored locally** in `vendor/`, so the game needs no CDN or external network access to run.

### GitHub Pages
1. In this repo, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions** (the included workflow handles the rest).
3. After a minute, open the published URL on your iPhone's browser.

> Tip: On iPhone, tap **Share → Add to Home Screen** to play fullscreen like a native app.

### Run locally
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files
- `index.html` — page shell, title / hangar-shop / results screens, in-flight HUD, iOS web-app meta tags, Three.js include.
- `game.js` — the full 3D game (Three.js scene, flight physics, terrain, coins, upgrade shop, evolution).
- `vendor/three.min.js` — Three.js r128 (MIT), vendored so the game runs with no CDN.
- `manifest.webmanifest` + `icon.svg` — installable web-app metadata and icon.
- `test/headless_test.cjs` — Node test that mocks Three.js + DOM and drives a full run.
- `.github/workflows/static.yml` — auto-deploys to GitHub Pages.

## Tech notes
- Three.js (WebGL) for 3D rendering; a custom arcade flight model for physics.
- Infinite-feeling terrain via a world-anchored heightfield mesh that re-centers on the plane.
- Caps device pixel ratio for mobile performance and prevents iOS scroll/zoom for clean touch play.
