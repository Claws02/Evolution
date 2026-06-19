/* Plane Evolution — an original slingshot-launch distance flyer.
   Inspired by the launch-and-fly genre. All art is drawn procedurally;
   no external assets and no copied code. */
(() => {
"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------- Sizing / DPI ----------
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + "px"; canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ---------- Utility ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

// ---------- Terrain ----------
const GROUND_BASE = 520; // world y of ground at sea level (y grows downward, up is negative)
function groundY(x) {
  return GROUND_BASE
    - Math.sin(x * 0.0011 + 2) * 70
    - Math.sin(x * 0.00055) * 50
    - Math.sin(x * 0.0029) * 18;
}

// ---------- Upgrades & evolution ----------
const UPGRADES = [
  { key: "power", ico: "🚀", name: "Launch Power",  max: 8, baseCost: 40,  growth: 1.55 },
  { key: "boost", ico: "🔥", name: "Boost Thrust",  max: 8, baseCost: 50,  growth: 1.55 },
  { key: "fuel",  ico: "⛽", name: "Fuel Tank",     max: 8, baseCost: 45,  growth: 1.55 },
  { key: "aero",  ico: "🪶", name: "Aerodynamics",  max: 8, baseCost: 55,  growth: 1.6  },
  { key: "wings", ico: "🛩", name: "Wings & Bounce", max: 8, baseCost: 60,  growth: 1.6  },
];
const TIERS = [
  { name: "Paper Glider", body: "#eef4ff", accent: "#b9d3ff", size: 16 },
  { name: "Prop Scout",   body: "#bfe6ff", accent: "#7fb8ff", size: 18 },
  { name: "Sport Flyer",  body: "#a9f0c4", accent: "#4fd08a", size: 20 },
  { name: "Jet Racer",    body: "#ffe49a", accent: "#ffb43d", size: 22 },
  { name: "Sky Rocket",   body: "#ffb98a", accent: "#ff7a3d", size: 24 },
  { name: "Star Cruiser", body: "#ffa6c9", accent: "#ff5fa0", size: 27 },
  { name: "Aether Wing",  body: "#cdb4ff", accent: "#9a6bff", size: 30 },
];

// ---------- Save data ----------
const SAVE_KEY = "pe_save_v1";
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
function lvl(key) { return save.up[key] || 0; }
function upgradeCost(u) { return Math.round(u.baseCost * Math.pow(u.growth, lvl(u.key))); }
function totalLevels() { return UPGRADES.reduce((s, u) => s + lvl(u.key), 0); }
function computeTier() {
  // evolve every 4 upgrade levels, capped at last tier
  return Math.min(TIERS.length - 1, Math.floor(totalLevels() / 4));
}

// ---------- Game state ----------
let state = "title"; // title | hangar | aim | flight | result
let plane, cam, coins, particles, clouds, trail;
let boosting, boostFuel, boostMax, runCoins, started, restT, lowSpeedT;
let aim; // {active, sx, sy, cx, cy}
let pendingEvoName = null;

function newClouds() {
  clouds = [];
  for (let i = 0; i < 22; i++)
    clouds.push({ x: rand(0, 6000), y: rand(-400, GROUND_BASE - 120),
                  s: rand(26, 70), scale: rand(0.7, 1.7), a: rand(0.5, 0.95) });
}
newClouds();

function startFlightSetup() {
  const t = TIERS[save.tier];
  plane = {
    x: 150, y: groundY(150) - 40, vx: 0, vy: 0, angle: -0.5,
    onGround: true, flying: false, size: t.size,
  };
  cam = { x: 0, y: 0 };
  coins = []; particles = []; trail = [];
  boosting = false;
  boostMax = 1.0 + lvl("fuel") * 0.45;
  boostFuel = boostMax;
  runCoins = 0; started = false; restT = 0; lowSpeedT = 0;
  pendingEvoName = null;
  spawnCoinsAhead(400, 12000);
}

function spawnCoinsAhead(fromX, toX) {
  let x = fromX;
  while (x < toX) {
    x += rand(220, 520);
    const gy = groundY(x);
    const y = gy - rand(50, 360);
    const arc = rand(0, 1) < 0.5;
    if (arc) { // a little arc of coins
      const n = 5, cx = x, cy = y;
      for (let i = 0; i < n; i++)
        coins.push({ x: cx + i * 46, y: cy - Math.sin((i / (n - 1)) * Math.PI) * 70, got: false });
      x += n * 46;
    } else {
      coins.push({ x, y, got: false });
    }
  }
}

// ---------- Launch ----------
function launch(angle, power) {
  const t = TIERS[save.tier];
  const base = 760, perLevel = 150, tierBonus = save.tier * 60;
  const maxSpeed = base + lvl("power") * perLevel + tierBonus;
  const speed = lerp(360, maxSpeed, power);
  plane.vx = Math.cos(angle) * speed;
  plane.vy = Math.sin(angle) * speed; // angle negative => upward
  plane.onGround = false; plane.flying = true;
  started = true;
  state = "flight";
  hideAllOverlays();
}

// ---------- Physics ----------
const GRAVITY = 980;
function update(dt) {
  if (state !== "flight") { updateAmbient(dt); return; }

  const t = TIERS[save.tier];
  // boost
  if (boosting && boostFuel > 0) {
    const thrust = 1500 + lvl("boost") * 320 + save.tier * 120;
    // push along current velocity heading (or forward if nearly still)
    let ang = Math.atan2(plane.vy, plane.vx);
    if (Math.hypot(plane.vx, plane.vy) < 60) ang = -0.4;
    plane.vx += Math.cos(ang) * thrust * dt;
    plane.vy += Math.sin(ang) * thrust * dt - 300 * dt; // slight lift bias
    boostFuel = Math.max(0, boostFuel - dt);
    // flame particles
    for (let i = 0; i < 2; i++)
      particles.push({ x: plane.x, y: plane.y, vx: -Math.cos(ang) * rand(120, 260) + plane.vx * 0.1,
        vy: -Math.sin(ang) * rand(120, 260), life: rand(0.2, 0.45), max: 0.45,
        c: i % 2 ? "#ffd24a" : "#ff7a2a", r: rand(2, 5) });
  }

  // gravity
  plane.vy += GRAVITY * dt;

  // air drag (lower with aerodynamics)
  const drag = (0.16 - lvl("aero") * 0.013);
  const dragF = Math.max(0, 1 - drag * dt);
  plane.vx *= dragF;
  plane.vy *= Math.max(0, 1 - drag * 0.6 * dt);

  // lift: faster + better wings => glides longer (counteracts some gravity)
  const speedH = plane.vx;
  if (!plane.onGround && speedH > 0) {
    const lift = clamp(speedH * (0.18 + lvl("wings") * 0.03), 0, GRAVITY * 0.7);
    plane.vy -= lift * dt;
  }

  plane.x += plane.vx * dt;
  plane.y += plane.vy * dt;
  if (Math.hypot(plane.vx, plane.vy) > 40) plane.angle = Math.atan2(plane.vy, plane.vx);

  // trail
  trail.push({ x: plane.x, y: plane.y, life: 0.5 });
  if (trail.length > 30) trail.shift();
  for (const p of trail) p.life -= dt;

  // ground collision + bounce
  const gy = groundY(plane.x);
  if (plane.y > gy - plane.size * 0.5) {
    plane.y = gy - plane.size * 0.5;
    const speed = Math.hypot(plane.vx, plane.vy);
    const restitution = 0.28 + lvl("wings") * 0.05; // up to ~0.68
    // ground normal from slope
    const slope = (groundY(plane.x + 4) - groundY(plane.x - 4)) / 8;
    const nx = -slope, ny = -1; const nl = Math.hypot(nx, ny);
    const dot = (plane.vx * nx + plane.vy * ny) / nl;
    if (plane.vy > 0) {
      // reflect
      plane.vx -= (1 + restitution) * dot * (nx / nl);
      plane.vy -= (1 + restitution) * dot * (ny / nl);
      plane.vx *= 0.82; // friction along surface
      if (speed > 140) {
        for (let i = 0; i < 8; i++)
          particles.push({ x: plane.x, y: gy, vx: rand(-60, -240), vy: rand(-160, -20),
            life: rand(0.3, 0.7), max: 0.7, c: "#cfa86b", r: rand(2, 5) });
      }
    }
    plane.onGround = true;
    // rolling: if very slow on ground, count toward stop
    if (Math.hypot(plane.vx, plane.vy) < 70) { lowSpeedT += dt; plane.vx *= 0.9; }
    else lowSpeedT = 0;
  } else {
    plane.onGround = false;
  }

  // collect coins
  for (const c of coins) {
    if (c.got) continue;
    const dx = c.x - plane.x, dy = c.y - plane.y;
    if (dx * dx + dy * dy < (plane.size + 22) * (plane.size + 22)) {
      c.got = true; runCoins++;
      for (let i = 0; i < 6; i++)
        particles.push({ x: c.x, y: c.y, vx: rand(-90, 90), vy: rand(-90, 90),
          life: rand(0.2, 0.45), max: 0.45, c: "#ffe27a", r: rand(2, 4) });
    }
  }
  // top up coins further ahead if running out
  const lastX = coins.length ? coins[coins.length - 1].x : plane.x;
  if (plane.x > lastX - 4000) spawnCoinsAhead(lastX + 400, lastX + 8000);

  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt; p.vx *= 0.96;
    if (p.life <= 0) particles.splice(i, 1);
  }

  // camera follow
  cam.x = plane.x - W * 0.32;
  const desiredY = plane.y - H * 0.5;
  const maxY = groundY(plane.x) - H * 0.82; // keep ground near bottom when low
  cam.y = Math.min(desiredY, maxY);

  // end run when at rest on ground
  if (plane.onGround && lowSpeedT > 0.6) endRun();
  // safety: if somehow stuck very slow mid-air near ground
}

function updateAmbient(dt) {
  for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; }
}

