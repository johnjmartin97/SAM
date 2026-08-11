import * as THREE from 'three';
import { forestFloor, normalFromCanvas } from './textures.js';

// The ground, and the river valley cut into it.
//
// One height function, heightAt(), is the single source of truth. The visible
// mesh is built from it, the physics heightfield is sampled from it, and every
// tree, rock and tent is placed by it. Nothing here can drift out of sync with
// the collision, because there is only one description of the shape.

export const WORLD = 78; // half-extent of the playable ground
export const WATER_Y = -0.35;

// Height of the terrain where there is no river. Kept comfortably above the
// waterline so the only wet part of the map is the river itself.
const LAND = 0.95;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Centre of the river channel, as a z position for a given x. It meanders. */
export function riverZ(x) {
  return 2 + 8.0 * Math.sin(x * 0.026) + 4.5 * Math.sin(x * 0.061 + 1.3);
}

/** Half-width of the deep part of the channel at a given x. */
export function riverHalfWidth(x) {
  return 8.5 + 2.2 * Math.sin(x * 0.04 + 0.7);
}

/** How far the sloping bank extends beyond the deep channel. */
const BANK = 7.5;
const DEPTH = 3.3;

export function heightAt(x, z) {
  // Gentle rolling ground, so the forest floor is not a billiard table.
  let h =
    LAND +
    0.5 * Math.sin(x * 0.045) * Math.cos(z * 0.038) +
    0.25 * Math.sin(x * 0.11 + z * 0.07);

  // Carve the valley. Full depth at the centreline, easing out to nothing at
  // the top of the bank, which is what makes the banks walkable rather than
  // a cliff you cannot climb back up.
  const d = Math.abs(z - riverZ(x));
  const w = riverHalfWidth(x);
  const carve = 1 - smoothstep(w * 0.3, w + BANK, d);
  h -= DEPTH * carve;

  return h;
}

/** Is there standing water at this spot? */
export function isWater(x, z) {
  return heightAt(x, z) < WATER_Y;
}

/** How deep the water is here (0 on dry land). */
export function waterDepth(x, z) {
  return Math.max(0, WATER_Y - heightAt(x, z));
}

/**
 * Direction and strength of the current. The river flows along its own
 * centreline, faster in the middle of the channel than at the edges.
 */
export function flowAt(x, z, out = new THREE.Vector2()) {
  const depth = waterDepth(x, z);
  if (depth <= 0) return out.set(0, 0);

  // Tangent of the meandering centreline: the river runs along +x.
  const dz = (riverZ(x + 0.5) - riverZ(x - 0.5)) / 1.0;
  out.set(1, dz).normalize();

  // Fastest mid-channel, slack near the banks.
  const strength = Math.min(1, depth / 1.4);
  return out.multiplyScalar(2.4 * strength);
}

/** Build the visible ground mesh. */
export function buildTerrainMesh(segments = 168) {
  const geo = new THREE.PlaneGeometry(WORLD * 2, WORLD * 2, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  // Tints, not colours: these MULTIPLY the forest-floor texture, which is
  // already dark. Absolute dark values here take the ground to near black.
  const grass = new THREE.Color(0.95, 1.05, 0.85);
  const moss = new THREE.Color(0.8, 1.1, 0.7);
  const mud = new THREE.Color(1.15, 0.95, 0.75);
  const silt = new THREE.Color(1.05, 1.0, 0.85);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);

    // Mud at the waterline, moss on the slopes, dark grass up top.
    const wetness = smoothstep(1.4, -0.3, y - WATER_Y);
    c.copy(grass).lerp(moss, (Math.sin(x * 0.3) * Math.cos(z * 0.27) + 1) * 0.5);
    c.lerp(mud, wetness);
    if (y < WATER_Y) c.lerp(silt, smoothstep(0, -1.6, y - WATER_Y));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // Detail texture on top of the vertex colours: the colours give the broad
  // wet/dry/mossy zoning, the texture gives needles and stones underfoot. A
  // normal map derived from it is what makes the ground catch Sam's lamp as
  // it sweeps past, which at this scale matters more than the colour does.
  const floor = forestFloor(11);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: floor.map,
      normalMap: normalFromCanvas(floor.canvas, 1.8),
      normalScale: new THREE.Vector2(1.5, 1.5),
      vertexColors: true,
      roughness: 0.97,
      metalness: 0,
    })
  );
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Build the physics collider. A Rapier heightfield samples the SAME function
 * as the mesh, so what you see is what you walk on.
 */
export function buildTerrainCollider(RAPIER, world, resolution = 160) {
  const n = resolution;
  const heights = new Float32Array((n + 1) * (n + 1));

  // Rapier's heightfield index is j * (n + 1) + i where i steps along Z and
  // j steps along X -- the opposite of the obvious reading. Getting this
  // backwards transposes the entire world, so it is checked by raycast in
  // tools/check-terrain.mjs rather than assumed.
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -WORLD + (j / n) * WORLD * 2;
      const z = -WORLD + (i / n) * WORLD * 2;
      heights[j * (n + 1) + i] = heightAt(x, z);
    }
  }

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const collider = world.createCollider(
    RAPIER.ColliderDesc.heightfield(n, n, heights, {
      x: WORLD * 2,
      y: 1,
      z: WORLD * 2,
    }),
    body
  );

  // Invisible walls so wandering in the dark cannot take you off the map.
  for (const [x, z, hx, hz] of [
    [0, -WORLD, WORLD, 1],
    [0, WORLD, WORLD, 1],
    [-WORLD, 0, 1, WORLD],
    [WORLD, 0, 1, WORLD],
  ]) {
    const wall = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, 8, z)
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 10, hz), wall);
  }

  return collider;
}

/**
 * Boulders standing in the channel.
 *
 * Deterministic and exported, because three separate systems need to agree on
 * exactly where they are: the renderer draws them, the physics blocks them,
 * and the water shader breaks white around them. Anything less than one shared
 * list and the foam appears where there is no rock.
 */
function buildRiverRocks() {
  const rocks = [];
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 34; i++) {
    const x = -72 + (i / 33) * 144 + (rand() - 0.5) * 3.5;
    const w = riverHalfWidth(x);
    const z = riverZ(x) + (rand() - 0.5) * 2 * w * 0.8;
    const depth = WATER_Y - heightAt(x, z);
    // Only where there is water, and not so deep the rock would drown.
    if (depth < 0.3 || depth > 2.1) continue;
    rocks.push({
      x,
      z,
      r: 0.55 + rand() * 1.45,
      h: depth + 0.35 + rand() * 0.8, // stands proud of the surface
    });
  }
  return rocks;
}

export const RIVER_ROCKS = buildRiverRocks();

/** Flow speed as a 0..1 fraction, for foam and for sound. */
export function flowSpeed(x, z) {
  return Math.min(1, waterDepth(x, z) / 1.4);
}
