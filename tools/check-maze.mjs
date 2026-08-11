/**
 * Prove the campsite is reachable, and measure how much of a challenge the
 * route is.
 *
 * A maze that seals the goal off looks completely fine in a screenshot and is
 * only discovered by a player wandering for ten minutes. So the same maze the
 * game builds is generated here and solved before anyone plays it.
 *
 * Run:  node tools/check-maze.mjs
 */
import { buildMaze, CELL } from '../src/maze.js';
import { WORLD, heightAt, WATER_Y } from '../src/terrain.js';
import { MAZE_SEED, MAZE_OPTIONS, SPAWN, CAMP } from '../src/woods.js';

const maze = buildMaze(WORLD, MAZE_SEED, {
  ...MAZE_OPTIONS,
  openAt: [SPAWN, CAMP],
});

let failures = 0;

// ---- 1. can Sam get home at all? -------------------------------------------
const path = maze.solve(SPAWN, CAMP);
if (!path) {
  console.log('  BAD: no route from spawn to the campsite');
  failures++;
} else {
  const routeMetres = (path.length - 1) * CELL;
  const straight = Math.hypot(SPAWN.x - CAMP.x, SPAWN.z - CAMP.z);
  const windiness = routeMetres / straight;

  console.log(`  route          : ${path.length} cells, about ${routeMetres.toFixed(0)} m`);
  console.log(`  straight line  : ${straight.toFixed(0)} m`);
  console.log(`  windiness      : ${windiness.toFixed(2)}x`);
  console.log(`  dead ends      : ${maze.deadEnds()} cells`);
  console.log(`  grid           : ${maze.cols} x ${maze.cols} cells of ${CELL} m`);
  console.log(`  standing walls : ${maze.walls().length}`);

  // At a run of 7.2 m/s, and nothing like a straight run in practice.
  const bestCase = routeMetres / 7.2;
  console.log(`  perfect run    : ~${bestCase.toFixed(0)} s if you never take a wrong turn`);

  if (windiness < 1.25) {
    console.log('  BAD: the route is nearly a straight line -- not a maze');
    failures++;
  }
  if (routeMetres < 140) {
    console.log('  BAD: route is too short to be a stage');
    failures++;
  }
}

// ---- 2. do the walls leave the river crossable? ----------------------------
// Walls sitting in water are skipped by the level, so the river stays open.
// If nearly every wall were skipped the maze would fall apart, so count them.
const walls = maze.walls();
const drowned = walls.filter((w) => heightAt(w.cx, w.cz) < WATER_Y + 0.3).length;
console.log(`  walls in water : ${drowned} of ${walls.length} (skipped when built)`);
if (drowned / walls.length > 0.25) {
  console.log('  BAD: too much of the maze is underwater to hold together');
  failures++;
}

// ---- 3. is there a clear tube down every corridor? -------------------------
// Object placement rejects anything within CLEARANCE of a corridor centreline.
// Confirm that leaves a gap Sam actually fits through (he is 0.6 m wide).
const CLEARANCE = MAZE_OPTIONS.clearance ?? 1.6;
console.log(`  corridor gap   : ${(CLEARANCE * 2).toFixed(1)} m clear (Sam is 0.6 m wide)`);
if (CLEARANCE * 2 < 1.4) {
  console.log('  BAD: corridors are too tight to walk down reliably');
  failures++;
}

console.log(
  failures === 0
    ? '\n  PASS -- the campsite is reachable and the route is a real one\n'
    : `\n  FAIL -- ${failures} problem(s)\n`
);
process.exit(failures === 0 ? 0 : 1);
