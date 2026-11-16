// Container yard map — 36 x 26 m, dusk. A west, B east, silo mid.
// Colliders are XZ AABBs {minX,minY,minZ,maxX,maxY,maxZ}; y is height.
import * as THREE from 'three';
import { PAL, mat } from './palette.js';

export const MAP = { minX: -18, maxX: 18, minZ: -13, maxZ: 13 };

export const SITES = {
  A: { x: -13.5, z: -8, r: 3 },
  B: { x: 13.5, z: -8, r: 3 },
};

// yaw 0 faces -z (north, toward the defenders); yaw PI faces +z (south).
export const SPAWNS = {
  ember: [
    { x: 0, z: 11, yaw: 0 },
    { x: -6, z: 11, yaw: 0 },
    { x: 6, z: 11, yaw: 0 },
  ],
  slate: [
    { x: -6, z: -11, yaw: Math.PI },
    { x: 0, z: -11, yaw: Math.PI },
    { x: 6, z: -11, yaw: Math.PI },
  ],
};

// Obstacles: x/z = centre, w = extent along x, d = extent along z, h = height.
export const OBSTACLES = [
  { x: 0, z: 0, w: 4.6, d: 4.6, h: 5, kind: 'silo' },
  { x: -9.25, z: -6, w: 5.5, d: 2.4, h: 2.6, kind: 'container' },
  { x: -9, z: 6, w: 6, d: 2.4, h: 2.6, kind: 'container' },
  { x: 9.25, z: -6, w: 5.5, d: 2.4, h: 2.6, kind: 'container' },
  { x: 9, z: 6, w: 6, d: 2.4, h: 2.6, kind: 'container' },
  { x: -3.5, z: 0, w: 2, d: 2, h: 1.2, kind: 'crate' },
  { x: 3.5, z: 0, w: 2, d: 2, h: 1.2, kind: 'crate' },
  { x: -15.5, z: 0, w: 3, d: 2.4, h: 2.6, kind: 'container' },
  { x: 15.5, z: 0, w: 3, d: 2.4, h: 2.6, kind: 'container' },
  { x: -13, z: -11.6, w: 2, d: 2, h: 1.2, kind: 'crate' },
  { x: 13, z: -11.6, w: 2, d: 2, h: 1.2, kind: 'crate' },
  { x: -8, z: 9, w: 2, d: 2, h: 1.2, kind: 'crate' },
  { x: 8, z: 9, w: 2, d: 2, h: 1.2, kind: 'crate' },
  { x: -15, z: -5.5, w: 2, d: 2, h: 1.2, kind: 'crate' },
  { x: 15, z: -5.5, w: 2, d: 2, h: 1.2, kind: 'crate' },
];

const WALL_T = 0.6; // perimeter wall thickness
const WALL_H = 3.2; // perimeter wall height

function aabb(cx, cz, w, d, h) {
  return {
    minX: cx - w / 2, maxX: cx + w / 2,
    minZ: cz - d / 2, maxZ: cz + d / 2,
    minY: 0, maxY: h,
  };
}

