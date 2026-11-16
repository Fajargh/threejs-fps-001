// player.js — first-person player: movement, look, collision, health.
// Yaw convention: forward = (-sin(yaw), 0, -cos(yaw)); yaw 0 faces -z (north).

import * as THREE from 'three';
import { collideCircle, MAP } from './map.js';

const PITCH_LIMIT = 1.5;
const LOOK_SENS = 0.0022;
const ACCEL = 42;
const FRICTION = 8;
const WALK_SPEED = 4.6;
const SLOW_SPEED = 2.5; // ShiftLeft slow-walk
const CROUCH_SPEED = 2.7;

// Map bounds, tolerating the few shapes map.js might export; falls back to
// the 36x26 m yard when a field is missing.
function bounds() {
  if (MAP) {
    if (typeof MAP.minX === 'number') {
      return { minX: MAP.minX, maxX: MAP.maxX, minZ: MAP.minZ, maxZ: MAP.maxZ };
    }
    if (MAP.bounds) {
      const b = MAP.bounds;
      return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
    }
    if (typeof MAP.halfX === 'number') {
      return { minX: -MAP.halfX, maxX: MAP.halfX, minZ: -MAP.halfZ, maxZ: MAP.halfZ };
    }
  }
  return { minX: -18, maxX: 18, minZ: -13, maxZ: 13 };
}

export class Player {
  // spawn = { x, z, yaw }
  constructor(spawn) {
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.yaw = spawn.yaw || 0;
    this.pitch = 0;
    this.vel = new THREE.Vector3(0, 0, 0);
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.money = 800;
    this.crouched = false;
    this.radius = 0.4;
    this._crouchToggle = false;
  }

  eyeHeight() {
    return this.crouched ? 1.05 : 1.62;
  }

  // Reuses out (THREE.Vector3); no allocation.
  eyePos(out) {
    out.set(this.pos.x, this.pos.y + this.eyeHeight(), this.pos.z);
    return out;
  }

  // Forward incl. pitch; reuses out, no allocation.
  forward(out) {
    const cp = Math.cos(this.pitch);
    out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    return out;
  }

  reset(spawn) {
    this.pos.set(spawn.x, 0, spawn.z);
    this.yaw = spawn.yaw || 0;
    this.pitch = 0;
    this.vel.set(0, 0, 0);
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.crouched = false;
    this._crouchToggle = false;
  }

  update(dt, input, colliders) {
    if (!this.alive || dt <= 0) return;

    // Mouse look (input.look() already returns 0 when pointer is unlocked).
    const look = input.look ? input.look() : null;
    if (look) {
      const dx = look.dx !== undefined ? look.dx : (look.x || 0);
      const dy = look.dy !== undefined ? look.dy : (look.y || 0);
      this.yaw -= dx * LOOK_SENS;
      this.pitch -= dy * LOOK_SENS;
      if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
      if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
    }

    // Crouch: hold ControlLeft, or toggle with KeyC.
    if (input.hit && input.hit('KeyC')) this._crouchToggle = !this._crouchToggle;
    this.crouched = (input.down && input.down('ControlLeft')) || this._crouchToggle;

    // WASD relative to yaw. Forward (-sin, -cos), right (cos, -sin) in xz.
    const down = (code) => input.down ? input.down(code) : false;
    const fwd = (down('KeyW') ? 1 : 0) - (down('KeyS') ? 1 : 0);
    const strafe = (down('KeyD') ? 1 : 0) - (down('KeyA') ? 1 : 0);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    let mx = -sy * fwd + cy * strafe;
    let mz = -cy * fwd - sy * strafe;

    const maxSpeed = this.crouched ? CROUCH_SPEED
      : (down('ShiftLeft') ? SLOW_SPEED : WALK_SPEED);

    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz);
      mx /= len;
      mz /= len;
      this.vel.x += mx * ACCEL * dt;
      this.vel.z += mz * ACCEL * dt;
      // Cap horizontal speed.
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        this.vel.x *= scale;
        this.vel.z *= scale;
      }
    } else {
      // No input: exponential friction, no snap stop.
      const damp = Math.exp(-FRICTION * dt);
      this.vel.x *= damp;
      this.vel.z *= damp;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // Clamp inside the yard (radius margin so the body stays in bounds).
    const b = bounds();
    const r = this.radius;
    if (this.pos.x < b.minX + r) this.pos.x = b.minX + r;
    if (this.pos.x > b.maxX - r) this.pos.x = b.maxX - r;
    if (this.pos.z < b.minZ + r) this.pos.z = b.minZ + r;
    if (this.pos.z > b.maxZ - r) this.pos.z = b.maxZ - r;

    if (colliders) collideCircle(this.pos, this.radius, colliders);
  }

  // Armor absorbs half the damage while any armor remains; the absorbed
  // amount comes off armor first (capped at the armor left). Returns true
  // when this damage kills the player.
  damage(amount) {
    if (!this.alive || amount <= 0) return false;
    let rest = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(amount * 0.5, this.armor);
      this.armor -= absorbed;
      rest = amount - absorbed;
    }
    this.hp -= rest;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return true;
    }
    return false;
  }

  addMoney(n) {
    this.money += n;
  }
}
