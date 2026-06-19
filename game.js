/* Sky Evolution — an original plane-evolution flyer.
   All art is drawn procedurally on canvas; no external assets. */
(() => {
"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------- Sizing / DPI ----------
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ---------- Utility ----------
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const TAU = Math.PI * 2;

// ---------- Persistent best ----------
const store = {
  get score() { return +localStorage.getItem("se_best_score") || 0; },
  set score(v) { localStorage.setItem("se_best_score", v); },
  get evo() { return +localStorage.getItem("se_best_evo") || 1; },
  set evo(v) { localStorage.setItem("se_best_evo", v); },
};

// ---------- Evolution tiers ----------
// Each tier defines look + weapon power. Reaching the orb threshold morphs the plane.
const TIERS = [
  { name: "Paper Dart",  color: "#d7e6ff", size: 20, guns: 1, fireRate: 0.42, dmg: 1, bulletColor: "#9fe8ff", xpNeed: 60 },
  { name: "Prop Scout",  color: "#9fe0ff", size: 23, guns: 1, fireRate: 0.32, dmg: 1, bulletColor: "#7fffd0", xpNeed: 120 },
  { name: "Twin Fang",   color: "#7ee0a8", size: 26, guns: 2, fireRate: 0.30, dmg: 1, bulletColor: "#aaffae", xpNeed: 200 },
  { name: "Storm Jet",   color: "#ffe08a", size: 29, guns: 2, fireRate: 0.22, dmg: 2, bulletColor: "#ffe27a", xpNeed: 320 },
  { name: "Vortex",      color: "#ffb35c", size: 32, guns: 3, fireRate: 0.20, dmg: 2, bulletColor: "#ffd27a", xpNeed: 480 },
  { name: "Thunderwing", color: "#ff8a8a", size: 35, guns: 3, fireRate: 0.16, dmg: 3, bulletColor: "#ff9d6b", xpNeed: 700 },
  { name: "Phoenix",     color: "#ff6fae", size: 39, guns: 4, fireRate: 0.14, dmg: 3, bulletColor: "#ff7ad0", xpNeed: 1000 },
  { name: "Celestial",   color: "#c79bff", size: 44, guns: 5, fireRate: 0.11, dmg: 4, bulletColor: "#d6a3ff", xpNeed: Infinity },
];

// ---------- Game state ----------
let state = "start"; // start | play | over
let player, bullets, enemies, eBullets, orbs, particles, stars, clouds;
let spawnT, score, evoIndex, xp, shootT, shake, elapsed, difficulty, flashT;

function reset() {
  player = {
    x: W * 0.24, y: H * 0.5, vx: 0, vy: 0,
    tx: W * 0.24, ty: H * 0.5,
    hp: 5, maxHp: 5, iframes: 0, tilt: 0,
  };
  bullets = []; enemies = []; eBullets = []; orbs = [];
  particles = [];
  spawnT = 0.6; score = 0; evoIndex = 0; xp = 0; shootT = 0;
  shake = 0; elapsed = 0; difficulty = 1; flashT = 0;
  initBackground();
}

function initBackground() {
  stars = [];
  for (let i = 0; i < 70; i++)
    stars.push({ x: Math.random() * W, y: Math.random() * H, r: rand(0.4, 1.6), s: rand(8, 28), tw: Math.random() * TAU });
  clouds = [];
  for (let i = 0; i < 8; i++)
    clouds.push({ x: Math.random() * W, y: rand(0, H), s: rand(18, 50), scale: rand(0.6, 1.8), a: rand(0.05, 0.18) });
}

// ---------- Input ----------
let dragging = false, lastTouchY = 0;
function pointerStart(x, y) {
  if (state !== "play") return;
  dragging = true;
  player.tx = x; player.ty = y;
}
function pointerMove(x, y) {
  if (!dragging || state !== "play") return;
  player.tx = x; player.ty = y;
}
function pointerEnd() { dragging = false; }

canvas.addEventListener("touchstart", e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  pointerStart(t.clientX, t.clientY);
}, { passive: false });
canvas.addEventListener("touchmove", e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  pointerMove(t.clientX, t.clientY);
}, { passive: false });
canvas.addEventListener("touchend", e => { e.preventDefault(); pointerEnd(); }, { passive: false });
canvas.addEventListener("touchcancel", e => { e.preventDefault(); pointerEnd(); }, { passive: false });

