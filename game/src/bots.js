// bots.js — RUSTLINE squad: route/hold/engage/plant/defuse/retreat; BFS nav, LOS, bursts, hearing.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { losClear, collideCircle, MAP } from './map.js';
import { NAV_NODES } from './nav.js';
import { PAL } from './palette.js';

const TAU = Math.PI * 2;
const CONE_COS = 0.643; // cos(50deg)
const EYE_H = 1.45, CHEST_H = 1.1;

function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
function lerpAngle(a, b, t) { return a + angDiff(b, a) * Math.min(1, t); }
function yawFor(dx, dz) { return Math.atan2(-dx, -dz); }

export class Bot {
  constructor(opts = {}) {
    this.name = opts.name || 'Bot';
    this.team = opts.team || 'ember';
    this.skill = opts.skill !== undefined ? opts.skill : 0.7;
    this.role = opts.role || 'support';
    this.weaponId = opts.weaponId || 'vk47';
    this.nav = opts.nav || null;
    this.startNode = opts.startNode !== undefined ? opts.startNode : 0;
    this._nodeOut = { x: 0, y: 0, z: 0 };
    const def = WEAPONS[this.weaponId];
    this.pos = new THREE.Vector3(0, 0, this.team === 'ember' ? 11 : -11);
    const sp = this._nodePos(this.startNode);
    if (sp) this.pos.set(sp.x, 0, sp.z);
    this.yaw = this.team === 'ember' ? 0 : Math.PI;
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.state = 'route';
    this.path = [];
    this.pathIdx = 0;
    this.onArrive = 'hold';
    this.holdT = 0;
    this.reactT = 0;
    this.visibleTarget = null;
    this.burstLeft = 0;
    this.burstT = 0;
    this.cooldown = 0;
    this.fireT = 0;
    this.loadout = { mag: def.mag, reserve: def.reserve };
    this.reloadT = 0;
    this.mesh = null;
    this.speed = 3.4;
    this.aimErr = 0.02 + (1 - this.skill) * 0.05;
    this.reactBase = 0.35 + (1 - this.skill) * 0.35;
    this.hearingR = 28;
    this.planting = false;
    this.defusing = false;
    this.assignedSite = null;
    this.bodyBox = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    this.headBox = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    this._target = { ref: this, team: this.team, alive: true, body: this.bodyBox, head: this.headBox };
    this._eye = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._clamped = { x: 0, z: 0 };
    this._lastKnown = { x: this.pos.x, z: this.pos.z };
    this._tgtPrev = { x: 0, z: 0, t: -1 };
    this._rng = {
      next: () => Math.random(),
      range: (a, b) => a + Math.random() * (b - a),
      gauss: () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.2,
    };
    this.scanT = 0;
    this.losLostT = 0;
    this.strafeT = 0;
    this.strafeDir = 1;
    this._phase = Math.random() * TAU;
    this._holdYaw = this.yaw;
    this._defuseSite = null;
    this._plantT = 0;
    this.hitBoxes();
  }
  buildMesh(scene) {
    const teamColor = this.team === 'ember'
      ? (PAL.ember !== undefined ? PAL.ember : 0xcc7722)
      : (PAL.slate !== undefined ? PAL.slate : 0x2e8b8b);
    const g = new THREE.Group();
    const mk = (w, h, d, c, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    mk(0.7, 1.15, 0.4, teamColor, 0, 0.575, 0);
    mk(0.42, 0.35, 0.42, new THREE.Color(teamColor).multiplyScalar(0.55), 0, 1.375, 0);
    mk(0.08, 0.12, 0.7, 0x222222, 0.25, 1.05, -0.35);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 24),
      new THREE.MeshBasicMaterial({ color: teamColor, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    g.position.set(this.pos.x, 0, this.pos.z);
    g.rotation.y = this.yaw;
    scene.add(g);
    this.mesh = g;
    return g;
  }
  reset(nodeIdx = this.startNode) {
    const p = this._nodePos(nodeIdx);
    if (p) this.pos.set(p.x, 0, p.z);
    this.yaw = this.team === 'ember' ? 0 : Math.PI;
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.state = 'route';
    this.path = [];
    this.pathIdx = 0;
    this.onArrive = 'hold';
    this.holdT = 0;
    this.reactT = 0;
    this.visibleTarget = null;
    this.burstLeft = 0;
    this.burstT = 0;
    this.cooldown = 0;
    this.fireT = 0;
    this.reloadT = 0;
    this.scanT = 0;
    this.losLostT = 0;
    this.strafeT = 0;
    this.planting = false;
    this.defusing = false;
    this.assignedSite = null;
    this._defuseSite = null;
    this._plantT = 0;
    this._holdYaw = this.yaw;
    this._tgtPrev.t = -1;
    this._lastKnown.x = this.pos.x;
    this._lastKnown.z = this.pos.z;
    const def = WEAPONS[this.weaponId];
    this.loadout.mag = def.mag;
    this.loadout.reserve = def.reserve;
    if (this.mesh) {
      this.mesh.visible = true;
      this.mesh.position.set(this.pos.x, 0, this.pos.z);
      this.mesh.rotation.y = this.yaw;
    }
    this.hitBoxes();
  }
  hitBoxes() {
    const x = this.pos.x, z = this.pos.z, b = this.bodyBox, h = this.headBox;
    b.minX = x - 0.35; b.maxX = x + 0.35; b.minY = 0; b.maxY = 1.15; b.minZ = z - 0.35; b.maxZ = z + 0.35;
    h.minX = x - 0.21; h.maxX = x + 0.21; h.minY = 1.2; h.maxY = 1.55; h.minZ = z - 0.21; h.maxZ = z + 0.21;
    this._target.alive = this.alive;
    return this._target;
  }
  damage(amount, head) {
    if (!this.alive) return false;
    let rest = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.5);
      this.armor -= absorbed;
      rest = amount - absorbed;
    }
    this.hp -= rest;
    const wasChannel = this.planting || this.defusing;
    this.planting = false;
    this.defusing = false;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.state = 'dead';
      if (this.mesh) this.mesh.visible = false;
      return true;
    }
    if (wasChannel) this.state = 'engage';
    return false;
  }
  hear(x, z) {
    if (!this.alive) return;
    if (this.state === 'engage' || this.state === 'plant' || this.state === 'defuse') return;
    const dx = x - this.pos.x, dz = z - this.pos.z;
    if (dx * dx + dz * dz > this.hearingR * this.hearingR) return;
    const idx = this._nearestNode(x, z);
    if (idx >= 0) this._routeTo(idx, 'hold');
  }
  assignRound(plan) {
    const site = (plan && plan.site) || 'A';
    this.assignedSite = site;
    this._defuseSite = null;
    this._plantT = 0;
    if (this.team === 'ember') {
      if (this.role === 'carrier' && (!plan || plan.carrier !== false)) {
        this._routeTo(site === 'A' ? 13 : 15, 'plant');
      } else {
        const mids = [7, 10, 11, 14];
        this._routeTo(mids[Math.floor(this._rng.next() * mids.length)], 'hold');
      }
    } else {
      this._routeTo(this.name === 'Sable' ? 13 : this.name === 'Mira' ? 15 : 14, 'hold');
    }
  }
  update(dt, ctx) {
    if (!this.alive) return;
    this._colliders = (ctx && ctx.colliders) || null;
    const rng = (ctx && ctx.rng) || this._rng;
    const def = WEAPONS[this.weaponId];
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const take = Math.min(def.mag - this.loadout.mag, this.loadout.reserve);
        this.loadout.mag += take;
        this.loadout.reserve -= take;
      }
    }
    if (this.cooldown > 0) this.cooldown -= dt;
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 0.15; this._scan(ctx); }
    if (this.visibleTarget && (this.state === 'route' || this.state === 'hold')) {
      this.reactT -= dt;
      if (this.reactT <= 0) { this.state = 'engage'; this.losLostT = 0; }
    }
    if (this.team === 'slate' && ctx.bomb && ctx.bomb.state === 'planted' && this.state !== 'defuse') {
      const sp = ctx.bomb.sitePos ? ctx.bomb.sitePos() : null;
      const t = this.visibleTarget;
      const tFar = !t || !t.pos || !sp || Math.hypot(t.pos.x - sp.x, t.pos.z - sp.z) > 8;
      if (tFar && this._defuseSite !== ctx.bomb.site) {
        this._defuseSite = ctx.bomb.site;
        if (sp) this._routeToPos(sp.x, sp.z, 'defuse');
      }
    } else if (!ctx.bomb || ctx.bomb.state !== 'planted') {
      this._defuseSite = null;
    }
    // Ember bot handed the charge (dropBomb): retake it to the site.
    if (this.team === 'ember' && ctx.bomb && ctx.bomb.carrier === this &&
        ctx.bomb.state === 'carried' && (this.state === 'hold' || this.state === 'route') &&
        this.onArrive !== 'plant') {
      this._routeTo(this.assignedSite === 'B' ? 15 : 13, 'plant');
    }
    switch (this.state) {
      case 'route':
      case 'retreat': {
        const wp = this.path[this.pathIdx];
        if (wp === undefined) { this._arrive(ctx, rng); break; }
        const p = this._nodePos(wp);
        if (!p) { this.pathIdx++; break; }
        if (this.moveToward(p.x, p.z, dt)) {
          this.pathIdx++;
          if (this.pathIdx >= this.path.length) this._arrive(ctx, rng);
        }
        break;
      }
      case 'hold': {
        this.holdT -= dt;
        this.yaw = this._holdYaw + Math.sin((ctx.time || 0) * 0.6 + this._phase) * 0.6;
        if (this.holdT <= 0) this._routeTo(Math.floor(rng.next() * this._nodeCount()), 'hold');
        break;
      }
      case 'engage': {
        const t = this.visibleTarget;
        if (!t || t.alive === false || this.losLostT > 1.2) {
          this.visibleTarget = null;
          this.losLostT = 0;
          this.burstLeft = 0;
          this._routeToPos(this._lastKnown.x, this._lastKnown.z, 'hold');
          break;
        }
        this.yaw = lerpAngle(this.yaw, yawFor(t.pos.x - this.pos.x, t.pos.z - this.pos.z), dt * 10);
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafeT = 0.8 + rng.next() * 0.6;
          this.strafeDir = rng.next() < 0.5 ? -1 : 1;
        }
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
        const c = this._clamp(
          this.pos.x + rx * this.strafeDir * this.speed * 0.4 * dt,
          this.pos.z + rz * this.strafeDir * this.speed * 0.4 * dt);
        this.pos.x = c.x;
        this.pos.z = c.z;
        this._tryFire(dt, ctx, rng, def);
        break;
      }
      case 'plant': {
        this.planting = true;
        this._plantT += dt;
        const b = ctx.bomb;
        if (b && b.state === 'planted') {
          this.planting = false;
          this._routeTo(this.startNode, 'hold'); // retreat to own spawn, 8+ m off
          this.state = 'retreat';
        } else if (b && b.state === 'carried' && this._plantT > 6) {
          this._plantT = 0;
          if (b.startPlant && b.startPlant(this, this.assignedSite) === false) this._toHold();
        } else if (!b || (b.state !== 'planting' && b.state !== 'planted' && b.state !== 'carried')) {
          this._toHold();
        }
        break;
      }
      case 'defuse': {
        this.defusing = true;
        const b = ctx.bomb;
        if (!b || (b.state !== 'planted' && b.state !== 'defusing')) this._toHold();
        else if (b.state === 'planted' && b.startDefuse) b.startDefuse(this);
        break;
      }
    }
    if (this.mesh) {
      this.mesh.position.set(this.pos.x, 0, this.pos.z);
      this.mesh.rotation.y = this.yaw;
    }
    this.hitBoxes();
  }
  _toHold() {
    this.planting = false;
    this.defusing = false;
    this.state = 'hold';
    this.holdT = 3;
    this._holdYaw = this.yaw;
  }
  _gauss(rng) {
    if (rng && typeof rng.gauss === 'function') return rng.gauss();
    return (Math.random() + Math.random() + Math.random() - 1.5) * 1.2;
  }
  _los(ax, az, bx, bz, ctx) {
    if (ctx && typeof ctx.los === 'function') return ctx.los(ax, az, bx, bz);
    const c = ctx && ctx.colliders;
    if (!c) return true;
    try { return losClear(ax, az, bx, bz, c); } catch (e) { return true; }
  }
  _scan(ctx) {
    if (this.state === 'plant' || this.state === 'defuse') return;
    let best = null, bestD = 42 * 42;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const consider = (e) => {
      if (!e || e === this || e.alive === false || !e.pos) return;
      if ((e.team || 'ember') === this.team) return;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d2 = dx * dx + dz * dz;
      if (d2 > bestD || d2 < 0.0001) return;
      const d = Math.sqrt(d2);
      if ((dx * fx + dz * fz) / d < CONE_COS) return;
      if (!this._los(this.pos.x, this.pos.z, e.pos.x, e.pos.z, ctx)) return;
      best = e;
      bestD = d2;
    };
    consider(ctx.player);
    const bots = (ctx && ctx.bots) || [];
    for (let i = 0; i < bots.length; i++) consider(bots[i]);
    if (best) {
      this._lastKnown.x = best.pos.x;
      this._lastKnown.z = best.pos.z;
      if (this.state === 'engage') { this.visibleTarget = best; this.losLostT = 0; }
      else if (this.visibleTarget !== best) { this.visibleTarget = best; this.reactT = this.reactBase; }
    } else if (this.state === 'engage') {
      this.losLostT += 0.15;
    } else if (this.state === 'route' || this.state === 'hold') {
      this.visibleTarget = null;
    }
  }
  _tryFire(dt, ctx, rng, def) {
    const t = this.visibleTarget;
    if (!t || !t.pos || this.reloadT > 0) return;
    if (this.loadout.mag <= 0) { this.reloadT = def.reload; return; }
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, range = def.range || 50;
    if (dx * dx + dz * dz > range * range || this.cooldown > 0) return;
    if (this.burstLeft === 0) { this.burstLeft = 3 + Math.floor(rng.next() * 3); this.burstT = 0; }
    this.burstT -= dt;
    if (this.burstT > 0 || this.burstLeft <= 0) return;
    this.burstT = 0.11;
    this.burstLeft--;
    const eye = this._eye.set(this.pos.x, EYE_H, this.pos.z);
    const dir = this._dir.set(dx, CHEST_H - EYE_H, dz).normalize();
    let extra = 0;
    if (this._tgtPrev.t >= 0 && ctx.time !== undefined) {
      const dtT = ctx.time - this._tgtPrev.t;
      if (dtT > 0.001) {
        const mx = t.pos.x - this._tgtPrev.x, mz = t.pos.z - this._tgtPrev.z;
        if (Math.sqrt(mx * mx + mz * mz) / dtT > 2.5) extra = this.aimErr;
      }
    }
    this._tgtPrev.x = t.pos.x;
    this._tgtPrev.z = t.pos.z;
    this._tgtPrev.t = ctx.time || 0;
    const err = this.aimErr + extra;
    dir.x += this._gauss(rng) * err;
    dir.y += this._gauss(rng) * err;
    dir.z += this._gauss(rng) * err;
    dir.normalize();
    let fired = false;
    if (ctx.fireShot) { ctx.fireShot(this, eye, dir, def); fired = true; }
    if (fired) {
      this.loadout.mag--;
      if (ctx.noise) ctx.noise(this.pos.x, this.pos.z, this);
    }
    if (this.burstLeft === 0) this.cooldown = 0.5 + rng.next() * 0.5;
  }
  _arrive(ctx, rng) {
    if (this.onArrive === 'plant') {
      this.state = 'plant';
      this.planting = true;
      this._plantT = 0;
      const b = ctx.bomb;
      if (b && b.startPlant && b.startPlant(this, this.assignedSite) === false) this._toHold();
    } else if (this.onArrive === 'defuse') {
      this.state = 'defuse';
      this.defusing = true;
      const b = ctx.bomb;
      if (b && b.startDefuse && b.startDefuse(this) === false) this._toHold();
    } else {
      this.state = 'hold';
      this.holdT = 2 + rng.range(0, 3);
      this._holdYaw = this.yaw;
    }
  }
  _routeTo(nodeIdx, onArrive) {
    this._setPath(nodeIdx);
    this.onArrive = onArrive;
    this.state = 'route';
    this.visibleTarget = null;
    this.reactT = 0;
  }
  _routeToPos(x, z, onArrive) {
    const idx = this._nearestNode(x, z);
    if (idx < 0) { this._toHold(); return; }
    this._routeTo(idx, onArrive);
  }
  _setPath(targetIdx) {
    const from = this._nearestNode(this.pos.x, this.pos.z);
    let p = null;
    if (this.nav && typeof this.nav.findPath === 'function') p = this.nav.findPath(from, targetIdx);
    if (!Array.isArray(p) || !p.length) p = [from, targetIdx];
    this.path = p.slice();
    this.pathIdx = 0;
  }
  _nodeCount() {
    if (NAV_NODES) return NAV_NODES.length;
    return 23;
  }
  _nodePos(idx) {
    if (idx < 0 || idx >= this._nodeCount()) return null;
    if (this.nav && typeof this.nav.nodePos === 'function') return this.nav.nodePos(idx, this._nodeOut);
    if (NAV_NODES) return NAV_NODES[idx] || null;
    return null;
  }
  _nearestNode(x, z) {
    if (this.nav && typeof this.nav.nearest === 'function') {
      const r = this.nav.nearest(x, z);
      if (typeof r === 'number') return r;
    }
    let best = -1, bestD = Infinity;
    const n = this._nodeCount();
    for (let i = 0; i < n; i++) {
      const p = this._nodePos(i);
      if (!p) continue;
      const dx = p.x - x, dz = p.z - z, d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  _clamp(x, z) {
    const c = this._clamped;
    c.x = Math.max(MAP.minX + 0.35, Math.min(MAP.maxX - 0.35, x));
    c.z = Math.max(MAP.minZ + 0.35, Math.min(MAP.maxZ - 0.35, z));
    if (this._colliders) {
      try { collideCircle(c, 0.35, this._colliders); } catch (e) { /* no colliders */ }
    }
    return c;
  }
  moveToward(tx, tz, dt) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= 0.4) return true;
    const step = Math.min(this.speed * dt, d);
    const c = this._clamp(this.pos.x + (dx / d) * step, this.pos.z + (dz / d) * step);
    this.pos.x = c.x;
    this.pos.z = c.z;
    this.yaw = lerpAngle(this.yaw, yawFor(dx, dz), Math.min(1, dt * 8));
    const rx = tx - this.pos.x, rz = tz - this.pos.z;
    return Math.sqrt(rx * rx + rz * rz) <= 0.4;
  }
}

export function buildSquads(nav, scene) {
  const defs = [
    { name: 'Vex', team: 'ember', skill: 0.75, role: 'carrier', weaponId: 'vk47', startNode: 1 },
    { name: 'Rook', team: 'ember', skill: 0.65, role: 'support', weaponId: 'vk47', startNode: 2 },
    { name: 'Sable', team: 'slate', skill: 0.8, role: 'defender', weaponId: 'vk47', startNode: 18 },
    { name: 'Mira', team: 'slate', skill: 0.7, role: 'defender', weaponId: 'vk47', startNode: 19 },
    { name: 'Kestrel', team: 'slate', skill: 0.6, role: 'defender', weaponId: 'hornet', startNode: 20 },
  ];
  const ember = [], slate = [];
  for (const d of defs) {
    const bot = new Bot({ name: d.name, team: d.team, skill: d.skill, role: d.role,
      weaponId: d.weaponId, nav, startNode: d.startNode });
    bot.buildMesh(scene);
    if (d.team === 'ember') ember.push(bot);
    else slate.push(bot);
  }
  return { ember, slate };
}
