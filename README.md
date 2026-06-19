# Sky Evolution 🛩️

An endless **plane-evolution flyer** for the browser, built to be played on an iPhone (or any phone/desktop) with no app install. Inspired by the plane-evolution arcade genre — all artwork is drawn procedurally on an HTML5 canvas and all code here is original.

## How to play

- **Drag anywhere** on the screen to fly your plane (your finger is the joystick).
- Your plane **fires automatically**.
- Destroy enemies — balloons, fighters, and blimps — to drop glowing green **evolution orbs**.
- Orbs are pulled toward you. Collect them to fill the **EVOLUTION** bar at the top.
- Fill the bar to **morph into a stronger, deadlier aircraft** (8 tiers). Each evolution heals you and adds firepower.
- Avoid enemy fire and collisions. You have a row of hearts at the bottom-left — lose them all and you're shot down.
- Survive as long as you can to maximize your **score** and **evolution tier**.

Your best score and best evolution are saved on your device.

## Play it

It's a static site (just `index.html`, `game.js`, and a couple of assets), so it can be hosted anywhere.

### GitHub Pages
1. In this repo, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
3. Pick the branch this is on and the `/ (root)` folder, then **Save**.
4. After a minute, open the published URL on your iPhone's browser.

> Tip: On iPhone, tap the **Share** button and **Add to Home Screen** to play it fullscreen like a native app.

### Run locally
Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000 on a device on the same network
```

## Files
- `index.html` — page shell, start / game-over screens, iOS web-app meta tags.
- `game.js` — the full game (rendering, physics, spawning, evolution system).
- `manifest.webmanifest` + `icon.svg` — installable web-app metadata and icon.

## Tech notes
- Pure vanilla JS + Canvas 2D — no dependencies, no build step.
- Handles device pixel ratio, resizes to the viewport, and prevents iOS scroll/zoom for a clean touch experience.