canvas.addEventListener("mousedown", e => pointerStart(e.clientX, e.clientY));
window.addEventListener("mousemove", e => pointerMove(e.clientX, e.clientY));
window.addEventListener("mouseup", pointerEnd);

// Keyboard for desktop testing
const keys = {};
window.addEventListener("keydown", e => { keys[e.key] = true; });
window.addEventListener("keyup", e => { keys[e.key] = false; });

// ---------- Spawning ----------
function spawnEnemy() {
  const roll = Math.random();
  const tierBoost = Math.min(elapsed / 35, 3);
  let type;
  if (roll < 0.5) type = "balloon";
  else if (roll < 0.8) type = "fighter";
  else type = "blimp";

  const y = rand(H * 0.12, H * 0.88);
  const base = { x: W + 60, y, t: 0, fireT: rand(0.8, 2), hitFlash: 0 };
  if (type === "balloon") {
    Object.assign(base, { type, r: 22, hp: 2 + Math.floor(tierBoost), maxHp: 2 + Math.floor(tierBoost),
      vx: -rand(80, 130), vy: 0, bob: Math.random() * TAU, xp: 8, score: 10, shoots: false, color: "#ff7b7b" });
  } else if (type === "fighter") {
    Object.assign(base, { type, r: 20, hp: 3 + Math.floor(tierBoost), maxHp: 3 + Math.floor(tierBoost),
      vx: -rand(150, 210), vy: 0, xp: 14, score: 20, shoots: true, color: "#9aa7c7" });
  } else { // blimp — tanky
    Object.assign(base, { type, r: 34, hp: 8 + Math.floor(tierBoost * 1.5), maxHp: 8 + Math.floor(tierBoost * 1.5),
      vx: -rand(45, 70), vy: 0, xp: 30, score: 50, shoots: true, color: "#8d6bd6" });
  }
  enemies.push(base);
}

// ---------- Player firing ----------
function fire() {
  const t = TIERS[evoIndex];
  const n = t.guns;
  const spread = (n - 1) * 9;
  for (let i = 0; i < n; i++) {
    const off = n === 1 ? 0 : -spread / 2 + (spread / (n - 1)) * i;
    bullets.push({
      x: player.x + t.size, y: player.y + off,
      vx: 760, vy: off * 0.6, r: 4 + t.dmg, dmg: t.dmg, color: t.bulletColor,
    });
  }
  shootT = t.fireRate;
  // muzzle particles
  for (let i = 0; i < 3; i++)
    particles.push(P(player.x + t.size, player.y, rand(60, 200), rand(-50, 50), rand(0.1, 0.25), t.bulletColor, rand(1, 3)));
}

function P(x, y, vx, vy, life, color, r) {
  return { x, y, vx, vy, life, maxLife: life, color, r };
}

// ---------- Evolution ----------
function addXp(amount) {
  xp += amount;
  const need = TIERS[evoIndex].xpNeed;
  if (xp >= need && evoIndex < TIERS.length - 1) {
    xp -= need;
    evolve();
  }
}
function evolve() {
  evoIndex++;
  flashT = 0.6;
  shake = Math.max(shake, 10);
  player.hp = player.maxHp = Math.min(player.maxHp + 1, 9);
  player.hp = player.maxHp; // full heal on evolve
  // burst of celebratory particles
  const c = TIERS[evoIndex].color;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * TAU, sp = rand(80, 360);
    particles.push(P(player.x, player.y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.4, 0.9), c, rand(2, 5)));
  }
}

// ---------- Damage ----------
function hurtPlayer(dmg) {
  if (player.iframes > 0) return;
  player.hp -= dmg;
  player.iframes = 1.1;
  shake = Math.max(shake, 14);
  flashT = Math.max(flashT, 0.18);
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * TAU, sp = rand(60, 260);
    particles.push(P(player.x, player.y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.7), "#ff5b5b", rand(2, 4)));
  }
  if (player.hp <= 0) gameOver();
}

function killEnemy(e) {
  addXp(e.xp);
  score += e.score;
  shake = Math.max(shake, 5);
  // drop orbs
  const n = Math.max(1, Math.round(e.xp / 8));
  for (let i = 0; i < n; i++) {
    orbs.push({ x: e.x, y: e.y, vx: rand(-40, 120), vy: rand(-120, 120),
      r: 6, value: e.xp / n, life: 8, hue: 150 });
  }
  // explosion
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * TAU, sp = rand(60, 320);
    particles.push(P(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.8), e.color, rand(2, 5)));
  }
  for (let i = 0; i < 8; i++)
    particles.push(P(e.x, e.y, rand(-40, 40), rand(-40, 40), rand(0.4, 1), "#ffce6b", rand(3, 7)));
}

