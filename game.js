/* Plane Evolution 3D — an original slingshot launch-and-fly distance game.
   Rendered with Three.js (WebGL). Original flight-physics model:
   thrust, gravity, drag, lift, velocity alignment, and terrain bounce.
   All geometry is built procedurally; no external 3D assets. */
(() => {
"use strict";

const loadingEl = document.getElementById("loading");
if (typeof THREE === "undefined") {
  loadingEl.innerHTML = "Couldn't load the 3D engine.<br>Check your internet connection and reload.";
  return;
}

// ---------- Utility ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const choice = arr => arr[Math.floor(Math.random() * arr.length)];
const TAU = Math.PI * 2, DEG = Math.PI / 180;

// ---------- Sound (WebAudio) + haptics ----------
const Sound = (() => {
  let ctx = null, enabled = true;
  function ac() {
    if (ctx) return ctx;
    const AC = (typeof window !== "undefined") && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; }
    return ctx;
  }
  function tone(freq, dur, type, gain, slideTo) {
    if (!enabled) return;
    const c = ac(); if (!c) return;
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(gain || 0.18, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  }
  function noise(dur, gain) {
    if (!enabled) return;
    const c = ac(); if (!c) return;
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.setValueAtTime(gain || 0.3, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    src.connect(g); g.connect(c.destination); src.start();
  }
  return {
    setEnabled(v) { enabled = !!v; },
    resume() { if (!enabled) return; const c = ac(); if (c && c.state === "suspended") { try { c.resume(); } catch (e) {} } },
    coin()   { tone(900, 0.10, "square", 0.10, 1350); },
    ring()   { tone(440, 0.18, "sawtooth", 0.16, 950); },
    fuel()   { tone(330, 0.16, "sine", 0.16, 680); },
    boost()  { noise(0.3, 0.10); },
    crash()  { noise(0.5, 0.5); tone(130, 0.45, "sawtooth", 0.3, 40); },
    evolve() { tone(523, 0.5, "triangle", 0.2, 1046); },
  };
})();
function haptic(p) { try { if (save && save.settings && !save.settings.haptics) return; if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

// ---------- Terrain height field (a land corridor flanked by sea on both sides) ----------
const CORRIDOR = 120;      // playable land half-width; |x| beyond this is open sea = no-go
const SEA_Y = -6;          // sea surface height
function terrainAmp() { return curZone ? curZone.amp : 1.0; }  // set per level
function terrainH(x, z) {
  // rolling base + a sharper ridge line so the ground actually has hills and valleys
  let h = Math.sin(x * 0.013) * 5
        + Math.sin(z * 0.009) * 8
        + Math.sin((x + z) * 0.006) * 11
        + Math.sin(z * 0.025 + x * 0.012) * 4
        + Math.abs(Math.sin(z * 0.0045 + x * 0.004)) * 10;   // ridges
  h *= terrainAmp();
  // flatten the runway area around the start
  const flat = clamp(z / 130, 0, 1);
  h *= flat;
  // shoreline: land slopes down into the sea past the corridor edges
  const ax = Math.abs(x);
  if (ax > CORRIDOR - 25) {
    const t = clamp((ax - (CORRIDOR - 25)) / 55, 0, 1);
    h = lerp(h, SEA_Y - 4, t);
  }
  return h;
}
// Meandering "safe lane" the coins/gaps follow — kept well inside the corridor
function laneX(z) { return Math.sin(z * 0.008) * 34 + Math.sin(z * 0.021 + 1.3) * 14; }

// ---------- Upgrades & evolution ----------
// Main hangar shop: the five flight upgrades (keeps the core loadout tight).
const UPGRADES = [
  { key: "power",  ico: "🚀", name: "Launch Power",  max: 8, baseCost: 65, growth: 1.62 },
  { key: "boost",  ico: "🔥", name: "Boost Thrust",  max: 8, baseCost: 80, growth: 1.62 },
  { key: "fuel",   ico: "⛽", name: "Fuel Tank",     max: 8, baseCost: 70, growth: 1.62 },
  { key: "aero",   ico: "🪶", name: "Aerodynamics",  max: 8, baseCost: 90, growth: 1.66 },
  { key: "wings",  ico: "🛩", name: "Wings & Lift",   max: 8, baseCost: 95, growth: 1.66 },
];
// Store boosters (bought separately, with coins).
const BOOSTERS = [
  { key: "magnet", ico: "🧲", name: "Coin Magnet",     max: 6, baseCost: 110, growth: 1.66 },
  { key: "mult",   ico: "✨", name: "Coin Multiplier", max: 6, baseCost: 140, growth: 1.72 },
];
const ALL_UP = UPGRADES.concat(BOOSTERS);
// Plane skins (cosmetic recolors) sold in the Store; "default" uses the evolution-tier colors.
const SKINS = [
  { key: "default", name: "Standard", cost: 0 },
  { key: "crimson", name: "Crimson Arrow", cost: 600,  body: 0xff5a5a, accent: 0x9b1b1b },
  { key: "midnight",name: "Midnight",      cost: 900,  body: 0x2b3a8a, accent: 0x6a78ff },
  { key: "jade",    name: "Jade Dragon",   cost: 1200, body: 0x3fd08a, accent: 0x0f6b46 },
  { key: "gold",    name: "Golden Eagle",  cost: 2000, body: 0xffd454, accent: 0xb8860b },
  { key: "neon",    name: "Neon Pulse",    cost: 2600, body: 0x39ffe0, accent: 0xff2bd6 },
];
const TIERS = [
  { name: "Paper Glider", body: 0xeef4ff, accent: 0xb9d3ff, scale: 0.9 },
  { name: "Prop Scout",   body: 0xbfe6ff, accent: 0x7fb8ff, scale: 1.0 },
  { name: "Sport Flyer",  body: 0xa9f0c4, accent: 0x4fd08a, scale: 1.08 },
  { name: "Jet Racer",    body: 0xffe49a, accent: 0xffb43d, scale: 1.16 },
  { name: "Sky Rocket",   body: 0xffb98a, accent: 0xff7a3d, scale: 1.24 },
  { name: "Star Cruiser", body: 0xffa6c9, accent: 0xff5fa0, scale: 1.32 },
  { name: "Aether Wing",  body: 0xcdb4ff, accent: 0x9a6bff, scale: 1.42 },
];

// ---------- Save ----------
const SAVE_KEY = "pe3d_save_v1";
let save;
function loadSave() {
  try { save = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { save = null; }
  if (!save || typeof save !== "object") save = {};
  save.coins = save.coins || 0;
  save.best = save.best || 0;
  save.level = save.level || 0;
  save.won = save.won || false;
  save.stars = (save.stars && typeof save.stars === "object") ? save.stars : {};
  save.perk = save.perk || "none";
  save.up = save.up || {};
  for (const u of ALL_UP) save.up[u.key] = save.up[u.key] || 0;
  save.skins = (save.skins && typeof save.skins === "object") ? save.skins : { default: 1 };
  save.skins.default = 1;
  save.skin = save.skin || "default";
  if (!Array.isArray(save.missions) || save.missions.length < 3) save.missions = [makeMission(), makeMission(), makeMission()];
  save.lastDaily = save.lastDaily || "";
  save.settings = Object.assign({ invert: false, sens: 1.0, sound: true, haptics: true, quality: "auto" }, save.settings || {});
  save.tier = computeTier();
}
function persist() { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
function lvl(k) { return save.up[k] || 0; }
function upgradeCost(u) { return Math.round(u.baseCost * Math.pow(u.growth, lvl(u.key))); }
// Evolution is earned by progress: completing levels evolves your plane to the next tier.
function computeTier() { return clamp(save.level || 0, 0, TIERS.length - 1); }

// ---------- Three.js setup ----------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
const SKY = 0x9fd4ff;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 350, 1100);

const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 4000);
camera.position.set(0, 8, -16);

// lights
const hemi = new THREE.HemisphereLight(0xcfeaff, 0x6a8b53, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3d0, 0.95);
sun.position.set(80, 160, 40);
scene.add(sun);

// sun billboard
{
  const sg = new THREE.SpriteMaterial({ map: makeGlowTexture("rgba(255,250,220,1)"), transparent: true, depthWrite: false });
  const sunSprite = new THREE.Sprite(sg);
  sunSprite.scale.set(180, 180, 1);
  sunSprite.position.set(420, 360, 900);
  scene.add(sunSprite);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- Quality / performance guard ----------
const MAX_DPR = Math.min(window.devicePixelRatio || 1, 2);
let qFog = 1;              // fog distance multiplier (lower = closer = cheaper)
let qLevel = "high";      // current applied quality
function applyQuality(q) {
  qLevel = q;
  if (q === "low") { renderer.setPixelRatio(Math.min(MAX_DPR, 1)); qFog = 0.75; }
  else { renderer.setPixelRatio(MAX_DPR); qFog = 1; }
}
// adaptive monitor (only active when setting is "auto")
let fpsAccum = 0, fpsFrames = 0, fpsTimer = 0;
function perfTick(dt) {
  const mode = save && save.settings ? save.settings.quality : "auto";
  if (mode === "low") { if (qLevel !== "low") applyQuality("low"); return; }
  if (mode === "high") { if (qLevel !== "high") applyQuality("high"); return; }
  // auto
  fpsAccum += dt; fpsFrames++; fpsTimer += dt;
  if (fpsTimer >= 1.5) {
    const fps = fpsFrames / fpsAccum;
    if (fps < 42 && qLevel !== "low") applyQuality("low");
    else if (fps > 56 && qLevel !== "high") applyQuality("high");
    fpsAccum = 0; fpsFrames = 0; fpsTimer = 0;
  }
}

// ---------- Textures ----------
function makeGlowTexture(color) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, color); grd.addColorStop(0.4, color.replace(/1\)$/, "0.6)"));
  grd.addColorStop(1, color.replace(/1\)$/, "0)"));
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}
function makeCloudTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255,255,255,0)"; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 6; i++) {
    const x = rand(35, 93), y = rand(45, 83), r = rand(22, 40);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, "rgba(255,255,255,0.95)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  return new THREE.CanvasTexture(c);
}
function makeShadowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(0,0,0,0.55)"); grd.addColorStop(0.6, "rgba(0,0,0,0.32)"); grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---------- Terrain mesh (the land corridor — fixed at x=0, scrolls only in z) ----------
const T_W = 380, T_D = 1500, T_WSEG = 30, T_DSEG = 90;
const cellZ = T_D / T_DSEG;
const terrainGeo = new THREE.PlaneGeometry(T_W, T_D, T_WSEG, T_DSEG);
terrainGeo.rotateX(-Math.PI / 2); // lie flat in XZ; Y is height
const terrainMat = new THREE.MeshLambertMaterial({ color: 0x67c267, flatShading: true });
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
scene.add(terrain);
let terrainSnapZ = NaN;
const FORWARD_BIAS = 380;
function updateTerrain(px, pz) {
  const sz = Math.round((pz + FORWARD_BIAS) / cellZ) * cellZ;
  if (sz === terrainSnapZ) return;
  terrainSnapZ = sz;
  terrain.position.set(0, 0, sz);   // corridor stays centered on x=0
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i), lz = pos.getZ(i);
    pos.setY(i, terrainH(lx, sz + lz));
  }
  pos.needsUpdate = true;
  terrainGeo.computeVertexNormals();
}

// ---------- Sea (flanks the corridor on both sides) ----------
const seaGeo = new THREE.PlaneGeometry(4000, 4000, 1, 1);
seaGeo.rotateX(-Math.PI / 2);
const seaMat = new THREE.MeshLambertMaterial({ color: 0x2f7fd6 });
const sea = new THREE.Mesh(seaGeo, seaMat);
sea.position.y = SEA_Y;
scene.add(sea);
function updateSea(px, pz) { sea.position.set(0, SEA_Y, pz); } // follows forward; flat so no snapping needed

// ---------- Launcher (a slingshot catapult the plane fires from) ----------
const launcher = new THREE.Group();
{
  const metal = new THREE.MeshStandardMaterial({ color: 0x46505e, metalness: 0.6, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b323c, metalness: 0.5, roughness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.8 });
  // base slab
  const base = new THREE.Mesh(new THREE.BoxGeometry(16, 1.6, 22), dark); base.position.set(0, 0.4, 4); launcher.add(base);
  // angled launch ramp the plane rides up
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(7, 0.7, 16), metal);
  ramp.position.set(0, 2.0, 6); ramp.rotation.x = -0.22; launcher.add(ramp);
  // side rails
  for (const sx of [-3.6, 3.6]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 16), metal);
    rail.position.set(sx, 2.6, 6); rail.rotation.x = -0.22; launcher.add(rail);
  }
  // two slingshot posts at the back, with a crossbar + elastic band
  for (const sx of [-4.4, 4.4]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 9, 10), metal);
    post.position.set(sx, 4.5, -3.5); launcher.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 9.6, 8), metal);
  bar.rotation.z = Math.PI / 2; bar.position.set(0, 8.6, -3.5); launcher.add(bar);
  // elastic band (a pouch + two lines) — we move the pouch back while aiming
  const band = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.0, 0.6), rubber);
  band.position.set(0, 5, -1); launcher.add(band);
  launcher.userData.band = band;
  scene.add(launcher);
}
let launchAnimT = 0; // brief recoil/smoke after firing
function updateLauncher(dt, aimPower) {
  // keep the rig parked at the start; hide it once you've flown well past it
  launcher.visible = pos.z < 220;
  if (!launcher.visible) return;
  const band = launcher.userData.band;
  if (state === "aim") {
    band.position.z = -1 - aimPower * 4.5;   // stretch the sling back as you pull
    band.position.y = 5 - aimPower * 1.5;
  } else if (launchAnimT > 0) {
    launchAnimT = Math.max(0, launchAnimT - dt);
    band.position.z = lerp(3, -1, 1 - launchAnimT / 0.35);  // snap forward
  } else { band.position.set(0, 5, -1); }
}

// ---------- Clouds ----------
const cloudTex = makeCloudTexture();
const clouds = [];
for (let i = 0; i < 30; i++) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: rand(0.7, 0.95), depthWrite: false }));
  const s = rand(40, 110); m.scale.set(s * 1.6, s, 1);
  m.position.set(rand(-300, 300), rand(40, 220), rand(-200, 1600));
  scene.add(m); clouds.push(m);
}

// ---------- Coins ----------
const coinGeo = new THREE.TorusGeometry(1.6, 0.55, 8, 18);
coinGeo.rotateY(Math.PI / 2); // face along Z so it reads as a ring ahead
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffcf3a, metalness: 0.7, roughness: 0.35, emissive: 0x5a3f00 });
const COIN_COUNT = 46;
const coins = [];
let coinFarZ = 0;
for (let i = 0; i < COIN_COUNT; i++) {
  const mesh = new THREE.Mesh(coinGeo, coinMat);
  scene.add(mesh);
  coins.push({ mesh, x: 0, y: 0, z: 0, got: false });
}
function placeCoin(c) {
  coinFarZ += rand(26, 60);
  c.z = coinFarZ;
  // follow the winding safe lane so coins lead you through gaps between buildings
  c.x = laneX(c.z) + rand(-12, 12);
  c.y = terrainH(c.x, c.z) + rand(11, 55);
  c.got = false;
  c.mesh.visible = true;
  c.mesh.position.set(c.x, c.y, c.z);
}
function resetCoins() {
  coinFarZ = 70;
  for (const c of coins) placeCoin(c);
}

