// main.js — RUSTLINE integrator: renderer, fixed-step loop, combat, rounds,
// buy/plant/defuse flow, screenshot + headless-test drivers. No network.

import * as THREE from 'three';
import { PAL } from './palette.js';
import { Rng } from './rng.js';
import { Input } from './input.js';
import { buildYard, SITES, SPAWNS, losClear, collideCircle, pointInSite } from './map.js';
import { Nav, NAV_NODES, NAV_EDGES } from './nav.js';
import { Player } from './player.js';
import {
  WEAPONS, GRENADE_PRICE, KEVLAR_PRICE, createLoadout,
  buy as buyWeapon, switchWeapon, shootRay, GrenadeSim,
} from './weapons.js';
import { AudioBank } from './audio.js';
import { buildSquads } from './bots.js';
import { Bomb } from './bomb.js';
import { RoundManager, ROUND } from './rounds.js';
import { Hud } from './hud.js';

// ---------- URL params ----------
const params = new URLSearchParams(window.location.search);
const SEED = Number(params.get('seed') || 7) || 7;
const SHOT = params.get('shot'); // start | play | end
const TEST = params.get('test') === 'auto';
const SMART = params.get('smart') === '1';
const TEST_SECS = Math.max(10, Math.min(1200, Number(params.get('secs') || 60) || 60));

// ---------- game state ----------
const G = {
  time: 0,
  rng: new Rng(SEED),
  kills: 0,
  shotsFired: 0,
  shotsHit: 0,
  playerKills: 0,
  playerDeaths: 0,
  distanceMoved: 0,
  siteKey: 'A',
  roundsLog: [],
  errors: [],
};
window.addEventListener('error', (e) => {
  G.errors.push(String((e && e.message) || e));
});
window.__errors = G.errors;

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PAL.fog);
scene.fog = new THREE.FogExp2(PAL.fog, 0.012);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 200);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0x8a7a66, 0x2c2f33, 1.35));
const sun = new THREE.DirectionalLight(0xffb36b, 2.9);
sun.position.set(10, 18, 6);
scene.add(sun);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- world ----------
const { colliders } = buildYard(scene);
const nav = new Nav(NAV_NODES, NAV_EDGES);
const squads = buildSquads(nav, scene);
const emberBots = squads.ember;
const slateBots = squads.slate;
const allBots = [...emberBots, ...slateBots];

const player = new Player(SPAWNS.ember[0]);
const loadout = createLoadout();
const bomb = new Bomb();
const rounds = new RoundManager();
const hud = new Hud();
const audio = new AudioBank();
const grenades = new GrenadeSim();

// Temp vectors (no per-frame allocation in hot loops).
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// ---------- input ----------
const fakeInput = {
  down: () => false,
  hit: () => false,
  look: () => ({ dx: 0, dy: 0 }),
  mouseHeld: () => false,
  mouseHit: () => false,
  locked: true,
  endFrame() {},
};
const input = TEST ? fakeInput : new Input(canvas);
if (!TEST && !SHOT) {
  canvas.addEventListener('click', () => {
    if (!input.locked && !buyOpen) input.requestLock();
  });
}

// ---------- combat state ----------
let fireT = 0;
let reloadT = 0;
let scoped = false;
let buyOpen = false;
let helpOpen = false;
let matchOver = false;
let grenadeThrower = 'player';
const _targets = [];

// One reusable player target for enemy raycasts; boxes updated in place.
const _playerTarget = {
  ref: 'player',
  team: 'ember',
  alive: true,
  body: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
  head: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
};
function syncPlayerTarget() {
  const p = player.pos;
  const b = _playerTarget.body;
  b.minX = p.x - 0.4; b.maxX = p.x + 0.4;
  b.minY = 0; b.maxY = 1.45;
  b.minZ = p.z - 0.4; b.maxZ = p.z + 0.4;
  const h = _playerTarget.head;
  h.minX = p.x - 0.25; h.maxX = p.x + 0.25;
  h.minY = 1.45; h.maxY = 1.75;
  h.minZ = p.z - 0.25; h.maxZ = p.z + 0.25;
  _playerTarget.alive = player.alive;
}

function syncCamera() {
  player.eyePos(_v1);
  camera.position.copy(_v1);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  camera.rotation.z = 0;
}

