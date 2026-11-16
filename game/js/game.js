/* STARFORGE game: the state machine and the loop. States: title, playing,
   shop (between waves), paused, over, win. Owns the world (player, enemies,
   bullets, particles, pickups, floating texts), collisions, combo scoring,
   the HUD and every screen drawn on the canvas. The demo autopilot plays
   through the same control shape a human produces, which powers the title
   screen's attract mode and the maker's screenshots. */
'use strict';

const Game = (() => {
  let canvas = null;
  let ctx = null;
  let lastTime = 0;
  let state = 'title';
  let demo = false;
  let kamikaze = false;
  let holdShop = false;
  let buttons = [];
  let stars = [];
  let nebula = null;
  let highScore = 0;

  const world = {
    player: null, enemies: [], bullets: [], particles: [], texts: [], pickups: [],
    upgrades: freshUpgrades(),
    score: 0, kills: 0, shots: 0, hits: 0,
    combo: 0, comboTimer: 0, bestCombo: 0,
    wave: 0, endless: false,
    spawnQueue: [], spawnTimer: 0,
    shake: 0, time: 0, waveBanner: 0,
    cards: [],
  };

  try { highScore = Number(localStorage.getItem('starforge.high') || 0) || 0; } catch (e) { highScore = 0; }

  function resetWorld() {
    world.player = makePlayer();
    world.enemies = []; world.bullets = []; world.particles = [];
    world.texts = []; world.pickups = [];
    world.upgrades = freshUpgrades();
    world.score = 0; world.kills = 0; world.shots = 0; world.hits = 0;
    world.combo = 0; world.comboTimer = 0; world.bestCombo = 0;
    world.wave = 0; world.endless = false;
    world.spawnQueue = []; world.shake = 0; world.time = 0;
  }

  function startGame() {
    resetWorld();
    state = 'playing';
    Sfx.startMusic();
    nextWave();
  }

  function nextWave() {
    world.wave += 1;
    world.spawnQueue = waveRecipe(world.wave);
    world.spawnTimer = 0.5;
    world.waveBanner = 2.2;
    floatText(world, ARENA.w / 2, 150, '', '#ffffff'); /* banner drawn separately */
  }

  function multiplier() {
    return 1 + Math.min(4, Math.floor(world.combo / 8));
  }

  function addScore(base, x, y) {
    const gain = base * multiplier();
    world.score += gain;
    floatText(world, x, y - 18, '+' + gain, '#ffe9a3');
  }

  function killEnemy(e) {
    e.alive = false;
    world.kills += 1;
    world.combo += 1;
    world.comboTimer = 3.5;
    world.bestCombo = Math.max(world.bestCombo, world.combo);
    addScore(e.score, e.x, e.y);
    burst(world, e.x, e.y, e.color, e.type === 'brute' ? 42 : 16, 260, 0.55, 3.4);
    if (e.type === 'brute') {
      Sfx.bigBoom();
      world.shake = Math.max(world.shake, 14);
    } else {
      Sfx.boom();
      world.shake = Math.max(world.shake, 4);
    }
    if (e.type === 'splitter') {
      for (let i = 0; i < 2; i++) {
        const m = makeEnemy('drone', e.x + (i ? 14 : -14), e.y + (i ? -10 : 10), waveHpScale(world.wave));
        m.hp = Math.round(m.hp * 0.6);
        m.maxHp = m.hp;
        m.score = 30;
        world.enemies.push(m);
      }
    }
    const roll = Math.random();
    if (e.type === 'brute' || roll < 0.10) world.pickups.push(makePickup(e.x, e.y, 'core'));
    else if (roll < 0.16) world.pickups.push(makePickup(e.x, e.y, 'shard'));
  }

  function hurtPlayer(dmg) {
    const p = world.player;
    if (!p.alive || p.invuln > 0) return;
    p.hp -= dmg;
    p.invuln = 0.5;
    world.shake = Math.max(world.shake, 7);
    Sfx.hurt();
    burst(world, p.x, p.y, '#ff8fa3', 12, 200, 0.4, 3);
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      burst(world, p.x, p.y, '#9fd0ff', 60, 340, 0.9, 4);
      burst(world, p.x, p.y, '#ffd76a', 30, 220, 0.7, 3);
      Sfx.bigBoom();
      Sfx.gameOver();
      Sfx.stopMusic();
      state = 'over';
      if (world.score > highScore) {
        highScore = world.score;
        try { localStorage.setItem('starforge.high', String(highScore)); } catch (e) { /* private mode */ }
      }
    }
  }

  function demoControl() {
    const p = world.player;
    let nearest = null;
    let nd = Infinity;
    for (const e of world.enemies) {
      const d = dist2(p.x, p.y, e.x, e.y);
      if (d < nd) { nd = d; nearest = e; }
    }
    let tx = ARENA.w / 2;
    let ty = ARENA.h / 2;
    if (kamikaze) {
      if (nearest) { tx = nearest.x; ty = nearest.y; }
      return { x: Math.sign(tx - p.x), y: Math.sign(ty - p.y), aimX: tx, aimY: ty, fire: false, dash: false };
    }
    /* kite: hold a ring around the nearest enemy, drift to pickups when safe */
    let moveX = 0;
    let moveY = 0;
    if (nearest) {
      const d = Math.sqrt(nd);
      const away = d < 240 ? -1 : (d > 420 ? 1 : 0);
      moveX = (nearest.x - p.x) / (d || 1) * away + (-(nearest.y - p.y) / (d || 1)) * 0.55;
      moveY = (nearest.y - p.y) / (d || 1) * away + ((nearest.x - p.x) / (d || 1)) * 0.55;
    }
    let pickup = null;
    let pd = Infinity;
    for (const pk of world.pickups) {
      const d = dist2(p.x, p.y, pk.x, pk.y);
      if (d < pd) { pd = d; pickup = pk; }
    }
    if (pickup && (!nearest || nd > 200 * 200)) { moveX = pickup.x - p.x; moveY = pickup.y - p.y; }
    const ml = Math.hypot(moveX, moveY) || 1;
    return {
      x: Math.abs(moveX / ml) > 0.35 ? Math.sign(moveX) : 0,
      y: Math.abs(moveY / ml) > 0.35 ? Math.sign(moveY) : 0,
      aimX: nearest ? nearest.x : p.x + 100,
      aimY: nearest ? nearest.y : p.y,
      fire: !!nearest,
      dash: !!nearest && nd < 130 * 130,
    };
  }

  function humanControl() {
    const a = Input.axis();
    const speedScale = 1 + world.upgrades.engine * 0.1;
    return {
      x: a.x, y: a.y,
      aimX: Input.mouse.x, aimY: Input.mouse.y,
      fire: Input.mouse.down || Input.down(' '),
      dash: Input.hit('shift') || Input.down('shift'),
      speedScale,
    };
  }

  function update(dt) {
    world.time += dt;
    if (world.shake > 0) world.shake = Math.max(0, world.shake - dt * 26);
    if (world.waveBanner > 0) world.waveBanner -= dt;
    if (world.comboTimer > 0) {
      world.comboTimer -= dt;
      if (world.comboTimer <= 0) world.combo = 0;
    }

    if (state === 'shop' && demo && !holdShop) {
      /* the autopilot takes the first forge gift so a demo run flows on
         through the waves (and a kamikaze run can still reach its end) */
      world.shopTimer = (world.shopTimer || 0) + dt;
      if (world.shopTimer > 1.2) {
        world.shopTimer = 0;
        chooseCard(0);
      }
    }

    if (state === 'playing') {
      const control = demo ? demoControl() : humanControl();
      if (world.player.alive) updatePlayer(world, world.player, dt, control);

      if (world.spawnQueue.length) {
        world.spawnTimer -= dt;
        if (world.spawnTimer <= 0) {
          world.spawnTimer = spawnInterval(world.wave);
          const pt = spawnPoint();
          const type = world.spawnQueue.shift();
          world.enemies.push(makeEnemy(type, pt.x, pt.y, waveHpScale(world.wave)));
        }
      }

      for (const e of world.enemies) if (e.alive) updateEnemy(world, e, dt);

      for (const b of world.bullets) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.x < -20 || b.x > ARENA.w + 20 || b.y < -20 || b.y > ARENA.h + 20) b.alive = false;
      }

      collide();

      for (const pk of world.pickups) {
        pk.t += dt;
        pk.life -= dt;
        if (pk.life <= 0) pk.alive = false;
        const p = world.player;
        const rr = 26 + world.upgrades.magnet * 55;
        if (p.alive && dist2(pk.x, pk.y, p.x, p.y) < rr * rr) {
          const d = Math.max(1, Math.hypot(p.x - pk.x, p.y - pk.y));
          pk.x += (p.x - pk.x) / d * 190 * dt;
          pk.y += (p.y - pk.y) / d * 190 * dt;
        }
        if (p.alive && dist2(pk.x, pk.y, p.x, p.y) < (pk.r + p.r) * (pk.r + p.r)) {
          pk.alive = false;
          Sfx.pickup();
          if (pk.type === 'core') {
            world.score += 150 * multiplier();
            floatText(world, pk.x, pk.y - 14, 'CORE +' + 150 * multiplier(), '#ffd76a');
          } else {
            p.hp = Math.min(p.maxHp, p.hp + 14);
            floatText(world, pk.x, pk.y - 14, '+14 HULL', '#8dff9a');
          }
          burst(world, pk.x, pk.y, pk.type === 'core' ? '#ffd76a' : '#8dff9a', 8, 120, 0.3, 2.4);
        }
      }

      world.enemies = world.enemies.filter((e) => e.alive);
      world.bullets = world.bullets.filter((b) => b.alive);
      world.pickups = world.pickups.filter((pk) => pk.alive);

      if (world.player.alive && !world.spawnQueue.length && world.enemies.length === 0) {
        if (world.wave >= TOTAL_WAVES && !world.endless) {
          state = 'win';
          Sfx.victory();
          Sfx.stopMusic();
          if (world.score > highScore) {
            highScore = world.score;
            try { localStorage.setItem('starforge.high', String(highScore)); } catch (e) { /* ignore */ }
          }
        } else {
          world.cards = pickUpgradeCards(world.upgrades);
          state = 'shop';
          Sfx.waveClear();
        }
      }
    }

    for (const pt of world.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= (1 - 1.8 * dt);
      pt.vy *= (1 - 1.8 * dt);
      pt.life -= dt;
      if (pt.life <= 0) pt.alive = false;
    }
    world.particles = world.particles.filter((pt) => pt.alive);
    for (const t of world.texts) {
      t.y -= 34 * dt;
      t.life -= dt;
      if (t.life <= 0) t.alive = false;
    }
    world.texts = world.texts.filter((t) => t.text && t.alive);
  }

  function collide() {
    const p = world.player;
    const dmg = world.upgrades.damage;
    for (const b of world.bullets) {
      if (!b.alive) continue;
      if (b.friendly) {
        for (const e of world.enemies) {
          if (!e.alive) continue;
          if (dist2(b.x, b.y, e.x, e.y) < (b.r + e.r) * (b.r + e.r)) {
            b.alive = false;
            e.hp -= dmg;
            e.flash = 0.08;
            world.hits += 1;
            burst(world, b.x, b.y, e.color, 3, 140, 0.25, 2);
            if (e.hp <= 0) killEnemy(e);
            break;
          }
        }
      } else if (p.alive && dist2(b.x, b.y, p.x, p.y) < (b.r + p.r - 4) * (b.r + p.r - 4)) {
        b.alive = false;
        hurtPlayer(9);
      }
    }
    if (p.alive) {
      for (const e of world.enemies) {
        if (!e.alive) continue;
        if (dist2(p.x, p.y, e.x, e.y) < (p.r + e.r - 3) * (p.r + e.r - 3)) {
          hurtPlayer(e.damage);
          e.hp -= 26;
          e.flash = 0.08;
          if (e.hp <= 0) killEnemy(e);
        }
      }
    }
  }

  /* ---------------- drawing ---------------- */

  function makeBackground() {
    nebula = document.createElement('canvas');
    nebula.width = ARENA.w;
    nebula.height = ARENA.h;
    const nctx = nebula.getContext('2d');
    const base = nctx.createLinearGradient(0, 0, 0, ARENA.h);
    base.addColorStop(0, '#0a1128');
    base.addColorStop(0.55, '#070b18');
    base.addColorStop(1, '#0d0a1f');
    nctx.fillStyle = base;
    nctx.fillRect(0, 0, ARENA.w, ARENA.h);
    const blobs = [
      [280, 190, 340, 'rgba(64,110,255,0.16)'],
      [1010, 560, 420, 'rgba(150,64,255,0.13)'],
      [880, 140, 260, 'rgba(255,120,80,0.08)'],
      [420, 640, 300, 'rgba(40,200,220,0.10)'],
    ];
    for (const [x, y, r, color] of blobs) {
      const g = nctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      nctx.fillStyle = g;
      nctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    /* the forge ring at the arena's heart */
    nctx.strokeStyle = 'rgba(120,180,255,0.10)';
    nctx.lineWidth = 2;
    nctx.beginPath();
    nctx.arc(ARENA.w / 2, ARENA.h / 2, 150, 0, Math.PI * 2);
    nctx.stroke();
    nctx.strokeStyle = 'rgba(120,180,255,0.05)';
    nctx.beginPath();
    nctx.arc(ARENA.w / 2, ARENA.h / 2, 190, 0, Math.PI * 2);
    nctx.stroke();
    stars = [];
    for (let i = 0; i < 170; i++) {
      stars.push({ x: Math.random() * ARENA.w, y: Math.random() * ARENA.h, r: Math.random() * 1.6 + 0.4, tw: Math.random() * 6 });
    }
  }

  function drawBackground() {
    ctx.drawImage(nebula, 0, 0);
    for (const s of stars) {
      const a = 0.45 + 0.4 * Math.sin(world.time * 1.7 + s.tw);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#cfe3ff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawPickup(pk) {
    const bob = Math.sin(pk.t * 4) * 3;
    ctx.save();
    ctx.translate(pk.x, pk.y + bob);
    if (pk.life < 2.5 && Math.floor(pk.life * 6) % 2 === 0) ctx.globalAlpha = 0.35;
    ctx.rotate(pk.t * 2);
    ctx.shadowBlur = 12;
    if (pk.type === 'core') {
      ctx.shadowColor = '#ffd76a';
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        ctx.lineTo(Math.cos(a) * 10, Math.sin(a) * 10);
        const a2 = a + Math.PI / 4;
        ctx.lineTo(Math.cos(a2) * 4.5, Math.sin(a2) * 4.5);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.shadowColor = '#8dff9a';
      ctx.fillStyle = '#8dff9a';
      ctx.fillRect(-3, -9, 6, 18);
      ctx.fillRect(-9, -3, 18, 6);
    }
    ctx.restore();
  }

  function drawWorld() {
    drawBackground();
    for (const pk of world.pickups) drawPickup(pk);
    for (const b of world.bullets) {
      ctx.save();
      ctx.shadowBlur = 10;
      if (b.friendly) {
        ctx.shadowColor = '#9fd0ff';
        ctx.fillStyle = '#dff2ff';
      } else {
        ctx.shadowColor = '#ff5470';
        ctx.fillStyle = '#ff8fa3';
      }
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (const e of world.enemies) drawEnemy(ctx, e);
    if (world.player && world.player.alive) drawShip(ctx, world.player);
    for (const pt of world.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
    for (const t of world.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 2);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  function bar(x, y, w, h, frac, color, bg) {
    ctx.fillStyle = bg || 'rgba(255,255,255,0.13)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  function drawHUD() {
    const p = world.player;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#cfe3ff';
    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('HULL', 22, 30);
    bar(22, 36, 210, 13, p.hp / p.maxHp, p.hp > 30 ? '#57e389' : '#ff5470');
    ctx.fillStyle = '#eaf4ff';
    ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(Math.ceil(p.hp) + ' / ' + p.maxHp, 240, 47);
    ctx.fillText('DASH', 22, 68);
    bar(22, 72, 110, 7, 1 - Math.max(0, p.dashCd) / 1.6, '#7fd8ff');

    ctx.textAlign = 'center';
    ctx.fillStyle = '#eaf4ff';
    ctx.font = '800 21px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(world.endless ? 'ENDLESS · WAVE ' + world.wave : 'WAVE ' + world.wave + ' / ' + TOTAL_WAVES, ARENA.w / 2, 36);
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#9db8dd';
    const left = world.enemies.length + world.spawnQueue.length;
    ctx.fillText(left + (left === 1 ? ' hostile remains' : ' hostiles remain'), ARENA.w / 2, 56);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffe9a3';
    ctx.font = '800 24px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(world.score.toLocaleString('en-US'), ARENA.w - 22, 38);
    const mult = multiplier();
    ctx.font = '700 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = mult > 1 ? '#ffd76a' : '#9db8dd';
    ctx.fillText('COMBO ' + world.combo + '  ·  x' + mult, ARENA.w - 22, 60);
    if (world.comboTimer > 0) bar(ARENA.w - 132, 66, 110, 5, world.comboTimer / 3.5, '#ffd76a');

    const brute = world.enemies.find((e) => e.type === 'brute');
    if (brute) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb59d';
      ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('FORGEBRUTE', ARENA.w / 2, ARENA.h - 26);
      bar(ARENA.w / 2 - 180, ARENA.h - 20, 360, 9, brute.hp / brute.maxHp, '#ff7a45');
    }

    if (world.waveBanner > 0 && state === 'playing') {
      ctx.globalAlpha = Math.min(1, world.waveBanner);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 54px "Segoe UI", system-ui, sans-serif';
      ctx.shadowColor = '#4d9fff';
      ctx.shadowBlur = 26;
      ctx.fillText('WAVE ' + world.wave, ARENA.w / 2, 170);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(8,13,28,0.88)';
    ctx.strokeStyle = 'rgba(120,180,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 14);
    ctx.fill();
    ctx.stroke();
  }

  function button(id, x, y, w, h, label, accent) {
    const m = Input.mouse;
    const hover = m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;
    ctx.fillStyle = hover ? (accent || '#2b5ea8') : 'rgba(30,52,96,0.9)';
    ctx.strokeStyle = '#9fd0ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 19px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + 7);
    buttons.push({ id, x, y, w, h });
    if (hover && m.clicked) return true;
    return false;
  }

  function drawTitle() {
    drawWorld();
    ctx.fillStyle = 'rgba(4,6,14,0.45)';
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
    ctx.textAlign = 'center';
    const grad = ctx.createLinearGradient(0, 180, 0, 300);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, '#9fd0ff');
    grad.addColorStop(1, '#ffb84d');
    ctx.fillStyle = grad;
    ctx.font = '900 96px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = '#4d9fff';
    ctx.shadowBlur = 34;
    ctx.fillText('STARFORGE', ARENA.w / 2, 285);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#cfe3ff';
    ctx.font = '600 21px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Ten waves of swarm are coming for the last forge in the dark.', ARENA.w / 2, 330);
    ctx.fillText('Keep the fire lit.', ARENA.w / 2, 358);
    if (button('start', ARENA.w / 2 - 130, 420, 260, 56, 'LAUNCH')) startGame();
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#9db8dd';
    ctx.fillText('WASD / arrows to fly · mouse to aim · hold click or Space to fire · Shift to dash', ARENA.w / 2, 540);
    ctx.fillText('Clear a wave, pick an upgrade, survive the Forgebrute on waves 5 and 10.', ARENA.w / 2, 566);
    if (highScore > 0) {
      ctx.fillStyle = '#ffd76a';
      ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('Best score so far: ' + highScore.toLocaleString('en-US'), ARENA.w / 2, 610);
    }
    ctx.fillStyle = '#5f789e';
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('An original arena game · sound on M to mute · P to pause', ARENA.w / 2, 752);
  }

  function drawShop() {
    drawWorld();
    ctx.fillStyle = 'rgba(4,6,14,0.55)';
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('WAVE ' + world.wave + ' CLEAR', ARENA.w / 2, 190);
    ctx.fillStyle = '#cfe3ff';
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('The forge offers one gift before wave ' + (world.wave + 1) + '. Choose.', ARENA.w / 2, 226);
    const cw = 300;
    const ch = 210;
    const gap = 28;
    const x0 = ARENA.w / 2 - (cw * 3 + gap * 2) / 2;
    world.cards.forEach((card, i) => {
      const x = x0 + i * (cw + gap);
      const y = 300;
      const m = Input.mouse;
      const hover = m.x >= x && m.x <= x + cw && m.y >= y && m.y <= y + ch;
      panel(x, y, cw, ch);
      if (hover) {
        ctx.strokeStyle = '#ffd76a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(x, y, cw, ch, 14);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffd76a';
      ctx.font = '900 30px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(card.icon, x + cw / 2, y + 58);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 22px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(card.name, x + cw / 2, y + 100);
      ctx.fillStyle = '#b9cfea';
      ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
      wrapText(card.desc, x + cw / 2, y + 132, cw - 36, 20);
      ctx.fillStyle = '#7f97bd';
      ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('press ' + (i + 1) + ' or click', x + cw / 2, y + ch - 16);
      buttons.push({ id: 'card' + i, x, y, w: cw, h: ch });
      if (hover && m.clicked) chooseCard(i);
    });
    ctx.fillStyle = '#9db8dd';
    ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Score ' + world.score.toLocaleString('en-US') + ' · hull ' + Math.ceil(world.player.hp) + '/' + world.player.maxHp, ARENA.w / 2, 580);
  }

  function wrapText(text, x, y, maxW, lineH) {
    const words = text.split(' ');
    let line = '';
    let yy = y;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = w;
        yy += lineH;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  function chooseCard(i) {
    const card = world.cards[i];
    if (!card) return;
    card.take(world.upgrades, world);
    Sfx.pickup();
    state = 'playing';
    nextWave();
  }

  function statsLine() {
    return 'Score ' + world.score.toLocaleString('en-US') + ' · wave ' + world.wave +
      ' · kills ' + world.kills + ' · best combo x' + (1 + Math.min(4, Math.floor(world.bestCombo / 8)));
  }

  function drawOver() {
    drawWorld();
    ctx.fillStyle = 'rgba(10,4,8,0.62)';
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff8fa3';
    ctx.font = '900 72px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = '#ff5470';
    ctx.shadowBlur = 26;
    ctx.fillText('THE FORGE GOES DARK', ARENA.w / 2, 268);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eaf4ff';
    ctx.font = '700 21px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(statsLine(), ARENA.w / 2, 330);
    ctx.fillStyle = '#9db8dd';
    ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('The swarm keeps the ashes. The next keeper lights it again.', ARENA.w / 2, 362);
    if (button('restart', ARENA.w / 2 - 140, 420, 280, 56, 'LIGHT IT AGAIN')) startGame();
    ctx.fillStyle = '#7f97bd';
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('or press Enter', ARENA.w / 2, 512);
  }

  function drawWin() {
    drawWorld();
    ctx.fillStyle = 'rgba(6,12,6,0.5)';
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe9a3';
    ctx.font = '900 72px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = '#ffb84d';
    ctx.shadowBlur = 28;
    ctx.fillText('THE FORGE BURNS ON', ARENA.w / 2, 268);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eaf4ff';
    ctx.font = '700 21px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('All ten waves broken. ' + statsLine(), ARENA.w / 2, 330);
    if (button('endless', ARENA.w / 2 - 300, 420, 280, 56, 'ENDLESS MODE')) {
      world.endless = true;
      state = 'playing';
      Sfx.startMusic();
      nextWave();
    }
    if (button('restart2', ARENA.w / 2 + 20, 420, 280, 56, 'PLAY AGAIN')) startGame();
    ctx.fillStyle = '#7f97bd';
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Endless waves keep scaling. How long can the fire last?', ARENA.w / 2, 512);
  }

  function drawPaused() {
    drawWorld();
    ctx.fillStyle = 'rgba(4,6,14,0.6)';
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 54px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PAUSED', ARENA.w / 2, 330);
    if (button('resume', ARENA.w / 2 - 120, 380, 240, 52, 'RESUME')) state = 'playing';
    ctx.fillStyle = '#9db8dd';
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('P or Esc to resume · M to ' + (Sfx.isMuted() ? 'unmute' : 'mute'), ARENA.w / 2, 480);
  }

  function draw() {
    ctx.save();
    if (world.shake > 0) {
      ctx.translate((Math.random() - 0.5) * world.shake, (Math.random() - 0.5) * world.shake);
    }
    buttons = [];
    if (state === 'title') drawTitle();
    else if (state === 'shop') drawShop();
    else if (state === 'over') drawOver();
    else if (state === 'win') drawWin();
    else if (state === 'paused') drawPaused();
    else { drawWorld(); drawHUD(); }
    ctx.restore();
    if (demo) {
      ctx.fillStyle = 'rgba(255,215,106,0.85)';
      ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('ATTRACT MODE', ARENA.w - 16, ARENA.h - 12);
    }
  }

  function handleKeys() {
    if (Input.hit('m')) Sfx.toggleMute();
    if (state === 'title' && (Input.hit('enter') || Input.hit(' '))) startGame();
    else if (state === 'over' && Input.hit('enter')) startGame();
    else if (state === 'win' && Input.hit('enter')) startGame();
    else if (state === 'shop') {
      if (Input.hit('1')) chooseCard(0);
      if (Input.hit('2')) chooseCard(1);
      if (Input.hit('3')) chooseCard(2);
    } else if (state === 'playing' && (Input.hit('p') || Input.hit('escape'))) state = 'paused';
    else if (state === 'paused' && (Input.hit('p') || Input.hit('escape'))) state = 'playing';
  }

  function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    handleKeys();
    if (state !== 'paused') update(dt);
    draw();
    Input.endFrame();
    requestAnimationFrame(frame);
  }

  return {
    init(el) {
      canvas = el;
      ctx = canvas.getContext('2d');
      makeBackground();
      resetWorld();
      /* title screen attract: a quiet swarm drifts behind the logo */
      world.enemies.push(makeEnemy('drone', 240, 200, 1));
      world.enemies.push(makeEnemy('weaver', 1040, 560, 1));
      world.enemies.push(makeEnemy('splitter', 980, 170, 1));
      world.player.alive = false;
      requestAnimationFrame(frame);
    },
    setDemo(on, opts) {
      demo = !!on;
      kamikaze = !!(opts && opts.kamikaze);
      holdShop = !!(opts && opts.holdShop);
      if (demo && state === 'title') startGame();
    },
    getState() { return state; },
    world,
  };
})();