// ---------- Ground shadow + altitude line (depth cues) ----------
const shadowMesh = (() => {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false, opacity: 0.6 });
  const m = new THREE.Mesh(geo, mat);
  scene.add(m);
  return m;
})();
// thin vertical pole from the plane down to its shadow — makes altitude unmistakable
const altLine = (() => {
  const geo = new THREE.CylinderGeometry(0.16, 0.16, 1, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0x10202f, transparent: true, opacity: 0.28, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  scene.add(m);
  return m;
})();
function updateShadow() {
  const gh = terrainH(pos.x, pos.z);
  const alt = clamp(pos.y - gh, 0, 200);
  const k = clamp(alt / 150, 0, 1);
  shadowMesh.position.set(pos.x, gh + 0.2, pos.z);
  const s = lerp(7, 20, k);              // tighter when low, larger when high
  shadowMesh.scale.set(s, s, s);
  shadowMesh.material.opacity = lerp(0.62, 0.16, k); // stays visible even up high
  shadowMesh.visible = true;
  // altitude pole
  altLine.position.set(pos.x, gh + alt / 2, pos.z);
  altLine.scale.set(1, Math.max(0.01, alt), 1);
  altLine.visible = alt > 2;
}

// ---------- City (Boston-style irregular blocks with windows + rooftops) ----------
function makeWindowTexture() {
  const c = document.createElement("canvas"); c.width = 64; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#aeb6c0"; g.fillRect(0, 0, 64, 128);          // facade
  const cols = 5, rows = 11, mx = 7, my = 6;
  const ww = (64 - mx * (cols + 1)) / cols, wh = (128 - my * (rows + 1)) / rows;
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    const lit = Math.random();
    g.fillStyle = lit < 0.18 ? "#fff2b0" : (lit < 0.5 ? "#3c4654" : "#5a6675");
    g.fillRect(mx + col * (ww + mx), my + r * (wh + my), ww, wh);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}
const CITY_HALF = 108;               // buildings stay inside the land corridor
const CITY_START_Z = 170;            // open runway before the skyline begins
const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
const roofGeo = new THREE.BoxGeometry(1, 1, 1);
const winTex = makeWindowTexture();
const cityTints = [0xc8d0da, 0xb6c0cc, 0xd2c9b6, 0xc6cdd4, 0xbcae9c, 0xa9b3bd];
const cityMats = cityTints.map(c => new THREE.MeshLambertMaterial({ color: c, map: winTex }));
const roofMats = [0x5b636e, 0x6b5a48, 0x49525c].map(c => new THREE.MeshLambertMaterial({ color: c }));
const BUILDING_COUNT = 70;
const buildings = [];
for (let i = 0; i < BUILDING_COUNT; i++) {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, cityMats[i % cityMats.length]); grp.add(body);
  const roof = new THREE.Mesh(roofGeo, roofMats[i % roofMats.length]); grp.add(roof);
  grp.visible = false; scene.add(grp);
  buildings.push({ grp, body, roof, x: 0, z: 0, w: 0, d: 0, topY: 0, active: false });
}
let genZ = 0, rowSlots = [];
function buildRow(z) {
  const L = laneX(z), gap = rand(30, 46);
  const downtown = Math.sin(z * 0.0032) > 0.35;   // periodic tall financial-district clusters
  const slots = [];
  let x = -CITY_HALF + rand(0, 14);
  while (x < CITY_HALF) {
    const w = rand(12, 26), d = rand(12, 26);
    const cx = x + w / 2;
    if (Math.abs(cx - L) > gap) {
      let h = downtown ? rand(45, 130) : rand(16, 60);
      if (Math.random() < 0.12) h += rand(20, 60);
      slots.push({ x: cx, w, d, h });
    }
    x += w + rand(8, 24);
  }
  return slots;
}
function nextPlacement() {
  if (!curZone.build) return null;     // only city-type zones have buildings
  let guard = 0;
  while (rowSlots.length === 0) {
    genZ += rand(40, 78);
    if (genZ > curLevelLen - 60) return null;  // stop before the finish line
    rowSlots = buildRow(genZ);
    if (++guard > 60) return null;
  }
  const s = rowSlots.pop();
  return { x: s.x, z: genZ, w: s.w, d: s.d, h: s.h };
}
function placeBuilding(b) {
  const p = nextPlacement();
  if (!p) { b.active = false; b.grp.visible = false; b.z = 1e7; return; }
  const gh = terrainH(p.x, p.z);
  b.x = p.x; b.z = p.z; b.w = p.w; b.d = p.d; b.topY = gh + p.h; b.active = true; b.near = false;
  b.body.scale.set(p.w, p.h, p.d); b.body.position.y = p.h / 2;
  const rh = rand(1.5, 4.5);
  b.roof.scale.set(p.w * 1.05, rh, p.d * 1.05); b.roof.position.y = p.h + rh / 2;
  b.grp.position.set(p.x, gh, p.z); b.grp.visible = true;
}
function resetCity() {
  genZ = CITY_START_Z; rowSlots = [];
  for (const b of buildings) placeBuilding(b);
}

// ---------- Boost-fuel pickups (refill your boost tank mid-flight) ----------
const flameGeo = new THREE.ConeGeometry(1.5, 3.4, 12);
const fuelBaseGeo = new THREE.CylinderGeometry(1.7, 1.7, 0.7, 12);
const flameMat = new THREE.MeshStandardMaterial({ color: 0xff7a1f, emissive: 0xff4400, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.5 });
const fuelBaseMat = new THREE.MeshStandardMaterial({ color: 0x2c333d, metalness: 0.5, roughness: 0.5 });
const FUEL_COUNT = 12;
const fuels = [];
for (let i = 0; i < FUEL_COUNT; i++) {
  const grp = new THREE.Group();
  const fl = new THREE.Mesh(flameGeo, flameMat); fl.position.y = 2.1; grp.add(fl);
  const base = new THREE.Mesh(fuelBaseGeo, fuelBaseMat); base.position.y = 0.35; grp.add(base);
  grp.visible = false; scene.add(grp);
  fuels.push({ grp, x: 0, y: 0, z: 0, got: false });
}
let fuelFarZ = 0;
const FUEL_REFILL = 0.5; // fraction of the tank each pickup restores
function placeFuel(f) {
  fuelFarZ += rand(170, 320);
  f.z = fuelFarZ;
  f.x = laneX(f.z) + rand(-12, 12);
  f.y = terrainH(f.x, f.z) + rand(16, 50);
  f.got = false;
  f.grp.visible = true;
  f.grp.position.set(f.x, f.y, f.z);
}
function resetFuels() {
  fuelFarZ = 130;
  for (const f of fuels) placeFuel(f);
}

// ---------- Sky power-ups (mostly help, occasionally hurt) ----------
const POWERS = {
  fuelFull: { color: 0x5effb0, good: true,  label: "⛽ FULL TANK!" },
  mega:     { color: 0xffd454, good: true,  label: "🚀 UNLIMITED BOOST 10s" },
  frenzy:   { color: 0xffe27a, good: true,  label: "💰 COIN FRENZY ×3" },
  magnet:   { color: 0x49e0ff, good: true,  label: "🧲 MAGNET BURST" },
  shrink:   { color: 0xb6f0ff, good: true,  label: "🪁 FEATHER (easy lift) 8s" },
  fuelEmpty:{ color: 0xff5b5b, good: false, label: "💨 TANK EMPTIED!" },
  stall:    { color: 0x9a6bff, good: false, label: "🌀 HEAVY AIR!" },
};
// weighted spawn pool (helpful far more common than harmful)
const POWER_BAG = ["fuelFull","fuelFull","mega","frenzy","frenzy","magnet","shrink","mystery","mystery","fuelEmpty","stall"];
const powGlowTex = makeGlowTexture("rgba(255,255,255,1)");
const powGeo = new THREE.OctahedronGeometry(2.2, 0);
const POW_COUNT = 7;
const powers = [];
for (let i = 0; i < POW_COUNT; i++) {
  const grp = new THREE.Group();
  const core = new THREE.Mesh(powGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.4 }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: powGlowTex, transparent: true, opacity: 0.6, depthWrite: false }));
  glow.scale.set(9, 9, 1); grp.add(glow); grp.add(core);
  grp.visible = false; scene.add(grp);
  powers.push({ grp, core, glow, x: 0, y: 0, z: 0, type: "fuelFull", got: false });
}
let powFarZ = 0;
function placePower(p) {
  powFarZ += rand(340, 620);
  p.z = powFarZ; p.x = laneX(p.z) + rand(-40, 40); p.y = terrainH(p.x, p.z) + rand(22, 64);
  p.type = choice(POWER_BAG);
  const def = p.type === "mystery" ? { color: 0xff2bd6 } : POWERS[p.type];
  if (p.core.material.color && p.core.material.color.setHex) p.core.material.color.setHex(def.color);
  if (p.core.material.emissive && p.core.material.emissive.setHex) p.core.material.emissive.setHex(def.color);
  if (p.glow.material.color && p.glow.material.color.setHex) p.glow.material.color.setHex(def.color);
  p.got = false; p.grp.visible = true; p.grp.position.set(p.x, p.y, p.z);
}
function resetPowers() { powFarZ = 240; for (const p of powers) placePower(p); }
function applyPower(type) {
  if (type === "mystery") { // usually good, small chance bad
    const pool = Math.random() < 0.78 ? ["fuelFull", "mega", "frenzy", "magnet", "shrink"] : ["fuelEmpty", "stall"];
    type = choice(pool);
  }
  const def = POWERS[type];
  switch (type) {
    case "fuelFull": boostFuel = boostMax; break;
    case "fuelEmpty": boostFuel = 0; break;
    case "mega": megaBoostT = 10; break;
    case "frenzy": frenzyT = 8; break;
    case "magnet": magnetBurstT = 6; break;
    case "shrink": featherT = 8; break;
    case "stall": stallT = 5; break;
  }
  goalBanner(def.label);
  if (def.good) { Sound.fuel(); spawnBurst(pos.x, pos.y, pos.z, def.color, 12, 16); }
  else { Sound.crash(); spawnBurst(pos.x, pos.y, pos.z, def.color, 14, 18); shakeT = Math.max(shakeT, 0.25); }
  haptic(def.good ? 15 : [30, 20, 30]);
}

// ---------- Particle / debris pool ----------
const partGeo = new THREE.BoxGeometry(1, 1, 1);
const PART_COUNT = 170;
const parts = [];
for (let i = 0; i < PART_COUNT; i++) {
  const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
  m.visible = false; scene.add(m);
  parts.push({ m, vx: 0, vy: 0, vz: 0, life: 0, max: 1, active: false });
}
let partCursor = 0;
function spawnBurst(x, y, z, color, count, speed, size) {
  for (let i = 0; i < count; i++) {
    const p = parts[partCursor]; partCursor = (partCursor + 1) % PART_COUNT;
    p.active = true; p.life = p.max = rand(0.4, 0.9);
    if (p.m.material.color && p.m.material.color.setHex) p.m.material.color.setHex(color);
    const s = size || rand(0.4, 1.1); p.m.scale.set(s, s, s);
    p.m.position.set(x, y, z); p.m.visible = true; p.m.material.opacity = 1;
    const a = rand(0, TAU), sp = speed || rand(8, 26);
    p.vx = Math.cos(a) * sp; p.vy = rand(2, 1) + Math.abs(rand(2, 18)); p.vz = Math.sin(a) * sp;
  }
}
// A proper firework: a big colorful sphere of sparks (two colors) that arc and fall, plus a flash.
function spawnFirework(x, y, z) {
  const palette = [0xff5b8a, 0xffd454, 0x49e0ff, 0x7dffb0, 0xff8a2a, 0xc79bff, 0xffffff];
  const cA = choice(palette), cB = choice(palette), n = 44;
  for (let i = 0; i < n; i++) {
    const p = parts[partCursor]; partCursor = (partCursor + 1) % PART_COUNT;
    p.active = true; p.life = p.max = rand(0.9, 1.7);
    if (p.m.material.color && p.m.material.color.setHex) p.m.material.color.setHex(i % 5 === 0 ? 0xffffff : (i % 2 ? cA : cB));
    const s = rand(0.6, 1.3); p.m.scale.set(s, s, s);
    p.m.position.set(x, y, z); p.m.visible = true; p.m.material.opacity = 1;
    // even spherical spray so it reads as a starburst
    const a = rand(0, TAU), e = Math.acos(rand(-1, 1)), sp = rand(28, 62);
    p.vx = Math.sin(e) * Math.cos(a) * sp; p.vy = Math.cos(e) * sp + 8; p.vz = Math.sin(e) * Math.sin(a) * sp;
  }
}
function updateParts(dt) {
  for (const p of parts) {
    if (!p.active) continue;
    p.life -= dt; if (p.life <= 0) { p.active = false; p.m.visible = false; continue; }
    p.vy -= 32 * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    p.m.material.opacity = clamp(p.life / p.max, 0, 1);
    p.m.rotation.x += dt * 4; p.m.rotation.y += dt * 5;
  }
}

// ---------- Rings / boost gates ----------
const ringGeo = new THREE.TorusGeometry(7, 0.7, 8, 24);
const ringMat = new THREE.MeshStandardMaterial({ color: 0x49e0ff, emissive: 0x0c5066, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.4 });
const RING_COUNT = 6, RING_R = 7;
const rings = [];
for (let i = 0; i < RING_COUNT; i++) {
  const m = new THREE.Mesh(ringGeo, ringMat); m.visible = false; scene.add(m);
  rings.push({ m, x: 0, y: 0, z: 0, passed: false });
}
let ringFarZ = 0;
function placeRing(r) {
  ringFarZ += rand(130, 240);
  r.z = ringFarZ; r.x = laneX(r.z) + rand(-14, 14); r.y = terrainH(r.x, r.z) + rand(22, 55);
  r.passed = false; r.m.visible = true; r.m.position.set(r.x, r.y, r.z);
}
function resetRings() { ringFarZ = 120; for (const r of rings) placeRing(r); }

