/* STARFORGE entities: the player's forge-skiff, five enemy kinds with
   distinct movement, bullets for both sides, particles, pickups and floating
   score text. Entities are plain objects; update and draw live here so
   game.js only runs the loop and the states. */
'use strict';

const ARENA = { w: 1280, h: 800 };

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function makePlayer() {
  return {
    kind: 'player',
    x: ARENA.w / 2, y: ARENA.h / 2 + 120,
    vx: 0, vy: 0, r: 16,
    hp: 100, maxHp: 100,
    fireCd: 0, dashCd: 0, dashTime: 0, invuln: 0,
    angle: -Math.PI / 2, alive: true, thrust: 0,
  };
}

const ENEMY_TYPES = {
  drone:   { hp: 22,  speed: 118, r: 15, score: 50,  color: '#ff5470', damage: 12 },
  weaver:  { hp: 16,  speed: 150, r: 13, score: 80,  color: '#ffb84d', damage: 10 },
  splitter:{ hp: 34,  speed: 82,  r: 21, score: 90,  color: '#c792ff', damage: 14 },
  spitter: { hp: 26,  speed: 64,  r: 16, score: 120, color: '#4dd7ff', damage: 10 },
  brute:   { hp: 130, speed: 46,  r: 30, score: 300, color: '#ff7a45', damage: 22 },
};

function makeEnemy(type, x, y, waveScale) {
  const base = ENEMY_TYPES[type];
  return {
    kind: 'enemy', type,
    x, y, vx: 0, vy: 0,
    r: base.r,
    hp: Math.round(base.hp * waveScale),
    maxHp: Math.round(base.hp * waveScale),
    speed: base.speed * (0.92 + Math.random() * 0.16),
    score: base.score, color: base.color, damage: base.damage,
    t: Math.random() * Math.PI * 2,
    shootCd: 1.2 + Math.random() * 1.6,
    flash: 0, alive: true,
  };
}

function makeBullet(x, y, angle, speed, friendly) {
  return {
    kind: 'bullet', friendly,
    x, y,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    r: friendly ? 4 : 5,
    life: friendly ? 1.1 : 3.2,
    alive: true,
  };
}

function burst(world, x, y, color, n, speed, life, size) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = (0.3 + Math.random() * 0.7) * speed;
    world.particles.push({
      kind: 'particle', x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: life * (0.5 + Math.random() * 0.8), maxLife: life,
      color, size: size * (0.6 + Math.random() * 0.8), alive: true,
    });
  }
}

function makePickup(x, y, type) {
  return { kind: 'pickup', type, x, y, r: 11, t: 0, life: 9, alive: true };
}

function floatText(world, x, y, text, color) {
  world.texts.push({ kind: 'text', x, y, text, color, life: 0.9, alive: true });
}

function updatePlayer(world, p, dt, control) {
  const accel = 2400;
  p.vx += control.x * accel * dt;
  p.vy += control.y * accel * dt;
  const dashing = p.dashTime > 0;
  const drag = dashing ? 0.4 : 4.2;
  p.vx -= p.vx * Math.min(1, drag * dt);
  p.vy -= p.vy * Math.min(1, drag * dt);
  const cruise = 335 * (1 + world.upgrades.engine * 0.1);
  const maxSpeed = dashing ? 1150 : cruise;
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > maxSpeed) {
    p.vx = p.vx / sp * maxSpeed;
    p.vy = p.vy / sp * maxSpeed;
  }
  p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + p.vx * dt));
  p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + p.vy * dt));
  p.thrust = Math.min(1, sp / 300);
  p.angle = Math.atan2(control.aimY - p.y, control.aimX - p.x);

  p.fireCd -= dt;
  p.dashCd -= dt;
  p.invuln -= dt;
  if (p.dashTime > 0) p.dashTime -= dt;

  if (control.dash && p.dashCd <= 0 && (control.x !== 0 || control.y !== 0)) {
    const d = Math.hypot(control.x, control.y);
    p.vx = control.x / d * 1150;
    p.vy = control.y / d * 1150;
    p.dashTime = 0.16;
    p.dashCd = 1.6 * (1 - world.upgrades.engine * 0.1);
    p.invuln = Math.max(p.invuln, 0.22);
    Sfx.dash();
    burst(world, p.x, p.y, '#7fd8ff', 10, 160, 0.35, 3);
  }

  if (control.fire && p.fireCd <= 0) {
    p.fireCd = 0.135;
    const spread = (Math.random() - 0.5) * 0.045;
    world.bullets.push(makeBullet(
      p.x + Math.cos(p.angle) * 20, p.y + Math.sin(p.angle) * 20,
      p.angle + spread, 780, true));
    if (world.upgrades.spread >= 3) {
      world.bullets.push(makeBullet(p.x, p.y, p.angle - 0.14, 780, true));
      world.bullets.push(makeBullet(p.x, p.y, p.angle + 0.14, 780, true));
    } else if (world.upgrades.spread === 2) {
      world.bullets.push(makeBullet(p.x, p.y, p.angle + (Math.random() < 0.5 ? -0.1 : 0.1), 780, true));
    }
    Sfx.shoot();
  }
}

