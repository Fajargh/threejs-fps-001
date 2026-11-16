// weapons.js — weapon stats, buy menu logic, hitscan shots, frag grenades.
// Damage falloff is NOT applied here: the caller applies
// def.damage * (dist > def.range * 0.6 ? 0.7 : 1) to a reported hit.

export const WEAPONS = {
  p9: { id: 'p9', name: 'P9', price: 0, damage: 26, headMul: 2.2, mag: 12, reserve: 36, interval: 0.16, auto: false, spread: 0.011, moveSpread: 0.030, reload: 1.1, zoom: false, pellets: 1, range: 70 },
  vk47: { id: 'vk47', name: 'VK-47', price: 2500, damage: 34, headMul: 2.0, mag: 30, reserve: 90, interval: 0.10, auto: true, spread: 0.014, moveSpread: 0.026, reload: 2.2, zoom: false, pellets: 1, range: 80 },
  hornet: { id: 'hornet', name: 'Hornet', price: 1500, damage: 22, headMul: 2.0, mag: 32, reserve: 96, interval: 0.075, auto: true, spread: 0.020, moveSpread: 0.034, reload: 1.8, zoom: false, pellets: 1, range: 60 },
  longbow: { id: 'longbow', name: 'Longbow', price: 3000, damage: 95, headMul: 2.5, mag: 5, reserve: 15, interval: 1.1, auto: false, spread: 0.05, scopedSpread: 0.002, moveSpread: 0.04, reload: 3.0, zoom: true, pellets: 1, range: 120 },
  mauler: { id: 'mauler', name: 'Mauler', price: 1200, damage: 12, headMul: 1.8, mag: 6, reserve: 18, interval: 0.9, auto: false, spread: 0.05, moveSpread: 0.05, reload: 2.6, zoom: false, pellets: 8, range: 30 },
};

export const GRENADE_PRICE = 300;
export const KEVLAR_PRICE = 650;
const MAX_GRENADES = 2;
const MAX_LIVE_GRENADES = 8;

export function createLoadout() {
  return { current: 'p9', mag: { p9: 12 }, reserve: { p9: 36 }, grenades: 0, kevlar: false };
}

function owned(loadout, id) {
  return loadout.mag[id] !== undefined;
}

// Buy a weapon, a grenade, or kevlar. The caller subtracts the returned
// cost from the player's money (and sets armor = 100 for kevlar).
// Returns { ok, cost, msg }.
export function buy(loadout, id, money) {
  if (id === 'grenade') {
    if (loadout.grenades >= MAX_GRENADES) return { ok: false, cost: 0, msg: 'max grenades carried' };
    if (money < GRENADE_PRICE) return { ok: false, cost: 0, msg: 'not enough money' };
    loadout.grenades += 1;
    return { ok: true, cost: GRENADE_PRICE, msg: 'bought grenade' };
  }
  if (id === 'kevlar') {
    if (loadout.kevlar) return { ok: false, cost: 0, msg: 'already owned' };
    if (money < KEVLAR_PRICE) return { ok: false, cost: 0, msg: 'not enough money' };
    loadout.kevlar = true;
    return { ok: true, cost: KEVLAR_PRICE, msg: 'bought kevlar' };
  }
  const def = WEAPONS[id];
  if (!def) return { ok: false, cost: 0, msg: 'unknown item' };
  if (owned(loadout, id)) return { ok: false, cost: 0, msg: 'already owned' };
  if (money < def.price) return { ok: false, cost: 0, msg: 'not enough money' };
  loadout.mag[id] = def.mag;
  loadout.reserve[id] = def.reserve;
  loadout.current = id;
  return { ok: true, cost: def.price, msg: 'bought ' + def.name };
}

export function switchWeapon(loadout, id) {
  if (!owned(loadout, id)) return false;
  loadout.current = id;
  return true;
}

// Slab test against an axis-aligned box. Returns the smallest positive t
// (in units of dir length; dir need not be normalized), or -1 on a miss.
// An origin inside the box returns the exit t.
export function rayBox(ox, oy, oz, dx, dy, dz, box) {
  let tMin = -Infinity;
  let tMax = Infinity;
  const axes = [
    [ox, dx, box.minX, box.maxX],
    [oy, dy, box.minY, box.maxY],
    [oz, dz, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return -1;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return -1;
    }
  }
  if (tMax < 0) return -1;
  return tMin > 0 ? tMin : tMax;
}

function gaussish(rng) {
  if (!rng) return Math.random() + Math.random() - 1;
  if (typeof rng.gauss === 'function') return rng.gauss();
  return rng.next() + rng.next() - 1;
}