// ---------- Thermals / updrafts ----------
const thermalGeo = new THREE.CylinderGeometry(11, 8, 70, 16, 1, true);
const thermalMat = new THREE.MeshBasicMaterial({ color: 0xbdf0ff, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
const THERMAL_COUNT = 4, THERMAL_R = 12;
const thermals = [];
for (let i = 0; i < THERMAL_COUNT; i++) {
  const m = new THREE.Mesh(thermalGeo, thermalMat); m.visible = false; scene.add(m);
  thermals.push({ m, x: 0, z: 0, top: 0 });
}
let thermalFarZ = 0;
function placeThermal(t) {
  thermalFarZ += rand(300, 560);
  t.z = thermalFarZ; t.x = laneX(t.z) + rand(-34, 34);
  const gh = terrainH(t.x, t.z); t.top = gh + 80;
  t.m.visible = true; t.m.position.set(t.x, gh + 35, t.z);
}
function resetThermals() { thermalFarZ = 220; for (const t of thermals) placeThermal(t); }

// ---------- Obstacles (blimps, cranes, birds, rising balloons, swinging pendulums) ----------
const OBS_TYPES = ["blimp", "crane", "bird", "balloon", "pendulum", "drone", "turbine", "rock", "spinbar", "laser", "gust", "tornado", "geyser", "cablecar", "firework", "raptor", "debris", "lightning", "avalanche", "mine", "log", "billboard", "sandstorm", "waterfall"];
const obstacles = [];
const PEND_ARM = 24;
const OBS_COUNT = 32;
// corridor-spanning wall dimensions (also used by sandstorm/waterfall side panels)
const WALL_HALF = CORRIDOR + 12, WALL_TOP = 200;   // walls reach above the cabin ceiling -> must use the gap
function buildObstacle(type) {
  const g = new THREE.Group();
  if (type === "blimp") {
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8584f, roughness: 0.6 }));
    body.scale.set(9, 4.5, 5); g.add(body);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3, 3.4),
      new THREE.MeshStandardMaterial({ color: 0xb8403a })); fin.position.set(-8.5, 0, 0); g.add(fin);
    const car = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x444a55 })); car.position.y = -4.6; g.add(car);
  } else if (type === "crane") {
    const yel = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.6 });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 2.4), yel); g.add(mast); g.userData.mast = mast;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(46, 2, 2.4), yel); g.add(arm); g.userData.arm = arm;
    const cw = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 3), new THREE.MeshStandardMaterial({ color: 0x555a63 }));
    g.userData.cw = cw; g.add(cw);
  } else if (type === "balloon") { // hot-air balloon that rises and falls
    const env = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xff6f6f, roughness: 0.5 }));
    env.scale.set(5, 6, 5); env.position.y = 3; g.add(env);
    const stripe = new THREE.Mesh(new THREE.SphereGeometry(1.02, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffd454, roughness: 0.5 }));
    stripe.scale.set(5, 1.6, 5); stripe.position.y = 3; g.add(stripe);
    const basket = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2a })); basket.position.y = -3; g.add(basket);
  } else if (type === "pendulum") { // wrecking ball swinging across the lane
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.5, roughness: 0.5 });
    const mount = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 4), steel); g.add(mount);
    const armG = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, PEND_ARM, 0.8), steel);
    arm.position.y = -PEND_ARM / 2; armG.add(arm);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(3.4, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0x444a55, metalness: 0.4, roughness: 0.6 }));
    ball.position.y = -PEND_ARM; armG.add(ball);
    g.add(armG); g.userData.swing = armG;
  } else if (type === "drone") { // fast erratic quad-drone
    const dm = new THREE.MeshStandardMaterial({ color: 0x33363d, metalness: 0.5, roughness: 0.5 });
    const rm = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0x6a0000, emissiveIntensity: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 2.2), dm); g.add(body);
    for (const [ax, az] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.3, 10), rm);
      rotor.position.set(ax, 0.5, az); g.add(rotor);
    }
  } else if (type === "turbine") { // wind turbine — spinning blades you fly around/over/under
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.6 });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.8, 1, 10), white); g.add(tower); g.userData.tower = tower;
    const hub = new THREE.Group();
    hub.add(new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), white));
    for (let i = 0; i < 3; i++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(2.2, 22, 0.5), white);
      bl.position.y = 11; bl.rotation.z = i * (TAU / 3); // pivot at hub
      const holder = new THREE.Group(); holder.rotation.z = i * (TAU / 3);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.8, 22, 0.5), white); blade.position.y = 11; holder.add(blade);
      hub.add(holder);
    }
    g.add(hub); g.userData.hub = hub;
  } else if (type === "rock") { // boulder that drops, then resets
    const rm = new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 0.95 });
    const rk = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 6), rm); rk.scale.set(1, 0.85, 1.1); g.add(rk);
  } else if (type === "spinbar") { // rotating bar sweeping the lane
    const m = new THREE.MeshStandardMaterial({ color: 0xb04a3a, metalness: 0.4, roughness: 0.5 });
    const hub = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), m); g.add(hub);
    const barG = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(64, 1.6, 1.6), m); barG.add(bar);
    g.add(barG); g.userData.bar = barG;
  } else if (type === "laser") { // toggling laser gate
    const post = new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.6, roughness: 0.4 });
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff2b4d, transparent: true, opacity: 0.9 });
    for (const sx of [-CORRIDOR, CORRIDOR]) { const p = new THREE.Mesh(new THREE.BoxGeometry(3, 8, 3), post); p.position.set(sx, 0, 0); g.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(CORRIDOR * 2, 1.4, 1.4), beamMat); g.add(beam); g.userData.beam = beam;
  } else if (type === "gust") { // wind zone that shoves you sideways (not lethal, but risky)
    const gm = new THREE.MeshBasicMaterial({ color: 0xdfe9f0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 80, 14, 1, true), gm);
    g.add(wall); g.userData.wisp = wall;
  } else if (type === "tornado") { // dust devil that drags you toward its core
    const tm = new THREE.MeshBasicMaterial({ color: 0xb59668, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(4, 14, 90, 14, 1, true), tm);
    cone.position.y = 45; g.add(cone); g.userData.swirl = cone;
  } else if (type === "geyser") { // erupts a column upward on a timer
    const rockM = new THREE.MeshStandardMaterial({ color: 0x5a6470, roughness: 0.9 });
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(4, 5.5, 3, 12), rockM); vent.position.y = 1.5; g.add(vent);
    const colM = new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.6, depthWrite: false });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, 1, 12), colM); col.visible = false; g.add(col); g.userData.col = col;
  } else if (type === "cablecar") { // a cable across the lane with a sliding gondola
    const steel = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.5, roughness: 0.5 });
    for (const sx of [-CORRIDOR, CORRIDOR]) { const p = new THREE.Mesh(new THREE.BoxGeometry(3, 80, 3), steel); p.position.set(sx, 40, 0); g.add(p); }
    const cable = new THREE.Mesh(new THREE.BoxGeometry(CORRIDOR * 2, 0.8, 0.8), steel); g.add(cable); g.userData.cable = cable;
    const car = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), new THREE.MeshStandardMaterial({ color: 0xd23b3b }));
    g.add(car); g.userData.car = car;
  } else if (type === "firework") { // shell that rises then bursts on a timer
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3, 1.4), new THREE.MeshStandardMaterial({ color: 0x33363d }));
    tube.position.y = 1.5; g.add(tube);
    const rocket = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
    rocket.visible = false; g.add(rocket); g.userData.rocket = rocket;
    const burst = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.85, depthWrite: false }));
    burst.visible = false; g.add(burst); g.userData.burst = burst;
  } else if (type === "raptor") { // big bird that swoops toward you
    const rm = new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.7 });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), rm));
    for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.ConeGeometry(1.3, 6, 4), rm); w.rotation.z = sx * Math.PI / 2; w.position.x = sx * 3; g.add(w); }
  } else if (type === "debris") { // tumbling chunk cluster to weave
    const dm = new THREE.MeshStandardMaterial({ color: 0x808892, roughness: 0.9 });
    for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(rand(1.6, 3), 7, 6), dm); c.position.set(rand(-5, 5), rand(-5, 5), rand(-5, 5)); g.add(c); }
  } else if (type === "lightning") { // storm cloud that strikes a bolt down a column
    const cm = new THREE.MeshStandardMaterial({ color: 0x47506a, roughness: 0.9 });
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), cm); cloud.scale.set(13, 5, 9); g.add(cloud);
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), new THREE.MeshBasicMaterial({ color: 0xbfe6ff }));
    bolt.visible = false; g.add(bolt); g.userData.bolt = bolt;
  } else if (type === "avalanche") { // snow wall sweeping across the lane
    const sm = new THREE.MeshStandardMaterial({ color: 0xeaf2f7, roughness: 0.9 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(42, 1, 8), sm); g.add(wall); g.userData.wall = wall;
  } else if (type === "mine") { // floating spiked mine
    const mm = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.5, roughness: 0.6 });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(3, 12, 10), mm));
    for (const d of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2, 6), new THREE.MeshStandardMaterial({ color: 0x8a2020 }));
      sp.position.set(d[0] * 3.6, d[1] * 3.6, d[2] * 3.6); g.add(sp);
    }
  } else if (type === "log") { // log swinging on ropes across the lane
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 });
    const swing = new THREE.Group();
    const rope = new THREE.Mesh(new THREE.BoxGeometry(0.3, PEND_ARM, 0.3), new THREE.MeshStandardMaterial({ color: 0x3a2e1f })); rope.position.y = -PEND_ARM / 2; swing.add(rope);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 12, 10), wood); log.rotation.x = Math.PI / 2; log.position.y = -PEND_ARM; swing.add(log);
    g.add(swing); g.userData.swing = swing;
  } else if (type === "billboard") { // sign panel sliding across
    const post = new THREE.MeshStandardMaterial({ color: 0x444a55 });
    for (const sx of [-7, 7]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 1), post); p.position.set(sx, -8, 0); g.add(p); }
    const panel = new THREE.Mesh(new THREE.BoxGeometry(20, 11, 1), new THREE.MeshStandardMaterial({ color: 0xdd4488, emissive: 0x441022, emissiveIntensity: 0.4 }));
    g.add(panel); g.userData.panel = panel;
  } else if (type === "sandstorm") { // dust wall with a sliding open gap
    const dm = new THREE.MeshBasicMaterial({ color: 0xcaa86a, transparent: true, opacity: 0.55, depthWrite: false });
    const left = new THREE.Mesh(new THREE.BoxGeometry(1, WALL_TOP, 4), dm);
    const right = new THREE.Mesh(new THREE.BoxGeometry(1, WALL_TOP, 4), dm);
    g.add(left, right); g.userData.left = left; g.userData.right = right;
  } else if (type === "waterfall") { // water curtain with a gap; pushes you down
    const wm = new THREE.MeshBasicMaterial({ color: 0x6fc3ff, transparent: true, opacity: 0.5, depthWrite: false });
    const left = new THREE.Mesh(new THREE.BoxGeometry(1, WALL_TOP, 3), wm);
    const right = new THREE.Mesh(new THREE.BoxGeometry(1, WALL_TOP, 3), wm);
    g.add(left, right); g.userData.left = left; g.userData.right = right;
  } else { // bird flock — a few V shapes
    const bm = new THREE.MeshStandardMaterial({ color: 0x2c2c38, roughness: 0.7 });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.4, 4), bm);
      b.rotation.z = Math.PI / 2; b.position.set(rand(-4, 4), rand(-2, 2), rand(-3, 3)); g.add(b);
    }
  }
  g.visible = false; scene.add(g);
  return g;
}
for (let i = 0; i < OBS_COUNT; i++) {
  const type = OBS_TYPES[i % OBS_TYPES.length];
  obstacles.push({ grp: buildObstacle(type), type, x: 0, y: 0, z: 0, drift: 0, t: 0, active: false });
}
let obsFarZ = 0;
const OBS_START_Z = 520; // hazards begin once you're flying well
// lay out a two-panel barrier (sandstorm / waterfall) leaving an open gap of width gw centred at gapX
function sideGapLayout(o, gapX, gw) {
  const u = o.grp.userData;
  const lEdge = gapX - gw / 2, rEdge = gapX + gw / 2;
  const lw = Math.max(1, lEdge - (-WALL_HALF));
  u.left.scale.x = lw; u.left.position.set((-WALL_HALF + lEdge) / 2, WALL_TOP / 2, 0);
  const rw = Math.max(1, WALL_HALF - rEdge);
  u.right.scale.x = rw; u.right.position.set((rEdge + WALL_HALF) / 2, WALL_TOP / 2, 0);
}
function placeObstacle(o) {
  // per-zone hazard mix: only the obstacle types this zone uses are active
  if (!curZone.obs || curZone.obs.indexOf(o.type) < 0) { o.active = false; o.grp.visible = false; o.z = 1e7; return; }
  const dense = 1 - Math.min(save.level, 6) * 0.06;   // hazards pack tighter in later levels
  obsFarZ += rand(150, 320) * dense;
  o.z = obsFarZ;
  o.t = rand(0, TAU);
  const gh = terrainH(laneX(o.z), o.z);
  if (o.type === "crane") {
    o.x = laneX(o.z) + (Math.random() < 0.5 ? -1 : 1) * rand(20, 55);
    o.mastH = rand(55, 110); o.armY = gh + o.mastH; o.armRot = rand(0, TAU);
    o.grp.userData.mast.scale.set(1, o.mastH, 1);
    o.grp.userData.mast.position.y = o.mastH / 2;
    o.grp.userData.arm.position.y = o.mastH; o.grp.userData.arm.rotation.y = o.armRot;
    o.grp.userData.cw.position.set(0, o.mastH, 0);
    o.y = gh; o.grp.position.set(o.x, gh, o.z);
  } else if (o.type === "blimp") {
    o.x = laneX(o.z) + rand(-30, 30); o.y = gh + rand(35, 70); o.drift = rand(-6, 6);
    o.grp.position.set(o.x, o.y, o.z);
  } else if (o.type === "balloon") {
    o.x = laneX(o.z) + rand(-40, 40); o.baseY = gh + rand(34, 56);
    o.amp = rand(14, 26); o.phase = rand(0, TAU); o.y = o.baseY;
    o.grp.position.set(o.x, o.y, o.z);
  } else if (o.type === "pendulum") {
    o.x = laneX(o.z) + rand(-20, 20); o.pivotY = gh + PEND_ARM + rand(24, 40);
    o.amp = rand(0.7, 1.05); o.phase = rand(0, TAU); o.swingSpd = rand(1.1, 1.8);
    o.y = o.pivotY; o.grp.position.set(o.x, o.pivotY, o.z);
  } else if (o.type === "drone") {
    o.x = laneX(o.z) + rand(-30, 30); o.baseY = gh + rand(26, 58);
    o.amp = rand(26, 50); o.phase = rand(0, TAU); o.swingSpd = rand(1.6, 2.6);
    o.y = o.baseY; o.grp.position.set(o.x, o.y, o.z);
  } else if (o.type === "turbine") {
    o.x = clamp(laneX(o.z) + (Math.random() < 0.5 ? -1 : 1) * rand(20, 60), -CORRIDOR + 24, CORRIDOR - 24);
    o.towerH = rand(40, 70); o.bladeR = 22; o.hubY = gh + o.towerH; o.spin = rand(1.2, 2.4) * (Math.random() < 0.5 ? 1 : -1);
    o.grp.userData.tower.scale.set(1, o.towerH, 1); o.grp.userData.tower.position.set(0, o.towerH / 2, 0);
    o.grp.userData.hub.position.set(0, o.towerH, 1.5);
    o.grp.position.set(o.x, gh, o.z);
  } else if (o.type === "rock") {
    o.x = laneX(o.z) + rand(-26, 26); o.topY = gh + rand(85, 130); o.groundY = gh + 2;
    o.fallSpd = rand(38, 62); o.phase = rand(0, 1); o.y = o.topY; o.grp.position.set(o.x, o.y, o.z);
  } else if (o.type === "spinbar") {
    o.x = laneX(o.z) + rand(-16, 16); o.hubY = gh + rand(30, 58); o.spin = rand(1.0, 1.9) * (Math.random() < 0.5 ? 1 : -1); o.phase = rand(0, TAU);
    o.grp.position.set(o.x, o.hubY, o.z);
  } else if (o.type === "laser") {
    o.x = 0; o.beamY = terrainH(0, o.z) + rand(20, 70); o.period = rand(1.8, 2.8); o.phase = rand(0, TAU);
    o.grp.userData.beam.position.y = o.beamY; o.grp.position.set(0, 0, o.z);
  } else if (o.type === "gust") {
    o.x = laneX(o.z) + rand(-30, 30); o.push = (Math.random() < 0.5 ? -1 : 1) * rand(40, 70); o.r = 14;
    o.grp.position.set(o.x, terrainH(o.x, o.z) + 36, o.z);
  } else if (o.type === "tornado") {
    o.x = laneX(o.z) + rand(-50, 50); o.drift = rand(-9, 9); o.r = 16;
    o.grp.position.set(o.x, gh, o.z);
  } else if (o.type === "geyser") {
    o.x = laneX(o.z) + rand(-30, 30); o.period = rand(2.4, 3.6); o.phase = rand(0, 1);
    o.ventY = gh; o.colTop = gh + rand(64, 100); o.r = 7;
    o.grp.position.set(o.x, gh, o.z);
  } else if (o.type === "cablecar") {
    o.x = 0; o.cableY = terrainH(0, o.z) + rand(30, 70); o.spd = rand(0.6, 1.2); o.phase = rand(0, TAU);
    o.grp.userData.cable.position.y = o.cableY;
    o.grp.position.set(0, 0, o.z);
  } else if (o.type === "firework") {
    o.x = laneX(o.z) + rand(-30, 30); o.by = gh + rand(28, 64); o.period = rand(2.0, 3.0); o.phase = rand(0, 1); o.r = 11;
    o.grp.userData.burst.position.set(0, o.by - gh, 0);
    o.grp.position.set(o.x, gh, o.z);
  } else if (o.type === "raptor") {
    o.x = laneX(o.z) + rand(-24, 24); o.y = gh + rand(30, 62); o.spd = rand(10, 16); o.phase = rand(0, TAU);
    o.grp.position.set(o.x, o.y, o.z);
  } else if (o.type === "debris") {
    o.x = laneX(o.z) + rand(-34, 34); o.y = gh + rand(30, 72); o.drift = rand(-8, 8); o.r = 7;
    o.grp.position.set(o.x, o.y, o.z);
  } else if (o.type === "lightning") {
    o.x = laneX(o.z) + rand(-30, 30); o.cloudY = gh + rand(82, 108); o.period = rand(2.6, 3.8); o.phase = rand(0, 1);
    const bh = o.cloudY - gh; o.grp.userData.bolt.scale.set(1, bh, 1); o.grp.userData.bolt.position.y = -bh / 2;
    o.grp.position.set(o.x, o.cloudY, o.z);
  } else if (o.type === "avalanche") {
    o.spd = rand(0.5, 0.9); o.phase = rand(0, TAU); o.wallTop = gh + rand(40, 66);
    o.grp.userData.wall.scale.set(1, o.wallTop - gh, 1); o.grp.userData.wall.position.y = (o.wallTop - gh) / 2;
    o.grp.position.set(0, gh, o.z);
  } else if (o.type === "mine") {
    o.x = laneX(o.z) + rand(-34, 34); o.y = gh + rand(28, 64); o.phase = rand(0, TAU); o.grp.position.set(o.x, o.y, o.z);
  } else if (o.type === "log") {
    o.x = laneX(o.z) + rand(-16, 16); o.pivotY = gh + PEND_ARM + rand(20, 36); o.amp = rand(0.7, 1.05); o.phase = rand(0, TAU); o.swingSpd = rand(0.9, 1.5);
    o.grp.position.set(o.x, o.pivotY, o.z);
  } else if (o.type === "billboard") {
    o.x = 0; o.panelY = terrainH(0, o.z) + rand(28, 60); o.spd = rand(0.5, 1.0); o.phase = rand(0, TAU);
    o.grp.position.set(0, o.panelY, o.z);
  } else if (o.type === "sandstorm") {
    o.gw = rand(48, 62); o.spd = rand(0.4, 0.8); o.phase = rand(0, TAU); o.gapX = 0;
    o.grp.position.set(0, terrainH(0, o.z), o.z); sideGapLayout(o, 0, o.gw);
  } else if (o.type === "waterfall") {
    o.gw = rand(44, 58); o.gapX = clamp(laneX(o.z) + rand(-26, 26), -CORRIDOR + o.gw / 2 + 6, CORRIDOR - o.gw / 2 - 6);
    o.grp.position.set(0, terrainH(0, o.z), o.z); sideGapLayout(o, o.gapX, o.gw);
  } else { // bird
    o.x = laneX(o.z) + rand(-30, 30); o.y = gh + rand(25, 60); o.drift = rand(-10, 10);
    o.grp.position.set(o.x, o.y, o.z);
  }
  o.active = true; o.near = false; o.grp.visible = true;
}
function resetObstacles() { obsFarZ = OBS_START_Z; for (const o of obstacles) placeObstacle(o); }

