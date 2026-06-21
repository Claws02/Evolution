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
  let h = Math.sin(x * 0.012) * 4
        + Math.sin(z * 0.010) * 6
        + Math.sin((x + z) * 0.006) * 9
        + Math.sin(z * 0.028 + x * 0.01) * 2;
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
const UPGRADES = [
  { key: "power",  ico: "🚀", name: "Launch Power",    max: 8, baseCost: 65,  growth: 1.62 },
  { key: "boost",  ico: "🔥", name: "Boost Thrust",    max: 8, baseCost: 80,  growth: 1.62 },
  { key: "fuel",   ico: "⛽", name: "Fuel Tank",       max: 8, baseCost: 70,  growth: 1.62 },
  { key: "aero",   ico: "🪶", name: "Aerodynamics",    max: 8, baseCost: 90,  growth: 1.66 },
  { key: "wings",  ico: "🛩", name: "Wings & Lift",     max: 8, baseCost: 95,  growth: 1.66 },
  { key: "magnet", ico: "🧲", name: "Coin Magnet",     max: 6, baseCost: 110, growth: 1.66 },
  { key: "mult",   ico: "✨", name: "Coin Multiplier", max: 6, baseCost: 140, growth: 1.72 },
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
  save.up = save.up || {};
  for (const u of UPGRADES) save.up[u.key] = save.up[u.key] || 0;
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

// runway ramp at start
{
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 26),
    new THREE.MeshLambertMaterial({ color: 0x8a5a3c }));
  ramp.position.set(0, 0.5, 6);
  scene.add(ramp);
  const post = new THREE.MeshLambertMaterial({ color: 0x6b4126 });
  for (const zz of [-4, 14]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), post);
    leg.position.set(0, -1.5, zz); ramp.add(leg);
  }
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
  b.x = p.x; b.z = p.z; b.w = p.w; b.d = p.d; b.topY = gh + p.h; b.active = true;
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

// ---------- Particle / debris pool ----------
const partGeo = new THREE.BoxGeometry(1, 1, 1);
const PART_COUNT = 70;
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

// ---------- Obstacles (blimps, cranes, bird flocks) — crashing hazards ----------
const OBS_TYPES = ["blimp", "crane", "bird"];
const obstacles = [];
const OBS_COUNT = 9;
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
  } else { // bird
    o.x = laneX(o.z) + rand(-30, 30); o.y = gh + rand(25, 60); o.drift = rand(-10, 10);
    o.grp.position.set(o.x, o.y, o.z);
  }
  o.active = true; o.grp.visible = true;
}
function resetObstacles() { obsFarZ = OBS_START_Z; for (const o of obstacles) placeObstacle(o); }

