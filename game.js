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
const TAU = Math.PI * 2, DEG = Math.PI / 180;

// ---------- Terrain height field (world-anchored, infinite illusion) ----------
function terrainH(x, z) {
  let h = Math.sin(x * 0.012) * 4
        + Math.sin(z * 0.010) * 6
        + Math.sin((x + z) * 0.006) * 9
        + Math.sin(z * 0.028 + x * 0.01) * 2;
  // flatten the runway area around the start
  const flat = clamp(z / 130, 0, 1);
  return h * flat;
}
// Meandering "safe lane" through the city — coins and gaps follow it (Boston-style winding streets)
function laneX(z) { return Math.sin(z * 0.008) * 42 + Math.sin(z * 0.021 + 1.3) * 16; }

// ---------- Upgrades & evolution ----------
const UPGRADES = [
  { key: "power", ico: "🚀", name: "Launch Power",  max: 8, baseCost: 40, growth: 1.55 },
  { key: "boost", ico: "🔥", name: "Boost Thrust",  max: 8, baseCost: 50, growth: 1.55 },
  { key: "fuel",  ico: "⛽", name: "Fuel Tank",     max: 8, baseCost: 45, growth: 1.55 },
  { key: "aero",  ico: "🪶", name: "Aerodynamics",  max: 8, baseCost: 55, growth: 1.6  },
  { key: "wings", ico: "🛩", name: "Wings & Lift",   max: 8, baseCost: 60, growth: 1.6  },
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
  save.up = save.up || {};
  for (const u of UPGRADES) save.up[u.key] = save.up[u.key] || 0;
  save.tier = computeTier();
}
function persist() { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
function lvl(k) { return save.up[k] || 0; }
function upgradeCost(u) { return Math.round(u.baseCost * Math.pow(u.growth, lvl(u.key))); }
function totalLevels() { return UPGRADES.reduce((s, u) => s + lvl(u.key), 0); }
function computeTier() { return Math.min(TIERS.length - 1, Math.floor(totalLevels() / 4)); }

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

// ---------- Terrain mesh ----------
const T_W = 760, T_D = 1500, T_WSEG = 46, T_DSEG = 90;
const cellX = T_W / T_WSEG, cellZ = T_D / T_DSEG;
const terrainGeo = new THREE.PlaneGeometry(T_W, T_D, T_WSEG, T_DSEG);
terrainGeo.rotateX(-Math.PI / 2); // lie flat in XZ; Y is height
const terrainMat = new THREE.MeshLambertMaterial({ color: 0x67c267, flatShading: true });
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
scene.add(terrain);
let terrainSnapX = NaN, terrainSnapZ = NaN;
const FORWARD_BIAS = 380;
function updateTerrain(px, pz) {
  const sx = Math.round(px / cellX) * cellX;
  const sz = Math.round((pz + FORWARD_BIAS) / cellZ) * cellZ;
  if (sx === terrainSnapX && sz === terrainSnapZ) return;
  terrainSnapX = sx; terrainSnapZ = sz;
  terrain.position.set(sx, 0, sz);
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i), lz = pos.getZ(i);
    pos.setY(i, terrainH(sx + lx, sz + lz));
  }
  pos.needsUpdate = true;
  terrainGeo.computeVertexNormals();
}

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

// ---------- Ground shadow (altitude depth cue) ----------
const shadowMesh = (() => {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false, opacity: 0.45 });
  const m = new THREE.Mesh(geo, mat);
  scene.add(m);
  return m;
})();
function updateShadow() {
  const gh = terrainH(pos.x, pos.z);
  const alt = clamp(pos.y - gh, 0, 160);
  const k = clamp(alt / 130, 0, 1);
  shadowMesh.position.set(pos.x, gh + 0.2, pos.z);
  const s = lerp(9, 26, k);          // grows + softens with altitude
  shadowMesh.scale.set(s, s, s);
  shadowMesh.material.opacity = lerp(0.5, 0.06, k);
  shadowMesh.visible = true;
}