// ---------- Barriers: walls across the corridor with a single gap you must thread ----------
// You have to line up BOTH your altitude and your lateral position with the gap, or you crash.
// (WALL_HALF / WALL_TOP are declared above, near the obstacle pool, so sandstorm/waterfall can use them.)
const BARRIER_COUNT = 6;
const barriers = [];
const barrierCoinGeo = new THREE.TorusGeometry(1.4, 0.5, 8, 16);
function buildBarrier() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7d8794, metalness: 0.3, roughness: 0.75 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x49e0ff, emissive: 0x0c5066, emissiveIntensity: 0.7 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  const left = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  const right = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 6, 4), frameMat); // diamond hint around gap
  frame.rotation.z = Math.PI / 4;
  // risk/reward: a little coin line sitting right in the gap
  const gapCoins = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(barrierCoinGeo, coinMat); c.rotation.y = Math.PI / 2; gapCoins.push(c); g.add(c);
  }
  g.add(top, bottom, left, right, frame);
  g.visible = false; scene.add(g);
  g.userData = { mat, top, bottom, left, right, frame, gapCoins };
  return g;
}
for (let i = 0; i < BARRIER_COUNT; i++) {
  barriers.push({ grp: buildBarrier(), kind: "wall", z: 0, gx: 0, gw: 40, gyLo: 0, gyHi: 0, gh: 36, baseGy: 60, passed: false, gotCoins: false, active: false, move: 0, mphase: 0 });
}
let barFarZ = 0, slalomLeft = 0, slalomHigh = false, spurSide = -1;
function placeBarrier(b) {
  const dense = 1 - Math.min(save.level, 6) * 0.05;
  const topGy = Math.min(CEILING - 6, 112);
  const canyonZone = curZone.gate === "canyon";
  // spacing: tight serpentine in canyons, tight runs during slaloms, spaced gap-walls otherwise
  if (slalomLeft > 0) { barFarZ += rand(120, 170); slalomLeft--; }
  else if (canyonZone) { barFarZ += rand(120, 200); }
  else {
    barFarZ += rand(360, 620) * dense;
    if (save.level >= 2 && Math.random() < 0.35) { slalomLeft = 1 + (Math.random() < 0.5 ? 1 : 2); slalomHigh = Math.random() < 0.5; }
  }
  if (barFarZ > curLevelLen - 120) { b.active = false; b.grp.visible = false; b.z = 1e7; return; }
  b.z = barFarZ;

  // choose kind: canyon zones use alternating side SPURS; otherwise gap-WALLS (mix can roll either)
  let kind = canyonZone ? "spur" : (curZone.gate === "mix" ? (Math.random() < 0.5 ? "wall" : "spur") : "wall");
  if (slalomActive()) kind = "wall";   // slalom chains are always gap-walls
  b.kind = kind;

  if (kind === "spur") {
    spurSide = -spurSide;                       // alternate left/right for a weaving canyon
    b.side = spurSide;
    const maxProt = 2 * CORRIDOR - 56;          // always leave a flyable lane
    b.baseProt = clamp(rand(50, 92 + Math.min(save.level, 8) * 7), 44, maxProt);
    b.protrude = b.baseProt;
    b.move = save.level >= 5 ? rand(8, 20) : 0; b.mphase = rand(0, TAU); b.mspd = rand(0.5, 1.0);
    if (b.grp.userData.mat.color && b.grp.userData.mat.color.setHex) b.grp.userData.mat.color.setHex(0x7a5d3f);
  } else {
    const gw = rand(38, 50), gh = rand(30, 40);
    let gy;
    if (slalomActive()) { gy = slalomHigh ? rand(72, topGy - gh / 2) : rand(gh / 2 + 12, 48); slalomHigh = !slalomHigh; }
    else gy = rand(gh / 2 + 12, topGy - gh / 2);
    const gx = clamp(laneX(b.z) + rand(-30, 30), -CORRIDOR + gw / 2 + 6, CORRIDOR - gw / 2 - 6);
    b.gx = gx; b.gw = gw; b.gyLo = gy - gh / 2; b.gyHi = gy + gh / 2; b.gh = gh; b.baseGy = gy;
    b.move = (save.level >= 4 && !slalomActive()) ? rand(6, 14) : 0; b.mphase = rand(0, TAU);
    if (b.grp.userData.mat.color && b.grp.userData.mat.color.setHex) b.grp.userData.mat.color.setHex(0x7d8794);
  }
  layoutBarrier(b);
  placeBarrierCoins(b);
  b.active = true; b.passed = false; b.gotCoins = false; b.grp.visible = true;
  b.grp.position.set(0, 0, b.z);
}
function spurInnerX(b) { return b.side < 0 ? -CORRIDOR + b.protrude : CORRIDOR - b.protrude; }
function spurOpenCenter(b) { return b.side < 0 ? (spurInnerX(b) + CORRIDOR) / 2 : (spurInnerX(b) - CORRIDOR) / 2; }
function placeBarrierCoins(b) {
  const cx = b.kind === "spur" ? spurOpenCenter(b) : b.gx;
  const cy = b.kind === "spur" ? 50 : (b.gyLo + b.gyHi) / 2;
  b.grp.userData.gapCoins.forEach((c, i) => { c.visible = true; c.position.set(cx, cy, (i - 1) * 5); });
}
function slalomActive() { return slalomLeft > 0; }
function layoutBarrier(b) {
  const u = b.grp.userData, D = 4;
  if (b.kind === "spur") {                       // a rock wall jutting in from one side
    const inner = spurInnerX(b);
    const outer = b.side < 0 ? -WALL_HALF : WALL_HALF;
    const w = Math.abs(inner - outer);
    u.left.scale.set(Math.max(1, w), WALL_TOP, D); u.left.position.set((inner + outer) / 2, WALL_TOP / 2, 0);
    u.right.scale.set(0.001, 0.001, 0.001);
    u.bottom.scale.set(0.001, 0.001, 0.001);
    u.top.scale.set(0.001, 0.001, 0.001);
    u.frame.visible = false;
    return;
  }
  const gyLo = b.gyLo, gyHi = b.gyHi, gxLo = b.gx - b.gw / 2, gxHi = b.gx + b.gw / 2;
  // left panel (full height)
  u.left.scale.set(gxLo + WALL_HALF, WALL_TOP, D); u.left.position.set((-WALL_HALF + gxLo) / 2, WALL_TOP / 2, 0);
  // right panel
  u.right.scale.set(WALL_HALF - gxHi, WALL_TOP, D); u.right.position.set((gxHi + WALL_HALF) / 2, WALL_TOP / 2, 0);
  // bottom panel (under the gap)
  u.bottom.scale.set(b.gw, gyLo, D); u.bottom.position.set(b.gx, gyLo / 2, 0);
  // top panel (above the gap)
  u.top.scale.set(b.gw, WALL_TOP - gyHi, D); u.top.position.set(b.gx, (gyHi + WALL_TOP) / 2, 0);
  // gap frame hint (only for gap-walls; canyons read from the rock channel itself)
  if (b.kind === "canyon") { u.frame.visible = false; }
  else {
    u.frame.visible = true;
    u.frame.scale.set(b.gw * 0.62, (gyHi - gyLo) * 0.62, 1);
    u.frame.position.set(b.gx, (gyLo + gyHi) / 2, 0.3);
  }
}
function resetBarriers() { barFarZ = 380; slalomLeft = 0; slalomHigh = false; spurSide = -1; for (const b of barriers) placeBarrier(b); }

// ---------- Tunnels: a low overpass you must duck UNDER (the inverse of the cabin ceiling) ----------
const TUN_COUNT = 3;
const tunnels = [];
function buildTunnel() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.25, roughness: 0.85 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffd454, emissive: 0x5a4300, emissiveIntensity: 0.5 });
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(WALL_HALF * 2, 10, 1), mat); g.add(ceil); g.userData.ceil = ceil;
  const lip = new THREE.Mesh(new THREE.BoxGeometry(WALL_HALF * 2, 1.4, 1.4), stripeMat); g.add(lip); g.userData.lip = lip; // height marker at the mouth
  g.visible = false; scene.add(g);
  return g;
}
for (let i = 0; i < TUN_COUNT; i++) tunnels.push({ grp: buildTunnel(), z: 0, len: 160, ceilY: 55, active: false, near: false });
let tunFarZ = 0;
function placeTunnel(t) {
  if (!curZone.tunnel) { t.active = false; t.grp.visible = false; t.z = 1e7; return; }
  tunFarZ += rand(520, 880);
  if (tunFarZ > curLevelLen - 200) { t.active = false; t.grp.visible = false; t.z = 1e7; return; }
  t.z = tunFarZ; t.len = rand(150, 240); t.ceilY = rand(40, 60);
  const u = t.grp.userData;
  u.ceil.scale.set(1, 1, t.len); u.ceil.position.set(0, t.ceilY + 5, 0);
  u.lip.position.set(0, t.ceilY, -t.len / 2);
  t.grp.position.set(0, 0, t.z); t.active = true; t.near = false; t.grp.visible = true;
}
function resetTunnels() { tunFarZ = 700; for (const t of tunnels) placeTunnel(t); }

// ---------- Levels (discrete zones; reach the FINISH to advance to the next level) ----------
// Length ramps with level so early levels are beatable, while a maxed plane needs ~90s on the
// longest ones (LEVEL_TIME * NOMINAL_CRUISE). Early levels are short to build momentum/retention.
const LEVEL_TIME = 90;            // target seconds for a maxed plane to clear a full-length level
const NOMINAL_CRUISE = 100;       // approx forward speed (units/s) a maxed plane sustains
const LEVEL_LEN = LEVEL_TIME * NOMINAL_CRUISE; // = 9000, the cap a level length ramps toward
function levelLength(n) {
  if (typeof CAMPAIGN !== "undefined" && n < CAMPAIGN_LEN) return CAMPAIGN[n].len;
  return Math.round(Math.min(LEVEL_LEN + 1500, 7000 + n * 400)); // endless gets longer
}
let curLevelLen = 2200;
const LEVELS = [
  { key: "city",   name: "Metropolis", sky: 0x9fd4ff, fog: 0xc3e6ff, ground: 0x67c267, edge: 0x2f7fd6, hs: 0xcfeaff, hg: 0x6a8b53, amp: 1.0, build: true,  fogNear: 350, fogFar: 1100, obs: ["crane", "pendulum", "drone", "spinbar", "firework", "billboard"], gate: "wall",   tunnel: false },
  { key: "coast",  name: "Coastline",  sky: 0x7ec8ff, fog: 0xbfe6ff, ground: 0xe9d59c, edge: 0x2f7fd6, hs: 0xd5efff, hg: 0xc2a96e, amp: 0.6, build: false, fogNear: 380, fogFar: 1250, obs: ["bird", "balloon", "gust", "cablecar", "mine", "waterfall"],     gate: "wall",   tunnel: false },
  { key: "canyon", name: "Canyon",     sky: 0xe9b27a, fog: 0xf0cfa0, ground: 0xb5713a, edge: 0x5a4a38, hs: 0xffe9cf, hg: 0x7a4a2a, amp: 1.4, build: false, fogNear: 280, fogFar: 1000, obs: ["rock", "bird", "raptor", "log", "waterfall"],               gate: "canyon", tunnel: false },
  { key: "desert", name: "Desert",     sky: 0xffcf94, fog: 0xffe2bc, ground: 0xd9a35a, edge: 0xcfa765, hs: 0xffe9cf, hg: 0xb5703a, amp: 1.3, build: false, fogNear: 340, fogFar: 1150, obs: ["turbine", "gust", "rock", "tornado", "sandstorm"],    gate: "wall",   tunnel: false },
  { key: "meadow", name: "Meadows",    sky: 0xaee4ff, fog: 0xd2f0ff, ground: 0x79cf52, edge: 0x2f7fd6, hs: 0xdaf5ff, hg: 0x5fa83f, amp: 0.8, build: false, fogNear: 380, fogFar: 1300, obs: ["bird", "balloon", "turbine", "log"],            gate: "mix",    tunnel: false },
  { key: "glacier",name: "Glacier",    sky: 0xd2eaff, fog: 0xeefaff, ground: 0xeaf2f7, edge: 0xbfe0f0, hs: 0xf0f8ff, hg: 0xbcd0dd, amp: 1.6, build: false, fogNear: 320, fogFar: 1200, obs: ["blimp", "bird", "rock", "geyser", "avalanche", "lightning"],         gate: "wall",   tunnel: true  },
  { key: "skycity",name: "Sky City",   sky: 0xc3e2ff, fog: 0xe0eeff, ground: 0x86c2a0, edge: 0x2f7fd6, hs: 0xe8f4ff, hg: 0x6aa080, amp: 1.0, build: true,  fogNear: 350, fogFar: 1150, obs: ["blimp", "drone", "laser", "spinbar", "debris", "cablecar", "lightning"], gate: "mix", tunnel: false },
];
// Curated campaign: a finite arc of 12 named levels with a finale, then endless beyond it.
// A trip around the world — each level is a place with its own little story.
const CAMPAIGN = [
  { zone: 0, len: 2200, name: "Neo-Tokyo",      story: "Take off through the neon canyons of the future city." },
  { zone: 3, len: 2500, name: "Mojave Wind Farm", story: "Skim a desert of spinning turbines and dust-devils." },
  { zone: 1, len: 2800, name: "Aegean Coast",   story: "Hug whitewashed cliffs above a turquoise sea." },
  { zone: 2, len: 3100, name: "Petra Canyons",  story: "Weave the rose-rock walls of the lost city." },
  { zone: 4, len: 3500, name: "Dutch Lowlands", story: "Low over green fields dotted with windmills." },
  { zone: 6, len: 3900, name: "Gulf Skyline",   story: "Thread a glittering skyline of glass towers." },
  { zone: 5, len: 4300, name: "Nordic Ice",     story: "Glide the silent blue light of a glacier." },
  { zone: 1, len: 4800, name: "Amalfi Run",     story: "Race the long cliffside road above the bay." },
  { zone: 2, len: 5400, name: "Grand Canyon",   story: "Serpentine the deepest red-rock gorge of all." },
  { zone: 3, len: 6200, name: "Sahara",         story: "Cross an endless dune sea under a blazing sun." },
  { zone: 0, len: 7200, name: "Manhattan",      story: "A marathon through the original concrete jungle." },
  { zone: 6, len: 9000, name: "Cloud Nine",     story: "FINALE — break through the clouds to the summit of the sky." },
];
const CAMPAIGN_LEN = CAMPAIGN.length;
function zoneForLevel(n) {
  if (n < CAMPAIGN_LEN) return LEVELS[CAMPAIGN[n].zone];
  return LEVELS[1 + (n % (LEVELS.length - 1))]; // endless: cycle the non-city zones
}
function levelName(n) { return n < CAMPAIGN_LEN ? CAMPAIGN[n].name : "Endless " + (n - CAMPAIGN_LEN + 1); }
let curZone = LEVELS[0];
function setColorHex(target, hex) { if (target && target.setHex) target.setHex(hex); }
function applyZone(z) {
  curZone = z;
  setColorHex(scene.background, z.sky);
  if (scene.fog) { setColorHex(scene.fog.color, z.fog); scene.fog.near = z.fogNear * qFog; scene.fog.far = z.fogFar * qFog; }
  setColorHex(terrainMat.color, z.ground);
  setColorHex(seaMat.color, z.edge || 0x2f7fd6);   // flanks: water, sand, rock or ice per zone
  setColorHex(hemi.color, z.hs);
  setColorHex(hemi.groundColor, z.hg);
}
function levelStory(n) { return n < CAMPAIGN_LEN ? (CAMPAIGN[n].story || "") : "Endless skies — how far can you go?"; }
function announceLevel() {
  const el = document.getElementById("levelName");
  if (el) {
    const prog = save.level < CAMPAIGN_LEN ? "LEVEL " + (save.level + 1) + "/" + CAMPAIGN_LEN : "ENDLESS";
    el.textContent = prog + " · " + levelName(save.level);
    el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 3400);
  }
  const st = document.getElementById("levelStory");
  if (st) {
    st.textContent = levelStory(save.level);
    st.classList.add("show"); clearTimeout(st._t); st._t = setTimeout(() => st.classList.remove("show"), 3400);
  }
}

// ---------- Finish gate (the single goal: the end of the level) ----------
const finishGate = (() => {
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x7dffb0, emissive: 0x0c5a30, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.4 });
  const bannerMat = new THREE.MeshStandardMaterial({ color: 0xffd454, emissive: 0x6a4e00, emissiveIntensity: 0.6 });
  const L = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 90, 10), postMat); L.position.set(-34, 45, 0); g.add(L);
  const R = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 90, 10), postMat); R.position.set(34, 45, 0); g.add(R);
  const top = new THREE.Mesh(new THREE.BoxGeometry(74, 9, 4), bannerMat); top.position.set(0, 86, 0); g.add(top);
  g.visible = false; scene.add(g);
  return g;
})();
function placeFinish() {
  finishGate.position.set(0, terrainH(0, curLevelLen), curLevelLen);
  finishGate.visible = true;
}