// Letter decal texture for a site ('A' amber, 'B' teal).
function letterTexture(letter, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.font = 'bold 92px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export function buildYard(scene) {
  const colliders = [];
  const siteMeshes = [];
  const M = {
    ground: mat(PAL.asphalt, 1.0),
    apron: mat(PAL.concreteDark, 1.0),
    wall: mat(PAL.concreteDark, 0.95),
    wallTop: mat(PAL.hazard, 0.8),
    silo: mat(PAL.concrete, 0.7, 0.25),
    siloBand: mat(PAL.rust, 0.8),
    rust: mat(PAL.rust, 0.85, 0.15),
    emberBox: mat(PAL.emberDeep, 0.85, 0.15),
    slateBox: mat(PAL.slateDeep, 0.85, 0.15),
    wood: mat(PAL.wood, 0.95),
    pole: mat(PAL.black, 0.6, 0.4),
    lamp: new THREE.MeshBasicMaterial({ color: PAL.sun }),
  };
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const addBox = (material, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(boxGeo, material);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };

  // Ground: playfield plus a darker apron skirt around it.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(36, 26), M.ground);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(44, 34), M.apron);
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  scene.add(apron);
  // Faint centre line + yard markings (thin flat boxes, no extra textures).
  addBox(M.wallTop, 36, 0.02, 0.12, 0, 0.01, 0);
  addBox(M.wallTop, 0.12, 0.02, 26, 0, 0.01, 0);

  // Perimeter walls (visual + collider). Wall centres sit half a thickness
  // outside the playfield so the inner face lands exactly on the boundary.
  const walls = [
    { w: 36 + WALL_T * 2, d: WALL_T, x: 0, z: MAP.minZ - WALL_T / 2 },
    { w: 36 + WALL_T * 2, d: WALL_T, x: 0, z: MAP.maxZ + WALL_T / 2 },
    { w: WALL_T, d: 26, x: MAP.minX - WALL_T / 2, z: 0 },
    { w: WALL_T, d: 26, x: MAP.maxX + WALL_T / 2, z: 0 },
  ];
  for (const wl of walls) {
    addBox(M.wall, wl.w, WALL_H, wl.d, wl.x, WALL_H / 2, wl.z);
    addBox(M.wallTop, wl.w, 0.12, wl.d, wl.x, WALL_H + 0.06, wl.z);
    colliders.push(aabb(wl.x, wl.z, wl.w, wl.d, WALL_H));
  }

  // Obstacles: visuals + colliders (silo as AABB [-2.3, 2.3]^2, height 5).
  const contMats = [M.rust, M.emberBox, M.slateBox];
  let ci = 0;
  for (const o of OBSTACLES) {
    if (o.kind === 'silo') {
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 5, 24), M.silo);
      silo.position.set(o.x, 2.5, o.z);
      scene.add(silo);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(2.24, 2.24, 0.5, 24), M.siloBand);
      band.position.set(o.x, 4.2, o.z);
      scene.add(band);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.1, 24), M.siloBand);
      cap.position.set(o.x, 5.55, o.z);
      scene.add(cap);
      colliders.push({ minX: -2.3, maxX: 2.3, minZ: -2.3, maxZ: 2.3, minY: 0, maxY: 5 });
    } else if (o.kind === 'container') {
      addBox(contMats[ci++ % contMats.length], o.w, o.h, o.d, o.x, o.h / 2, o.z);
      // Corrugation hint: a slightly darker lid strip on top.
      addBox(M.wall, o.w * 0.96, 0.08, o.d * 0.96, o.x, o.h + 0.04, o.z);
      colliders.push(aabb(o.x, o.z, o.w, o.d, o.h));
    } else {
      addBox(M.wood, o.w, o.h, o.d, o.x, o.h / 2, o.z);
      colliders.push(aabb(o.x, o.z, o.w, o.d, o.h));
    }
  }

  // Site decals: flat coloured ring + letter on the ground.
  const ringGeo = new THREE.RingGeometry(2.7, 3, 40);
  const discGeo = new THREE.CircleGeometry(2.7, 40);
  const letterGeo = new THREE.PlaneGeometry(3.4, 3.4);
  for (const [name, site] of Object.entries(SITES)) {
    const team = name === 'A' ? PAL.ember : PAL.slate;
    const disc = new THREE.Mesh(
      discGeo,
      new THREE.MeshBasicMaterial({ color: team, transparent: true, opacity: 0.16 }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(site.x, 0.02, site.z);
    scene.add(disc);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: team, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    scene.add(ring);
    const letter = new THREE.Mesh(
      letterGeo,
      new THREE.MeshBasicMaterial({
        map: letterTexture(name, name === 'A' ? '#ff9a3c' : '#37b6ab'),
        transparent: true, opacity: 0.9, depthWrite: false,
      }),
    );
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(site.x, 0.04, site.z);
    scene.add(letter);
    siteMeshes.push(disc, ring, letter);
  }

  // Dusk light poles at the four yard corners (emissive heads; the scene's
  // hemisphere + sun lights in main.js do the actual illumination).
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8);
  const headGeo = new THREE.SphereGeometry(0.28, 12, 8);
  for (const [px, pz] of [[-17, -12], [17, -12], [-17, 12], [17, 12]]) {
    const pole = new THREE.Mesh(poleGeo, M.pole);
    pole.position.set(px, 2.7, pz);
    scene.add(pole);
    const head = new THREE.Mesh(headGeo, M.lamp);
    head.position.set(px, 5.5, pz);
    scene.add(head);
  }

  return { colliders, siteMeshes };
}

// 2D segment-vs-AABB slab test in XZ. A collider blocks only if its top is
// above the sight height. Pure math, no allocation.
export function losClear(ax, az, bx, bz, colliders, height = 1.4) {
  const dx = bx - ax;
  const dz = bz - az;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.maxY <= height) continue;
    let t0 = 0;
    let t1 = 1;
    // X slab.
    if (dx === 0) {
      if (ax < c.minX || ax > c.maxX) continue;
    } else {
      let ta = (c.minX - ax) / dx;
      let tb = (c.maxX - ax) / dx;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    // Z slab.
    if (dz === 0) {
      if (az < c.minZ || az > c.maxZ) continue;
    } else {
      let ta = (c.minZ - az) / dz;
      let tb = (c.maxZ - az) / dz;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    return false; // segment crosses this blocker
  }
  return true;
}

// Push a feet-positioned circle out of overlapping colliders (XZ only,
// colliders with maxY > 0.3). Resolves per axis — X first, then Z with the
// updated X — so sliding along a wall works. Returns true if any push happened.
export function collideCircle(pos, radius, colliders) {
  let pushed = false;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.maxY <= 0.3) continue;
    // X pass: only when the circle overlaps the collider's Z span.
    if (pos.z > c.minZ - radius && pos.z < c.maxZ + radius &&
        pos.x > c.minX - radius && pos.x < c.maxX + radius) {
      const dl = pos.x - (c.minX - radius);
      const dr = (c.maxX + radius) - pos.x;
      pos.x = dl < dr ? c.minX - radius : c.maxX + radius;
      pushed = true;
    }
    // Z pass, re-checked with the resolved X.
    if (pos.x > c.minX - radius && pos.x < c.maxX + radius &&
        pos.z > c.minZ - radius && pos.z < c.maxZ + radius) {
      const dn = pos.z - (c.minZ - radius);
      const df = (c.maxZ + radius) - pos.z;
      pos.z = dn < df ? c.minZ - radius : c.maxZ + radius;
      pushed = true;
    }
  }
  return pushed;
}

export function pointInSite(x, z, site) {
  const dx = x - site.x;
  const dz = z - site.z;
  return dx * dx + dz * dz <= site.r * site.r;
}