function noise(x, z, shooterRef) {
  for (const b of allBots) {
    if (b === shooterRef) continue;
    const dx = b.pos.x - x;
    const dz = b.pos.z - z;
    if (dx * dx + dz * dz < 28 * 28) b.hear(x, z);
  }
}

// ---------- damage / kills ----------
function dropBomb() {
  bomb.plantProgress = 0;
  bomb.defuseProgress = 0;
  if (player.alive) {
    bomb.carrier = 'player';
    bomb.state = 'carried';
    hud.feed('Charge secured');
    return;
  }
  let best = null;
  let bestD = Infinity;
  for (const b of emberBots) {
    if (!b.alive) continue;
    const dx = b.pos.x - player.pos.x;
    const dz = b.pos.z - player.pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = b; }
  }
  if (best) {
    bomb.carrier = best;
    bomb.state = 'carried';
    hud.feed(`Charge secured by ${best.name}`);
  }
}

function damageTarget(t, amount, head, shooter, def) {
  const ref = t && t.ref !== undefined ? t.ref : t;
  const wname = def ? def.name
    : shooter && shooter !== 'player' && shooter.weaponId && WEAPONS[shooter.weaponId]
      ? WEAPONS[shooter.weaponId].name : 'P9';
  if (ref === player || ref === 'player') {
    if (!player.alive) return;
    const died = player.damage(amount);
    hud.damageFlash();
    hud.setHealth(player.hp, player.armor);
    if (died) {
      G.playerDeaths++;
      const sname = shooter === 'player' ? 'You' : (shooter && shooter.name ? shooter.name : 'Enemy');
      hud.feed(`${sname} [${wname}] You`, 'bad');
      if (bomb.carrier === 'player') dropBomb();
    }
    return;
  }
  const bot = ref;
  if (!bot || !bot.alive || typeof bot.damage !== 'function') return;
  const died = bot.damage(amount, head);
  if (!died) return;
  if (shooter === 'player') {
    player.addMoney(ROUND.killMoney);
    G.playerKills++;
    G.kills++;
    hud.feed(`You [${wname}] ${bot.name}`, 'good');
    hud.hitmarker(head, true);
    audio.killSnd();
  } else {
    const sname = shooter && shooter.name ? shooter.name : 'Bot';
    hud.feed(`${sname} [${wname}] ${bot.name}`, 'bad');
  }
  if (bomb.carrier === bot) dropBomb();
}

// ---------- shooting ----------
function fireShot(shooter, origin, dir, def, spread) {
  const s = spread !== undefined ? spread : def.spread + ((shooter && shooter.aimErr) || 0);
  const shooterTeam = shooter === 'player' ? 'ember' : (shooter.team || 'ember');
  _targets.length = 0;
  if (shooterTeam !== 'ember' && player.alive) {
    syncPlayerTarget();
    _targets.push(_playerTarget);
  }
  for (const b of allBots) {
    if (!b.alive || b.team === shooterTeam) continue;
    const hb = b.hitBoxes();
    if (hb) _targets.push(hb);
  }
  const hit = shootRay(origin, dir, s, def, _targets, colliders, G.rng);
  if (hit && hit.hit && hit.target) {
    if (shooter === 'player') G.shotsHit++;
    damageTarget(hit.target, def.damage * (hit.head ? def.headMul : 1), hit.head, shooter, def);
    if (shooter === 'player') {
      hud.hitmarker(hit.head, false);
      audio.hitmark(hit.head);
    }
  }
  noise(origin.x, origin.z, shooter);
  return hit;
}

function firePlayer() {
  if (rounds.phase !== 'live' || !player.alive) return false;
  if (fireT > 0 || reloadT > 0) return false;
  const def = WEAPONS[loadout.current];
  const mag = loadout.mag[loadout.current] || 0;
  if (mag <= 0) {
    audio.dry();
    fireT = 0.25;
    return false;
  }
  loadout.mag[loadout.current] = mag - 1;
  fireT = def.interval;
  G.shotsFired++;
  const speed = player.vel ? Math.hypot(player.vel.x, player.vel.z) : 0;
  let spread = def.spread + def.moveSpread * (speed / 4.6) + (player.crouched ? -0.004 : 0);
  if (scoped && def.scopedSpread) spread = def.scopedSpread + def.moveSpread * (speed / 4.6) * 0.5;
  player.eyePos(_v1);
  player.forward(_v2);
  fireShot('player', _v1, _v2, def, spread);
  audio.shot(loadout.current);
  player.pitch += loadout.current === 'longbow' ? 0.012
    : loadout.current === 'mauler' ? 0.01
    : loadout.current === 'vk47' ? 0.004 : 0.003;
  if (player.pitch > 1.45) player.pitch = 1.45;
  return true;
}