// ---------- Missions ----------
function makeMission() {
  const t = choice(["dist", "coins", "rings"]);
  if (t === "dist")  return { type: "dist",  target: choice([500, 1000, 1800, 2800]), reward: 120 };
  if (t === "coins") return { type: "coins", target: choice([20, 35, 55]),           reward: 100 };
  return                    { type: "rings", target: choice([3, 5, 8]),              reward: 150 };
}
function missionText(m) {
  if (m.type === "dist")  return `Fly ${m.target} m in one run`;
  if (m.type === "coins") return `Collect ${m.target} coins in a run`;
  return `Pass ${m.target} rings in a run`;
}
function evalMissions(stats) {
  let total = 0;
  for (let i = 0; i < save.missions.length; i++) {
    const m = save.missions[i];
    if ((stats[m.type] || 0) >= m.target) { total += m.reward; save.coins += m.reward; save.missions[i] = makeMission(); }
  }
  return total;
}

// ---------- Plane ----------
let plane = null;
function skinColors(t) {
  const s = SKINS.find(k => k.key === save.skin);
  if (s && s.key !== "default" && s.body !== undefined) return { body: s.body, accent: s.accent };
  return { body: t.body, accent: t.accent };
}
function buildPlane(tier) {
  if (plane) scene.remove(plane);
  const t = TIERS[tier];
  const sk = skinColors(t);
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: sk.body, metalness: 0.2, roughness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: sk.accent, metalness: 0.25, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x16335c, metalness: 0.3, roughness: 0.3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd454, metalness: 0.6, roughness: 0.3 });

  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 5.4, 16), body);
  fus.rotation.x = Math.PI / 2; g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.6, 16), body);
  nose.rotation.x = Math.PI / 2; nose.position.z = 3.3; g.add(nose);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 12), gold);
  spinner.rotation.x = Math.PI / 2; spinner.position.z = 4.15; g.add(spinner);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.22, 1.7), accent);
  wing.position.z = 0.3; g.add(wing);
  const tailH = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 1.0), accent);
  tailH.position.z = -2.4; g.add(tailH);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.3, 1.2), accent);
  fin.position.set(0, 0.7, -2.4); g.add(fin);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 12), dark);
  cockpit.scale.set(1, 0.7, 1.5); cockpit.position.set(0, 0.45, 0.8); g.add(cockpit);

  // engine flame (shown while boosting)
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.2, 12),
    new THREE.MeshBasicMaterial({ color: 0xffa12a, transparent: true, opacity: 0.9 }));
  flame.rotation.x = -Math.PI / 2; flame.position.z = -3.0; flame.visible = false;
  g.add(flame); g.userData.flame = flame;

  g.scale.setScalar(t.scale);
  g.rotation.order = "YXZ";
  scene.add(g);
  plane = g;
  return g;
}

// ---------- Plane trail ----------
const trailTex = makeGlowTexture("rgba(255,255,255,1)");
const TRAIL_COUNT = 26;
const trail = [];
for (let i = 0; i < TRAIL_COUNT; i++) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: trailTex, transparent: true, opacity: 0, depthWrite: false }));
  m.visible = false; scene.add(m); trail.push({ m, life: 0, max: 1 });
}
let trailCursor = 0, trailT = 0;
function emitTrail(x, y, z, big) {
  const p = trail[trailCursor]; trailCursor = (trailCursor + 1) % TRAIL_COUNT;
  p.life = p.max = big ? 0.6 : 0.4; p.m.visible = true;
  const s = big ? rand(3.5, 5) : rand(1.6, 2.6); p.m.scale.set(s, s, 1);
  p.m.position.set(x, y, z);
  if (p.m.material.color && p.m.material.color.setHex) p.m.material.color.setHex(big ? 0xffc46b : 0xffffff);
}
function updateTrail(dt) {
  for (const p of trail) {
    if (p.life <= 0) { if (p.m.visible) p.m.visible = false; continue; }
    p.life -= dt; p.m.material.opacity = clamp(p.life / p.max, 0, 1) * 0.6;
  }
}

// ---------- Launch trajectory arc (aim preview) ----------
const arcGeo = new THREE.SphereGeometry(0.9, 8, 6);
const arcMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
const ARC_COUNT = 18;
const arcDots = [];
for (let i = 0; i < ARC_COUNT; i++) { const m = new THREE.Mesh(arcGeo, arcMat); m.visible = false; scene.add(m); arcDots.push(m); }
function hideArc() { for (const m of arcDots) m.visible = false; }

// ---------- Game state ----------
let state = "title"; // title | hangar | aim | flight | result
const pos = new THREE.Vector3();
const vel = new THREE.Vector3();
let yaw = 0, pitch = 0, roll = 0;
let boostFuel = 0, boostMax = 0, boosting = false;
let runCoins = 0, lowSpeedT = 0, pendingEvoName = null, titleT = 0, shakeT = 0;
let comboMult = 1, ringsPassed = 0, runCoinPickups = 0, crashT = 0, prevZ = 0, levelCleared = false;
let flightTime = 0;        // time spent flying this run (for star ratings)
let megaBoostT = 0, frenzyT = 0, magnetBurstT = 0, featherT = 0, stallT = 0; // active power-up timers
const PLANE_GROUND = 1.6;

// ---------- Loadout perks (pick one per run) ----------
const PERKS = [
  { key: "none",  ico: "🛩", name: "Standard" },
  { key: "fuel",  ico: "⛽", name: "Full Tanks" },   // +50% boost fuel
  { key: "coins", ico: "💰", name: "Coin Rush" },    // coins worth ×2
  { key: "start", ico: "🚀", name: "Head Start" },   // faster launch + topped fuel
  { key: "lift",  ico: "🪁", name: "Updraft" },      // extra lift all run
];
let runPerk = "none";
function perkLift() { return runPerk === "lift" ? 0.02 : 0; }
function perkCoin() { return runPerk === "coins" ? 2 : 1; }

function setupRun() {
  applyZone(zoneForLevel(save.level));   // this level's theme (sets terrain amplitude + colors)
  curLevelLen = levelLength(save.level);
  buildPlane(save.tier);
  yaw = 0; pitch = 0; roll = 0;
  pos.set(0, terrainH(0, 8) + 3.6, 8);   // resting on the launcher ramp
  vel.set(0, 0, 0);
  runPerk = save.perk || "none";
  boostMax = (1.1 + lvl("fuel") * 0.5) * (runPerk === "fuel" ? 1.5 : 1);
  boostFuel = boostMax;
  boosting = false; runCoins = 0; lowSpeedT = 0; pendingEvoName = null; shakeT = 0;
  comboMult = 1; ringsPassed = 0; runCoinPickups = 0; crashT = 0; prevZ = pos.z; levelCleared = false;
  flightTime = 0; launchAnimT = 0;
  megaBoostT = 0; frenzyT = 0; magnetBurstT = 0; featherT = 0; stallT = 0;
  terrainSnapZ = NaN;                    // force terrain rebuild for the new zone amplitude
  resetCoins();
  resetCity();
  resetFuels();
  resetRings();
  resetThermals();
  resetObstacles();
  resetBarriers();
  resetTunnels();
  resetPowers();
  placeFinish();
  for (const p of parts) { p.active = false; p.m.visible = false; }
  for (const p of trail) { p.life = 0; p.m.visible = false; }
  hideArc();
  updateTerrain(pos.x, pos.z);
  updateSea(pos.x, pos.z);
  plane.position.copy(pos);
  plane.rotation.set(0, 0, 0);
  updateShadow();
  announceLevel();
}

function forwardVec(out) {
  out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  return out;
}

// ---------- Launch ----------
const PERFECT_LO = 0.78, PERFECT_HI = 0.92;   // release in this power band for a perfect launch
function launch(power, launchPitch, launchYaw) {
  // Launch Power dominates the initial speed; a fresh plane is slow off the ramp.
  const maxSpeed = 56 + lvl("power") * 18 + save.tier * 6;
  let speed = lerp(32, maxSpeed, power);
  const perfect = power >= PERFECT_LO && power <= PERFECT_HI;
  if (perfect) { speed *= 1.18; boostFuel = Math.min(boostMax, boostFuel + 0.4); goalBanner("✦ PERFECT LAUNCH"); Sound.ring(); haptic(25); }
  if (runPerk === "start") { speed *= 1.35; boostFuel = boostMax; }   // Head Start perk
  pitch = launchPitch; yaw = launchYaw || 0;
  const f = forwardVec(new THREE.Vector3());
  vel.copy(f).multiplyScalar(speed);
  // catapult fling: band recoil, smoke + sparks off the rig (no camera shake on launch)
  launchAnimT = 0.35;
  spawnBurst(0, terrainH(0, 6) + 2, 5, 0xdfe7ee, 16, 16, rand(0.8, 1.6));
  spawnBurst(0, terrainH(0, 6) + 3, 4, 0xffd27a, 10, 22, 0.6);
  Sound.boost();
  hideArc();
  state = "flight";
  hud.classList.remove("hidden");
  aimHintEl.textContent = "";
  hideAllOverlays();
  showFlightControls();
}