function updateEnemy(world, e, dt) {
  const p = world.player;
  e.t += dt;
  if (e.flash > 0) e.flash -= dt;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  let mx = dx / d;
  let my = dy / d;

  if (e.type === 'weaver') {
    const px = -my * Math.sin(e.t * 3.4);
    const py = mx * Math.sin(e.t * 3.4);
    mx += px * 0.9;
    my += py * 0.9;
  } else if (e.type === 'spitter') {
    if (d < 300) { mx = -mx * 0.6; my = -my * 0.6; }
    else if (d < 380) { mx = -my * 0.7; my = dx / d * 0.7; }
    e.shootCd -= dt;
    if (e.shootCd <= 0 && d < 560 && p.alive) {
      e.shootCd = 2.1 + Math.random() * 0.9;
      const a = Math.atan2(dy, dx);
      world.bullets.push(makeBullet(e.x, e.y, a, 265, false));
      Sfx.hit();
    }
  } else if (e.type === 'brute') {
    if (e.hp < e.maxHp * 0.5) e.speed = ENEMY_TYPES.brute.speed * 1.45;
  }

  const steer = e.type === 'brute' ? 1.6 : 3.2;
  e.vx += (mx * e.speed - e.vx) * Math.min(1, steer * dt);
  e.vy += (my * e.speed - e.vy) * Math.min(1, steer * dt);
  e.x += e.vx * dt;
  e.y += e.vy * dt;

  /* Enemies keep a little personal space so packs read as a swarm, not a blob. */
  for (const other of world.enemies) {
    if (other === e || !other.alive) continue;
    const rr = e.r + other.r;
    if (dist2(e.x, e.y, other.x, other.y) < rr * rr) {
      const ox = e.x - other.x;
      const oy = e.y - other.y;
      const od = Math.max(1, Math.hypot(ox, oy));
      e.x += ox / od * 26 * dt;
      e.y += oy / od * 26 * dt;
    }
  }
}

function drawShip(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0) ctx.globalAlpha = 0.45;
  /* engine flame */
  const flame = 12 + p.thrust * 16 + Math.random() * 5;
  ctx.save();
  ctx.rotate(p.angle);
  const grad = ctx.createLinearGradient(-14, 0, -14 - flame, 0);
  grad.addColorStop(0, 'rgba(140,220,255,0.95)');
  grad.addColorStop(1, 'rgba(64,120,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-13, -5);
  ctx.lineTo(-14 - flame, 0);
  ctx.lineTo(-13, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  /* hull */
  ctx.rotate(p.angle);
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(-8, -13);
  ctx.lineTo(-14, -6);
  ctx.lineTo(-14, 6);
  ctx.lineTo(-8, 13);
  ctx.closePath();
  const hull = ctx.createLinearGradient(-14, 0, 20, 0);
  hull.addColorStop(0, '#3d6fb8');
  hull.addColorStop(0.6, '#9fd0ff');
  hull.addColorStop(1, '#eaf7ff');
  ctx.fillStyle = hull;
  ctx.fill();
  ctx.strokeStyle = '#dff2ff';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  /* forge core */
  ctx.beginPath();
  ctx.arc(2, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd76a';
  ctx.shadowColor = '#ffb84d';
  ctx.shadowBlur = 14;
  ctx.fill();
  ctx.restore();
}

function drawEnemy(ctx, e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  const flash = e.flash > 0;
  ctx.fillStyle = flash ? '#ffffff' : e.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = e.color;
  ctx.shadowBlur = flash ? 18 : 8;
  const rot = e.t * (e.type === 'weaver' ? 2.4 : 0.9);
  ctx.rotate(rot);
  ctx.beginPath();
  if (e.type === 'drone') {
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      const px = Math.cos(a) * e.r;
      const py = Math.sin(a) * e.r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
  } else if (e.type === 'weaver') {
    ctx.moveTo(e.r, 0); ctx.lineTo(0, e.r * 0.7); ctx.lineTo(-e.r, 0); ctx.lineTo(0, -e.r * 0.7);
  } else if (e.type === 'splitter') {
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      const px = Math.cos(a) * e.r;
      const py = Math.sin(a) * e.r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
  } else if (e.type === 'spitter') {
    ctx.arc(0, 0, e.r, 0, Math.PI * 2);
  } else { /* brute */
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      const px = Math.cos(a) * e.r;
      const py = Math.sin(a) * e.r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.rotate(-rot);
  ctx.beginPath();
  ctx.arc(0, 0, e.r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = flash ? '#ffd7de' : 'rgba(10,10,20,0.55)';
  ctx.shadowBlur = 0;
  ctx.fill();
  ctx.restore();
  if (e.hp < e.maxHp) {
    const w = e.r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(e.x - e.r, e.y - e.r - 10, w, 4);
    ctx.fillStyle = '#8dff9a';
    ctx.fillRect(e.x - e.r, e.y - e.r - 10, w * Math.max(0, e.hp / e.maxHp), 4);
  }
}
