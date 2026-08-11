import * as THREE from 'three';
import { heightAt, riverZ } from './terrain.js';
import { bark } from './textures.js';

// An arched footbridge over the river.
//
// It exists to make the crossing a CHOICE rather than a single scripted event.
// So it is deliberately not on the straight line to camp -- reaching it costs
// a detour, and the reward is staying dry. Swimming stays shorter and now
// carries a real risk of being swept downstream.
//
// A lantern hangs at each end. Without them the bridge would be invisible at
// fourteen metres of visibility, and an option you cannot find is not a choice.

export const BRIDGE_X = 31; // well east of the direct route
export const SPAN = 31; // long enough to clear the channel and both banks
const WIDTH = 2.6;
const RISE = 3.1; // how high the arch lifts above its ends
const PLANKS = 46;

/** Where the deck surface is, for t along the span (0..1). */
function deckPoint(t, z0, z1, y0, y1) {
  const z = THREE.MathUtils.lerp(z0, z1, t);
  const base = THREE.MathUtils.lerp(y0, y1, t);
  return { z, y: base + RISE * Math.sin(Math.PI * t) };
}

export function buildBridge(scene, RAPIER, world) {
  const centre = riverZ(BRIDGE_X);
  const z0 = centre - SPAN / 2;
  const z1 = centre + SPAN / 2;
  // Sit the ends slightly into the bank so the deck meets the ground.
  const y0 = heightAt(BRIDGE_X, z0) + 0.25;
  const y1 = heightAt(BRIDGE_X, z1) + 0.25;

  const group = new THREE.Group();
  scene.add(group);

  const plank = bark('furrowed', 2);
  const wood = new THREE.MeshStandardMaterial({
    map: plank.map,
    color: 0x8a6a48,
    roughness: 0.92,
    metalness: 0,
  });
  const beamWood = new THREE.MeshStandardMaterial({
    map: plank.map,
    color: 0x5f4830,
    roughness: 0.95,
  });

  // --- deck ---------------------------------------------------------------
  const plankGeo = new THREE.BoxGeometry(WIDTH, 0.14, (SPAN / PLANKS) * 1.15);
  const deck = new THREE.InstancedMesh(plankGeo, wood, PLANKS);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);

  for (let i = 0; i < PLANKS; i++) {
    const t = (i + 0.5) / PLANKS;
    const p = deckPoint(t, z0, z1, y0, y1);
    // Tilt each plank to follow the slope of the arch at that point.
    const ahead = deckPoint(Math.min(1, t + 0.01), z0, z1, y0, y1);
    const behind = deckPoint(Math.max(0, t - 0.01), z0, z1, y0, y1);
    const slope = Math.atan2(ahead.y - behind.y, ahead.z - behind.z);
    q.setFromEuler(new THREE.Euler(-slope, 0, 0));
    m.compose(pos.set(BRIDGE_X, p.y, p.z), q, scl);
    deck.setMatrixAt(i, m);
  }
  deck.instanceMatrix.needsUpdate = true;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // --- collision ----------------------------------------------------------
  // One box per few planks rather than per plank: the character controller's
  // autostep smooths the joins, and it keeps the collider count sane.
  const SEGMENTS = 12;
  for (let i = 0; i < SEGMENTS; i++) {
    const t0 = i / SEGMENTS;
    const t1 = (i + 1) / SEGMENTS;
    const a = deckPoint(t0, z0, z1, y0, y1);
    const b = deckPoint(t1, z0, z1, y0, y1);
    const midZ = (a.z + b.z) / 2;
    const midY = (a.y + b.y) / 2;
    const length = Math.hypot(b.z - a.z, b.y - a.y);
    const slope = Math.atan2(b.y - a.y, b.z - a.z);

    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-slope, 0, 0));
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(BRIDGE_X, midY - 0.07, midZ)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(WIDTH / 2, 0.12, length / 2 + 0.05),
      body
    );
  }

  // --- railings -----------------------------------------------------------
  const postGeo = new THREE.CylinderGeometry(0.075, 0.09, 1, 6);
  const POSTS = 13;
  const posts = new THREE.InstancedMesh(postGeo, beamWood, POSTS * 2);
  const railGeo = new THREE.BoxGeometry(0.1, 0.1, (SPAN / POSTS) * 1.1);
  const rails = new THREE.InstancedMesh(railGeo, beamWood, POSTS * 2);

  let pi = 0;
  let ri = 0;
  for (let i = 0; i < POSTS; i++) {
    const t = (i + 0.5) / POSTS;
    const p = deckPoint(t, z0, z1, y0, y1);
    const ahead = deckPoint(Math.min(1, t + 0.02), z0, z1, y0, y1);
    const behind = deckPoint(Math.max(0, t - 0.02), z0, z1, y0, y1);
    const slope = Math.atan2(ahead.y - behind.y, ahead.z - behind.z);

    for (const side of [-1, 1]) {
      const x = BRIDGE_X + side * (WIDTH / 2 - 0.12);
      q.setFromEuler(new THREE.Euler(0, 0, 0));
      m.compose(pos.set(x, p.y + 0.5, p.z), q, scl.set(1, 1, 1));
      posts.setMatrixAt(pi++, m);

      q.setFromEuler(new THREE.Euler(-slope, 0, 0));
      m.compose(pos.set(x, p.y + 0.95, p.z), q, scl.set(1, 1, 1));
      rails.setMatrixAt(ri++, m);
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  rails.instanceMatrix.needsUpdate = true;
  for (const im of [posts, rails]) {
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  }

  // Railing collision: two long low walls, so Sam cannot walk off the side
  // mid-river. Approximated as a few straight boxes along the arch.
  for (let i = 0; i < SEGMENTS; i++) {
    const t0 = i / SEGMENTS;
    const t1 = (i + 1) / SEGMENTS;
    const a = deckPoint(t0, z0, z1, y0, y1);
    const b = deckPoint(t1, z0, z1, y0, y1);
    const midZ = (a.z + b.z) / 2;
    const midY = (a.y + b.y) / 2;
    const length = Math.hypot(b.z - a.z, b.y - a.y);
    const slope = Math.atan2(b.y - a.y, b.z - a.z);
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-slope, 0, 0));

    for (const side of [-1, 1]) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(BRIDGE_X + side * (WIDTH / 2), midY + 0.55, midZ)
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.1, 0.55, length / 2 + 0.05),
        body
      );
    }
  }

  // --- lanterns, so the bridge can actually be found ----------------------
  const lights = [];
  for (const t of [0.04, 0.96]) {
    const p = deckPoint(t, z0, z1, y0, y1);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.07, 2.0, 6),
      beamWood
    );
    pole.position.set(BRIDGE_X + (WIDTH / 2 - 0.1), p.y + 1.0, p.z);
    group.add(pole);

    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.28, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffd08a, fog: false })
    );
    lamp.position.set(BRIDGE_X + (WIDTH / 2 - 0.1), p.y + 2.0, p.z);
    group.add(lamp);

    const light = new THREE.PointLight(0xffb060, 14, 16, 1.4);
    light.position.copy(lamp.position);
    group.add(light);
    lights.push(light);
  }

  const midpoint = deckPoint(0.5, z0, z1, y0, y1);
  return {
    group,
    lights,
    x: BRIDGE_X,
    z0,
    z1,
    centre: new THREE.Vector3(BRIDGE_X, midpoint.y, midpoint.z),
    /** Keep-clear radius around each end, so nothing blocks the approaches. */
    ends: [
      new THREE.Vector3(BRIDGE_X, y0, z0),
      new THREE.Vector3(BRIDGE_X, y1, z1),
    ],
    update(dt, time) {
      // Lanterns swing gently and flicker, so they read as flame not bulbs.
      for (let i = 0; i < lights.length; i++) {
        lights[i].intensity = 14 * (0.85 + Math.sin(time * (5.3 + i * 2.1)) * 0.1
          + Math.sin(time * 13.7 + i) * 0.05);
      }
    },
  };
}