// ---------- Physics ----------
// Deliberately demanding: a stock plane sinks fast and stalls quickly. Upgrades are what
// let you sustain speed, and you must keep diving / boosting / catching rings to keep moving.
const G = 31, fTmp = new THREE.Vector3(), dTmp = new THREE.Vector3();
const CEILING = 118;          // cabin-pressure ceiling: above this the air thins out
let cabinWarn = false;
function updateFlight(dt) {
  // input → target attitude (virtual joystick)
  let targetPitch = pitch * 0.985; // relax toward level when not steering
  let yawRate = 0;
  if (joy.active) {
    const sens = (save.settings && save.settings.sens) || 1;
    const inv = (save.settings && save.settings.invert) ? -1 : 1;
    targetPitch = clamp(inv * joy.y * 0.8 * sens, -0.75, 0.9);  // default: push stick DOWN = climb
    yawRate = -joy.x * 1.2 * sens;                              // stick right = bank right on screen
  }
  // power-up timers
  if (megaBoostT > 0) megaBoostT -= dt;
  if (frenzyT > 0) frenzyT -= dt;
  if (magnetBurstT > 0) magnetBurstT -= dt;
  if (featherT > 0) featherT -= dt;
  if (stallT > 0) stallT -= dt;
  const mega = megaBoostT > 0;
  boosting = mega || (boostHeld && boostFuel > 0 && hasBoost());
  flightTime += dt;
  comboMult = Math.max(1, comboMult - 0.22 * dt);  // style combo decays unless you keep it up

  pitch += (targetPitch - pitch) * Math.min(1, dt * 4);
  yaw += yawRate * dt;
  roll += ((-yawRate * 0.5) - roll) * Math.min(1, dt * 5);

  const f = forwardVec(fTmp);
  let speed = vel.length();

  // thrust (boost upgrade, or free during a mega-boost power-up)
  const flame = plane.userData.flame;
  if (boosting) {
    const thrust = (mega ? 70 : 48) + lvl("boost") * 12 + save.tier * 3;
    vel.addScaledVector(f, thrust * dt);
    if (!mega) boostFuel = Math.max(0, boostFuel - dt);   // mega-boost doesn't burn fuel
    if (flame) { flame.visible = true; flame.scale.setScalar(rand(0.8, 1.3) * (mega ? 1.5 : 1)); }
  } else if (flame) flame.visible = false;

  // gravity
  vel.y -= G * dt;

  // pitch trades altitude for speed: nose DOWN accelerates strongly, nose UP decelerates
  vel.addScaledVector(f, -Math.sin(pitch) * G * 1.3 * dt);

  // stall power-up: heavy air drags you down for a few seconds
  if (stallT > 0) vel.y -= 16 * dt;
  // lift: horizontal speed sustains altitude. Weak by default — Wings upgrades matter a lot.
  const speedH = Math.hypot(vel.x, vel.z);
  let liftCoef = 0.014 + lvl("wings") * 0.026 + perkLift() + (featherT > 0 ? 0.03 : 0);
  if (stallT > 0) liftCoef *= 0.5;
  const lift = clamp(speedH * liftCoef, 0, G * 0.95);
  vel.y += lift * dt;

  // cabin pressure: climb too high and the thin air bleeds your speed and drags you down
  cabinWarn = pos.y > CEILING;
  if (cabinWarn) {
    const over = pos.y - CEILING;
    vel.y -= (8 + over * 0.45) * dt;
    vel.multiplyScalar(Math.max(0, 1 - clamp(over / 70, 0, 1) * 0.6 * dt));
  }

  // aerodynamic alignment: send velocity where the nose points (so pitch actually steers the dive)
  speed = vel.length();
  dTmp.copy(f).multiplyScalar(speed);
  vel.lerp(dTmp, Math.min(1, 2.6 * dt));

  // drag (much less with Aerodynamics upgrades)
  const drag = 0.30 - lvl("aero") * 0.022;
  vel.multiplyScalar(Math.max(0, 1 - drag * dt));

  // soft top speed: an achievable cruise that rises with upgrades (sets the ~90s-per-level pace)
  const cap = 38 + lvl("aero") * 3 + lvl("power") * 2.5 + lvl("wings") * 1.5 + save.tier * 2 + (boosting ? 24 : 0);
  speed = vel.length();
  if (speed > cap) vel.multiplyScalar(lerp(1, cap / speed, clamp(2.5 * dt, 0, 1)));

  pos.addScaledVector(vel, dt);

  // sea on both sides is a no-go: stray past the corridor edge and you ditch
  if (Math.abs(pos.x) > CORRIDOR) { crash(); }

  // terrain collision + bounce
  const gh = terrainH(pos.x, pos.z) + PLANE_GROUND;
  let onGround = false;
  if (pos.y <= gh) {
    pos.y = gh; onGround = true;
    if (vel.y < 0) {
      const restitution = 0.26 + lvl("wings") * 0.045;
      vel.y = -vel.y * restitution;
      vel.x *= 0.78; vel.z *= 0.82; // surface friction
    }
    if (Math.hypot(vel.x, vel.z) < 7 && Math.abs(vel.y) < 6) lowSpeedT += dt;
    else lowSpeedT = 0;
  } else lowSpeedT = 0;

  // keep roughly heading forward (no flying backward off the runway)
  if (pos.z < 4) pos.z = 4;

  // apply transform
  plane.position.copy(pos);
  plane.rotation.set(-pitch, yaw, roll);

  // coin value scales with the Coin Multiplier upgrade, the ring/style combo, and the Coin Rush perk
  const coinValue = Math.max(1, Math.round((1 + lvl("mult") * 0.5) * comboMult * perkCoin() * (frenzyT > 0 ? 3 : 1)));
  const magnetR = (9 + lvl("magnet") * 11) * (runPerk === "coins" ? 1.4 : 1) + (magnetBurstT > 0 ? 80 : 0);
  const magnetActive = lvl("magnet") > 0 || magnetBurstT > 0;
  for (const c of coins) {
    if (!c.got) {
      const dx = c.x - pos.x, dy = c.y - pos.y, dz = c.z - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (magnetActive && d2 < magnetR * magnetR) {  // magnet pull
        const d = Math.sqrt(d2) || 1, pull = 60 * dt * (1 - d / magnetR);
        c.x += (dx / d) * pull * d; c.y += (dy / d) * pull * d; c.z += (dz / d) * pull * d;
        c.mesh.position.set(c.x, c.y, c.z);
      }
      if (d2 < 36) {
        c.got = true; c.mesh.visible = false;
        runCoins += coinValue; runCoinPickups++;
        spawnBurst(c.x, c.y, c.z, 0xffd454, 5, 12, rand(0.3, 0.7));
        Sound.coin();
      }
      c.mesh.rotation.z += dt * 3;
    }
    if (c.got || pos.z - c.z > 50) placeCoin(c);
  }

  // boost-fuel pickups
  for (const f of fuels) {
    if (!f.got) {
      f.grp.rotation.y += dt * 2.2;
      const dx = f.x - pos.x, dy = f.y - pos.y, dz = f.z - pos.z;
      if (dx * dx + dy * dy + dz * dz < 49) {
        f.got = true; f.grp.visible = false;
        boostFuel = Math.min(boostMax, boostFuel + boostMax * FUEL_REFILL);
        spawnBurst(f.x, f.y, f.z, 0xff8a2a, 8, 16); Sound.fuel(); haptic(15); shakeT = Math.max(shakeT, 0.1);
      }
    }
    if (f.got || pos.z - f.z > 60) placeFuel(f);
  }

  // sky power-ups
  for (const p of powers) {
    if (!p.got) {
      p.grp.rotation.y += dt * 1.6; p.core.rotation.x += dt * 1.2;
      const dx = p.x - pos.x, dy = p.y - pos.y, dz = p.z - pos.z;
      if (dx * dx + dy * dy + dz * dz < 56) { p.got = true; p.grp.visible = false; applyPower(p.type); }
    }
    if (p.got || pos.z - p.z > 60) placePower(p);
  }

  // rings / boost gates — fly through to build a combo and gain a speed kick
  for (const r of rings) {
    r.m.rotation.z += dt * 1.2;
    if (!r.passed && prevZ < r.z && pos.z >= r.z) {
      const dx = pos.x - r.x, dy = pos.y - r.y;
      if (dx * dx + dy * dy < RING_R * RING_R) {        // threaded it!
        r.passed = true;
        comboMult = Math.min(comboMult + 0.5, 6); ringsPassed++;
        vel.addScaledVector(f, 26);                     // boost gate
        boostFuel = Math.min(boostMax, boostFuel + 0.25);
        runCoins += Math.round(5 * comboMult);
        spawnBurst(r.x, r.y, r.z, 0x49e0ff, 16, 20); Sound.ring(); haptic(20);
      }
    }
    if (pos.z - r.z > 40) placeRing(r);
  }

  // thermals / updrafts — ride them for free altitude
  for (const t of thermals) {
    const dx = pos.x - t.x, dz = pos.z - t.z;
    if (dx * dx + dz * dz < THERMAL_R * THERMAL_R && pos.y < t.top) {
      vel.y += 26 * dt;
      if (Math.random() < 0.3) spawnBurst(pos.x + rand(-4, 4), pos.y - 3, pos.z, 0xbdf0ff, 1, 6, 0.5);
    }
    t.m.rotation.y += dt * 0.6;
    if (pos.z - t.z > 80) placeThermal(t);
  }

  // buildings: hitting one is a CRASH (ends the run) — weave through the gaps; skim for style
  const PH = 2.6, NEAR = 9;
  for (const b of buildings) {
    if (b.active) {
      const inZ = Math.abs(pos.z - b.z) < b.d / 2 + PH;
      const colX = Math.abs(pos.x - b.x) < b.w / 2 + PH;
      const below = pos.y < b.topY + PH;
      if (inZ && colX && below) { crash(); break; }
      if (!b.near && below && Math.abs(pos.z - b.z) < b.d / 2 + 3 && !colX && Math.abs(pos.x - b.x) < b.w / 2 + NEAR) {
        b.near = true; styleHit(pos.x, pos.y, pos.z);
      }
    }
    if (pos.z - b.z > 60) placeBuilding(b);
  }

  // obstacles (blimps drift, birds swarm, cranes loom) — also crash you
  for (const o of obstacles) {
    if (!o.active) { if (pos.z - o.z > 80) placeObstacle(o); continue; }
    o.t += dt;
    if (o.type === "blimp") {
      o.x += o.drift * dt; o.grp.position.x = o.x; o.grp.position.y = o.y + Math.sin(o.t) * 1.2;
      const dx = (pos.x - o.x) / 9, dy = (pos.y - o.grp.position.y) / 4.5, dz = (pos.z - o.z) / 5;
      const e = dx * dx + dy * dy + dz * dz;
      if (e < 1) { crash(); }
      else if (!o.near && e < 2.0) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "bird") {
      o.x += o.drift * dt; o.z -= 18 * dt; // fly toward the player
      o.grp.position.set(o.x, o.y + Math.sin(o.t * 4) * 1.5, o.z);
      const dx = pos.x - o.x, dy = pos.y - o.grp.position.y, dz = pos.z - o.z;
      const e = dx * dx + dy * dy + dz * dz;
      if (e < 16) { crash(); }
      else if (!o.near && e < 64) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "balloon") { // rises and falls — time your altitude
      const by = o.baseY + Math.sin(flightTime * 0.7 + o.phase) * o.amp;
      o.grp.position.set(o.x, by, o.z);
      const cy = by + 3; // envelope centre
      const dx = (pos.x - o.x) / 5.5, dy = (pos.y - cy) / 6.5, dz = (pos.z - o.z) / 5.5;
      const e = dx * dx + dy * dy + dz * dz;
      if (e < 1) { crash(); }
      else if (!o.near && e < 2.2) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "drone") { // darts side to side fast — hard to predict
      const bx = o.x + Math.sin(flightTime * o.swingSpd + o.phase) * o.amp;
      const by = o.baseY + Math.sin(flightTime * o.swingSpd * 1.7 + o.phase) * 8;
      o.grp.position.set(bx, by, o.z);
      const dx = pos.x - bx, dy = pos.y - by, dz = pos.z - o.z;
      const e = dx * dx + dy * dy + dz * dz;
      if (e < 16) { crash(); }
      else if (!o.near && e < 64) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "pendulum") { // wrecking ball swings across the lane
      const th = Math.sin(flightTime * o.swingSpd + o.phase) * o.amp;
      if (o.grp.userData.swing) o.grp.userData.swing.rotation.z = th;
      const bx = o.x + Math.sin(th) * PEND_ARM, by = o.pivotY - Math.cos(th) * PEND_ARM;
      const dx = pos.x - bx, dy = pos.y - by, dz = pos.z - o.z;
      const e = dx * dx + dy * dy + dz * dz;
      if (e < (3.4 + PH) * (3.4 + PH)) { crash(); }
      else if (!o.near && e < 90) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "turbine") { // spinning blades — go around, over, or under the disc
      if (o.grp.userData.hub) o.grp.userData.hub.rotation.z += o.spin * dt;
      if (Math.abs(pos.x - o.x) < 2.6 && Math.abs(pos.z - o.z) < 2.6 + PH && pos.y < o.hubY) crash(); // tower
      if (Math.abs(pos.z - o.z) < 2 + PH) {
        const dx = pos.x - o.x, dy = pos.y - o.hubY, d2 = dx * dx + dy * dy;
        if (d2 < (o.bladeR + PH * 0.4) * (o.bladeR + PH * 0.4)) crash();
        else if (!o.near && d2 < (o.bladeR + 9) * (o.bladeR + 9)) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
      }
    } else if (o.type === "rock") { // boulder dropping on a cycle
      const dist = o.topY - o.groundY;
      const yy = o.topY - (((flightTime * o.fallSpd) + o.phase * dist) % dist);
      o.grp.position.set(o.x, yy, o.z); o.grp.rotation.x += dt * 2; o.grp.rotation.z += dt * 1.5;
      const dx = pos.x - o.x, dy = pos.y - yy, dz = pos.z - o.z;
      const e = dx * dx + dy * dy + dz * dz;
      if (e < (3.4 + PH) * (3.4 + PH)) crash();
      else if (!o.near && e < 80) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "spinbar") { // bar sweeps the lane — time your pass
      const th = flightTime * o.spin + o.phase;
      if (o.grp.userData.bar) o.grp.userData.bar.rotation.z = th;
      if (Math.abs(pos.z - o.z) < 2 + PH) {
        const rx = pos.x - o.x, ry = pos.y - o.hubY;
        const perp = Math.abs(ry * Math.cos(th) - rx * Math.sin(th));
        const along = Math.abs(rx * Math.cos(th) + ry * Math.sin(th));
        if (perp < 1.4 + PH && along < 32) crash();
        else if (!o.near && perp < 6 && along < 32) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
      }
    } else if (o.type === "laser") { // beam blinks on and off — pass while it's down
      const cyc = (flightTime + o.phase * o.period) % o.period;
      const on = cyc > o.period * 0.45;
      const beam = o.grp.userData.beam;
      if (beam && beam.material) beam.material.opacity = on ? 0.95 : (cyc > o.period * 0.32 ? 0.5 : 0.12); // telegraph
      if (on && Math.abs(pos.z - o.z) < 2 + PH && Math.abs(pos.y - o.beamY) < 2.2 + PH * 0.4) crash();
    } else if (o.type === "gust") { // sideways wind — shoves you (mind the sea/walls!)
      const dx = pos.x - o.x, dz = pos.z - o.z;
      if (o.grp.userData.wisp) o.grp.userData.wisp.rotation.y += dt * 1.5;
      if (dx * dx + dz * dz < o.r * o.r) {
        vel.x += o.push * dt;
        if (Math.random() < 0.25) spawnBurst(pos.x - Math.sign(o.push) * 4, pos.y, pos.z, 0xdfe9f0, 1, 8, 0.5);
      }
    } else if (o.type === "tornado") { // drags you toward its core; the eye is lethal
      o.x += o.drift * dt; o.grp.position.x = o.x;
      if (o.grp.userData.swirl) o.grp.userData.swirl.rotation.y += dt * 5;
      const dx = pos.x - o.x, dz = pos.z - o.z, d2 = dx * dx + dz * dz;
      if (d2 < o.r * o.r) {
        vel.x += (o.x - pos.x) * 1.3 * dt; vel.y -= 8 * dt;
        if (d2 < 26) crash();
        else if (Math.random() < 0.2) spawnBurst(pos.x, pos.y, pos.z, 0xb59668, 1, 8, 0.6);
      }
    } else if (o.type === "geyser") { // erupting column — don't be in it at blast
      const cyc = (flightTime + o.phase * o.period) % o.period;
      const erupt = cyc < 0.6, col = o.grp.userData.col;
      if (col) { const h = o.colTop - o.ventY; col.visible = erupt; col.scale.set(1, erupt ? h : 0.01, 1); col.position.y = erupt ? h / 2 : 0.1; }
      const dx = pos.x - o.x, dz = pos.z - o.z;
      if (cyc > 0.12 && cyc < 0.6 && dx * dx + dz * dz < o.r * o.r && pos.y < o.colTop && pos.y > o.ventY - 4) crash();
    } else if (o.type === "cablecar") { // a cable + sliding gondola — go above or below the cable
      const gx = Math.sin(flightTime * o.spd + o.phase) * (CORRIDOR - 12);
      if (o.grp.userData.car) o.grp.userData.car.position.set(gx, o.cableY - 2, 0);
      if (Math.abs(pos.z - o.z) < 2 + PH) {
        if (Math.abs(pos.y - o.cableY) < 1.6 + PH * 0.4) crash();
        const dx = pos.x - gx, dy = pos.y - (o.cableY - 2);
        if (dx * dx + dy * dy < (4 + PH) * (4 + PH)) crash();
      }
    } else if (o.type === "firework") { // rocket rises, then a big colorful burst — pass between blasts
      const cyc = (flightTime + o.phase * o.period) % o.period;
      const fuse = o.period - 0.45, burst = o.grp.userData.burst, rocket = o.grp.userData.rocket;
      const gh2 = terrainH(o.x, o.z);
      if (cyc < fuse) {                          // fuse: the shell climbs, trailing sparks
        const fr = cyc / fuse;
        if (rocket) { rocket.visible = true; rocket.position.set(0, (o.by - gh2) * fr, 0); }
        if (burst) burst.visible = false;
        o.fired = false;
        if (Math.random() < 0.4) spawnBurst(o.x, gh2 + (o.by - gh2) * fr, o.z, 0xfff3b0, 1, 6, 0.5);
      } else {                                   // burst window (lethal)
        if (rocket) rocket.visible = false;
        const bf = (cyc - fuse) / 0.45;
        if (!o.fired) { spawnFirework(o.x, o.by, o.z); Sound.crash(); shakeT = Math.max(shakeT, 0.2); o.fired = true; }
        if (burst) { burst.visible = bf < 0.6; const s = o.r * (0.4 + bf); burst.position.set(0, o.by - gh2, 0); burst.scale.set(s, s, s); burst.material.opacity = (1 - bf) * 0.7; }
        const dx = pos.x - o.x, dy = pos.y - o.by, dz = pos.z - o.z, rr = o.r * (0.5 + bf * 0.7);
        if (dx * dx + dy * dy + dz * dz < rr * rr) crash();
      }
    } else if (o.type === "raptor") { // swoops toward you, homing in
      o.z -= o.spd * dt; o.x += (pos.x - o.x) * 0.6 * dt;
      const ry = o.y + Math.sin(flightTime * 6 + o.phase) * 2;
      o.grp.position.set(o.x, ry, o.z);
      const dx = pos.x - o.x, dy = pos.y - ry, dz = pos.z - o.z, e = dx * dx + dy * dy + dz * dz;
      if (e < 14) crash(); else if (!o.near && e < 70) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "debris") { // tumbling chunks to weave through
      o.x += o.drift * dt; o.grp.position.x = o.x; o.grp.rotation.x += dt * 1.2; o.grp.rotation.y += dt * 0.9;
      const dx = pos.x - o.x, dy = pos.y - o.y, dz = pos.z - o.z, e = dx * dx + dy * dy + dz * dz;
      if (e < (o.r + PH) * (o.r + PH)) crash(); else if (!o.near && e < (o.r + 8) * (o.r + 8)) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "lightning") { // storm cloud strikes a bolt down a column on a timer
      const cyc = (flightTime + o.phase * o.period) % o.period;
      const strike = cyc < 0.45, bolt = o.grp.userData.bolt;
      if (bolt) { bolt.visible = strike; if (strike) bolt.position.x = rand(-1.6, 1.6); }
      if (strike && cyc > 0.08 && Math.abs(pos.x - o.x) < 4 + PH && Math.abs(pos.z - o.z) < 3 + PH && pos.y < o.cloudY) crash();
      else if (!o.near && Math.abs(pos.x - o.x) < 9 && Math.abs(pos.z - o.z) < 9) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "avalanche") { // snow wall sweeps across the lane — time the gap behind it
      const wx = Math.sin(flightTime * o.spd + o.phase) * (CORRIDOR - 8);
      if (o.grp.userData.wall) o.grp.userData.wall.position.x = wx;
      if (Math.abs(pos.z - o.z) < 4 + PH && Math.abs(pos.x - wx) < 21 + PH && pos.y < o.wallTop) crash();
      else if (!o.near && Math.abs(pos.z - o.z) < 10 && Math.abs(pos.x - wx) < 28) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "mine") { // floating spiked mine, bobbing
      const my = o.y + Math.sin(flightTime * 1.2 + o.phase) * 4;
      o.grp.position.y = my; o.grp.rotation.y += dt * 0.6;
      const dx = pos.x - o.x, dy = pos.y - my, dz = pos.z - o.z, e = dx * dx + dy * dy + dz * dz;
      if (e < (4 + PH) * (4 + PH)) crash(); else if (!o.near && e < 90) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "log") { // log swinging on ropes across the lane
      const th = Math.sin(flightTime * o.swingSpd + o.phase) * o.amp;
      if (o.grp.userData.swing) o.grp.userData.swing.rotation.z = th;
      const bx = o.x + Math.sin(th) * PEND_ARM, by = o.pivotY - Math.cos(th) * PEND_ARM;
      const dx = pos.x - bx, dy = pos.y - by, dz = pos.z - o.z;
      if (Math.abs(dz) < 6 + PH && dx * dx + dy * dy < (2.4 + PH) * (2.4 + PH)) crash();
      else if (!o.near && Math.abs(dz) < 10 && dx * dx + dy * dy < 64) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "billboard") { // lit sign panel sliding across the lane
      const px = Math.sin(flightTime * o.spd + o.phase) * (CORRIDOR - 14);
      if (o.grp.userData.panel) o.grp.userData.panel.position.x = px;
      if (Math.abs(pos.z - o.z) < 2 + PH && Math.abs(pos.x - px) < 10 + PH && Math.abs(pos.y - o.panelY) < 5.5 + PH * 0.4) crash();
      else if (!o.near && Math.abs(pos.z - o.z) < 8 && Math.abs(pos.x - px) < 16 && Math.abs(pos.y - o.panelY) < 9) { o.near = true; styleHit(pos.x, pos.y, pos.z); }
    } else if (o.type === "sandstorm") { // dust wall with a sliding open gap — thread it
      o.gapX = Math.sin(flightTime * o.spd + o.phase) * (CORRIDOR - o.gw / 2 - 6);
      sideGapLayout(o, o.gapX, o.gw);
      if (Math.abs(pos.z - o.z) < 2 + PH) {
        if (Math.abs(pos.x - o.gapX) > o.gw / 2) crash();
        else if (Math.random() < 0.2) spawnBurst(pos.x, pos.y, pos.z, 0xcaa86a, 1, 8, 0.6);
      }
    } else if (o.type === "waterfall") { // water curtain with a gap; the gap pours you downward
      if (Math.abs(pos.z - o.z) < 2 + PH) {
        if (Math.abs(pos.x - o.gapX) > o.gw / 2) crash();
        else { vel.y -= 26 * dt; if (Math.random() < 0.25) spawnBurst(pos.x, pos.y, pos.z, 0x6fc3ff, 1, 10, 0.5); }
      }
    } else { // crane — vertical mast + horizontal jib
      const ca = Math.cos(o.armRot), sa = Math.sin(o.armRot);
      // mast collision
      if (Math.abs(pos.x - o.x) < 3 && Math.abs(pos.z - o.z) < 3 && pos.y < o.armY + PH) crash();
      // jib collision (a long arm along armRot at height armY)
      const rx = pos.x - o.x, rz = pos.z - o.z;
      const along = rx * ca + rz * sa, perp = -rx * sa + rz * ca;
      if (Math.abs(along) < 24 && Math.abs(perp) < 2.5 && Math.abs(pos.y - o.armY) < 3) crash();
    }
    if (pos.z - o.z > 80) placeObstacle(o);
  }

  // barriers: walls with a gap (or canyon channels) — line up height AND lateral position or crash
  for (const b of barriers) {
    if (b.active) {
      const gc = b.grp.userData.gapCoins;
      if (b.move) {
        if (b.kind === "spur") {
          b.protrude = clamp(b.baseProt + Math.sin(flightTime * b.mspd + b.mphase) * b.move, 40, 2 * CORRIDOR - 56);
          layoutBarrier(b);
          const oc = spurOpenCenter(b); gc.forEach(c => { if (c.visible) c.position.x = oc; });
        } else {
          const gy = b.baseGy + Math.sin(flightTime * 0.8 + b.mphase) * b.move;
          b.gyLo = gy - b.gh / 2; b.gyHi = gy + b.gh / 2; layoutBarrier(b);
          gc.forEach(c => { if (c.visible) c.position.y = gy; });
        }
      }
      for (const c of gc) if (c.visible) c.rotation.z += dt * 3;
      // collect the reward coins (they sit on the risky line)
      if (!b.gotCoins && Math.abs(pos.z - b.z) < 8) {
        const cx = b.kind === "spur" ? spurOpenCenter(b) : b.gx;
        const cyOK = b.kind === "spur" ? Math.abs(pos.y - 50) < 34 : Math.abs(pos.y - (b.gyLo + b.gyHi) / 2) < 8;
        if (Math.abs(pos.x - cx) < 8 && cyOK) {
          b.gotCoins = true; gc.forEach(c => c.visible = false);
          const val = Math.round((1 + lvl("mult") * 0.5) * comboMult * perkCoin()) * 3;
          runCoins += val; runCoinPickups += 3; spawnBurst(pos.x, pos.y, pos.z, 0xffd454, 6, 12); Sound.coin();
        }
      }
      if (Math.abs(pos.z - b.z) < 3 + PH) {
        if (b.kind === "spur") {
          const inner = spurInnerX(b);
          const blocked = b.side < 0 ? pos.x < inner + PH : pos.x > inner - PH;
          if (blocked) crash();
          else if (!b.passed) {
            b.passed = true; comboMult = Math.min(comboMult + 0.7, 6); runCoins += Math.round(8 * comboMult);
            spawnBurst(pos.x, pos.y, pos.z, 0xffcf94, 12, 16); goalBanner("CANYON ×" + comboMult.toFixed(1)); Sound.ring(); haptic(16);
          }
        } else {
          const inGap = Math.abs(pos.x - b.gx) < b.gw / 2 - PH * 0.6 && pos.y > b.gyLo + PH * 0.6 && pos.y < b.gyHi - PH * 0.6;
          if (!inGap) { crash(); }
          else if (!b.passed) {
            b.passed = true;
            const tight = clamp(1.6 - b.gw / 50, 0.4, 1.4);
            comboMult = Math.min(comboMult + 0.6 + tight * 0.4, 6);
            runCoins += Math.round(8 * comboMult * (1 + tight));
            spawnBurst(pos.x, pos.y, pos.z, 0x49e0ff, 14, 18);
            goalBanner("THREADED ×" + comboMult.toFixed(1)); Sound.ring(); haptic(18);
          }
        }
      }
    }
    if (pos.z - b.z > 60) placeBarrier(b);
  }

  // tunnels: an overpass you must stay UNDER — fly too high inside it and you smack the ceiling
  for (const t of tunnels) {
    if (t.active && Math.abs(pos.z - t.z) < t.len / 2 + PH) {
      if (pos.y > t.ceilY - PH * 0.6) crash();
      else if (!t.near && pos.y > t.ceilY - 12) { t.near = true; styleHit(pos.x, pos.y, pos.z); }
    }
    if (pos.z - t.z > 80) placeTunnel(t);
  }

  // FINISH — reaching the end of the level is the goal; it advances you to the next level
  if (!levelCleared && prevZ < curLevelLen && pos.z >= curLevelLen) {
    levelCleared = true;
    spawnBurst(0, finishGate.position.y + 50, curLevelLen, 0x7dffb0, 30, 28);
    Sound.evolve(); haptic([20, 60, 20]); shakeT = Math.max(shakeT, 0.3);
    goalBanner("🏁 LEVEL COMPLETE!");
    endRun();
    return;
  }

  // plane trail (brighter while boosting)
  trailT -= dt;
  if (trailT <= 0) { emitTrail(pos.x, pos.y, pos.z, boosting); trailT = boosting ? 0.03 : 0.06; }

  prevZ = pos.z;
  updateParts(dt);
  updateTrail(dt);
  updateShadow();
  updateSea(pos.x, pos.z);
  updateLauncher(dt, 0);
  updateTerrain(pos.x, pos.z);
  updateChaseCamera(dt, f);
  updateHUD();

  if (crashT <= 0 && onGround && lowSpeedT > 0.7) endRun();
}