function endRun() {
  state = "result";
  const meters = Math.max(0, Math.floor((plane.x - 150) / 10));
  const earned = runCoins + Math.floor(meters / 4);
  save.coins += earned;
  const prevTier = save.tier;
  if (meters > save.best) save.best = meters;
  persist();

  document.getElementById("runDist").textContent = meters;
  document.getElementById("runCoins").textContent = earned;
  document.getElementById("runBest").textContent = save.best;

  // evolution can only change via purchases, but show any pending notice
  const notice = document.getElementById("evoNotice");
  if (pendingEvoName) {
    notice.classList.remove("hidden");
    document.getElementById("evoNoticeName").textContent = pendingEvoName;
  } else notice.classList.add("hidden");

  showOverlay("resultScreen");
}

// ---------- Rendering ----------
function w2sx(x) { return x - cam.x; }
function w2sy(y) { return y - cam.y; }

function render() {
  // sky
  const tierShift = save.tier * 4;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${205 + tierShift}, 80%, ${70 - save.tier * 2}%)`);
  g.addColorStop(0.7, `hsl(${200 + tierShift}, 70%, ${80 - save.tier}%)`);
  g.addColorStop(1, "#eaf6ff");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // sun
  ctx.save();
  ctx.globalAlpha = 0.9;
  const sung = ctx.createRadialGradient(W * 0.8, H * 0.2, 0, W * 0.8, H * 0.2, 120);
  sung.addColorStop(0, "rgba(255,250,220,0.95)"); sung.addColorStop(1, "rgba(255,250,220,0)");
  ctx.fillStyle = sung; ctx.beginPath(); ctx.arc(W * 0.8, H * 0.2, 120, 0, TAU); ctx.fill();
  ctx.restore();

  // parallax clouds
  const camX = cam ? cam.x : 0, camY = cam ? cam.y : 0;
  for (const c of clouds) {
    const px = c.x - camX * 0.4, py = c.y - camY * 0.4;
    let sx = ((px % (W + 600)) + (W + 600)) % (W + 600) - 300;
    ctx.globalAlpha = c.a * 0.9; ctx.fillStyle = "#ffffff";
    drawCloud(sx, py, c.s * c.scale);
  }
  ctx.globalAlpha = 1;

  drawTerrain();

  if (state === "flight" || state === "result" || state === "aim") {
    drawCoins();
    drawTrail();
    drawParticles();
    drawPlane();
  }

  if (state === "aim") drawAim();
  if (state === "flight") drawFlightHUD();
}

function drawCloud(x, y, s) {
  ctx.beginPath();
  ctx.arc(x, y, s, 0, TAU);
  ctx.arc(x + s * 0.9, y + s * 0.2, s * 0.7, 0, TAU);
  ctx.arc(x - s * 0.9, y + s * 0.2, s * 0.7, 0, TAU);
  ctx.arc(x, y + s * 0.45, s * 0.85, 0, TAU);
  ctx.fill();
}

function drawTerrain() {
  const camX = cam ? cam.x : 0;
  // far hills (parallax)
  ctx.fillStyle = "#cfeacb";
  ctx.beginPath(); ctx.moveTo(0, H);
  for (let sx = 0; sx <= W; sx += 16) {
    const wx = (camX * 0.5) + sx * 2;
    const y = w2sy(groundY(wx) + 90) ;
    ctx.lineTo(sx, y + 60);
  }
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

  // main ground
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let sx = -2; sx <= W + 2; sx += 8) {
    const wx = camX + sx;
    ctx.lineTo(sx, w2sy(groundY(wx)));
  }
  ctx.lineTo(W, H); ctx.closePath();
  const gg = ctx.createLinearGradient(0, w2sy(GROUND_BASE - 150), 0, H);
  gg.addColorStop(0, "#7ed47a"); gg.addColorStop(1, "#3f9b53");
  ctx.fillStyle = gg; ctx.fill();

  // grass top line
  ctx.strokeStyle = "#a7ef8e"; ctx.lineWidth = 4;
  ctx.beginPath();
  for (let sx = -2; sx <= W + 2; sx += 8) {
    const wx = camX + sx, y = w2sy(groundY(wx));
    if (sx < 0) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
  }
  ctx.stroke();

  // launch ramp near start
  if (cam) {
    const rx = w2sx(150);
    if (rx > -200 && rx < W + 200) {
      const ry = w2sy(groundY(150));
      ctx.fillStyle = "#8a5a3c";
      ctx.fillRect(rx - 60, ry - 6, 90, 14);
      ctx.fillStyle = "#6b4126";
      ctx.fillRect(rx - 56, ry + 6, 8, 40);
      ctx.fillRect(rx + 16, ry + 6, 8, 40);
      // distance markers every 100m
    }
    drawDistanceMarkers();
  }
}

function drawDistanceMarkers() {
  const camX = cam.x;
  const startM = Math.floor((camX) / 1000) * 100;
  for (let m = Math.max(0, startM); m < startM + (W / 10) + 200; m += 100) {
    const wx = 150 + m * 10;
    const sx = w2sx(wx);
    if (sx < -20 || sx > W + 20) continue;
    const gy = w2sy(groundY(wx));
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(sx - 1.5, gy - 30, 3, 30);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.font = "700 11px -apple-system, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(m + "m", sx, gy - 32);
  }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

function drawCoins() {
  for (const c of coins) {
    if (c.got) continue;
    const sx = w2sx(c.x), sy = w2sy(c.y);
    if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
    const wob = Math.cos(performance.now() / 200 + c.x) ;
    ctx.save(); ctx.translate(sx, sy); ctx.scale(clamp(Math.abs(wob), 0.3, 1), 1);
    const cg = ctx.createRadialGradient(-3, -3, 1, 0, 0, 12);
    cg.addColorStop(0, "#fff6c4"); cg.addColorStop(0.6, "#ffcf3a"); cg.addColorStop(1, "#e0a31e");
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#b8821a"; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }
}

function drawTrail() {
  if (!trail || trail.length < 2) return;
  ctx.lineCap = "round";
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i];
    ctx.strokeStyle = `rgba(255,255,255,${clamp(b.life, 0, 0.5) * 0.7})`;
    ctx.lineWidth = clamp(b.life * 10, 1, 5);
    ctx.beginPath(); ctx.moveTo(w2sx(a.x), w2sy(a.y)); ctx.lineTo(w2sx(b.x), w2sy(b.y)); ctx.stroke();
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(w2sx(p.x), w2sy(p.y), p.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlane() {
  const t = TIERS[save.tier], s = plane.size;
  ctx.save();
  ctx.translate(w2sx(plane.x), w2sy(plane.y));
  ctx.rotate(plane.angle);

  // wings back
  ctx.fillStyle = shade(t.accent, -15);
  ctx.beginPath();
  ctx.moveTo(-s * 0.1, 0);
  ctx.lineTo(-s * 0.8, -s * (0.85 + save.tier * 0.03));
  ctx.lineTo(-s * 0.2, -s * 0.2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-s * 0.1, 0);
  ctx.lineTo(-s * 0.8, s * (0.85 + save.tier * 0.03));
  ctx.lineTo(-s * 0.2, s * 0.2);
  ctx.fill();

  // body
  const grad = ctx.createLinearGradient(-s, -s, s, s);
  grad.addColorStop(0, "#fff"); grad.addColorStop(0.45, t.body); grad.addColorStop(1, shade(t.body, -30));
  ctx.fillStyle = grad; ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(s * 1.3, 0);
  ctx.quadraticCurveTo(s * 0.3, -s * 0.55, -s, -s * 0.32);
  ctx.lineTo(-s, s * 0.32);
  ctx.quadraticCurveTo(s * 0.3, s * 0.55, s * 1.3, 0);
  ctx.fill(); ctx.stroke();

  // tail fin
  ctx.fillStyle = shade(t.accent, -10);
  ctx.beginPath();
  ctx.moveTo(-s * 0.85, 0); ctx.lineTo(-s * 1.15, -s * 0.55); ctx.lineTo(-s * 0.6, -s * 0.05);
  ctx.fill();

  // cockpit
  ctx.fillStyle = "rgba(20,45,85,0.9)";
  ctx.beginPath(); ctx.ellipse(s * 0.4, -s * 0.02, s * 0.3, s * 0.2, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "rgba(185,230,255,0.8)";
  ctx.beginPath(); ctx.ellipse(s * 0.46, -s * 0.07, s * 0.16, s * 0.09, 0, 0, TAU); ctx.fill();

  // nose spinner
  ctx.fillStyle = "#ffd454";
  ctx.beginPath(); ctx.arc(s * 1.25, 0, s * 0.13, 0, TAU); ctx.fill();

  ctx.restore();
}

function drawAim() {
  const sx = w2sx(plane.x), sy = w2sy(plane.y);
  // base plane already drawn; draw pull + trajectory
  if (!aim || !aim.active) {
    // hint
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.font = "700 16px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Drag back & release to launch", W / 2, H * 0.5);
    ctx.textAlign = "left";
    return;
  }
  const { angle, power } = aimParams();
  // slingshot band
  ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(sx, sy);
  ctx.lineTo(sx - Math.cos(angle) * power * 70, sy - Math.sin(angle) * power * 70);
  ctx.stroke();

  // predicted trajectory (dotted)
  const t = TIERS[save.tier];
  const maxSpeed = 760 + lvl("power") * 150 + save.tier * 60;
  const speed = lerp(360, maxSpeed, power);
  let px = plane.x, py = plane.y, pvx = Math.cos(angle) * speed, pvy = Math.sin(angle) * speed;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (let i = 0; i < 36; i++) {
    pvy += GRAVITY * 0.05; px += pvx * 0.05; py += pvy * 0.05;
    if (i % 2 === 0) { ctx.beginPath(); ctx.arc(w2sx(px), w2sy(py), 3, 0, TAU); ctx.fill(); }
    if (py > groundY(px)) break;
  }

  // power meter
  const bw = Math.min(W - 60, 280), bx = (W - bw) / 2, by = H - 70;
  ctx.fillStyle = "rgba(0,0,0,0.35)"; roundRect(bx, by, bw, 16, 8); ctx.fill();
  const pg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  pg.addColorStop(0, "#7dffb0"); pg.addColorStop(0.6, "#ffe27a"); pg.addColorStop(1, "#ff5b5b");
  ctx.fillStyle = pg; roundRect(bx, by, bw * power, 16, 8); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "700 11px -apple-system, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("POWER " + Math.round(power * 100) + "%", W / 2, by - 8);
  ctx.textAlign = "left";
}

function drawFlightHUD() {
  const meters = Math.max(0, Math.floor((plane.x - 150) / 10));
  ctx.textBaseline = "top";
  // distance
  ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.font = "800 26px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(meters + " m", W / 2, 14 + safeTop());
  ctx.font = "700 11px -apple-system, sans-serif"; ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillText("DISTANCE", W / 2, 44 + safeTop());

  // coins this run (top-right)
  ctx.textAlign = "right";
  ctx.fillStyle = "#caa11a"; ctx.font = "800 20px -apple-system, sans-serif";
  ctx.fillText("◉ " + runCoins, W - 16, 16 + safeTop());
  ctx.textAlign = "left";

  // fuel/boost meter bottom
  const bw = Math.min(W - 40, 300), bx = (W - bw) / 2, by = H - 54 - safeBottom();
  ctx.fillStyle = "rgba(0,0,0,0.3)"; roundRect(bx, by, bw, 16, 8); ctx.fill();
  const frac = clamp(boostFuel / boostMax, 0, 1);
  const fg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  fg.addColorStop(0, "#ff7a2a"); fg.addColorStop(1, "#ffd24a");
  ctx.fillStyle = frac > 0 ? fg : "rgba(255,255,255,0.2)";
  roundRect(bx, by, bw * frac, 16, 8); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "700 11px -apple-system, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(boostFuel > 0 ? "HOLD TO BOOST 🔥" : "OUT OF FUEL", W / 2, by + 2);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

function safeTop() { return 0; }
function safeBottom() { return 0; }

// ---------- helpers ----------
function roundRect(x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function shade(col, amt) {
  let r, g, b;
  if (col[0] === "#") {
    const c = col.slice(1);
    r = parseInt(c.substr(0, 2), 16); g = parseInt(c.substr(2, 2), 16); b = parseInt(c.substr(4, 2), 16);
  } else { const m = col.match(/\d+/g); r = +m[0]; g = +m[1]; b = +m[2]; }
  r = clamp(r + amt, 0, 255); g = clamp(g + amt, 0, 255); b = clamp(b + amt, 0, 255);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ---------- Aim input ----------
function aimParams() {
  // drag vector from start to current; launch opposite, power by length
  const dx = aim.cx - aim.sx, dy = aim.cy - aim.sy;
  const len = Math.hypot(dx, dy);
  const maxDrag = Math.min(W, H) * 0.42;
  const power = clamp(len / maxDrag, 0.04, 1);
  let angle = Math.atan2(-dy, -dx); // opposite of drag
  // clamp to forward-up quadrant: roughly -85°..-5° (up-right) ... allow shallow
  angle = clamp(angle, -1.48, -0.08);
  return { angle, power };
}

// ---------- Pointer handling ----------
function getPoint(e) {
  const t = e.touches ? e.touches[0] : (e.changedTouches ? e.changedTouches[0] : e);
  return { x: t.clientX, y: t.clientY };
}
function onDown(e) {
  if (state === "aim") {
    const p = getPoint(e);
    aim = { active: true, sx: p.x, sy: p.y, cx: p.x, cy: p.y };
  } else if (state === "flight") {
    boosting = true;
  }
}
function onMove(e) {
  if (state === "aim" && aim && aim.active) {
    const p = getPoint(e); aim.cx = p.x; aim.cy = p.y;
  }
}
function onUp(e) {
  if (state === "aim" && aim && aim.active) {
    const { angle, power } = aimParams();
    aim.active = false;
    if (power > 0.06) launch(angle, power);
  } else if (state === "flight") {
    boosting = false;
  }
}
canvas.addEventListener("touchstart", e => { e.preventDefault(); onDown(e); }, { passive: false });
canvas.addEventListener("touchmove",  e => { e.preventDefault(); onMove(e); }, { passive: false });
canvas.addEventListener("touchend",   e => { e.preventDefault(); onUp(e); }, { passive: false });
canvas.addEventListener("touchcancel",e => { e.preventDefault(); onUp(e); }, { passive: false });
canvas.addEventListener("mousedown", onDown);
window.addEventListener("mousemove", onMove);
window.addEventListener("mouseup", onUp);

// ---------- Loop ----------
let last = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.04, (ts - last) / 1000 || 0);
  last = ts;
  update(dt);
  render();
}

// ---------- UI / Screens ----------
const overlays = {
  title: document.getElementById("titleScreen"),
  hangar: document.getElementById("hangarScreen"),
  result: document.getElementById("resultScreen"),
};
function hideAllOverlays() { for (const k in overlays) overlays[k].classList.add("hidden"); }
function showOverlay(id) {
  hideAllOverlays();
  document.getElementById(id).classList.remove("hidden");
}

function renderShop() {
  const shop = document.getElementById("shop");
  shop.innerHTML = "";
  for (const u of UPGRADES) {
    const level = lvl(u.key), maxed = level >= u.max, cost = upgradeCost(u);
    const row = document.createElement("div");
    row.className = "up" + (maxed ? " maxed" : "");
    const pips = Array.from({ length: u.max }, (_, i) =>
      `<span class="pip ${i < level ? "on" : ""}"></span>`).join("");
    row.innerHTML = `
      <div class="ico">${u.ico}</div>
      <div class="info">
        <div class="name">${u.name} <span style="opacity:.7;font-weight:600">Lv ${level}</span></div>
        <div class="pips">${pips}</div>
      </div>
      <button class="buy" ${maxed || save.coins < cost ? "disabled" : ""}>
        ${maxed ? "MAX" : `<span class="c"><span class="coin"></span>${cost}</span>`}
      </button>`;
    if (!maxed) {
      row.querySelector(".buy").addEventListener("click", () => buyUpgrade(u));
    }
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
  save.coins -= cost;
  save.up[u.key]++;
  const before = save.tier;
  save.tier = computeTier();
  if (save.tier > before) pendingEvoName = TIERS[save.tier].name; // shown after next run / immediately in hangar badge
  persist();
  renderShop();
}

function goHangar() {
  renderShop();
  showOverlay("hangar");
  state = "hangar";
}
function goAim() {
  startFlightSetup();
  state = "aim";
  aim = { active: false, sx: 0, sy: 0, cx: 0, cy: 0 };
  hideAllOverlays();
}

document.getElementById("playBtn").addEventListener("click", goHangar);
document.getElementById("launchBtn").addEventListener("click", goAim);
document.getElementById("againBtn").addEventListener("click", goAim);
document.getElementById("shopBtn").addEventListener("click", goHangar);

// ---------- Boot ----------
loadSave();
document.getElementById("bestTitle").textContent = save.best;
// set up a static ambient scene behind the title
startFlightSetup();
state = "title";
requestAnimationFrame(loop);
})();