function startReload() {
  const def = WEAPONS[loadout.current];
  if (reloadT > 0) return;
  if ((loadout.mag[loadout.current] || 0) >= def.mag) return;
  if ((loadout.reserve[loadout.current] || 0) <= 0) return;
  reloadT = def.reload;
  audio.reloadSnd();
}

function completeReload() {
  const def = WEAPONS[loadout.current];
  const need = def.mag - (loadout.mag[loadout.current] || 0);
  const take = Math.min(need, loadout.reserve[loadout.current] || 0);
  loadout.mag[loadout.current] = (loadout.mag[loadout.current] || 0) + take;
  loadout.reserve[loadout.current] = (loadout.reserve[loadout.current] || 0) - take;
}

function throwGrenade() {
  if (rounds.phase !== 'live' || !player.alive) return;
  if ((loadout.grenades || 0) <= 0) return;
  loadout.grenades--;
  grenadeThrower = 'player';
  player.eyePos(_v3);
  player.forward(_v2);
  grenades.throwGrenade(_v3.clone(), _v2.clone(), 14);
  audio.beep(520);
}

// ---------- buy ----------
function doBuy(id) {
  if (rounds.phase !== 'freeze') return;
  const res = buyWeapon(loadout, id, player.money);
  if (!res || !res.ok) {
    if (res && res.msg) hud.feed(res.msg);
    return;
  }
  player.money -= res.cost;
  if (WEAPONS[id]) {
    if (loadout.mag[id] === undefined) {
      loadout.mag[id] = WEAPONS[id].mag;
      loadout.reserve[id] = WEAPONS[id].reserve;
    }
    switchWeapon(loadout, id);
  }
  if (id === 'kevlar') player.armor = 100;
  if (res.msg) hud.feed(res.msg);
  hud.setMoney(player.money);
  refreshBuyMenu();
}

function refreshBuyMenu() {
  if (buyOpen) hud.showBuy(true, player.money, loadout);
}

function setBuyOpen(open) {
  if (rounds.phase !== 'freeze' && open) return;
  buyOpen = open;
  hud.showBuy(open, player.money, loadout);
  if (open && document.pointerLockElement) document.exitPointerLock();
}

document.querySelectorAll('[data-buy]').forEach((btn) => {
  btn.addEventListener('click', () => doBuy(btn.getAttribute('data-buy')));
});

// ---------- bot context ----------
const botCtx = {
  time: 0,
  player,
  bots: allBots,
  bomb,
  nav,
  colliders,
  rng: G.rng,
  los: (ax, az, bx, bz) => losClear(ax, az, bx, bz, colliders, 1.4),
  fireShot,
  damageTarget,
  noise,
  onEvent: (type, data) => { /* bot events (e.g. botDown) are already fed via damageTarget */ },
};

const bombCtx = {
  player,
  bots: allBots,
  onEvent: bombEvent,
  beep: () => audio.beep(880),
  plantHeld: false,
  defuseHeld: false,
};

function bombEvent(type, data) {
  if (type === 'planted') {
    const site = (data && data.site) || bomb.site || G.siteKey;
    const planter = (data && data.planter) || bomb.planter;
    if (planter === player) player.addMoney(ROUND.plantMoney);
    hud.feed(`Charge planted at Site ${site}`);
    hud.setMoney(player.money);
    audio.beep(660);
  } else if (type === 'exploded') {
    audio.explosion();
    endRound('ember', 'Site detonated');
  } else if (type === 'defused') {
    const defuser = (data && data.defuser) || bomb.defuser;
    if (defuser === player) player.addMoney(ROUND.defuseMoney);
    endRound('slate', 'Charge defused');
  }
}

// ---------- round flow ----------
function assignBotPlans() {
  for (const b of emberBots) {
    b.assignRound({ site: G.siteKey, carrier: b === emberBots[0], attack: true, role: b.role });
  }
  for (const b of slateBots) {
    b.assignRound({ site: G.siteKey, defend: true, role: b.role });
  }
}

