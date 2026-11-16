# threejs-fps-001

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Fajargh/threejs-fps-001/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Fajargh/threejs-fps-001/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

RUSTLINE: a round-based tactical FPS in a container yard at dusk. You are Ember, attacking
with two bot teammates against three Slate bots. Plant the charge at site A or B, or wipe
out the defenders. Money between rounds buys rifles, SMGs, a sniper, a shotgun, grenades
and kevlar. First to 5 rounds takes the yard.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. No build step, no network: three.js
0.187.0 is vendored under game/vendor/three/.

## The game

- **Rounds:** freeze/buy phase, 100-second rounds, first to 5 (max 9). Won by elimination,
  by the charge detonating, by the charge being defused, or by the clock.
- **Gunplay:** hitscan weapons with headshot damage, recoil and spread that punish firing
  on the move, crouching and slow-walking for accuracy, collision with the map.
- **Tactics:** a bomb to plant and defuse, money earned each round and spent in a buy menu,
  five weapons and a frag grenade, and bots that follow routes, hold sites, react to
  gunfire, plant and defuse.
- **Map:** an original 36 x 26 m yard with three lanes, two bomb sites, container cover and
  a central silo, lit by a low amber sun against a slate dusk sky.
- **Code:** one module per job, a fixed 60 Hz simulation kept apart from rendering, a
  single state per fighter, no per-frame allocation in the hot loops.

---

<sub>Entered on [make.fun](https://make.fun/?ref=8cvj6bwy&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
