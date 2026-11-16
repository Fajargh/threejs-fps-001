// Deterministic RNG — mulberry32, no dependencies.
// Used for map dressing, bot jitter and screenshot-mode seeds so a given
// seed always replays the same round.

export class Rng {
  constructor(seed = 1) {
    // Force to uint32; mulberry32 needs a non-zero state.
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  // Next float in [0, 1).
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + this.next() * (b - a);
  }

  // Inclusive both ends.
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  // Approx standard normal via the average of 6 uniforms (mean 0, ~unit var).
  gauss() {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += this.next();
    return sum - 3;
  }
}

// FNV-1a-ish string hash -> uint32, for turning '?seed=foo' into a state.
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