function resetRoundEntities() {
  const money = player.money;
  player.reset(SPAWNS.ember[0]);
  player.money = money;
  for (const id of Object.keys(loadout.mag)) {
    if (WEAPONS[id]) loadout.mag[id] = WEAPONS[id].mag;
  }
  fireT = 0;
  reloadT = 0;
  scoped = false;
  emberBots.forEach((b, i) => {
    const sp = SPAWNS.ember[Math.min(i + 1, SPAWNS.ember.length - 1)];
    b.reset(typeof b.startNode === 'number' ? b.startNode : nav.nearest(sp.x, sp.z));
  });
  slateBots.forEach((b, i) => {
    const sp = SPAWNS.slate[Math.min(i, SPAWNS.slate.length - 1)];
    b.reset(typeof b.startNode === 'number' ? b.startNode : nav.nearest(sp.x, sp.z));
  });
  bomb.reset('player');
  G.siteKey = G.rng.pick(['A', 'B']);
  assignBotPlans();
  driver.bought = false;
  driver.path = [];
  driver.pathIdx = 0;
  driver.burst = 0;
  driver.pause = 0;
  driver.plantHeld = false;
  hud.hideEnd();
  hud.center(`ROUND ${rounds.round}`, `Plant the charge at Site ${G.siteKey}`);
  updateHud(true);
}

function startRound() {
  rounds.startRound();
  resetRoundEntities();
}

function startMatch() {
  rounds.score = { ember: 0, slate: 0 };
  rounds.round = 1;
  matchOver = false;
  startRound();
}

function endRound(winner, reason) {
  if (rounds.phase === 'over' || matchOver) return;
  rounds.endRound(winner, reason);
  player.addMoney(winner === 'ember' ? ROUND.winMoney : ROUND.lossMoney);
  G.roundsLog.push({ round: rounds.round, winner, reason });
  audio.sting(winner === 'ember');
  hud.endScreen(winner, reason, rounds.score);
  hud.feed(reason);
  hud.setMoney(player.money);
  updateHud(true);
}

function checkElimination() {
  const emberAlive = player.alive || emberBots.some((b) => b.alive);
  const slateAlive = slateBots.some((b) => b.alive);
  if (!slateAlive) {
    endRound('ember', 'Slate eliminated');
    return;
  }
  if (!emberAlive && bomb.state !== 'planted') {
    endRound('slate', 'Ember eliminated');
  }
}

// ---------- HUD ----------
const _lastHud = {};
function updateHud(force) {
  const def = WEAPONS[loadout.current];
  const vals = {
    hp: Math.ceil(player.hp),
    armor: Math.ceil(player.armor || 0),
    mag: loadout.mag[loadout.current] || 0,
    reserve: loadout.reserve[loadout.current] || 0,
    weapon: def.name,
    timer: Math.ceil(rounds.timeLeft),
    phase: rounds.phase,
    e: rounds.score.ember,
    s: rounds.score.slate,
    money: Math.floor(player.money),
    round: rounds.round,
  };
  if (force || vals.hp !== _lastHud.hp || vals.armor !== _lastHud.armor) {
    hud.setHealth(player.hp, player.armor);
  }
  if (force || vals.mag !== _lastHud.mag || vals.reserve !== _lastHud.reserve || vals.weapon !== _lastHud.weapon) {
    hud.setAmmo(vals.mag, vals.reserve, vals.weapon);
  }
  if (force || vals.timer !== _lastHud.timer || vals.phase !== _lastHud.phase) {
    hud.setTimer(rounds.timeLeft, rounds.phase);
  }
  if (force || vals.e !== _lastHud.e || vals.s !== _lastHud.s) hud.setScore(vals.e, vals.s);
  if (force || vals.money !== _lastHud.money) hud.setMoney(player.money);
  if (force || vals.round !== _lastHud.round) hud.setRound(rounds.round);
  const bs = document.getElementById('bomb-status');
  if (bs) {
    const txt = bomb.state === 'planted' ? `CHARGE PLANTED — ${Math.ceil(bomb.explodeIn)}s`
      : bomb.state === 'planting' ? 'PLANTING…'
      : bomb.state === 'defusing' ? 'DEFUSING…'
      : bomb.carrier === 'player' ? 'YOU CARRY THE CHARGE'
      : '';
    if (txt !== _lastHud.bomb) bs.textContent = txt;
    vals.bomb = txt;
  }
  Object.assign(_lastHud, vals);
}

