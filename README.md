# Plane Evolution 3D ✈️

A **3D** browser slingshot launch-and-fly distance game, built to play on an iPhone (or any phone/desktop) with no install. Inspired by the launch-and-fly arcade genre — all 3D geometry is built procedurally with [Three.js](https://threejs.org/); no external 3D assets and all game code here is original.

## How to play

1. **Launch** — on the runway, **drag back and release** (like a slingshot). A power meter fills as you pull; a harder pull launches faster and steeper.
2. **Fly** — once airborne, **hold the screen to boost** 🔥 (limited fuel) and **steer with your finger**: move it up to climb, down to dive, left/right to bank. Dive to build speed, then pull up to soar — real arcade flight physics (thrust, gravity, drag, lift, and terrain bounces).
3. **Collect coins** floating through the 3D sky.
4. **Land** — when your plane comes to rest, you bank your **distance** and **coins earned** (collected coins + a distance bonus).
5. **Upgrade & evolve** — spend coins in the hangar on Launch Power, Boost Thrust, Fuel Tank, Aerodynamics, and Wings & Lift. Every few upgrades your plane **evolves** into a new, better-looking tier (7 tiers total).

Coins, upgrades, evolution tier, and your best distance are all saved on your device.

## Play it

It's a static site (`index.html`, `game.js`, plus a couple of assets). Three.js is loaded from a CDN (jsDelivr) at runtime, so the device needs internet access the first time.

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
- `manifest.webmanifest` + `icon.svg` — installable web-app metadata and icon.
- `.github/workflows/pages.yml` — auto-deploys to GitHub Pages.

## Tech notes
- Three.js (WebGL) for 3D rendering; a custom arcade flight model for physics.
- Infinite-feeling terrain via a world-anchored heightfield mesh that re-centers on the plane.
- Caps device pixel ratio for mobile performance and prevents iOS scroll/zoom for clean touch play.
