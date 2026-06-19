/* Headless test harness for game.js.
   Mocks Three.js (with a REAL Vector3 so physics actually runs) and the DOM,
   then drives the game through every state to catch runtime errors. */
const fs = require("fs");
const path = require("path");

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log("  ✓ " + msg); }
  else { console.log("  ✗ FAIL: " + msg); failures++; }
}

// ---------- real-ish Vector3 ----------
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
}

// ---------- geometry / material / object mocks ----------
function makeBufferAttr(count) {
  const arr = new Float32Array(count * 3);
  return {
    count,
    getX: i => arr[i * 3], getY: i => arr[i * 3 + 1], getZ: i => arr[i * 3 + 2],
    setX: (i, v) => { arr[i * 3] = v; }, setY: (i, v) => { arr[i * 3 + 1] = v; }, setZ: (i, v) => { arr[i * 3 + 2] = v; },
    needsUpdate: false, array: arr,
  };
}
function geo(extra = {}) {
  return Object.assign({
    rotateX() { return this; }, rotateY() { return this; }, rotateZ() { return this; },
    computeVertexNormals() {}, attributes: {},
  }, extra);
}
function obj3d() {
  return {
    position: new V3(), rotation: { x: 0, y: 0, z: 0, order: "XYZ", set(a, b, c) { this.x = a; this.y = b; this.z = c; } },
    scale: { x: 1, y: 1, z: 1, set(a, b, c) { this.x = a; this.y = b; this.z = c; }, setScalar(s) { this.x = this.y = this.z = s; } },
    visible: true, userData: {}, children: [],
    add(c) { this.children.push(c); }, remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
  };
}

const THREE = {
  Vector3: V3,
  Color: class { constructor() {} },
  Fog: class { constructor() {} },
  Scene: class { constructor() { Object.assign(this, obj3d()); this.background = null; this.fog = null; } },
  PerspectiveCamera: class { constructor() { Object.assign(this, obj3d()); this.aspect = 1; } updateProjectionMatrix() {} lookAt() {} },
  WebGLRenderer: class { constructor() {} setPixelRatio() {} setSize() {} render() {} },
  HemisphereLight: class { constructor() { Object.assign(this, obj3d()); } },
  DirectionalLight: class { constructor() { Object.assign(this, obj3d()); } },
  SpriteMaterial: class { constructor() {} },
  MeshBasicMaterial: class { constructor() {} },
  MeshLambertMaterial: class { constructor() {} },
  MeshStandardMaterial: class { constructor() {} },
  CanvasTexture: class { constructor() {} },
  Sprite: class { constructor() { Object.assign(this, obj3d()); } },
  Mesh: class { constructor(g, m) { Object.assign(this, obj3d()); this.geometry = g; this.material = m; } },
  Group: class { constructor() { Object.assign(this, obj3d()); } },
  PlaneGeometry: class { constructor(w, d, ws = 1, ds = 1) { Object.assign(this, geo()); this.attributes = { position: makeBufferAttr((ws + 1) * (ds + 1)) };
    // lay out a grid so terrain displacement reads real planar coords
    const pos = this.attributes.position; let i = 0;
    for (let zi = 0; zi <= ds; zi++) for (let xi = 0; xi <= ws; xi++) { pos.setX(i, -w / 2 + (w / ws) * xi); pos.setZ(i, -d / 2 + (d / ds) * zi); i++; } } },
  BoxGeometry: class { constructor() { Object.assign(this, geo()); } },
  ConeGeometry: class { constructor() { Object.assign(this, geo()); } },
  CylinderGeometry: class { constructor() { Object.assign(this, geo()); } },
  TorusGeometry: class { constructor() { Object.assign(this, geo()); } },
  SphereGeometry: class { constructor() { Object.assign(this, geo()); } },
};

// ---------- DOM mock ----------
function mockCtx() {
  return {
    fillStyle: "", createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {}, beginPath() {}, arc() {}, fill() {},
  };
}
function mockEl(id) {
  const listeners = {};
  const el = {
    id, _text: "", _html: "", style: {}, children: [],
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    set textContent(v) { this._text = String(v); }, get textContent() { return this._text; },
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    _fire(t, ev) { (listeners[t] || []).forEach(fn => fn(ev || { preventDefault() {} })); },
    querySelector() { return mockEl(id + "::child"); },
    appendChild(c) { this.children.push(c); }, getContext() { return mockCtx(); },
    width: 0, height: 0,
  };
  return el;
}
const elements = {};
const document = {
  getElementById(id) { return (elements[id] = elements[id] || mockEl(id)); },
  createElement(tag) { return mockEl("created:" + tag); },
};

