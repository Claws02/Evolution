# Plane Evolution 3D ✈️

A **3D** browser slingshot launch-and-fly distance game, built to play on an iPhone (or any phone/desktop) with no install. Inspired by the launch-and-fly arcade genre — all 3D geometry is built procedurally with [Three.js](https://threejs.org/); no external 3D assets and all game code here is original.

## How to play

1. **Launch from the catapult** — your plane sits on a slingshot launcher. **Drag toward where you want to fly** and the plane aims as you drag: drag **up** for a steep climb, flatter for a long low shot, and **left/right to veer** that way. Drag **distance** sets power. A dotted **trajectory arc** previews the exact shot; release in the sweet-spot band for a **PERFECT LAUNCH** (extra speed + fuel). Releasing fires the catapult with a smoke-and-spark kick.
2. **Fly to the finish** — every level has an **end**: reach the 🏁 finish gate to clear it and advance to the next level. A **fixed joystick** controls the **right ~70% of the screen** (press anywhere there to fly relative to its center: push **down to climb, up to dive**, left/right to bank). The **left ~28% is the boost tap zone** (once you own a Boost upgrade). Tap **⏸** any time to pause and reach Settings.
3. **Work for your speed** — this is a demanding flyer. A stock plane sinks fast and stalls; you have to **dive to build speed**, spend boost, catch rings, and ride thermals to keep moving. Upgrades are what let you sustain a cruise.
4. **Mind the limits** — the land is a **corridor flanked by open sea on both sides**: stray over the water and you ditch. Climb too high and you **lose cabin pressure** — the thin air bleeds your speed and pulls you down, so you can't just float above everything.
5. **Dodge a huge gauntlet of hazards** — buildings, **wind turbines**, **dropping boulders**, **rotating bars**, blinking **laser gates**, **wind-gust** + **dust-devil/tornado** zones, **erupting geysers**, **cable-cars**, **fireworks** that burst on a timer, swooping **raptors**, tumbling **debris fields**, swinging **wrecking-ball pendulums**, rising/falling **hot-air balloons**, darting **drones**, cranes, and bird flocks. Each zone has its own themed mix. Clipping anything crashes you (debris + slow-mo).
6. **Thread the gates & weave the canyons** — gap-walls span the corridor (line up **altitude and lateral position**; gaps go high/low, drift, and chain into fast **slaloms**). **Canyons** are walls that jut in alternately from the **left and right** — a serpentine weave that tightens and (later) breathes in and out. **Tunnels** add a low overpass you must duck *under*. Coins sit on the risky line — tighter lines pay more.
7. **Collect & combo** — grab coins, refill at **fuel pickups**, chain **rings** for a coin-multiplier combo + speed kick, and ride **thermal updrafts** for altitude.
8. **Grab sky power-ups** — floating power-ups mostly help but occasionally hurt: **Full Tank**, **Unlimited Boost (10s)**, **Coin Frenzy (×3)**, **Magnet Burst**, **Feather** (easy lift) — and the odd **Empty Tank** or **Heavy Air**. Mystery boxes (?) roll a (usually good) random one.

### Campaign & zones (a trip around the world)
- A **12-level campaign** that travels the globe — each level is a **place with its own short story**: Neo-Tokyo → a Mojave wind farm → the Aegean coast → Petra's canyons → Dutch lowlands → a Gulf skyline → Nordic ice → Amalfi → the Grand Canyon → the Sahara → Manhattan → the finale **"Cloud Nine."** Beat it for a 🏆 **Campaign Complete**, then keep going in **Endless**.
- Levels get **longer as you progress** (early ones are short to get you going; a fully-upgraded plane needs ~90 s on the longest).
- Each place has its own sky, ground, terrain shape, and **hazard mix**.
- **Star ratings** per level: ★ finish · ★ beat par time · ★ catch enough rings. Your best stars are saved and totalled.

### Loadout perks (pick one per run)
In the hangar choose a perk for the next run: **Full Tanks** (+50% boost fuel), **Coin Rush** (coins ×2 + wider magnet), **Head Start** (faster launch + full fuel), or **Updraft** (extra lift all run).

### Store
A separate **Store** (🛍 in the hangar) sells the **Coin Magnet** and **Coin Multiplier** boosters, plus **plane skins** you can buy and equip to recolor your aircraft.

### Style / combo scoring
Chain **rings** and **skim hazards** for near-misses to build a coin-multiplier combo (shown as `×N`). The combo decays if you play it safe, so flying stylishly — not just far — pays off.

### Progression
- **Coins** buy upgrades: Launch Power, Boost Thrust, Fuel Tank, Aerodynamics, Wings & Lift, **Coin Magnet**, and **Coin Multiplier**. Coins are scarce on purpose — upgrades are an investment.
- **Evolution** is earned by **completing levels** — each level cleared evolves your plane to a stronger, cooler tier.
- **Missions** (fly X metres, collect X coins, pass X rings) and a **daily login bonus** top up your coins.

### Settings, offline & performance
- **Settings** (⚙ on the title screen, or ⏸ pause in flight): joystick sensitivity, invert pitch, sound on/off, haptics on/off, and graphics quality (Auto/High/Low).
- **Installable PWA with offline play** — a service worker caches the whole app (including the vendored Three.js), so after the first load it runs with no network. Add to Home Screen for a fullscreen, app-like experience.
- **Adaptive performance guard** — in Auto quality the game watches the frame rate and dials back pixel ratio / draw distance on slower devices.
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