// ---------- City (Boston-style irregular blocks to weave between) ----------
const CITY_HALF = 115;               // city spreads this far either side of center
const CITY_START_Z = 170;            // open runway before the skyline begins
const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
const cityMats = [0x9aa3ad, 0x8b96a3, 0xb0a99b, 0xa8b0b8, 0x9d8f80, 0x7e8893]
  .map(c => new THREE.MeshLambertMaterial({ color: c }));
const BUILDING_COUNT = 70;
const buildings = [];
for (let i = 0; i < BUILDING_COUNT; i++) {
  const mesh = new THREE.Mesh(buildingGeo, cityMats[i % cityMats.length]);
  mesh.visible = false; scene.add(mesh);
  buildings.push({ mesh, x: 0, z: 0, w: 0, d: 0, topY: 0, active: false });
}
let genZ = 0, rowSlots = [];
function buildRow(z) {
  const L = laneX(z), gap = rand(30, 46);
  // tall "downtown" clusters appear periodically; elsewhere mid-rise
  const downtown = Math.sin(z * 0.0032) > 0.35;
  const slots = [];
  let x = -CITY_HALF + rand(0, 14);
  while (x < CITY_HALF) {
    const w = rand(12, 26), d = rand(12, 26);
    const cx = x + w / 2;
    // leave the winding street open
    if (Math.abs(cx - L) > gap) {
      let h = downtown ? rand(45, 130) : rand(16, 60);
      if (Math.random() < 0.12) h += rand(20, 60); // occasional spike
      slots.push({ x: cx, w, d, h });
    }
    x += w + rand(8, 24);
  }
  return slots;
}
function nextPlacement() {
  if (rowSlots.length === 0) { genZ += rand(40, 78); rowSlots = buildRow(genZ); }
  const s = rowSlots.pop();
  return { x: s.x, z: genZ, w: s.w, d: s.d, h: s.h };
}
function placeBuilding(b) {
  const p = nextPlacement();
  const gh = terrainH(p.x, p.z);
  b.x = p.x; b.z = p.z; b.w = p.w; b.d = p.d; b.topY = gh + p.h; b.active = true;
  b.mesh.scale.set(p.w, p.h, p.d);
  b.mesh.position.set(p.x, gh + p.h / 2, p.z);
  b.mesh.visible = true;
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

// ---------- Game state ----------
let state = "title"; // title | hangar | aim | flight | result
const pos = new THREE.Vector3();
const vel = new THREE.Vector3();
let yaw = 0, pitch = 0, roll = 0;
let boostFuel = 0, boostMax = 0, boosting = false;
let runCoins = 0, lowSpeedT = 0, pendingEvoName = null, titleT = 0, shakeT = 0;
const PLANE_GROUND = 1.6;

function setupRun() {
  buildPlane(save.tier);
  yaw = 0; pitch = 0; roll = 0;
  pos.set(0, terrainH(0, 6) + PLANE_GROUND, 6);
  vel.set(0, 0, 0);
  boostMax = 1.1 + lvl("fuel") * 0.5;
  boostFuel = boostMax;
  boosting = false; runCoins = 0; lowSpeedT = 0; pendingEvoName = null; shakeT = 0;
  resetCoins();
  resetCity();
  resetFuels();
  updateTerrain(pos.x, pos.z);
  plane.position.copy(pos);
  plane.rotation.set(0, 0, 0);
  updateShadow();
}

function forwardVec(out) {
  out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  return out;
}

// ---------- Launch ----------
function launch(power, launchPitch) {
  // Launch Power dominates initial speed; a fresh plane is slow and won't go far without upgrades.
  const maxSpeed = 78 + lvl("power") * 22 + save.tier * 8;
  const speed = lerp(44, maxSpeed, power);
  pitch = launchPitch; yaw = 0;
  const f = forwardVec(new THREE.Vector3());
  vel.copy(f).multiplyScalar(speed);
  state = "flight";
  hud.classList.remove("hidden");
  aimHintEl.textContent = "";
  hideAllOverlays();
  showFlightControls();
}

// ---------- Physics ----------
const G = 25, fTmp = new THREE.Vector3(), dTmp = new THREE.Vector3();
function updateFlight(dt) {
  // input → target attitude (virtual joystick)
  let targetPitch = pitch * 0.985; // relax toward level when not steering
  let yawRate = 0;
  if (joy.active) {
    targetPitch = clamp(joy.y * 0.8, -0.7, 0.85);   // push stick DOWN = climb (inverted)
    yawRate = -joy.x * 1.2;                          // stick right = bank right on screen
  }
  boosting = boostHeld && boostFuel > 0 && hasBoost();

  pitch += (targetPitch - pitch) * Math.min(1, dt * 4);
  yaw += yawRate * dt;
  roll += ((-yawRate * 0.5) - roll) * Math.min(1, dt * 5);

  const f = forwardVec(fTmp);
  let speed = vel.length();

  // thrust (only available once a Boost upgrade is owned)
  const flame = plane.userData.flame;
  if (boosting) {
    const thrust = 62 + lvl("boost") * 15 + save.tier * 4;
    vel.addScaledVector(f, thrust * dt);
    boostFuel = Math.max(0, boostFuel - dt);
    if (flame) { flame.visible = true; flame.scale.setScalar(rand(0.8, 1.3)); }
  } else if (flame) flame.visible = false;

  // gravity
  vel.y -= G * dt;

  // pitch trades altitude for speed: nose DOWN accelerates along heading, nose UP decelerates
  vel.addScaledVector(f, -Math.sin(pitch) * G * 0.65 * dt);

  // lift: horizontal speed sustains altitude. Weak by default — Wings upgrades matter a lot.
  const speedH = Math.hypot(vel.x, vel.z);
  const lift = clamp(speedH * (0.03 + lvl("wings") * 0.030), 0, G * 0.97);
  vel.y += lift * dt;

  // aerodynamic alignment: send velocity where the nose points (so pitch actually steers the dive)
  speed = vel.length();
  dTmp.copy(f).multiplyScalar(speed);
  vel.lerp(dTmp, Math.min(1, 2.0 * dt));

  // drag (much less with Aerodynamics upgrades)
  const drag = 0.25 - lvl("aero") * 0.022;
  vel.multiplyScalar(Math.max(0, 1 - drag * dt));

  pos.addScaledVector(vel, dt);

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

  // coins
  for (const c of coins) {
    if (!c.got) {
      const dx = c.x - pos.x, dy = c.y - pos.y, dz = c.z - pos.z;
      if (dx * dx + dy * dy + dz * dz < 36) { c.got = true; c.mesh.visible = false; runCoins++; }
      c.mesh.rotation.z += dt * 3;
    }
    if (c.got || pos.z - c.z > 50) placeCoin(c);
  }

  // boost-fuel pickups: refill the tank
  for (const f of fuels) {
    if (!f.got) {
      f.grp.rotation.y += dt * 2.2;
      const dx = f.x - pos.x, dy = f.y - pos.y, dz = f.z - pos.z;
      if (dx * dx + dy * dy + dz * dz < 49) {
        f.got = true; f.grp.visible = false;
        boostFuel = Math.min(boostMax, boostFuel + boostMax * FUEL_REFILL);
        shakeT = Math.max(shakeT, 0.1);
      }
    }
    if (f.got || pos.z - f.z > 60) placeFuel(f);
  }

  // buildings: collision (weave between them) + recycle ahead
  const PH = 3.0; // plane collision half-size (forgiving so you can squeeze through)
  for (const b of buildings) {
    if (b.active &&
        Math.abs(pos.x - b.x) < b.w / 2 + PH &&
        Math.abs(pos.z - b.z) < b.d / 2 + PH &&
        pos.y < b.topY + PH) {
      handleBuildingHit(b);
    }
    if (pos.z - b.z > 60) placeBuilding(b);
  }

  updateShadow();
  updateTerrain(pos.x, pos.z);
  updateChaseCamera(dt, f);
  updateHUD();

  if (onGround && lowSpeedT > 0.7) endRun();
}

function handleBuildingHit(b) {
  // hard knock: kill most momentum, bounce up and back, shove sideways out of the wall
  vel.multiplyScalar(0.22);
  vel.z = -Math.abs(vel.z) - 6;
  vel.y = Math.max(vel.y, 0) + 9;
  vel.x += (pos.x < b.x ? -1 : 1) * 14;
  pos.z = b.z - (b.d / 2 + 3.2); // pop just in front of the face we hit
  shakeT = 0.35;
}

const camGoal = new THREE.Vector3(), camLook = new THREE.Vector3(), fh = new THREE.Vector3();
function updateChaseCamera(dt, f) {
  fh.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
  camGoal.copy(pos).addScaledVector(fh, -15).add(new THREE.Vector3(0, 6.5, 0));
  // don't let camera dip under terrain
  const camGround = terrainH(camGoal.x, camGoal.z) + 3;
  if (camGoal.y < camGround) camGoal.y = camGround;
  camera.position.lerp(camGoal, Math.min(1, dt * 4));
  if (shakeT > 0) {
    shakeT = Math.max(0, shakeT - dt);
    const m = shakeT * 12;
    camera.position.x += rand(-m, m); camera.position.y += rand(-m, m);
  }
  camLook.copy(pos).addScaledVector(fh, 12).add(new THREE.Vector3(0, 1.5, 0));
  camera.lookAt(camLook);
}

// ---------- Aim camera / preview ----------
function updateAim(dt) {
  // gentle behind-the-plane view
  fh.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
  camGoal.copy(pos).addScaledVector(fh, -14).add(new THREE.Vector3(0, 6, 0));
  camera.position.lerp(camGoal, Math.min(1, dt * 3));
  camLook.copy(pos).add(new THREE.Vector3(0, 2, 8));
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
  const meters = Math.max(0, Math.floor(pos.z));
  const earned = runCoins + Math.floor(meters / 4);
  save.coins += earned;
  if (meters > save.best) save.best = meters;
  persist();
  document.getElementById("runDist").textContent = meters;
  document.getElementById("runCoins").textContent = earned;
  document.getElementById("runBest").textContent = save.best;
  const notice = document.getElementById("evoNotice");
  if (pendingEvoName) { notice.classList.remove("hidden"); document.getElementById("evoNoticeName").textContent = pendingEvoName; }
  else notice.classList.add("hidden");
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
function updateHUD() {
  distBig.innerHTML = Math.max(0, Math.floor(pos.z)) + "<small>METERS</small>";
  coinHud.textContent = "◉ " + runCoins;
  const frac = clamp(boostFuel / boostMax, 0, 1);
  fuelFill.style.width = (frac * 100) + "%";
  fuelLabel.textContent = boostFuel > 0 ? "BOOST FUEL 🔥" : "BOOST EMPTY — GLIDE!";
}

// ---------- Input ----------
const touch = { down: false, x: 0, y: 0, startX: 0, startY: 0 };
function pt(e) { const t = e.touches ? e.touches[0] : (e.changedTouches ? e.changedTouches[0] : e); return { x: t.clientX, y: t.clientY }; }
function onDown(e) {
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
function showAimPreview() {
  const { power } = aimValues();
  fuelFill.style.width = (power * 100) + "%";
  fuelLabel.textContent = "POWER " + Math.round(power * 100) + "% — release!";
  aimHintEl.textContent = "";
}
canvas.addEventListener("touchstart", e => { e.preventDefault(); onDown(e); }, { passive: false });
canvas.addEventListener("touchmove",  e => { e.preventDefault(); onMove(e); }, { passive: false });
canvas.addEventListener("touchend",   e => { e.preventDefault(); onUp(e); }, { passive: false });
canvas.addEventListener("touchcancel",e => { e.preventDefault(); onUp(e); }, { passive: false });
canvas.addEventListener("mousedown", onDown);
window.addEventListener("mousemove", onMove);
window.addEventListener("mouseup", onUp);

// ---------- Virtual joystick (bottom-right) + boost button (bottom-left) ----------
const joy = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0, r: 60 };
let boostHeld = false;
const joyEl = document.getElementById("joy");
const joyKnob = document.getElementById("joyKnob");
const boostBtn = document.getElementById("boostBtn");
const hasBoost = () => lvl("boost") >= 1;

function joyMoveTo(x, y) {
  let dx = x - joy.cx, dy = y - joy.cy;
  const len = Math.hypot(dx, dy);
  if (len > joy.r) { dx *= joy.r / len; dy *= joy.r / len; }
  joy.x = dx / joy.r; joy.y = dy / joy.r;
  joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
}
function joyStart(x, y) {
  const r = joyEl.getBoundingClientRect ? joyEl.getBoundingClientRect() : { left: x, top: y, width: 0, height: 0 };
  joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2; joy.active = true;
  joyMoveTo(x, y);
}
function joyReset() { joy.active = false; joy.id = null; joy.x = 0; joy.y = 0; if (joyKnob) joyKnob.style.transform = "translate(0px,0px)"; }

joyEl.addEventListener("touchstart", e => { e.preventDefault(); const t = e.changedTouches[0]; joy.id = t.identifier; joyStart(t.clientX, t.clientY); }, { passive: false });
joyEl.addEventListener("touchmove",  e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === joy.id) joyMoveTo(t.clientX, t.clientY); }, { passive: false });
joyEl.addEventListener("touchend",   e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === joy.id) joyReset(); }, { passive: false });
joyEl.addEventListener("touchcancel",e => { e.preventDefault(); joyReset(); }, { passive: false });
// mouse (desktop)
let joyMouse = false;
joyEl.addEventListener("mousedown", e => { e.preventDefault(); joyMouse = true; joyStart(e.clientX, e.clientY); });
window.addEventListener("mousemove", e => { if (joyMouse) joyMoveTo(e.clientX, e.clientY); });
window.addEventListener("mouseup", () => { if (joyMouse) { joyMouse = false; joyReset(); } });

