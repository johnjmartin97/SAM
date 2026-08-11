/**
 * Verify that the physics ground actually matches the visible ground.
 *
 * A Rapier heightfield takes a flat array, and getting its row/column order
 * backwards transposes the whole world -- the river ends up somewhere other
 * than where it is drawn, and you fall through the map. That failure is
 * invisible in a screenshot, so it gets checked here instead: fire rays
 * straight down at deliberately asymmetric points and compare where they land
 * against heightAt().
 *
 * Run:  node tools/check-terrain.mjs
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { heightAt, buildTerrainCollider, WATER_Y, riverZ } from '../src/terrain.js';

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
buildTerrainCollider(RAPIER, world, 160);
world.step();

const SAMPLES = [
  [4, 62],    // spawn
  [-10, -52], // campsite
  [40, -30],
  [-55, 20],
  [70, 5],
  [-70, -70],
  [0, riverZ(0)],     // middle of the river
  [30, riverZ(30)],
  [-45, riverZ(-45)],
  [25, riverZ(25) + 14], // up on the bank
];

const START = 30;
let worst = 0;
let failures = 0;

for (const [x, z] of SAMPLES) {
  const ray = new RAPIER.Ray({ x, y: START, z }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, 80, true);
  const expected = heightAt(x, z);

  if (!hit) {
    console.log(`  MISS  (${x}, ${z}) -- ray hit nothing, expected y=${expected.toFixed(2)}`);
    failures++;
    continue;
  }

  const actual = START - hit.timeOfImpact;
  const err = Math.abs(actual - expected);
  worst = Math.max(worst, err);
  const tag = err < 0.12 ? 'ok  ' : 'BAD ';
  if (err >= 0.12) failures++;
  console.log(
    `  ${tag} (${String(x).padStart(4)}, ${String(z.toFixed(1)).padStart(6)})  ` +
    `physics ${actual.toFixed(2).padStart(6)}   mesh ${expected.toFixed(2).padStart(6)}   ` +
    `off by ${err.toFixed(3)}`
  );
}

// The river has to actually be underwater, and the banks actually dry.
const midDepth = WATER_Y - heightAt(0, riverZ(0));
const bankHeight = heightAt(0, riverZ(0) + 22) - WATER_Y;
console.log(`\n  river depth at centre : ${midDepth.toFixed(2)} m`);
console.log(`  bank height above water: ${bankHeight.toFixed(2)} m`);
if (midDepth < 1.3) { console.log('  BAD: too shallow to swim'); failures++; }
if (bankHeight < 0.4) { console.log('  BAD: banks are flooded'); failures++; }

console.log(
  failures === 0
    ? `\n  PASS -- physics matches the mesh (worst error ${worst.toFixed(3)} m)\n`
    : `\n  FAIL -- ${failures} problem(s)\n`
);
process.exit(failures === 0 ? 0 : 1);
