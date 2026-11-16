/* STARFORGE waves: ten waves against the swarm. Each wave is a spawn queue
   built from a small recipe that grows in count and mixes in a new enemy kind
   every couple of waves; wave 5 and wave 10 end on a brute. Clearing a wave
   opens the forge shop: one of three upgrade cards, chosen with the mouse or
   keys 1-3. Surviving wave 10 wins the game; the forge then offers endless
   mode with the same recipes scaled up. */
'use strict';

const TOTAL_WAVES = 10;

function waveRecipe(wave) {
  const q = [];
  const push = (type, n) => { for (let i = 0; i < n; i++) q.push(type); };
  push('drone', 4 + wave * 2);
  if (wave >= 2) push('weaver', 2 + wave);
  if (wave >= 3) push('splitter', Math.floor(wave * 0.9));
  if (wave >= 4) push('spitter', Math.floor(wave * 0.8));
  if (wave >= 6) push('drone', wave);
  if (wave % 5 === 0) push('brute', Math.floor(wave / 5));
  /* shuffle deterministically-ish so kinds interleave instead of blocking */
  for (let i = q.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = q[i]; q[i] = q[j]; q[j] = tmp;
  }
  if (wave % 5 === 0) q.push('brute'); /* the brute always closes its wave */
  return q;
}

function waveHpScale(wave) {
  return 1 + (wave - 1) * 0.16;
}

function spawnInterval(wave) {
  return Math.max(0.45, 1.15 - wave * 0.07);
}

function spawnPoint() {
  /* just outside a random edge, so the swarm pours in from the dark */
  const side = Math.floor(Math.random() * 4);
  const m = 30;
  if (side === 0) return { x: Math.random() * ARENA.w, y: -m };
  if (side === 1) return { x: ARENA.w + m, y: Math.random() * ARENA.h };
  if (side === 2) return { x: Math.random() * ARENA.w, y: ARENA.h + m };
  return { x: -m, y: Math.random() * ARENA.h };
}

const UPGRADES = [
  {
    id: 'damage', name: 'Hotter Forge', icon: 'DMG',
    desc: 'Bullet damage +5. The swarm melts faster.',
    canTake: (u) => u.damage < 30,
    take: (u) => { u.damage += 5; },
  },
  {
    id: 'spread', name: 'Split Barrel', icon: 'SPR',
    desc: 'Fire extra side shots. Twice the starlight.',
    canTake: (u) => u.spread < 3,
    take: (u) => { u.spread += 1; },
  },
  {
    id: 'hull', name: 'Thicker Hull', icon: 'HUL',
    desc: '+25 max hull and repair 40 right now.',
    canTake: () => true,
    take: (u, world) => {
      u.hullBonus += 25;
      world.player.maxHp += 25;
      world.player.hp = Math.min(world.player.maxHp, world.player.hp + 40);
    },
  },
  {
    id: 'engine', name: 'Ion Engine', icon: 'ENG',
    desc: 'Move 10% faster and dash recharges sooner.',
    canTake: (u) => u.engine < 4,
    take: (u) => { u.engine += 1; },
  },
  {
    id: 'magnet', name: 'Core Magnet', icon: 'MAG',
    desc: 'Pickups drift toward you from farther away.',
    canTake: (u) => u.magnet < 3,
    take: (u) => { u.magnet += 1; },
  },
];

function freshUpgrades() {
  return { damage: 10, spread: 1, hullBonus: 0, engine: 0, magnet: 0 };
}

function pickUpgradeCards(upgrades) {
  const pool = UPGRADES.filter((c) => c.canTake(upgrades));
  const cards = [];
  const copy = pool.slice();
  while (cards.length < 3 && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    cards.push(copy.splice(i, 1)[0]);
  }
  while (cards.length < 3) cards.push(UPGRADES[2]); /* hull is always takeable */
  return cards;
}