// ---------- Update ----------
function update(dt) {
  elapsed += dt;
  difficulty = 1 + elapsed / 30;

  // Player movement: ease toward target (finger)
  if (keys["ArrowUp"]) player.ty -= 420 * dt;
  if (keys["ArrowDown"]) player.ty += 420 * dt;
  if (keys["ArrowLeft"]) player.tx -= 420 * dt;
  if (keys["ArrowRight"]) player.tx += 420 * dt;

  const t = TIERS[evoIndex];
  player.tx = clamp(player.tx, t.size, W - t.size);
  player.ty = clamp(player.ty, t.size + 6, H - t.size - 6);
  const nx = player.x + (player.tx - player.x) * Math.min(1, dt * 12);
  const ny = player.y + (player.ty - player.y) * Math.min(1, dt * 12);
  player.tilt = clamp((ny - player.y) * 0.06, -0.5, 0.5);
  player.x = nx; player.y = ny;
  if (player.iframes > 0) player.iframes -= dt;

  // Auto fire
  shootT -= dt;
  if (shootT <= 0) fire();

  // Spawn enemies
  spawnT -= dt;
  if (spawnT <= 0) {
    spawnEnemy();
    spawnT = clamp(rand(1.4, 2.2) / difficulty, 0.32, 2.2);
  }

  // Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x > W + 30 || b.y < -30 || b.y > H + 30) { bullets.splice(i, 1); continue; }
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      const dx = b.x - e.x, dy = b.y - e.y;
      if (dx * dx + dy * dy < (e.r + b.r) * (e.r + b.r)) {
        e.hp -= b.dmg; e.hitFlash = 0.1;
        for (let k = 0; k < 4; k++)
          particles.push(P(b.x, b.y, rand(-80, 40), rand(-80, 80), rand(0.15, 0.35), b.color, rand(1, 3)));
        bullets.splice(i, 1);
        if (e.hp <= 0) { killEnemy(e); enemies.splice(j, 1); }
        break;
      }
    }
  }

  // Enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.t += dt;
    e.x += e.vx * dt;
    if (e.type === "balloon") e.y += Math.sin(e.t * 2 + e.bob) * 40 * dt * 1.0;
    if (e.hitFlash > 0) e.hitFlash -= dt;
    // shooting
    if (e.shoots) {
      e.fireT -= dt;
      if (e.fireT <= 0 && e.x < W - 20) {
        e.fireT = rand(1.4, 2.6) / Math.min(difficulty, 2.5);
        const ang = Math.atan2(player.y - e.y, player.x - e.x);
        const sp = 230;
        eBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 6, color: "#ff5b8a" });
      }
    }
    // collision with player
    const dx = player.x - e.x, dy = player.y - e.y;
    const rr = e.r + t.size * 0.7;
    if (dx * dx + dy * dy < rr * rr) {
      hurtPlayer(2);
      e.hp -= 3; if (e.hp <= 0) { killEnemy(e); enemies.splice(i, 1); continue; }
    }
    if (e.x < -80) enemies.splice(i, 1);
  }

  // Enemy bullets
  for (let i = eBullets.length - 1; i >= 0; i--) {
    const b = eBullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) { eBullets.splice(i, 1); continue; }
    const dx = player.x - b.x, dy = player.y - b.y;
    if (dx * dx + dy * dy < (b.r + t.size * 0.6) * (b.r + t.size * 0.6)) {
      hurtPlayer(1); eBullets.splice(i, 1);
    }
  }

  // Orbs — drift, then magnetize to player
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    o.life -= dt;
    const dx = player.x - o.x, dy = player.y - o.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 170) { // magnet
      const pull = (1 - dist / 170) * 900;
      o.vx += (dx / dist) * pull * dt;
      o.vy += (dy / dist) * pull * dt;
    }
    o.vx *= 0.94; o.vy *= 0.94;
    o.x += o.vx * dt; o.y += o.vy * dt;
    if (dist < t.size + 8) {
      addXp(o.value);
      score += 1;
      for (let k = 0; k < 5; k++)
        particles.push(P(o.x, o.y, rand(-60, 60), rand(-60, 60), rand(0.2, 0.4), "#9dffce", rand(1, 3)));
      orbs.splice(i, 1); continue;
    }
    if (o.life <= 0) orbs.splice(i, 1);
  }

  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
    if (p.life <= 0) particles.splice(i, 1);
  }

  // Background scroll
  const bgSpeed = 60 + difficulty * 10;
  for (const s of stars) {
    s.x -= s.s * dt * (bgSpeed / 60); s.tw += dt * 3;
    if (s.x < -2) { s.x = W + 2; s.y = Math.random() * H; }
  }
  for (const c of clouds) {
    c.x -= c.s * dt * (bgSpeed / 60);
    if (c.x < -120) { c.x = W + 120; c.y = rand(0, H); c.scale = rand(0.6, 1.8); }
  }

  if (shake > 0) shake = Math.max(0, shake - dt * 40);
  if (flashT > 0) flashT -= dt;
}