// ---------- test driver ----------
const driver = {
  bought: false,
  path: [],
  pathIdx: 0,
  burst: 0,
  pause: 0,
  plantHeld: false,
  prevX: 0,
  prevZ: 0,
};

function nearestVisibleEnemy(maxDist) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const b of slateBots) {
    if (!b.alive) continue;
    const dx = b.pos.x - player.pos.x;
    const dz = b.pos.z - player.pos.z;
    const d = dx * dx + dz * dz;
    if (d > bestD) continue;
    if (!losClear(player.pos.x, player.pos.z, b.pos.x, b.pos.z, colliders, 1.4)) continue;
    bestD = d;
    best = b;
  }
  return best;
}

function aimAtChest(bot) {
  const dx = bot.pos.x - player.pos.x;
  const dz = bot.pos.z - player.pos.z;
  const dy = 1.1 - 1.62;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

function movePlayerToward(tx, tz, dt, speed) {
  const dx = tx - player.pos.x;
  const dz = tz - player.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return;
  player.yaw = Math.atan2(-dx, -dz);
  player.pos.x += (dx / d) * speed * dt;
  player.pos.z += (dz / d) * speed * dt;
  player.vel.set((dx / d) * speed, 0, (dz / d) * speed);
  collideCircle(player.pos, player.radius || 0.4, colliders);
}

function followPath(dt) {
  const site = SITES[G.siteKey];
  if (!driver.path.length) {
    const targetNode = nav.nearest(site.x, site.z);
    driver.path = nav.path(nav.nearest(player.pos.x, player.pos.z), targetNode) || [];
    driver.pathIdx = 0;
  }
  if (driver.pathIdx < driver.path.length) {
    const node = { x: 0, y: 0, z: 0 };
    nav.nodePos(driver.path[driver.pathIdx], node);
    const d = Math.hypot(node.x - player.pos.x, node.z - player.pos.z);
    if (d < 0.6) driver.pathIdx++;
    else movePlayerToward(node.x, node.z, dt, 4.6);
  }
}

function drivePlayer(dt) {
  if (rounds.phase === 'freeze') {
    if (SMART && !driver.bought) {
      const res = buyWeapon(loadout, 'vk47', player.money);
      if (res && res.ok) {
        player.money -= res.cost;
        if (loadout.mag.vk47 === undefined) {
          loadout.mag.vk47 = WEAPONS.vk47.mag;
          loadout.reserve.vk47 = WEAPONS.vk47.reserve;
        }
        switchWeapon(loadout, 'vk47');
      }
      driver.bought = true;
    }
    return;
  }
  if (rounds.phase !== 'live' || !player.alive) return;
  const beforeX = player.pos.x;
  const beforeZ = player.pos.z;
  if ((loadout.mag[loadout.current] || 0) === 0 && (loadout.reserve[loadout.current] || 0) > 0) {
    startReload();
  }
  const enemy = nearestVisibleEnemy(45);
  if (SMART) {
    if (enemy) {
      const ed = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.z - player.pos.z);
      // On the final leg to the site with the charge, push in while firing
      // instead of camping outside the site radius.
      const pushing = bomb.carrier === 'player' && driver.path.length > 0 &&
        driver.pathIdx >= driver.path.length - 1;
      aimAtChest(enemy);
      if (ed < 18 && !pushing) {
        // Close: stop, stand still and burst fire (accurate).
        player.vel.set(0, 0, 0);
        if (driver.pause > 0) {
          driver.pause -= dt;
        } else if (driver.burst < 3) {
          if (firePlayer()) driver.burst++;
        } else {
          driver.burst = 0;
          driver.pause = 0.5;
        }
      } else {
        // Far, or pushing to plant: keep advancing while taking single shots.
        followPath(dt);
        firePlayer();
      }
    } else {
      followPath(dt);
    }
  } else if (enemy) {
    aimAtChest(enemy);
    player.vel.set(0, 0, 0);
    firePlayer();
  } else {
    player.yaw = 0;
    player.forward(_v3);
    player.pos.x += _v3.x * 4.6 * dt;
    player.pos.z += _v3.z * 4.6 * dt;
    player.vel.set(_v3.x * 4.6, 0, _v3.z * 4.6);
    collideCircle(player.pos, player.radius || 0.4, colliders);
  }
  G.distanceMoved += Math.hypot(player.pos.x - beforeX, player.pos.z - beforeZ);
}