// ---------- Levels (discrete zones; reach the FINISH to advance to the next level) ----------
// Length ramps with level so early levels are beatable, while a maxed plane needs ~90s on the
// longest ones (LEVEL_TIME * NOMINAL_CRUISE). Early levels are short to build momentum/retention.
const LEVEL_TIME = 90;            // target seconds for a maxed plane to clear a full-length level
const NOMINAL_CRUISE = 100;       // approx forward speed (units/s) a maxed plane sustains
const LEVEL_LEN = LEVEL_TIME * NOMINAL_CRUISE; // = 9000, the cap a level length ramps toward
function levelLength(n) { return Math.round(Math.min(LEVEL_LEN, 2500 + n * 1100)); }
let curLevelLen = 2500;
const LEVELS = [
  { key: "city",   name: "Metropolis", sky: 0x9fd4ff, fog: 0xc3e6ff, ground: 0x67c267, hs: 0xcfeaff, hg: 0x6a8b53, amp: 1.0, build: true,  fogNear: 350, fogFar: 1100, obs: ["crane", "blimp"] },
  { key: "coast",  name: "Coastline",  sky: 0x7ec8ff, fog: 0xbfe6ff, ground: 0xe9d59c, hs: 0xd5efff, hg: 0xc2a96e, amp: 0.5, build: false, fogNear: 380, fogFar: 1250, obs: ["bird", "blimp"] },
  { key: "highl",  name: "Highlands",  sky: 0x8fc0e6, fog: 0xb6d2e6, ground: 0x8fb06a, hs: 0xd2e3f2, hg: 0x5d7a44, amp: 2.6, build: false, fogNear: 300, fogFar: 1050, obs: ["crane", "bird"] },
  { key: "mesa",   name: "Sunset Mesa",sky: 0xffcf94, fog: 0xffe2bc, ground: 0xd9925a, hs: 0xffe9cf, hg: 0xb5703a, amp: 1.7, build: false, fogNear: 340, fogFar: 1150, obs: ["bird", "crane"] },
  { key: "meadow", name: "Meadows",    sky: 0xaee4ff, fog: 0xd2f0ff, ground: 0x79cf52, hs: 0xdaf5ff, hg: 0x5fa83f, amp: 0.7, build: false, fogNear: 380, fogFar: 1300, obs: ["bird"] },
  { key: "glacier",name: "Glacier",    sky: 0xd2eaff, fog: 0xeefaff, ground: 0xeaf2f7, hs: 0xf0f8ff, hg: 0xbcd0dd, amp: 1.9, build: false, fogNear: 320, fogFar: 1200, obs: ["blimp", "bird"] },
  { key: "skycity",name: "Sky City",   sky: 0xc3e2ff, fog: 0xe0eeff, ground: 0x86c2a0, hs: 0xe8f4ff, hg: 0x6aa080, amp: 1.1, build: true,  fogNear: 350, fogFar: 1150, obs: ["blimp", "crane"] },
];
function zoneForLevel(n) { return n <= 0 ? LEVELS[0] : LEVELS[1 + ((n - 1) % (LEVELS.length - 1))]; }
let curZone = LEVELS[0];
function setColorHex(target, hex) { if (target && target.setHex) target.setHex(hex); }
function applyZone(z) {
  curZone = z;
  setColorHex(scene.background, z.sky);
  if (scene.fog) { setColorHex(scene.fog.color, z.fog); scene.fog.near = z.fogNear * qFog; scene.fog.far = z.fogFar * qFog; }
  setColorHex(terrainMat.color, z.ground);
  setColorHex(hemi.color, z.hs);
  setColorHex(hemi.groundColor, z.hg);
}
function announceLevel() {
  const el = document.getElementById("levelName");
  if (el) { el.textContent = "LEVEL " + (save.level + 1) + " · " + curZone.name; el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2600); }
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
function buildPlane(tier) {
  if (plane) scene.remove(plane);
  const t = TIERS[tier];
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: t.body, metalness: 0.2, roughness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: t.accent, metalness: 0.25, roughness: 0.5 });
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
const PLANE_GROUND = 1.6;