// ---------- window / globals ----------
let rafCb = null;
const winListeners = {};
const window = {
  innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
  addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
};
const localStore = new Map();
const localStorage = {
  getItem: k => (localStore.has(k) ? localStore.get(k) : null),
  setItem: (k, v) => localStore.set(k, String(v)),
};
let nowMs = 0;
const performanceMock = { now: () => nowMs };

// Seed a save with coins + some upgrades so we exercise tier>0 (bigger plane) and the shop.
localStore.set("pe3d_save_v1", JSON.stringify({
  coins: 100000, best: 0, up: { power: 3, boost: 2, fuel: 4, aero: 1, wings: 2 },
}));

// expose globals
Object.assign(globalThis, {
  THREE, document, window, localStorage,
  performance: performanceMock,
  requestAnimationFrame: cb => { rafCb = cb; return 1; },
  cancelAnimationFrame: () => {},
});

// ---------- load and run game.js in global scope ----------
const code = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
console.log("Loading game.js...");
try { (0, eval)(code); } catch (e) { console.log("  ✗ FAIL: threw during boot: " + e.stack); process.exit(1); }
assert(typeof rafCb === "function", "boot completed and registered a render loop");
assert(elements["loading"].classList.contains("hidden"), "loading overlay hidden after boot");
assert(!elements["titleScreen"].classList.contains("hidden"), "title screen visible after boot");

// helpers to drive
function frame(dtMs = 16) { nowMs += dtMs; const cb = rafCb; cb(nowMs); }
function frames(n, dtMs = 16) { for (let i = 0; i < n; i++) frame(dtMs); }
function fire(id, type, ev) { document.getElementById(id)._fire(type, ev); }
function touch(type, x, y) {
  document.getElementById("scene")._fire(type, { preventDefault() {}, touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });
}

// 1) title frames
try { frames(10); assert(true, "title-state frames render without error"); }
catch (e) { assert(false, "title frames threw: " + e.message); }

// 2) Play -> hangar, shop renders, tier reflects seeded upgrades (12 levels -> tier 3)
fire("playBtn", "click");
assert(!document.getElementById("hangarScreen").classList.contains("hidden"), "hangar screen visible after Play");
assert(document.getElementById("shop").children.length === 5, "hangar shop rendered 5 upgrade rows");
assert(document.getElementById("evoName")._text.length > 0, "evolution name shown in hangar: " + document.getElementById("evoName")._text);

// 3) Launch -> aim
fire("launchBtn", "click");
try { frames(10); assert(true, "aim-state frames render without error"); }
catch (e) { assert(false, "aim frames threw: " + e.message); }

// 4) Slingshot: touch down at center, drag down to build power, release
touch("touchstart", 195, 422);
touch("touchmove", 195, 700);    // drag down ~278px
touch("touchend", 195, 700);
assert(true, "launch input processed (no throw)");

// 5) Flight: simulate holding to boost+steer for a while, then release to glide until landing
let landed = false, maxZ = 0, maxFrames = 4000;
try {
  // hold (boost) for ~3s steering gently
  touch("touchstart", 220, 380);
  for (let i = 0; i < 1200 && !landed; i++) {
    touch("touchmove", 220, 380 - Math.min(i, 60)); // finger high -> climb
    frame(16);
    maxZ = Math.max(maxZ, readDistance());
    if (resultShown()) { landed = true; break; }
  }
  touch("touchend", 220, 380);
  // glide until it lands
  for (let i = 0; i < maxFrames && !landed; i++) {
    frame(16);
    maxZ = Math.max(maxZ, readDistance());
    if (resultShown()) landed = true;
  }
} catch (e) { assert(false, "flight loop threw: " + e.stack); }

function readDistance() { const t = document.getElementById("distBig")._html; const m = /^(\d+)/.exec(t); return m ? +m[1] : 0; }
function resultShown() { return !document.getElementById("resultScreen").classList.contains("hidden"); }

assert(maxZ > 50, "plane actually flew forward a meaningful distance (max " + maxZ + " m)");
assert(landed, "run ended and result screen was shown");
if (landed) {
  assert(+document.getElementById("runDist")._text >= 0, "result distance set: " + document.getElementById("runDist")._text + " m");
  assert(+document.getElementById("runCoins")._text >= 0, "result coins earned set: " + document.getElementById("runCoins")._text);
}

// 6) Replay from results
fire("againBtn", "click");
try { frames(5); assert(true, "relaunch after result works"); }
catch (e) { assert(false, "relaunch threw: " + e.message); }

console.log(failures === 0 ? "\nALL TESTS PASSED ✅" : `\n${failures} TEST(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