function boostOn(e) { if (e) e.preventDefault(); boostHeld = true; boostBtn.classList.add("active"); }
function boostOff(e) { if (e) e.preventDefault(); boostHeld = false; boostBtn.classList.remove("active"); }
boostBtn.addEventListener("touchstart", boostOn, { passive: false });
boostBtn.addEventListener("touchend", boostOff, { passive: false });
boostBtn.addEventListener("touchcancel", boostOff, { passive: false });
boostBtn.addEventListener("mousedown", boostOn);
window.addEventListener("mouseup", () => boostOff());

function showFlightControls() {
  joyReset(); joyEl.classList.add("show");
  if (hasBoost()) boostBtn.classList.add("show"); else boostBtn.classList.remove("show");
  fuelWrap.style.display = hasBoost() ? "block" : "none";
}
function hideFlightControls() {
  joyEl.classList.remove("show"); boostBtn.classList.remove("show"); boostHeld = false;
  boostBtn.classList.remove("active");
}

// ---------- Loop ----------
let last = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.04, (ts - last) / 1000 || 0);
  last = ts;
  if (state === "flight") updateFlight(dt);
  else if (state === "aim") updateAim(dt);
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
  const cost = upgradeCost(u);
  if (lvl(u.key) >= u.max || save.coins < cost) return;
  save.coins -= cost; save.up[u.key]++;
  const before = save.tier; save.tier = computeTier();
  if (save.tier > before) { pendingEvoName = TIERS[save.tier].name; buildPlane(save.tier); }
  persist(); renderShop();
}

function goHangar() { renderShop(); showOverlay("hangar"); state = "hangar"; }
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

// ---------- Boot ----------
loadSave();
buildPlane(save.tier);
pos.set(0, terrainH(0, 6) + PLANE_GROUND, 6);
plane.position.copy(pos);
updateTerrain(0, 6);
resetCoins();
resetCity();
resetFuels();
updateShadow();
document.getElementById("bestTitle").textContent = save.best;
loadingEl.classList.add("hidden");
showOverlay("title");
state = "title";
requestAnimationFrame(loop);
})();
