// The shape of the forest, as a maze.
//
// Deliberately pure: no three.js, no DOM, no rendering. That is what lets
// tools/check-maze.mjs generate the exact same maze in Node and prove the
// campsite is reachable before anyone plays it. A forest that accidentally
// walls the goal off would be invisible in a screenshot and infuriating in
// play, so it gets checked rather than trusted.
//
// The maze is "braided": a perfect maze is carved first, then a fraction of
// its walls are knocked back out. Perfect mazes have exactly one route and
// read as a puzzle. Braided mazes have loops, dead ends and choices, and read
// as woods.

export const CELL = 9; // metres across one maze cell

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToSegment(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((px - x1) * dx + (pz - z1) * dz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

export function buildMaze(worldHalf, seed, {
  braid = 0.30, // fraction of walls knocked back out -- the "openness" dial
  clearings = 6, // cells opened on every side, as landmarks and breathing room
  openAt = [], // world positions that must not be walled in (spawn, camp)
  openRadius = 12,
} = {}) {
  const cols = Math.floor((worldHalf * 2) / CELL);
  const span = cols * CELL;
  const origin = -span / 2;
  const rand = rng(seed);

  // openV[i][j] is the boundary between cell (i,j) and (i+1,j).
  // openH[i][j] is the boundary between cell (i,j) and (i,j+1).
  const openV = new Uint8Array((cols - 1) * cols);
  const openH = new Uint8Array(cols * (cols - 1));
  const vIdx = (i, j) => j * (cols - 1) + i;
  const hIdx = (i, j) => j * cols + i;

  // --- carve a perfect maze (randomised depth-first search) --------------
  const visited = new Uint8Array(cols * cols);
  const start = [(cols / 2) | 0, (cols / 2) | 0];
  visited[start[1] * cols + start[0]] = 1;
  const stack = [start];

  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const options = [];
    if (i > 0 && !visited[j * cols + i - 1]) options.push([i - 1, j, 'v', i - 1, j]);
    if (i < cols - 1 && !visited[j * cols + i + 1]) options.push([i + 1, j, 'v', i, j]);
    if (j > 0 && !visited[(j - 1) * cols + i]) options.push([i, j - 1, 'h', i, j - 1]);
    if (j < cols - 1 && !visited[(j + 1) * cols + i]) options.push([i, j + 1, 'h', i, j]);

    if (!options.length) {
      stack.pop();
      continue;
    }
    const [ni, nj, kind, wi, wj] = options[(rand() * options.length) | 0];
    if (kind === 'v') openV[vIdx(wi, wj)] = 1;
    else openH[hIdx(wi, wj)] = 1;
    visited[nj * cols + ni] = 1;
    stack.push([ni, nj]);
  }

  // --- braid: knock walls back out, creating loops and alternative routes --
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < cols - 1; i++) {
      if (!openV[vIdx(i, j)] && rand() < braid) openV[vIdx(i, j)] = 1;
    }
  }
  for (let j = 0; j < cols - 1; j++) {
    for (let i = 0; i < cols; i++) {
      if (!openH[hIdx(i, j)] && rand() < braid) openH[hIdx(i, j)] = 1;
    }
  }

  const cellCenter = (i, j) => ({
    x: origin + (i + 0.5) * CELL,
    z: origin + (j + 0.5) * CELL,
  });
  const cellAt = (x, z) => ({
    i: Math.max(0, Math.min(cols - 1, Math.floor((x - origin) / CELL))),
    j: Math.max(0, Math.min(cols - 1, Math.floor((z - origin) / CELL))),
  });

  const openAround = (i, j) => {
    if (i > 0) openV[vIdx(i - 1, j)] = 1;
    if (i < cols - 1) openV[vIdx(i, j)] = 1;
    if (j > 0) openH[hIdx(i, j - 1)] = 1;
    if (j < cols - 1) openH[hIdx(i, j)] = 1;
  };

  // --- clearings: landmarks you can recognise and reorient from ----------
  const clearingCells = [];
  for (let k = 0; k < clearings; k++) {
    const i = 2 + ((rand() * (cols - 4)) | 0);
    const j = 2 + ((rand() * (cols - 4)) | 0);
    clearingCells.push({ i, j, ...cellCenter(i, j) });
    openAround(i, j);
  }

  // --- never wall in the spawn or the campsite ---------------------------
  for (const p of openAt) {
    const r = Math.ceil(openRadius / CELL);
    const c = cellAt(p.x, p.z);
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const i = c.i + di;
        const j = c.j + dj;
        if (i < 0 || j < 0 || i >= cols || j >= cols) continue;
        const cc = cellCenter(i, j);
        if (Math.hypot(cc.x - p.x, cc.z - p.z) <= openRadius) openAround(i, j);
      }
    }
  }

  const isOpenV = (i, j) => i >= 0 && i < cols - 1 && openV[vIdx(i, j)] === 1;
  const isOpenH = (i, j) => j >= 0 && j < cols - 1 && openH[hIdx(i, j)] === 1;

  /** Every wall that still stands, as an axis-aligned segment. */
  function walls() {
    const out = [];
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < cols - 1; i++) {
        if (openV[vIdx(i, j)]) continue;
        const x = origin + (i + 1) * CELL;
        out.push({
          axis: 'z', x1: x, z1: origin + j * CELL, x2: x, z2: origin + (j + 1) * CELL,
          cx: x, cz: origin + (j + 0.5) * CELL, length: CELL,
        });
      }
    }
    for (let j = 0; j < cols - 1; j++) {
      for (let i = 0; i < cols; i++) {
        if (openH[hIdx(i, j)]) continue;
        const z = origin + (j + 1) * CELL;
        out.push({
          axis: 'x', x1: origin + i * CELL, z1: z, x2: origin + (i + 1) * CELL, z2: z,
          cx: origin + (i + 0.5) * CELL, cz: z, length: CELL,
        });
      }
    }
    return out;
  }

  /**
   * Distance from a point to the nearest corridor centreline.
   *
   * Object placement uses this to keep a clear tube down every corridor. That
   * is what makes the maze passable BY CONSTRUCTION: no random tree can ever
   * plug a route, so the only thing that blocks you is a wall the checker
   * knows about.
   */
  function corridorDistance(x, z) {
    const { i, j } = cellAt(x, z);
    const c = cellCenter(i, j);
    let best = Infinity;
    const tryTo = (ni, nj) => {
      const n = cellCenter(ni, nj);
      best = Math.min(best, distToSegment(x, z, c.x, c.z, n.x, n.z));
    };
    if (isOpenV(i - 1, j)) tryTo(i - 1, j);
    if (isOpenV(i, j)) tryTo(i + 1, j);
    if (isOpenH(i, j - 1)) tryTo(i, j - 1);
    if (isOpenH(i, j)) tryTo(i, j + 1);
    // A cell with no open side (impossible after carving) still needs a value.
    return best === Infinity ? Math.hypot(x - c.x, z - c.z) : best;
  }

  /** Breadth-first search between two world positions. Returns cell path. */
  function solve(from, to) {
    const a = cellAt(from.x, from.z);
    const b = cellAt(to.x, to.z);
    const startIdx = a.j * cols + a.i;
    const goalIdx = b.j * cols + b.i;

    const prev = new Int32Array(cols * cols).fill(-1);
    const seen = new Uint8Array(cols * cols);
    seen[startIdx] = 1;
    const queue = [startIdx];

    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      if (at === goalIdx) break;
      const i = at % cols;
      const j = (at / cols) | 0;
      const push = (ni, nj) => {
        const idx = nj * cols + ni;
        if (seen[idx]) return;
        seen[idx] = 1;
        prev[idx] = at;
        queue.push(idx);
      };
      if (isOpenV(i - 1, j)) push(i - 1, j);
      if (isOpenV(i, j)) push(i + 1, j);
      if (isOpenH(i, j - 1)) push(i, j - 1);
      if (isOpenH(i, j)) push(i, j + 1);
    }

    if (!seen[goalIdx]) return null;
    const path = [];
    for (let at = goalIdx; at !== -1; at = prev[at]) {
      path.push({ i: at % cols, j: (at / cols) | 0 });
      if (at === startIdx) break;
    }
    return path.reverse();
  }

  /** How many cells are dead ends -- a rough measure of how maze-like it is. */
  function deadEnds() {
    let n = 0;
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < cols; i++) {
        let exits = 0;
        if (isOpenV(i - 1, j)) exits++;
        if (isOpenV(i, j)) exits++;
        if (isOpenH(i, j - 1)) exits++;
        if (isOpenH(i, j)) exits++;
        if (exits === 1) n++;
      }
    }
    return n;
  }

  return {
    cols, cell: CELL, origin, span,
    cellCenter, cellAt, walls, corridorDistance, solve, deadEnds,
    clearingCells,
  };
}