// ---------- Crash ----------
function crash() {
  if (crashT > 0) return;
  crashT = 1.1; shakeT = 0.7;
  spawnBurst(pos.x, pos.y, pos.z, 0xffa12a, 24, 28, rand(0.7, 1.5));
  spawnBurst(pos.x, pos.y, pos.z, 0x6a6a6a, 16, 18);
  vel.multiplyScalar(0.3); vel.y += 6;
  Sound.crash(); haptic([40, 30, 70]);
}
// near-miss / style: skim a hazard for a combo boost + coins
function styleHit(x, y, z) {
  comboMult = Math.min(comboMult + 0.4, 6);
  runCoins += Math.round(3 * comboMult);
  spawnBurst(x, y, z, 0xffffff, 4, 9, 0.5);
  goalBanner("NEAR MISS ×" + comboMult.toFixed(1));
  Sound.coin(); haptic(8);
}
function updateCrash(dt) {
  crashT -= dt;
  const s = dt * 0.4; // slow-mo
  vel.y -= G * s;
  pos.addScaledVector(vel, s);
  const gh = terrainH(pos.x, pos.z) + PLANE_GROUND;
  if (pos.y < gh) pos.y = gh;
  plane.position.copy(pos);
  plane.rotation.x += s * 6; plane.rotation.z += s * 9; // tumble
  const fdir = forwardVec(fTmp);
  updateParts(dt); updateTrail(dt); updateShadow();
  updateChaseCamera(dt, fdir);
  if (crashT <= 0) endRun();
}

const camGoal = new THREE.Vector3(), camLook = new THREE.Vector3(), fh = new THREE.Vector3();
function updateChaseCamera(dt, f) {
  fh.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
  camGoal.copy(pos).addScaledVector(fh, -15); camGoal.y += 6.5;
  const camGround = terrainH(camGoal.x, camGoal.z) + 3;
  if (camGoal.y < camGround) camGoal.y = camGround;
  camera.position.lerp(camGoal, Math.min(1, dt * 4));
  if (shakeT > 0) {
    shakeT = Math.max(0, shakeT - dt);
    const m = shakeT * 12;
    camera.position.x += rand(-m, m); camera.position.y += rand(-m, m);
  }
  camLook.copy(pos).addScaledVector(fh, 12); camLook.y += 1.5;
  camera.lookAt(camLook);
}

// ---------- Aim camera / preview ----------
function updateAim(dt) {
  // behind-and-above view so both the up/down angle AND the left/right aim read clearly
  camGoal.set(0, pos.y + 7, pos.z - 17);
  camera.position.lerp(camGoal, Math.min(1, dt * 3));
  camLook.set(0, pos.y + 3, pos.z + 12);
  camera.lookAt(camLook);
  // sit on the angled ramp at rest, then aim (pitch + yaw) and slide back down it as you pull
  const av = (touch.down) ? aimValues() : { power: 0, lp: 0.30, ly: 0 };
  plane.rotation.set(-av.lp, av.ly, 0);
  plane.position.set(pos.x - av.power * 2 * av.ly, pos.y - av.power * 1.4, pos.z - av.power * 5);
  updateLauncher(dt, av.power);
  updateShadow();
  spinCoins(dt);
}

function updateTitle(dt) {
  titleT += dt;
  updateLauncher(dt, 0);
  const r = 20;
  camera.position.set(Math.sin(titleT * 0.25) * r, 7 + Math.sin(titleT * 0.4) * 1.5, 6 + Math.cos(titleT * 0.25) * r);
  camera.lookAt(0, 2, 8);
  spinCoins(dt);
}
function spinCoins(dt) { for (const c of coins) if (!c.got) c.mesh.rotation.z += dt * 2; }

// ---------- End run ----------
// Star rating for a cleared level: ★ finish, ★ under par time, ★ caught enough rings.
function parTime(len) { return len / NOMINAL_CRUISE * 1.5; }
function ringGoal(len) { return Math.max(3, Math.floor(len / 600)); }
function rateStars(len, time, rings) {
  let s = 1;
  if (time <= parTime(len)) s++;
  if (rings >= ringGoal(len)) s++;
  return s;
}
function totalStars() { let t = 0; for (const k in save.stars) t += save.stars[k]; return t; }
function endRun() {
  state = "result";
  const lvlIdx = save.level;                          // index of the level just played
  const meters = Math.max(0, Math.floor(Math.min(pos.z, curLevelLen)));
  const completedLevel = save.level + 1;             // for display, before advancing
  let earned = runCoins + Math.floor(meters / 8);    // tighter economy: less per metre
  if (levelCleared) earned += 200 + save.level * 60; // level-clear bonus
  save.coins += earned;
  if (meters > save.best) save.best = meters;

  let stars = 0, justWon = false;
  if (levelCleared) {
    stars = rateStars(curLevelLen, flightTime, ringsPassed);
    save.stars[lvlIdx] = Math.max(save.stars[lvlIdx] || 0, stars);
    const prevTier = save.tier;
    save.level += 1;                                  // advance to the next level
    save.tier = computeTier();
    if (save.tier > prevTier) { pendingEvoName = TIERS[save.tier].name; Sound.evolve(); }
    if (completedLevel === CAMPAIGN_LEN && !save.won) { save.won = true; justWon = true; }
  }
  const missionReward = evalMissions({ dist: meters, coins: runCoinPickups, rings: ringsPassed });
  persist();

  const resTitle = document.getElementById("resultTitle");
  if (resTitle) resTitle.textContent = justWon ? "🏆 CAMPAIGN COMPLETE!" : (levelCleared ? "LEVEL " + completedLevel + " COMPLETE!" : "DITCHED!");
  document.getElementById("runDist").textContent = meters;
  document.getElementById("runCoins").textContent = earned;
  document.getElementById("runBest").textContent = save.best;
  const starEl = document.getElementById("resultStars");
  if (starEl) {
    if (levelCleared) { starEl.classList.remove("hidden"); starEl.textContent = "★★★☆☆☆".slice(3 - stars, 6 - stars); }
    else starEl.classList.add("hidden");
  }
  const notice = document.getElementById("evoNotice");
  if (pendingEvoName) { notice.classList.remove("hidden"); document.getElementById("evoNoticeName").textContent = pendingEvoName; }
  else notice.classList.add("hidden");
  const mEl = document.getElementById("missionResult");
  if (mEl) { if (missionReward > 0) { mEl.classList.remove("hidden"); mEl.textContent = "🎯 Mission complete +" + missionReward + " coins!"; } else mEl.classList.add("hidden"); }
  const again = document.getElementById("againBtn");
  if (again) again.textContent = levelCleared ? "NEXT LEVEL ✈" : "RETRY ✈";
  hud.classList.add("hidden");
  hideFlightControls();
  showOverlay("resultScreen");
}

// ---------- HUD ----------
const hud = document.getElementById("hud");
const distBig = document.getElementById("distBig");
const coinHud = document.getElementById("coinHud");
const fuelWrap = document.getElementById("fuelWrap");
const fuelFill = document.getElementById("fuelFill");
const fuelLabel = document.getElementById("fuelLabel");
const aimHintEl = document.getElementById("aimHint");
const goalHud = document.getElementById("goalHud");
function goalBanner(text) {
  const el = document.getElementById("goalBanner");
  if (!el) return;
  el.textContent = text; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2000);
}
const cabinEl = document.getElementById("cabinWarn");
const powerHud = document.getElementById("powerHud");
function updateHUD() {
  distBig.innerHTML = Math.max(0, Math.floor(pos.z)) + "<small>METERS</small>";
  coinHud.innerHTML = "◉ " + runCoins + (comboMult > 1 ? ` <span style="color:#49e0ff">×${comboMult.toFixed(1)}</span>` : "");
  if (goalHud) goalHud.textContent = "🏁 " + Math.max(0, curLevelLen - Math.floor(pos.z)) + " m";
  const frac = clamp(boostFuel / boostMax, 0, 1);
  fuelFill.style.width = (frac * 100) + "%";
  fuelLabel.textContent = boostFuel > 0 ? "BOOST FUEL 🔥" : "BOOST EMPTY — GLIDE!";
  if (cabinEl) cabinEl.classList.toggle("show", cabinWarn);
  if (powerHud) {
    let s = "";
    if (megaBoostT > 0) s += "🚀" + Math.ceil(megaBoostT) + " ";
    if (frenzyT > 0) s += "💰" + Math.ceil(frenzyT) + " ";
    if (magnetBurstT > 0) s += "🧲" + Math.ceil(magnetBurstT) + " ";
    if (featherT > 0) s += "🪁" + Math.ceil(featherT) + " ";
    if (stallT > 0) s += "🌀" + Math.ceil(stallT) + " ";
    powerHud.textContent = s;
  }
}

// ---------- Input ----------
const touch = { down: false, x: 0, y: 0, startX: 0, startY: 0 };
function pt(e) { const t = e.touches ? e.touches[0] : (e.changedTouches ? e.changedTouches[0] : e); return { x: t.clientX, y: t.clientY }; }
function onDown(e) {
  Sound.resume();
  const p = pt(e);
  touch.down = true; touch.x = p.x; touch.y = p.y; touch.startX = p.x; touch.startY = p.y;
}
function onMove(e) {
  const p = pt(e); touch.x = p.x; touch.y = p.y;
  if (state === "aim" && touch.down) showAimPreview();
}
function onUp() {
  if (state === "aim" && touch.down) {
    const { power, lp, ly } = aimValues();
    if (power > 0.06) launch(power, lp, ly);
    else aimHintEl.textContent = "Drag toward where you want to launch";
  }
  touch.down = false;
}
function aimValues() {
  // DIRECT AIM: drag toward where you want to fire. Up on screen = climb, sideways = veer,
  // drag length = power. Returns launch pitch (lp) and launch yaw (ly).
  const dx = touch.x - touch.startX, dy = touch.y - touch.startY;
  const maxDrag = Math.min(window.innerWidth, window.innerHeight) * 0.36;
  const len = Math.hypot(dx, dy);
  const power = clamp(len / maxDrag, 0, 1);
  const up = clamp(-dy / maxDrag, 0, 1);            // how far you dragged upward
  const lp = lerp(0.18, 1.2, up);                   // launch pitch: flat .. steep
  const ly = clamp(dx / maxDrag, -1, 1) * 0.5;      // launch yaw: drag right -> veer right (±~29°)
  return { power, lp, ly };
}
function predictArc() {
  const { power, lp, ly } = aimValues();
  const maxSpeed = 56 + lvl("power") * 18 + save.tier * 6;
  let speed = lerp(32, maxSpeed, power);
  if (power >= PERFECT_LO && power <= PERFECT_HI) speed *= 1.18;
  let px = pos.x, py = pos.y, pz = pos.z;
  let vx = Math.sin(ly) * Math.cos(lp) * speed, vy = Math.sin(lp) * speed, vz = Math.cos(ly) * Math.cos(lp) * speed;
  const h = 0.06;
  for (let i = 0; i < ARC_COUNT; i++) {
    for (let s = 0; s < 5; s++) { vy -= G * h; px += vx * h; py += vy * h; pz += vz * h; }
    const m = arcDots[i]; m.visible = true; m.position.set(px, py, pz);
    m.scale.setScalar(lerp(1.3, 0.5, i / ARC_COUNT));
  }
}
function showAimPreview() {
  const { power } = aimValues();
  fuelFill.style.width = (power * 100) + "%";
  const perfect = power >= PERFECT_LO && power <= PERFECT_HI;
  fuelLabel.textContent = perfect ? "✦ PERFECT — release!" : "POWER " + Math.round(power * 100) + "%";
  aimHintEl.textContent = "";
  predictArc();
}
canvas.addEventListener("touchstart", e => { e.preventDefault(); if (state === "aim") onDown(e); else if (state === "flight") flightStart(e.changedTouches); }, { passive: false });
canvas.addEventListener("touchmove",  e => { e.preventDefault(); if (state === "aim") onMove(e); else if (state === "flight") flightMove(e.changedTouches); }, { passive: false });
canvas.addEventListener("touchend",   e => { e.preventDefault(); if (state === "aim") onUp(e); else if (state === "flight") flightEnd(e.changedTouches); }, { passive: false });
canvas.addEventListener("touchcancel",e => { e.preventDefault(); if (state === "aim") onUp(e); else if (state === "flight") flightEnd(e.changedTouches); }, { passive: false });
canvas.addEventListener("mousedown", e => { if (state === "aim") onDown(e); else if (state === "flight") flightMouseDown(e); });
window.addEventListener("mousemove", e => { if (state === "aim") onMove(e); else if (state === "flight") flightMouseMove(e); });
window.addEventListener("mouseup",   e => { if (state === "aim") onUp(e); else if (state === "flight") flightMouseUp(e); });