// ---------- plant / defuse (player) ----------
function siteKeyAtPlayer() {
  if (pointInSite(player.pos.x, player.pos.z, SITES.A)) return 'A';
  if (pointInSite(player.pos.x, player.pos.z, SITES.B)) return 'B';
  return null;
}

function handlePlant(dt) {
  if (rounds.phase !== 'live') return;
  const inSite = siteKeyAtPlayer();
  const eHeld = TEST ? false : input.down('KeyE');
  if (bomb.carrier === 'player' && bomb.state === 'carried' && inSite && eHeld) {
    bomb.startPlant(player, inSite);
  } else if (bomb.state === 'planting' && bomb.planter === player && (!inSite || !eHeld)) {
    bomb.cancelPlant();
  }
}

// ---------- sim step ----------
const STEP = 1 / 60;

function step(dt) {
  // Refresh world matrices + camera before any raycast this step.
  scene.updateMatrixWorld();
  syncCamera();

  const ev = rounds.update(dt);
  if (ev === 'timeout') {
    if (bomb.state !== 'planted') endRound('slate', 'Time expired — site held');
  } else if (ev === 'next') {
    const m = rounds.isMatchOver();
    if (m) {
      matchOver = true;
      hud.endScreen(m === 'draw' ? 'draw' : m, m === 'draw' ? 'Match drawn' : 'Match complete', rounds.score);
      hud.center(m === 'draw' ? 'DRAW' : m === 'ember' ? 'EMBER WINS THE MATCH' : 'SLATE WINS THE MATCH', '');
    } else {
      rounds.nextRound();
      resetRoundEntities();
    }
    return;
  }
  if (matchOver) return;

  if (rounds.phase === 'freeze' && rounds.timeLeft <= 0) {
    rounds.beginLive();
    hud.center('GO — PLANT THE CHARGE', `Site ${G.siteKey}`);
    audio.beep(990);
  }

  // Edge inputs (once per fixed step; endFrame clears them below).
  if (!TEST) {
    if (input.hit('KeyB')) setBuyOpen(!buyOpen);
    if (input.hit('KeyH')) {
      helpOpen = !helpOpen;
      hud.help(helpOpen);
    }
    if (rounds.phase === 'freeze') {
      const buyKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
      const buyIds = ['vk47', 'hornet', 'longbow', 'mauler', 'grenade', 'kevlar'];
      buyKeys.forEach((code, i) => {
        if (input.hit(code)) doBuy(buyIds[i]);
      });
    }
    if (input.hit('KeyR')) startReload();
    if (input.hit('KeyG')) throwGrenade();
  }

  if (rounds.phase === 'live') {
    if (TEST) {
      drivePlayer(dt);
    } else {
      player.update(dt, input, colliders);
      const def = WEAPONS[loadout.current];
      if (input.mouseHeld(0) && (def.auto || input.mouseHit(0))) firePlayer();
    }

    if (fireT > 0) fireT -= dt;
    if (reloadT > 0) {
      reloadT -= dt;
      if (reloadT <= 0) completeReload();
    }

    // Scope (right mouse + zoom weapon).
    const wantScope = !TEST && input.mouseHeld(2) && !!WEAPONS[loadout.current].zoom;
    if (wantScope !== scoped) {
      scoped = wantScope;
      hud.scope(scoped);
    }
    const targetFov = scoped ? 28 : 74;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
      camera.updateProjectionMatrix();
    }

    // Crosshair spread from movement speed.
    const speed = player.vel ? Math.hypot(player.vel.x, player.vel.z) : 0;
    const def = WEAPONS[loadout.current];
    hud.crosshairSpread(6 + def.moveSpread * (speed / 4.6) * 220 + (scoped ? -3 : 0));

    botCtx.time = G.time;
    for (const b of allBots) b.update(dt, botCtx);

    // Smart test driver plants when it reaches the site carrying the charge.
    if (TEST && SMART) {
      const sk = siteKeyAtPlayer();
      if (bomb.carrier === 'player' && bomb.state === 'carried' && sk) {
        bomb.startPlant(player, sk);
      }
      driver.plantHeld = bomb.state === 'planting' && bomb.planter === player;
    }
    bombCtx.plantHeld = TEST ? !!driver.plantHeld : input.down('KeyE');
    bombCtx.defuseHeld = false;
    bomb.update(dt, bombCtx);
    handlePlant(dt);

    const allTargets = [];
    if (player.alive) {
      syncPlayerTarget();
      allTargets.push(_playerTarget);
    }
    for (const b of allBots) {
      if (!b.alive) continue;
      const hb = b.hitBoxes();
      if (hb) allTargets.push(hb);
    }
    grenades.update(dt, colliders, allTargets, (pos) => {
      audio.explosion();
      const px = pos.x !== undefined ? pos.x : pos[0];
      const py = pos.y !== undefined ? pos.y : 1;
      const pz = pos.z !== undefined ? pos.z : pos[2];
      for (const t of allTargets) {
        const ref = t.ref !== undefined ? t.ref : t;
        const cx = ref === 'player' || ref === player ? player.pos.x : (ref.pos ? ref.pos.x : 0);
        const cz = ref === 'player' || ref === player ? player.pos.z : (ref.pos ? ref.pos.z : 0);
        const d = Math.hypot(cx - px, cz - pz);
        if (d < 6) {
          const dmg = Math.round(95 * (1 - d / 6)) + 10;
          damageTarget(t, dmg, false, grenadeThrower, { name: 'Frag' });
        }
      }
    });

    checkElimination();
  }

  updateHud(false);
  G.time += dt;
  if (!TEST) input.endFrame();
}

