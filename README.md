# Plane Evolution ✈️

A browser **slingshot launch-and-fly distance game**, built to play on an iPhone (or any phone/desktop) with no install. Inspired by the launch-and-fly arcade genre — all artwork is drawn procedurally on an HTML5 canvas and all code here is original.

## How to play

1. **Launch** — on the launch screen, **drag back from the plane and release** (like a slingshot). The drag direction sets the angle; the length sets the power. A dotted line previews your trajectory.
2. **Fly** — once airborne, **tap & hold anywhere to boost** 🔥 (limited fuel). Use gravity, glide, and bounce off the rolling hills to keep your speed and fly as far as possible.
3. **Collect coins** scattered through the sky during your flight.
4. **Land** — when your plane comes to rest, you bank your **distance** and **coins earned** (collected coins + a distance bonus).
5. **Upgrade & evolve** — spend coins in the hangar on Launch Power, Boost Thrust, Fuel Tank, Aerodynamics, and Wings & Bounce. Every few upgrades your plane **evolves** into a new, better-looking tier (7 tiers total).

Goal: chase a new **best distance** each run. Coins, upgrades, evolution tier, and your best distance are all saved on your device.

## Play it

It's a static site (`index.html`, `game.js`, plus a couple of assets), so it can be hosted anywhere.

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
- `index.html` — page shell, title / hangar-shop / results screens, iOS web-app meta tags.
- `game.js` — the full game (slingshot launch, flight physics, terrain, coins, upgrade shop, evolution).
- `manifest.webmanifest` + `icon.svg` — installable web-app metadata and icon.
- `.github/workflows/pages.yml` — auto-deploys to GitHub Pages.

## Tech notes
- Pure vanilla JS + Canvas 2D — no dependencies, no build step.
- Physics-based flight: gravity, drag, lift, and slope-aware ground bounces.
- Handles device pixel ratio, resizes to the viewport, and prevents iOS scroll/zoom for clean touch play.