// ---------- Stationary joystick (right half) + dynamic boost (left half) ----------
// The joystick stays put in a thumb-friendly spot; pressing anywhere on the right
// half steers relative to its fixed center (direction + distance = how the plane flies).
const joy = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0, r: 115 };
let boostHeld = false, boostId = null;
const joyEl = document.getElementById("joy");
const joyKnob = document.getElementById("joyKnob");
const boostBtn = document.getElementById("boostBtn");
const hasBoost = () => lvl("boost") >= 1;
const KNOB_MAX = 46; // how far the visible knob can travel from the base center

function recomputeJoyCenter() {
  const r = joyEl.getBoundingClientRect ? joyEl.getBoundingClientRect() : null;
  if (r && r.width) { joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2; }
  else { joy.cx = window.innerWidth * 0.78; joy.cy = window.innerHeight * 0.72; }
}
function joyMoveTo(x, y) {
  const dx = x - joy.cx, dy = y - joy.cy;
  joy.x = clamp(dx / joy.r, -1, 1);
  joy.y = clamp(dy / joy.r, -1, 1);
  let kx = dx, ky = dy; const kl = Math.hypot(dx, dy);
  if (kl > KNOB_MAX) { kx *= KNOB_MAX / kl; ky *= KNOB_MAX / kl; }
  joyKnob.style.transform = `translate(${kx}px, ${ky}px)`;
}
function joyReset() {
  joy.active = false; joy.id = null; joy.x = 0; joy.y = 0;
  if (joyKnob) joyKnob.style.transform = "translate(0px,0px)";
}
function boostStartAt(x, y) {
  if (!hasBoost()) return false;
  boostHeld = true;
  boostBtn.style.left = (x - 48) + "px"; boostBtn.style.top = (y - 48) + "px";
  boostBtn.style.right = "auto"; boostBtn.style.bottom = "auto";
  boostBtn.classList.add("show", "active");
  return true;
}
function boostStop() { boostHeld = false; boostId = null; boostBtn.classList.remove("active", "show"); }

const BOOST_ZONE = 0.28;   // left ~28% is the boost tap zone; the rest of the screen is the joystick
function flightStart(list) {
  for (const t of list) {
    if (t.clientX >= window.innerWidth * BOOST_ZONE) {
      if (joy.id === null) { joy.id = t.identifier; joy.active = true; recomputeJoyCenter(); joyMoveTo(t.clientX, t.clientY); }
    } else {
      if (boostId === null && boostStartAt(t.clientX, t.clientY)) boostId = t.identifier;
    }
  }
}
function flightMove(list) { for (const t of list) if (t.identifier === joy.id) joyMoveTo(t.clientX, t.clientY); }
function flightEnd(list) {
  for (const t of list) {
    if (t.identifier === joy.id) joyReset();
    if (t.identifier === boostId) boostStop();
  }
}
// mouse (desktop, single pointer)
let mouseRole = null;
function flightMouseDown(e) {
  if (e.clientX >= window.innerWidth * BOOST_ZONE) { mouseRole = "joy"; joy.id = -1; joy.active = true; recomputeJoyCenter(); joyMoveTo(e.clientX, e.clientY); }
  else if (boostStartAt(e.clientX, e.clientY)) { mouseRole = "boost"; boostId = -1; }
}
function flightMouseMove(e) { if (mouseRole === "joy") joyMoveTo(e.clientX, e.clientY); }
function flightMouseUp() { if (mouseRole === "joy") joyReset(); if (mouseRole === "boost") boostStop(); mouseRole = null; }

function showFlightControls() {
  joyReset(); boostStop();
  joyEl.classList.add("show"); recomputeJoyCenter();   // joystick stays visible & stationary
  fuelWrap.style.display = hasBoost() ? "block" : "none";
}
function hideFlightControls() { joyReset(); boostStop(); joyEl.classList.remove("show"); }

// ---------- Loop ----------
let last = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.04, (ts - last) / 1000 || 0);
  last = ts;
  perfTick(dt);
  if (state === "flight") { if (crashT > 0) updateCrash(dt); else updateFlight(dt); }
  else if (state === "aim") updateAim(dt);
  else if (state === "paused") { /* frozen */ }
  else updateTitle(dt);
  // drifting clouds
  for (const c of clouds) { c.position.x += dt * 1.5; if (c.position.x > 320) c.position.x = -320; }
  renderer.render(scene, camera);
}

// ---------- Screens / shop ----------
const overlays = {
  title: document.getElementById("titleScreen"),
  hangar: document.getElementById("hangarScreen"),
  result: document.getElementById("resultScreen"),
  settings: document.getElementById("settingsScreen"),
  pause: document.getElementById("pauseScreen"),
  store: document.getElementById("storeScreen"),
};
function hideAllOverlays() { for (const k in overlays) overlays[k].classList.add("hidden"); }
function showOverlay(key) { hideAllOverlays(); (overlays[key] || document.getElementById(key)).classList.remove("hidden"); }

function renderShop() {
  const shop = document.getElementById("shop");
  shop.innerHTML = "";
  for (const u of UPGRADES) {
    const level = lvl(u.key), maxed = level >= u.max, cost = upgradeCost(u);
    const row = document.createElement("div");
    row.className = "up" + (maxed ? " maxed" : "");
    const pips = Array.from({ length: u.max }, (_, i) => `<span class="pip ${i < level ? "on" : ""}"></span>`).join("");
    row.innerHTML = `
      <div class="ico">${u.ico}</div>
      <div class="info">
        <div class="name">${u.name} <span style="opacity:.7;font-weight:600">Lv ${level}</span></div>
        <div class="pips">${pips}</div>
      </div>
      <button class="buy" ${maxed || save.coins < cost ? "disabled" : ""}>
        ${maxed ? "MAX" : `<span class="c"><span class="coin"></span>${cost}</span>`}
      </button>`;
    if (!maxed) row.querySelector(".buy").addEventListener("click", () => buyUpgrade(u));
    shop.appendChild(row);
  }
  document.getElementById("coinCount").textContent = save.coins;
  document.getElementById("evoTier").textContent = save.tier + 1;
  document.getElementById("evoName").textContent = TIERS[save.tier].name;
  document.getElementById("bestHangar").textContent = save.best;
  const sc = document.getElementById("starCount"); if (sc) sc.textContent = totalStars();
  const nl = document.getElementById("nextLevel");
  if (nl) nl.textContent = (save.level < CAMPAIGN_LEN ? "NEXT · LEVEL " + (save.level + 1) + "/" + CAMPAIGN_LEN : "ENDLESS") + " · " + levelName(save.level);
}
function buyUpgrade(u) {
  Sound.resume();
  const cost = upgradeCost(u);
  if (lvl(u.key) >= u.max || save.coins < cost) return;
  save.coins -= cost; save.up[u.key]++;
  persist();
  if (state === "store") renderStore(); else renderShop();
}

// ---------- Store (boosters + plane skins) ----------
function renderStore() {
  document.getElementById("storeCoins").textContent = save.coins;
  // boosters
  const bEl = document.getElementById("storeBoosters");
  if (bEl) {
    bEl.innerHTML = `<div class="mTitle">⚡ BOOSTERS</div>`;
    for (const u of BOOSTERS) {
      const level = lvl(u.key), maxed = level >= u.max, cost = upgradeCost(u);
      const row = document.createElement("div");
      row.className = "up" + (maxed ? " maxed" : "");
      const pips = Array.from({ length: u.max }, (_, i) => `<span class="pip ${i < level ? "on" : ""}"></span>`).join("");
      row.innerHTML = `<div class="ico">${u.ico}</div><div class="info"><div class="name">${u.name} <span style="opacity:.7;font-weight:600">Lv ${level}</span></div><div class="pips">${pips}</div></div>
        <button class="buy" ${maxed || save.coins < cost ? "disabled" : ""}>${maxed ? "MAX" : `<span class="c"><span class="coin"></span>${cost}</span>`}</button>`;
      if (!maxed) row.querySelector(".buy").addEventListener("click", () => buyUpgrade(u));
      bEl.appendChild(row);
    }
  }
  // skins
  const sEl = document.getElementById("storeSkins");
  if (sEl) {
    sEl.innerHTML = `<div class="mTitle">🎨 PLANES & SKINS</div>`;
    for (const s of SKINS) {
      const owned = !!save.skins[s.key], equipped = save.skin === s.key;
      const row = document.createElement("div");
      row.className = "up";
      const sw = s.body !== undefined ? `background:#${s.body.toString(16).padStart(6, "0")}` : "background:linear-gradient(45deg,#eef4ff,#b9d3ff)";
      let btn;
      if (equipped) btn = `<button class="buy" disabled>EQUIPPED</button>`;
      else if (owned) btn = `<button class="buy equip">EQUIP</button>`;
      else btn = `<button class="buy" ${save.coins < s.cost ? "disabled" : ""}><span class="c"><span class="coin"></span>${s.cost}</span></button>`;
      row.innerHTML = `<div class="ico"><span class="skinSw" style="${sw}"></span></div><div class="info"><div class="name">${s.name}</div></div>${btn}`;
      const button = row.querySelector(".buy");
      if (equipped) {/* no-op */}
      else if (owned) button.addEventListener("click", () => { save.skin = s.key; persist(); buildPlane(save.tier); renderStore(); });
      else if (save.coins >= s.cost) button.addEventListener("click", () => { save.coins -= s.cost; save.skins[s.key] = 1; save.skin = s.key; persist(); buildPlane(save.tier); Sound.coin(); renderStore(); });
      sEl.appendChild(row);
    }
  }
}
function goStore() { Sound.resume(); renderStore(); showOverlay("store"); state = "store"; }

function renderMissions() {
  const el = document.getElementById("missions");
  if (!el) return;
  el.innerHTML = `<div class="mTitle">🎯 MISSIONS</div>` + save.missions.map(m =>
    `<div class="mRow"><span>${missionText(m)}</span><span class="mRew"><span class="coin"></span>${m.reward}</span></div>`
  ).join("");
}
function renderPerks() {
  const el = document.getElementById("perks");
  if (!el) return;
  el.innerHTML = `<div class="mTitle">🎒 LOADOUT (pick one)</div><div class="perkRow">` +
    PERKS.map(p => `<button class="perk ${save.perk === p.key ? "on" : ""}" data-k="${p.key}"><span>${p.ico}</span>${p.name}</button>`).join("") +
    `</div>`;
  el.querySelectorAll(".perk").forEach(btn => btn.addEventListener("click", () => {
    save.perk = btn.getAttribute("data-k"); persist(); renderPerks();
  }));
}
function goHangar() { renderShop(); renderMissions(); renderPerks(); showOverlay("hangar"); state = "hangar"; }
function goAim() {
  setupRun();
  state = "aim";
  hideAllOverlays();
  hud.classList.remove("hidden");
  hideFlightControls();
  fuelWrap.style.display = "block";          // reused as the launch power meter
  fuelFill.style.width = "0%";
  fuelLabel.textContent = "DRAG TO AIM · RELEASE TO LAUNCH";
  aimHintEl.textContent = "Drag toward where you want to launch ✈";
}

document.getElementById("playBtn").addEventListener("click", goHangar);
document.getElementById("launchBtn").addEventListener("click", goAim);
document.getElementById("againBtn").addEventListener("click", goAim);
document.getElementById("shopBtn").addEventListener("click", goHangar);
document.getElementById("storeBtn").addEventListener("click", goStore);
document.getElementById("storeClose").addEventListener("click", goHangar);
document.getElementById("resetBtn").addEventListener("click", () => {
  if (!(window.confirm && window.confirm("Reset all progress? This clears coins, upgrades, evolution, and your best distance."))) return;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  loadSave();
  buildPlane(save.tier);
  document.getElementById("bestTitle").textContent = save.best;
});

// ---------- Settings ----------
function setToggleBtn(id, on) { const el = document.getElementById(id); if (el) { el.classList.toggle("on", !!on); el.textContent = on ? "ON" : "OFF"; } }
function initSettingsUI() {
  const s = save.settings;
  const sens = document.getElementById("setSens");
  if (sens) { sens.value = String(s.sens); const lbl = document.getElementById("setSensVal"); if (lbl) lbl.textContent = Number(s.sens).toFixed(2) + "×"; }
  setToggleBtn("setInvert", s.invert);
  setToggleBtn("setSound", s.sound);
  setToggleBtn("setHaptics", s.haptics);
  const q = document.getElementById("setQuality"); if (q) q.value = s.quality;

  const onChange = () => { persist(); };
  if (sens) sens.addEventListener("input", () => {
    s.sens = clamp(parseFloat(sens.value) || 1, 0.4, 1.6);
    const lbl = document.getElementById("setSensVal"); if (lbl) lbl.textContent = s.sens.toFixed(2) + "×";
    onChange();
  });
  const bindToggle = (id, key, after) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => { s[key] = !s[key]; setToggleBtn(id, s[key]); if (after) after(); onChange(); });
  };
  bindToggle("setInvert", "invert");
  bindToggle("setSound", "sound", () => Sound.setEnabled(s.sound));
  bindToggle("setHaptics", "haptics");
  if (q) q.addEventListener("change", () => {
    s.quality = q.value;
    applyQuality(s.quality === "low" ? "low" : "high");
    onChange();
  });
  const open = document.getElementById("settingsBtn");
  if (open) open.addEventListener("click", () => { settingsReturn = "title"; showOverlay("settings"); });
  const close = document.getElementById("settingsClose");
  if (close) close.addEventListener("click", () => showOverlay(settingsReturn));

  // pause / in-flight access
  const pb = document.getElementById("pauseBtn");
  if (pb) pb.addEventListener("click", pauseGame);
  const rb = document.getElementById("resumeBtn");
  if (rb) rb.addEventListener("click", resumeGame);
  const ps = document.getElementById("pauseSettingsBtn");
  if (ps) ps.addEventListener("click", () => { settingsReturn = "pause"; showOverlay("settings"); });
  const qb = document.getElementById("quitBtn");
  if (qb) qb.addEventListener("click", () => { hud.classList.add("hidden"); hideFlightControls(); goHangar(); });
}
let settingsReturn = "title";
function pauseGame() { if (state !== "flight") return; state = "paused"; showOverlay("pause"); }
function resumeGame() { if (state !== "paused") return; hideAllOverlays(); state = "flight"; }

function checkDaily() {
  let today = "";
  try { today = new Date().toISOString().slice(0, 10); } catch (e) { return; }
  if (save.lastDaily !== today) {
    save.lastDaily = today; save.coins += 100; persist();
    const toast = document.getElementById("dailyToast");
    if (toast) {
      toast.textContent = "🎁 Daily bonus: +100 coins!";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 3200);
    }
  }
}

// ---------- Boot ----------
loadSave();
applyQuality(save.settings.quality === "low" ? "low" : "high");
Sound.setEnabled(save.settings.sound);
initSettingsUI();
applyZone(zoneForLevel(save.level));
curLevelLen = levelLength(save.level);
buildPlane(save.tier);
pos.set(0, terrainH(0, 8) + 3.6, 8);   // resting on the launcher ramp
plane.position.copy(pos);
plane.rotation.set(-0.3, 0, 0);        // tilt to match the ramp on the title screen
updateTerrain(0, 6);
updateSea(0, 6);
resetCoins();
resetCity();
resetFuels();
resetRings();
resetThermals();
resetObstacles();
resetBarriers();
resetTunnels();
resetPowers();
placeFinish();
updateShadow();
checkDaily();
document.getElementById("bestTitle").textContent = save.best;
loadingEl.classList.add("hidden");
showOverlay("title");
state = "title";
requestAnimationFrame(loop);
})();