// ---------- Drawing ----------
function drawBackground() {
  // sky gradient shifts with evolution
  const hueShift = evoIndex * 6;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${212 + hueShift},70%,${14 + evoIndex}%)`);
  g.addColorStop(0.6, `hsl(${205 + hueShift},65%,${22 + evoIndex}%)`);
  g.addColorStop(1, `hsl(${28},60%,${30 + evoIndex * 0.5}%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // stars
  for (const s of stars) {
    const a = 0.4 + Math.sin(s.tw) * 0.3;
    ctx.globalAlpha = clamp(a, 0.1, 0.9);
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // clouds
  for (const c of clouds) {
    ctx.globalAlpha = c.a;
    ctx.fillStyle = "#dfeeff";
    drawCloud(c.x, c.y, c.s * c.scale);
  }
  ctx.globalAlpha = 1;
}
function drawCloud(x, y, s) {
  ctx.beginPath();
  ctx.arc(x, y, s, 0, TAU);
  ctx.arc(x + s * 0.9, y + s * 0.2, s * 0.7, 0, TAU);
  ctx.arc(x - s * 0.9, y + s * 0.2, s * 0.7, 0, TAU);
  ctx.arc(x, y + s * 0.4, s * 0.9, 0, TAU);
  ctx.fill();
}

function drawPlayer() {
  const t = TIERS[evoIndex];
  const s = t.size;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.tilt);

  // blink when invulnerable
  if (player.iframes > 0 && Math.floor(player.iframes * 16) % 2 === 0) ctx.globalAlpha = 0.35;

  // engine glow trail
  ctx.fillStyle = "rgba(120,200,255,0.5)";
  for (let i = 1; i <= 3; i++) {
    ctx.globalAlpha *= 0.6;
    ctx.beginPath();
    ctx.ellipse(-s - i * 8, 0, s * 0.5, s * 0.22, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = (player.iframes > 0 && Math.floor(player.iframes * 16) % 2 === 0) ? 0.35 : 1;

  // body
  const grad = ctx.createLinearGradient(-s, -s, s, s);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(0.4, t.color);
  grad.addColorStop(1, shade(t.color, -30));
  ctx.fillStyle = grad;
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;

  // fuselage
  ctx.beginPath();
  ctx.moveTo(s * 1.25, 0);
  ctx.quadraticCurveTo(s * 0.3, -s * 0.5, -s, -s * 0.34);
  ctx.lineTo(-s, s * 0.34);
  ctx.quadraticCurveTo(s * 0.3, s * 0.5, s * 1.25, 0);
  ctx.fill(); ctx.stroke();

  // wings (more wings as it evolves)
  ctx.fillStyle = shade(t.color, -18);
  ctx.beginPath();
  ctx.moveTo(s * 0.1, -s * 0.2);
  ctx.lineTo(-s * 0.5, -s * (0.9 + evoIndex * 0.04));
  ctx.lineTo(-s * 0.05, -s * 0.25);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(s * 0.1, s * 0.2);
  ctx.lineTo(-s * 0.5, s * (0.9 + evoIndex * 0.04));
  ctx.lineTo(-s * 0.05, s * 0.25);
  ctx.fill();

  // tail fin
  ctx.beginPath();
  ctx.moveTo(-s * 0.8, 0);
  ctx.lineTo(-s * 1.15, -s * 0.5);
  ctx.lineTo(-s * 0.6, -s * 0.05);
  ctx.fill();

  // cockpit
  ctx.fillStyle = "rgba(20,40,80,0.85)";
  ctx.beginPath();
  ctx.ellipse(s * 0.35, 0, s * 0.3, s * 0.22, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(180,230,255,0.7)";
  ctx.beginPath();
  ctx.ellipse(s * 0.42, -s * 0.05, s * 0.16, s * 0.1, 0, 0, TAU);
  ctx.fill();

  // nose spinner
  ctx.fillStyle = "#ffd454";
  ctx.beginPath(); ctx.arc(s * 1.2, 0, s * 0.14, 0, TAU); ctx.fill();

  ctx.restore();
}

function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  const flash = e.hitFlash > 0;
  if (e.type === "balloon") {
    // hot-air balloon style
    ctx.fillStyle = flash ? "#fff" : e.color;
    ctx.beginPath(); ctx.arc(0, -e.r * 0.15, e.r, 0, TAU); ctx.fill();
    ctx.fillStyle = flash ? "#fff" : shade(e.color, -25);
    ctx.beginPath();
    ctx.moveTo(-e.r * 0.5, e.r * 0.5); ctx.lineTo(e.r * 0.5, e.r * 0.5);
    ctx.lineTo(e.r * 0.25, e.r * 1.05); ctx.lineTo(-e.r * 0.25, e.r * 1.05);
    ctx.closePath(); ctx.fill();
    // stripe
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(-e.r * 0.18, -e.r * 1.1, e.r * 0.36, e.r * 1.3);
  } else if (e.type === "fighter") {
    ctx.rotate(Math.PI);
    ctx.fillStyle = flash ? "#fff" : e.color;
    ctx.beginPath();
    ctx.moveTo(e.r, 0); ctx.lineTo(-e.r * 0.7, -e.r * 0.7);
    ctx.lineTo(-e.r * 0.3, 0); ctx.lineTo(-e.r * 0.7, e.r * 0.7);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = flash ? "#fff" : shade(e.color, -30);
    ctx.beginPath();
    ctx.moveTo(-e.r * 0.1, 0); ctx.lineTo(-e.r * 0.6, -e.r); ctx.lineTo(-e.r * 0.3, 0);
    ctx.lineTo(-e.r * 0.6, e.r); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffb3c7";
    ctx.beginPath(); ctx.arc(e.r * 0.2, 0, e.r * 0.2, 0, TAU); ctx.fill();
  } else { // blimp
    ctx.fillStyle = flash ? "#fff" : e.color;
    ctx.beginPath(); ctx.ellipse(0, 0, e.r * 1.3, e.r * 0.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = flash ? "#fff" : shade(e.color, -28);
    ctx.fillRect(-e.r * 0.5, e.r * 0.55, e.r, e.r * 0.4);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath(); ctx.ellipse(-e.r * 0.4, -e.r * 0.2, e.r * 0.5, e.r * 0.25, 0, 0, TAU); ctx.fill();
  }
  // health bar
  if (e.hp < e.maxHp) {
    const w = e.r * 2;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(-w / 2, -e.r - 14, w, 5);
    ctx.fillStyle = "#7dff9b";
    ctx.fillRect(-w / 2, -e.r - 14, w * (e.hp / e.maxHp), 5);
  }
  ctx.restore();
}

function drawOrb(o) {
  const pulse = 1 + Math.sin(performance.now() / 120 + o.x) * 0.15;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.globalAlpha = clamp(o.life, 0, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, o.r * 2.4 * pulse);
  g.addColorStop(0, "rgba(180,255,210,0.95)");
  g.addColorStop(0.4, "rgba(80,230,150,0.7)");
  g.addColorStop(1, "rgba(40,200,120,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, o.r * 2.4 * pulse, 0, TAU); ctx.fill();
  ctx.fillStyle = "#eafff0";
  ctx.beginPath(); ctx.arc(0, 0, o.r * 0.55, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawBullet(b, enemy) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.shadowBlur = 12; ctx.shadowColor = b.color;
  ctx.fillStyle = b.color;
  if (enemy) {
    ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU); ctx.fill();
  } else {
    ctx.beginPath(); ctx.ellipse(0, 0, b.r * 2, b.r, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  const t = TIERS[evoIndex];
  const pad = 14;
  // top-left: evolution name + tier pips
  ctx.textBaseline = "top";
  ctx.font = "700 13px -apple-system, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillText(`LV ${evoIndex + 1} · ${t.name.toUpperCase()}`, pad, pad);

  // evolution progress bar
  const barW = Math.min(W - pad * 2, 360), barH = 12, barY = pad + 20;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  roundRect(pad, barY, barW, barH, 6); ctx.fill();
  const need = t.xpNeed === Infinity ? 1 : t.xpNeed;
  const frac = t.xpNeed === Infinity ? 1 : clamp(xp / need, 0, 1);
  const bg = ctx.createLinearGradient(pad, 0, pad + barW, 0);
  bg.addColorStop(0, "#5effb0"); bg.addColorStop(1, "#39d6ff");
  ctx.fillStyle = bg;
  roundRect(pad, barY, barW * frac, barH, 6); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "700 9px -apple-system, sans-serif";
  ctx.fillText(t.xpNeed === Infinity ? "MAX EVOLUTION" : "EVOLUTION", pad + 6, barY + 2);

  // score top-right
  ctx.textAlign = "right";
  ctx.font = "800 22px -apple-system, sans-serif";
  ctx.fillStyle = "#ffd454";
  ctx.fillText(String(score), W - pad, pad);
  ctx.font = "700 10px -apple-system, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("SCORE", W - pad, pad + 24);
  ctx.textAlign = "left";

  // hearts bottom-left
  const hy = H - 34;
  for (let i = 0; i < player.maxHp; i++) {
    const hx = pad + i * 22;
    ctx.fillStyle = i < player.hp ? "#ff5b6e" : "rgba(255,255,255,0.18)";
    drawHeart(hx + 8, hy + 8, 8);
  }
}

function drawHeart(x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(s * 0.1, -s * 0.3, s, -s * 0.1, 0, s);
  ctx.bezierCurveTo(-s, -s * 0.1, -s * 0.1, -s * 0.3, 0, s * 0.35);
  ctx.fill();
  ctx.restore();
}

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

function shade(hex, amt) {
  // hex like #rrggbb -> lighten/darken
  const c = hex.replace("#", "");
  let r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  r = clamp(r + amt, 0, 255); g = clamp(g + amt, 0, 255); b = clamp(b + amt, 0, 255);
  return `rgb(${r|0},${g|0},${b|0})`;
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  drawBackground();
  for (const o of orbs) drawOrb(o);
  for (const e of enemies) drawEnemy(e);
  for (const b of eBullets) drawBullet(b, true);
  for (const b of bullets) drawBullet(b, false);
  if (state === "play") drawPlayer();
  drawParticles();
  ctx.restore();

  // evolution flash
  if (flashT > 0) {
    ctx.globalAlpha = clamp(flashT, 0, 0.6);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    if (flashT > 0.2) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#06121f";
      ctx.font = "900 " + Math.min(W * 0.1, 52) + "px -apple-system, sans-serif";
      ctx.fillText("EVOLVED!", W / 2, H / 2 - 20);
      ctx.font = "700 " + Math.min(W * 0.05, 24) + "px -apple-system, sans-serif";
      ctx.fillText(TIERS[evoIndex].name, W / 2, H / 2 + 24);
      ctx.textAlign = "left"; ctx.textBaseline = "top";
    }
  }

  if (state === "play") drawHUD();
}

// ---------- Loop ----------
let last = 0;
function loop(ts) {
  requestAnimationFrame(loop); // keep the loop alive even if a frame throws
  const dt = Math.min(0.05, (ts - last) / 1000 || 0);
  last = ts;
  if (state === "play") update(dt);
  render();
}

// ---------- Screens ----------
const startScreen = document.getElementById("startScreen");
const gameOverScreen = document.getElementById("gameOverScreen");

function startGame() {
  reset();
  state = "play";
  startScreen.classList.add("hidden");
  gameOverScreen.classList.add("hidden");
}
function gameOver() {
  state = "over";
  if (score > store.score) store.score = score;
  if (evoIndex + 1 > store.evo) store.evo = evoIndex + 1;
  document.getElementById("finalScore").textContent = score;
  document.getElementById("finalEvo").textContent = evoIndex + 1;
  document.getElementById("bestScore").textContent = store.score;
  document.getElementById("bestEvo").textContent = store.evo;
  gameOverScreen.classList.remove("hidden");
}

document.getElementById("startBtn").addEventListener("click", startGame);
document.getElementById("restartBtn").addEventListener("click", startGame);
document.getElementById("bestStart").textContent = store.evo;

reset();            // initialize all arrays/state so the first frames render cleanly
state = "start";    // ...but stay on the start screen until the player taps Play
requestAnimationFrame(loop);
})();