// ---------- main loop ----------
let lastT = performance.now();
let acc = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.1, (now - lastT) / 1000 || 0);
  lastT = now;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) {
    step(STEP);
    acc -= STEP;
    n++;
  }
  if (acc > STEP * 5) acc = 0;
  renderer.render(scene, camera);
}

// ---------- screenshot staging ----------
function renderTwice() {
  syncCamera();
  scene.updateMatrixWorld();
  renderer.render(scene, camera);
  renderer.render(scene, camera);
}

function runShot(mode) {
  if (mode === 'start') {
    startMatch();
    player.yaw = -0.15;
    player.pitch = 0;
    hud.help(false);
    setBuyOpen(false);
  } else if (mode === 'play') {
    startMatch();
    rounds.beginLive();
    rounds.timeLeft = 70;
    rounds.score.ember = 1;
    player.pos.set(-13, 0, 2);
    player.yaw = 0;
    player.pitch = 0;
    const nodes = [13, 16, 9];
    slateBots.forEach((b, i) => {
      const o = { x: 0, y: 0, z: 0 };
      nav.nodePos(nodes[i % nodes.length], o);
      b.pos.set(o.x, 0, o.z);
      if (b.mesh) b.mesh.position.set(o.x, 0, o.z);
      b.yaw = Math.atan2(-(player.pos.x - o.x), -(player.pos.z - o.z));
    });
    const target = slateBots[0];
    if (target) aimAtChest(target);
    setBuyOpen(false);
    updateHud(true);
  } else if (mode === 'end') {
    startMatch();
    endRound('ember', 'Site A detonated');
    rounds.timeLeft = 0;
    setBuyOpen(false);
    updateHud(true);
  }
  // Hide the transient "ROUND 1" centre banner so staged shots are clean.
  const cm = document.getElementById('center-msg');
  if (cm) cm.style.display = 'none';
  const cs = document.getElementById('center-sub');
  if (cs) cs.style.display = 'none';
  renderTwice();
  window.__shotReady = true;
}

// ---------- test driver ----------
function runTest() {
  startMatch();
  let steps = 0;
  const maxSteps = TEST_SECS * 60;
  while (steps < maxSteps && !matchOver) {
    step(STEP);
    steps++;
  }
  const result = {
    seed: SEED,
    smart: SMART ? 1 : 0,
    steps,
    rounds: G.roundsLog,
    score: { ...rounds.score },
    money: Math.floor(player.money),
    playerKills: G.playerKills,
    playerDeaths: G.playerDeaths,
    shotsFired: G.shotsFired,
    shotsHit: G.shotsHit,
    distanceMoved: Math.round(G.distanceMoved * 10) / 10,
    errors: G.errors,
  };
  window.__testResult = result;
  console.log(`TEST_RESULT ${JSON.stringify(result)}`);
}

// ---------- boot ----------
window.__game = { player, bots: allBots, emberBots, slateBots, rounds, bomb, loadout, G };
startMatch();
if (SHOT) {
  runShot(SHOT);
} else if (TEST) {
  runTest();
} else {
  if (audio.ensure) audio.ensure();
  hud.center('RUSTLINE', 'Click to lock mouse — B to buy — H for controls');
  requestAnimationFrame(animate);
}