function normalize3(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

// Hitscan shot. origin/dir are {x,y,z} (plain or THREE.Vector3).
// targets: [{ ref, team, alive, body: box, head: box }], skipped when !alive.
// Returns the closest hit across all pellets:
// { hit, target: ref|null, head, dist, point:{x,y,z} }.
// hit is true only when the closest hit is a target; a wall hit reports
// hit:false with the wall distance/point. No hit at all reports dist
// Infinity and a point at def.range along the unjittered direction.
export function shootRay(origin, dir, spread, def, targets, colliders, rng) {
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const [dx0, dy0, dz0] = normalize3(dir.x, dir.y, dir.z);
  let best = null; // { t, dir:[x,y,z], isTarget, head, ref }

  for (let p = 0; p < def.pellets; p++) {
    // Jitter the direction by spread around two axes perpendicular to it.
    let dx = dx0, dy = dy0, dz = dz0;
    if (spread > 0) {
      const up = Math.abs(dy0) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let rx = dy0 * up[2] - dz0 * up[1];
      let ry = dz0 * up[0] - dx0 * up[2];
      let rz = dx0 * up[1] - dy0 * up[0];
      [rx, ry, rz] = normalize3(rx, ry, rz);
      const ux = ry * dz0 - rz * dy0;
      const uy = rz * dx0 - rx * dz0;
      const uz = rx * dy0 - ry * dx0;
      const gx = gaussish(rng) * spread;
      const gy = gaussish(rng) * spread;
      [dx, dy, dz] = normalize3(dx0 + rx * gx + ux * gy, dy0 + ry * gx + uy * gy, dz0 + rz * gx + uz * gy);
    }

    // Nearest wall hit for this pellet.
    let t = Infinity;
    let isTarget = false;
    let head = false;
    let ref = null;
    if (colliders) {
      for (const box of colliders) {
        const tw = rayBox(ox, oy, oz, dx, dy, dz, box);
        if (tw >= 0 && tw < t) { t = tw; isTarget = false; head = false; ref = null; }
      }
    }
    if (targets) {
      for (const tgt of targets) {
        if (!tgt.alive) continue;
        if (tgt.head) {
          const th = rayBox(ox, oy, oz, dx, dy, dz, tgt.head);
          if (th >= 0 && th < t) { t = th; isTarget = true; head = true; ref = tgt.ref; }
        }
        if (tgt.body) {
          const tb = rayBox(ox, oy, oz, dx, dy, dz, tgt.body);
          if (tb >= 0 && tb < t) { t = tb; isTarget = true; head = false; ref = tgt.ref; }
        }
      }
    }
    if (t !== Infinity && (!best || t < best.t)) {
      best = { t, dir: [dx, dy, dz], isTarget, head, ref };
    }
  }

  if (!best) {
    return {
      hit: false, target: null, head: false, dist: Infinity,
      point: { x: ox + dx0 * def.range, y: oy + dy0 * def.range, z: oz + dz0 * def.range },
    };
  }
  return {
    hit: best.isTarget,
    target: best.isTarget ? best.ref : null,
    head: best.head,
    dist: best.t,
    point: { x: ox + best.dir[0] * best.t, y: oy + best.dir[1] * best.t, z: oz + best.dir[2] * best.t },
  };
}

// Frag grenade: 2 s fuse, gravity, simple bounces, radial falloff damage.
export class GrenadeSim {
  constructor() {
    this.list = [];
  }

  // pos/dir are Vector3-like. Returns false when the 8-grenade cap is hit.
  throwGrenade(pos, dir, speed = 14) {
    if (this.list.length >= MAX_LIVE_GRENADES) return false;
    const [dx, dy, dz] = normalize3(dir.x, dir.y, dir.z);
    this.list.push({
      pos: { x: pos.x, y: pos.y, z: pos.z },
      vel: { x: dx * speed, y: dy * speed, z: dz * speed },
      fuse: 2.0,
    });
    return true;
  }

  // targets use the same shape as shootRay; onExplode(pos, hits) is called
  // with hits = [{ target: ref, amount }]. Damage: 110 at centre, 20 at
  // the 6 m edge, linear in between, measured to the body-box centre.
  update(dt, colliders, targets, onExplode) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      g.fuse -= dt;
      g.vel.y -= 18 * dt;
      g.pos.x += g.vel.x * dt;
      g.pos.y += g.vel.y * dt;
      g.pos.z += g.vel.z * dt;

      // Ground bounce at y = 0, vertical speed dampened to 0.4.
      if (g.pos.y < 0) {
        g.pos.y = 0;
        g.vel.y = -g.vel.y * 0.4;
        if (Math.abs(g.vel.y) < 0.5) g.vel.y = 0;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }

      // Collider bounce: inside an XZ footprint below the top, push out
      // horizontally along the shallowest side and dampen that component.
      if (colliders) {
        for (const box of colliders) {
          if (g.pos.y >= box.maxY) continue;
          if (g.pos.x < box.minX || g.pos.x > box.maxX) continue;
          if (g.pos.z < box.minZ || g.pos.z > box.maxZ) continue;
          const pushL = g.pos.x - box.minX;
          const pushR = box.maxX - g.pos.x;
          const pushB = g.pos.z - box.minZ;
          const pushF = box.maxZ - g.pos.z;
          const min = Math.min(pushL, pushR, pushB, pushF);
          if (min === pushL) { g.pos.x = box.minX; g.vel.x = -Math.abs(g.vel.x) * 0.4; }
          else if (min === pushR) { g.pos.x = box.maxX; g.vel.x = Math.abs(g.vel.x) * 0.4; }
          else if (min === pushB) { g.pos.z = box.minZ; g.vel.z = -Math.abs(g.vel.z) * 0.4; }
          else { g.pos.z = box.maxZ; g.vel.z = Math.abs(g.vel.z) * 0.4; }
        }
      }

      if (g.fuse > 0) continue;
      // Explode.
      const hits = [];
      if (targets) {
        for (const tgt of targets) {
          if (!tgt.alive || !tgt.body) continue;
          const b = tgt.body;
          const cx = (b.minX + b.maxX) / 2;
          const cy = (b.minY + b.maxY) / 2;
          const cz = (b.minZ + b.maxZ) / 2;
          const dist = Math.hypot(cx - g.pos.x, cy - g.pos.y, cz - g.pos.z);
          if (dist > 6) continue;
          const amount = 110 - (110 - 20) * (dist / 6);
          hits.push({ target: tgt.ref !== undefined ? tgt.ref : tgt, amount });
        }
      }
      this.list.splice(i, 1);
      if (typeof onExplode === 'function') {
        onExplode({ x: g.pos.x, y: g.pos.y, z: g.pos.z }, hits);
      }
    }
  }
}