function setupRun() {
  applyZone(zoneForLevel(save.level));   // this level's theme (sets terrain amplitude + colors)
  curLevelLen = levelLength(save.level);
  buildPlane(save.tier);
  yaw = 0; pitch = 0; roll = 0;
  pos.set(0, terrainH(0, 6) + PLANE_GROUND, 6);
  vel.set(0, 0, 0);
  boostMax = 1.1 + lvl("fuel") * 0.5;
  boostFuel = boostMax;
  boosting = false; runCoins = 0; lowSpeedT = 0; pendingEvoName = null; shakeT = 0;
  comboMult = 1; ringsPassed = 0; runCoinPickups = 0; crashT = 0; prevZ = pos.z; levelCleared = false;
  terrainSnapZ = NaN;                    // force terrain rebuild for the new zone amplitude
  resetCoins();
  resetCity();
  resetFuels();
  resetRings();
  resetThermals();
  resetObstacles();
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
function launch(power, launchPitch) {
  // Launch Power dominates the initial speed; a fresh plane is slow off the ramp.
  const maxSpeed = 56 + lvl("power") * 18 + save.tier * 6;
  let speed = lerp(32, maxSpeed, power);
  const perfect = power >= PERFECT_LO && power <= PERFECT_HI;
  if (perfect) { speed *= 1.18; boostFuel = Math.min(boostMax, boostFuel + 0.4); goalBanner("✦ PERFECT LAUNCH"); Sound.ring(); haptic(25); }
  pitch = launchPitch; yaw = 0;
  const f = forwardVec(new THREE.Vector3());
  vel.copy(f).multiplyScalar(speed);
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
  boosting = boostHeld && boostFuel > 0 && hasBoost();

  pitch += (targetPitch - pitch) * Math.min(1, dt * 4);
  yaw += yawRate * dt;
  roll += ((-yawRate * 0.5) - roll) * Math.min(1, dt * 5);

  const f = forwardVec(fTmp);
  let speed = vel.length();

  // thrust (only once a Boost upgrade is owned)
  const flame = plane.userData.flame;
  if (boosting) {
    const thrust = 48 + lvl("boost") * 12 + save.tier * 3;
    vel.addScaledVector(f, thrust * dt);
    boostFuel = Math.max(0, boostFuel - dt);
    if (flame) { flame.visible = true; flame.scale.setScalar(rand(0.8, 1.3)); }
  } else if (flame) flame.visible = false;

  // gravity
  vel.y -= G * dt;

  // pitch trades altitude for speed: nose DOWN accelerates strongly, nose UP decelerates
  vel.addScaledVector(f, -Math.sin(pitch) * G * 1.3 * dt);

  // lift: horizontal speed sustains altitude. Weak by default — Wings upgrades matter a lot.
  const speedH = Math.hypot(vel.x, vel.z);
  const lift = clamp(speedH * (0.014 + lvl("wings") * 0.026), 0, G * 0.9);
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

  // coin value scales with the Coin Multiplier upgrade and the current ring combo
  const coinValue = Math.round((1 + lvl("mult") * 0.5) * comboMult);
  const magnetR = 9 + lvl("magnet") * 11;
  for (const c of coins) {
    if (!c.got) {
      const dx = c.x - pos.x, dy = c.y - pos.y, dz = c.z - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (lvl("magnet") > 0 && d2 < magnetR * magnetR) {  // magnet pull
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

  // buildings: hitting one is a CRASH (ends the run) — weave through the gaps
  const PH = 2.6;
  for (const b of buildings) {
    if (b.active &&
        Math.abs(pos.x - b.x) < b.w / 2 + PH &&
        Math.abs(pos.z - b.z) < b.d / 2 + PH &&
        pos.y < b.topY + PH) { crash(); break; }
    if (pos.z - b.z > 60) placeBuilding(b);
  }

  // obstacles (blimps drift, birds swarm, cranes loom) — also crash you
  for (const o of obstacles) {
    if (!o.active) { if (pos.z - o.z > 80) placeObstacle(o); continue; }
    o.t += dt;
    if (o.type === "blimp") {
      o.x += o.drift * dt; o.grp.position.x = o.x; o.grp.position.y = o.y + Math.sin(o.t) * 1.2;
      const dx = (pos.x - o.x) / 9, dy = (pos.y - o.grp.position.y) / 4.5, dz = (pos.z - o.z) / 5;
      if (dx * dx + dy * dy + dz * dz < 1) { crash(); }
    } else if (o.type === "bird") {
      o.x += o.drift * dt; o.z -= 18 * dt; // fly toward the player
      o.grp.position.set(o.x, o.y + Math.sin(o.t * 4) * 1.5, o.z);
      const dx = pos.x - o.x, dy = pos.y - o.grp.position.y, dz = pos.z - o.z;
      if (dx * dx + dy * dy + dz * dz < 16) { crash(); }
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
  fh.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
  camGoal.copy(pos).addScaledVector(fh, -14); camGoal.y += 6;
  camera.position.lerp(camGoal, Math.min(1, dt * 3));
  camLook.copy(pos); camLook.y += 2; camLook.z += 8;
  camera.lookAt(camLook);
  updateShadow();
  spinCoins(dt);
}

function updateTitle(dt) {
  titleT += dt;
  const r = 20;
  camera.position.set(Math.sin(titleT * 0.25) * r, 7 + Math.sin(titleT * 0.4) * 1.5, 6 + Math.cos(titleT * 0.25) * r);
  camera.lookAt(0, 2, 8);
  spinCoins(dt);
}
function spinCoins(dt) { for (const c of coins) if (!c.got) c.mesh.rotation.z += dt * 2; }

// ---------- End run ----------
function endRun() {
  state = "result";
  const meters = Math.max(0, Math.floor(Math.min(pos.z, curLevelLen)));
  const completedLevel = save.level + 1;            // for display, before advancing
  let earned = runCoins + Math.floor(meters / 8);   // tighter economy: less per metre
  let completeBonus = 0;
  if (levelCleared) { completeBonus = 200 + save.level * 60; earned += completeBonus; }
  save.coins += earned;
  if (meters > save.best) save.best = meters;
  const prevTier = save.tier;
  if (levelCleared) save.level += 1;                // advance to the next level
  save.tier = computeTier();
  if (save.tier > prevTier) { pendingEvoName = TIERS[save.tier].name; Sound.evolve(); }
  const missionReward = evalMissions({ dist: meters, coins: runCoinPickups, rings: ringsPassed });
  persist();
  const resTitle = document.getElementById("resultTitle");
  if (resTitle) resTitle.textContent = levelCleared ? "LEVEL " + completedLevel + " COMPLETE!" : "DITCHED!";
  document.getElementById("runDist").textContent = meters;
  document.getElementById("runCoins").textContent = earned;
  document.getElementById("runBest").textContent = save.best;
  const notice = document.getElementById("evoNotice");
  if (pendingEvoName) { notice.classList.remove("hidden"); document.getElementById("evoNoticeName").textContent = pendingEvoName; }
  else notice.classList.add("hidden");
  const mEl = document.getElementById("missionResult");
  if (mEl) { if (missionReward > 0) { mEl.classList.remove("hidden"); mEl.textContent = "🎯 Mission complete +" + missionReward + " coins!"; } else mEl.classList.add("hidden"); }
  // the launch button continues to the (possibly new) current level
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
function updateHUD() {
  distBig.innerHTML = Math.max(0, Math.floor(pos.z)) + "<small>METERS</small>";
  coinHud.innerHTML = "◉ " + runCoins + (comboMult > 1 ? ` <span style="color:#49e0ff">×${comboMult.toFixed(1)}</span>` : "");
  if (goalHud) goalHud.textContent = "🏁 " + Math.max(0, curLevelLen - Math.floor(pos.z)) + " m";
  const frac = clamp(boostFuel / boostMax, 0, 1);
  fuelFill.style.width = (frac * 100) + "%";
  fuelLabel.textContent = boostFuel > 0 ? "BOOST FUEL 🔥" : "BOOST EMPTY — GLIDE!";
  if (cabinEl) cabinEl.classList.toggle("show", cabinWarn);
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
    const { power, lp } = aimValues();
    if (power > 0.06) launch(power, lp);
    else aimHintEl.textContent = "Drag back & release to launch";
  }
  touch.down = false;
}
function aimValues() {
  const dy = touch.y - touch.startY;       // drag down to pull back
  const len = Math.hypot(touch.x - touch.startX, dy);
  const maxDrag = window.innerHeight * 0.4;
  const power = clamp(len / maxDrag, 0, 1);
  const lp = 0.35 + power * 0.4;            // harder pull = steeper + faster
  return { power, lp };
}
function predictArc() {
  const { power, lp } = aimValues();
  const maxSpeed = 56 + lvl("power") * 18 + save.tier * 6;
  let speed = lerp(32, maxSpeed, power);
  if (power >= PERFECT_LO && power <= PERFECT_HI) speed *= 1.18;
  let px = pos.x, py = pos.y, pz = pos.z;
  let vx = 0, vy = Math.sin(lp) * speed, vz = Math.cos(lp) * speed;
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

function flightStart(list) {
  for (const t of list) {
    if (t.clientX >= window.innerWidth * 0.5) {
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
  if (e.clientX >= window.innerWidth * 0.5) { mouseRole = "joy"; joy.id = -1; joy.active = true; recomputeJoyCenter(); joyMoveTo(e.clientX, e.clientY); }
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
}
function buyUpgrade(u) {
  Sound.resume();
  const cost = upgradeCost(u);
  if (lvl(u.key) >= u.max || save.coins < cost) return;
  save.coins -= cost; save.up[u.key]++;
  persist(); renderShop();
}

function renderMissions() {
  const el = document.getElementById("missions");
  if (!el) return;
  el.innerHTML = `<div class="mTitle">🎯 MISSIONS</div>` + save.missions.map(m =>
    `<div class="mRow"><span>${missionText(m)}</span><span class="mRew"><span class="coin"></span>${m.reward}</span></div>`
  ).join("");
}
function goHangar() { renderShop(); renderMissions(); showOverlay("hangar"); state = "hangar"; }
function goAim() {
  setupRun();
  state = "aim";
  hideAllOverlays();
  hud.classList.remove("hidden");
  hideFlightControls();
  fuelWrap.style.display = "block";          // reused as the launch power meter
  fuelFill.style.width = "0%";
  fuelLabel.textContent = "DRAG BACK & RELEASE TO LAUNCH";
  aimHintEl.textContent = "Drag back & release to launch ✈";
}

document.getElementById("playBtn").addEventListener("click", goHangar);
document.getElementById("launchBtn").addEventListener("click", goAim);
document.getElementById("againBtn").addEventListener("click", goAim);
document.getElementById("shopBtn").addEventListener("click", goHangar);
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
pos.set(0, terrainH(0, 6) + PLANE_GROUND, 6);
plane.position.copy(pos);
updateTerrain(0, 6);
updateSea(0, 6);
resetCoins();
resetCity();
resetFuels();
resetRings();
resetThermals();
resetObstacles();
placeFinish();
updateShadow();
checkDaily();
document.getElementById("bestTitle").textContent = save.best;
loadingEl.classList.add("hidden");
showOverlay("title");
state = "title";
requestAnimationFrame(loop);
})();
