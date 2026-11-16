// nav.js — hand-placed waypoint graph for the RUSTLINE container yard.
// Nodes cover spawns, the three lanes, both bomb sites and the mid cross.
// Bots route with BFS over this graph; players never touch it directly.

// Yard: x in [-18, 18], z in [-13, 13]. South (z=+11) is the Ember spawn,
// north (z=-11) is Slate. Sites: A (-13.5,-8), B (13.5,-8).
export const NAV_NODES = [
  { x: 0, z: 11 },      // 0  Ember spawn, mid
  { x: -6, z: 11 },     // 1  Ember spawn, west
  { x: 6, z: 11 },      // 2  Ember spawn, east
  { x: -13, z: 8 },     // 3  west lane, south
  { x: 0, z: 8 },       // 4  mid lane, south
  { x: 13, z: 8 },      // 5  east lane, south
  { x: -13, z: 3 },     // 6  west lane, mid-south
  { x: 0, z: 4.5 },     // 7  mid lane, centre-south
  { x: 13, z: 3 },      // 8  east lane, mid-south
  { x: -13, z: -3 },    // 9  west lane, mid-north
  { x: -6, z: 0 },      // 10 mid-west cross
  { x: 6, z: 0 },       // 11 mid-east cross
  { x: 13, z: -3 },     // 12 east lane, mid-north
  { x: -13, z: -8 },    // 13 site A
  { x: 0, z: -4.5 },    // 14 mid lane, centre-north
  { x: 13, z: -8 },     // 15 site B
  { x: -5, z: -8 },     // 16 A approach, west
  { x: 5, z: -8 },      // 17 B approach, east
  { x: -6, z: -11 },    // 18 Slate spawn, west
  { x: 0, z: -11 },     // 19 Slate spawn, mid
  { x: 6, z: -11 },     // 20 Slate spawn, east
  { x: -11.5, z: -11 }, // 21 Slate spawn, far west
  { x: 11.5, z: -11 },  // 22 Slate spawn, far east
];

// Bidirectional links; the graph is symmetric, so each pair is stored once
// and expanded to both directions in the constructor.
export const NAV_EDGES = [
  [0, 1], [0, 2], [0, 4], [1, 3], [2, 5], [3, 4], [4, 5],
  [3, 6], [4, 7], [5, 8], [6, 9], [6, 10], [7, 10], [7, 11],
  [8, 11], [8, 12], [9, 13], [9, 10], [10, 14], [11, 14],
  [11, 12], [12, 15], [13, 16], [13, 21], [14, 16], [14, 17],
  [15, 17], [15, 22], [16, 18], [16, 19], [17, 19], [17, 20],
  [18, 19], [19, 20], [18, 21], [20, 22],
];

export class Nav {
  constructor(nodes = NAV_NODES, edges = NAV_EDGES) {
    this.nodes = nodes;
    this.edges = edges;
    // Adjacency list: adj[i] is the list of node indices linked to i.
    this.adj = nodes.map(() => []);
    for (const [a, b] of edges) {
      if (a < 0 || b < 0 || a >= nodes.length || b >= nodes.length) continue;
      this.adj[a].push(b);
      this.adj[b].push(a);
    }
  }

  // Index of the node closest to (x, z), by squared distance.
  nearest(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const dx = this.nodes[i].x - x;
      const dz = this.nodes[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // BFS shortest path of node indices from a to b, inclusive.
  // Returns [a] when a === b and [] when b cannot be reached.
  path(a, b) {
    const n = this.nodes.length;
    if (a < 0 || b < 0 || a >= n || b >= n) return [];
    if (a === b) return [a];
    const prev = new Array(n).fill(-1);
    const seen = new Array(n).fill(false);
    const queue = [a];
    seen[a] = true;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      for (const next of this.adj[cur]) {
        if (seen[next]) continue;
        seen[next] = true;
        prev[next] = cur;
        if (next === b) {
          const out = [b];
          let walk = b;
          while (prev[walk] !== -1) { walk = prev[walk]; out.push(walk); }
          out.reverse();
          return out;
        }
        queue.push(next);
      }
    }
    return [];
  }

  // Write node i's position into out, a plain {x, y, z} object (y = 0).
  // Assigns fields directly; never calls out.set().
  nodePos(i, out) {
    const node = this.nodes[i];
    out.x = node.x;
    out.y = 0;
    out.z = node.z;
    return out;
  }
}
