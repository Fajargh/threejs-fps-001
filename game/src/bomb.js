// bomb.js — carried -> planting (4s) -> planted (35s) -> exploded; defusing (5s) -> defused.
import { SITES, pointInSite } from './map.js';

function siteDef(key) {
  if (!SITES) return null;
  const s = SITES[key];
  return s ? { x: s.x, z: s.z, r: s.r || 3 } : null;
}

function inSite(x, z, key) {
  const s = siteDef(key);
  if (!s) return false;
  try {
    const r = pointInSite(x, z, s);
    if (typeof r === 'boolean') return r;
  } catch (e) { /* fall through to geometry */ }
  const dx = x - s.x, dz = z - s.z;
  return dx * dx + dz * dz <= s.r * s.r;
}

export class Bomb {
  constructor() {
    this.state = 'idle';
    this.carrier = null;
    this.site = null;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.explodeIn = 35;
    this.planter = null;
    this.defuser = null;
    this.mesh = null;
    this._lastBeep = 35;
  }

  reset(carrier) {
    this.state = 'carried';
    this.carrier = carrier;
    this.site = null;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.explodeIn = 35;
    this.planter = null;
    this.defuser = null;
    this._lastBeep = 35;
    if (this.mesh) this.mesh.visible = false;
  }

  startPlant(actor, siteKey) {
    // carrier is the string 'player'; the actor is the player object
    // (no weaponId). Bots always carry a weaponId, so they can't pass.
    const isPlayer = actor && typeof actor === 'object' && actor.weaponId === undefined;
    if (this.state === 'carried' &&
        (this.carrier === actor || (this.carrier === 'player' && isPlayer))) {
      this.state = 'planting';
      this.planter = actor;
      this.site = siteKey;
      this.plantProgress = 0;
      return true;
    }
    return false;
  }

  cancelPlant() {
    if (this.state === 'planting') {
      this.state = 'carried';
      this.planter = null;
      this.plantProgress = 0;
    }
  }

  startDefuse(actor) {
    if (this.state === 'planted') {
      this.state = 'defusing';
      this.defuser = actor;
      this.defuseProgress = 0;
      return true;
    }
    return false;
  }

  cancelDefuse() {
    if (this.state === 'defusing') {
      this.state = 'planted';
      this.defuser = null;
      this.defuseProgress = 0;
    }
  }

  update(dt, ctx) {
    if (this.state === 'planting') {
      const a = this.planter === 'player' ? ctx.player : this.planter;
      const p = a && (a.pos || a.position);
      const isPlayer = this.planter === 'player' || a === ctx.player;
      const held = isPlayer ? !!ctx.plantHeld : !!(a && a.planting);
      const ok = a && a.alive !== false && this.site && p &&
        inSite(p.x, p.z, this.site) && held;
      if (!ok) {
        this.cancelPlant();
        if (ctx.onEvent) ctx.onEvent('plantInterrupted');
        return;
      }
      this.plantProgress += dt / 4;
      if (this.plantProgress >= 1) {
        this.plantProgress = 1;
        this.state = 'planted';
        this.explodeIn = 35;
        this._lastBeep = 35;
        if (a && !isPlayer) a.planting = false;
        const s = siteDef(this.site);
        if (this.mesh && s) {
          this.mesh.position.set(s.x, 0.15, s.z);
          this.mesh.visible = true;
        }
        if (ctx.onEvent) ctx.onEvent('planted', { site: this.site, planter: this.planter });
        this.planter = null;
      }
      return;
    }
    if (this.state === 'planted') {
      this.explodeIn -= dt;
      const gap = this.explodeIn <= 5 ? 0.5 : 1;
      if (this.explodeIn <= 10 && this._lastBeep - this.explodeIn >= gap) {
        this._lastBeep = this.explodeIn;
        if (ctx.beep) ctx.beep();
      }
      if (this.explodeIn <= 0) {
        this.explodeIn = 0;
        this.state = 'exploded';
        if (this.mesh) this.mesh.visible = false;
        if (ctx.onEvent) ctx.onEvent('exploded');
      }
      return;
    }
    if (this.state === 'defusing') {
      const a = this.defuser === 'player' ? ctx.player : this.defuser;
      const p = a && (a.pos || a.position);
      const isPlayer = this.defuser === 'player' || a === ctx.player;
      const held = isPlayer ? !!ctx.defuseHeld : !!(a && a.defusing);
      const ok = a && a.alive !== false && this.site && p &&
        inSite(p.x, p.z, this.site) && held;
      if (!ok) {
        this.cancelDefuse();
        if (ctx.onEvent) ctx.onEvent('defuseInterrupted');
        return;
      }
      this.defuseProgress += dt / 5;
      if (this.defuseProgress >= 1) {
        this.defuseProgress = 1;
        this.state = 'defused';
        if (a && !isPlayer) a.defusing = false;
        if (this.mesh) this.mesh.visible = false;
        if (ctx.onEvent) ctx.onEvent('defused', { defuser: this.defuser });
        this.defuser = null;
      }
    }
  }

  sitePos() {
    if (!this.site) return null;
    const s = siteDef(this.site);
    return s ? { x: s.x, z: s.z } : null;
  }
}
