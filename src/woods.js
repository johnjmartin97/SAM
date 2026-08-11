import * as THREE from 'three';
import {
  WORLD,
  WATER_Y,
  RIVER_ROCKS,
  riverZ,
  heightAt,
  buildTerrainMesh,
  buildTerrainCollider,
} from './terrain.js';
import { buildForest, buildUndergrowth, buildThickets } from './trees.js';
import { buildMaze } from './maze.js';
import { buildBridge, bridgeEnds } from './bridge.js';
import { stone } from './textures.js';

// A dark pine forest with a river through it and a campsite somewhere beyond.
//
// The stage is a navigation problem, not a platforming one: Sam can only see a
// few metres in any direction, so the forest has to be readable by landmark
// rather than by layout. The campfire glow is the one thing that carries
// through the fog, which makes it the beacon the whole level is built around.

const TREE_COUNT = 640;
const BUSH_COUNT = 300;
const BRAMBLE_COUNT = 620;
const ROCK_COUNT = 150;
const BOULDER_COUNT = 52;
const LOG_COUNT = 38;

// Spawn and campsite sit on opposite banks, so the river always has to be
// crossed. Their heights come from the terrain, not from guesswork.
export const SPAWN = new THREE.Vector3(4, heightAt(4, 62) + 0.8, 62);
export const CAMP = new THREE.Vector3(-10, heightAt(-10, -52), -52);
export const GOAL_RADIUS = 5.5;

const SPAWN_CLEARING = 7;
const CAMP_CLEARING = 11;

// The maze. Exported so tools/check-maze.mjs can build an identical one and
// prove the campsite is reachable before anyone plays the stage.
export const MAZE_SEED = 90210;

// Everywhere the maze must leave open. The bridge belongs here: clearing a
// circle around its ends is not enough, because a wall further out can still
// seal the whole corridor leading to it. The maze has to know it exists.
export const MAZE_OPEN_AT = [SPAWN, CAMP, ...bridgeEnds()];
export const MAZE_OPTIONS = {
  braid: 0.12,      // how many walls get knocked back out: higher = more open
  clearings: 6,     // landmark cells, opened on every side
  openRadius: 13,   // spawn and camp are never walled in
  clearance: 1.7,   // clear tube kept down every corridor, in metres
};

/** Small deterministic RNG, so the forest is the same every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from a point to a line segment. */
function segmentDistance(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((px - x1) * dx + (pz - z1) * dz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

function standard(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.94,
    metalness: 0,
    flatShading: true,
    ...opts,
  });
}

/** A soft round gradient, used for the fire's glow and Sam's ground shadow. */
function radialTexture(inner, outer, power = 2) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const a = Math.pow(1 - t, power);
    grad.addColorStop(t, `rgba(${inner},${a * outer})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Woods {
  constructor(scene, RAPIER, world) {
    this.scene = scene;
    this.RAPIER = RAPIER;
    this.world = world;
    this.time = 0;
    this.rand = rng(20260811);

    this.maze = buildMaze(WORLD, MAZE_SEED, {
      ...MAZE_OPTIONS,
      openAt: MAZE_OPEN_AT,
    });

    this._buildAtmosphere();
    this._buildGround();
    this.bridge = buildBridge(this.scene, this.RAPIER, this.world);
    this._buildThickets();
    this._buildTrees();
    this._buildScatter();
    this._buildCampsite();
    this._buildFireflies();
  }

  // ---------------------------------------------------------------- mood ---

  _buildAtmosphere() {
    const night = new THREE.Color(0x05070d);
    this.scene.background = night;
    // Exponential fog IS the vision circle: everything past ~14m is swallowed.
    this.scene.fog = new THREE.FogExp2(night, 0.105);

    // Barely-there moonlight. Enough to separate a tree from the void, no more.
    // The ground colour matters as much as the intensity: with a lamp directly
    // overhead this is the only light reaching anything's underside, and at
    // near-black it left Sam's legs looking like they had been cut off.
    const moon = new THREE.HemisphereLight(0x2c3d5c, 0x232a33, 0.7);
    this.scene.add(moon);
    const moonDir = new THREE.DirectionalLight(0x8fa8d8, 0.14);
    moonDir.position.set(-30, 40, 20);
    this.scene.add(moonDir);
  }

  // -------------------------------------------------------------- ground ---

  _buildGround() {
    // Both the mesh and the collider come from terrain.js, sampled from the
    // same height function, so they cannot disagree.
    this.scene.add(buildTerrainMesh(168));
    buildTerrainCollider(this.RAPIER, this.world, 160);
  }

  // --------------------------------------------------------------- trees ---

  /**
   * Rejection sampling on a grid: cheap, and keeps things from overlapping.
   * Anything below `minHeight` above the waterline is rejected, which is what
   * keeps trees out of the river without any explicit river logic here.
   */
  _scatter(count, minDist, clearings, minHeight = 0.35,
           clearance = MAZE_OPTIONS.clearance) {
    const cell = minDist;
    const grid = new Map();
    const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    const points = [];

    for (let attempt = 0; attempt < count * 40 && points.length < count; attempt++) {
      const x = (this.rand() * 2 - 1) * (WORLD - 3);
      const z = (this.rand() * 2 - 1) * (WORLD - 3);

      const y = heightAt(x, z);
      if (y < WATER_Y + minHeight) continue; // in or too near the river

      // Keep a clear tube down every corridor. This is what makes the maze
      // passable by construction: no random tree can ever plug a route, so
      // the only thing blocking Sam is a wall the checker knows about.
      if (this.maze.corridorDistance(x, z) < clearance) continue;

      let blocked = false;
      for (const [cx, cz, r] of clearings) {
        if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) { blocked = true; break; }
      }
      if (blocked) continue;

      const gx = Math.floor(x / cell);
      const gz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1 && !blocked; dx++) {
        for (let dz = -1; dz <= 1 && !blocked; dz++) {
          const near = grid.get(`${gx + dx},${gz + dz}`);
          if (!near) continue;
          for (const p of near) {
            if ((p.x - x) ** 2 + (p.z - z) ** 2 < minDist * minDist) {
              blocked = true;
              break;
            }
          }
        }
      }
      if (blocked) continue;

      const p = { x, z, y };
      points.push(p);
      const k = key(x, z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
    }
    return points;
  }

  /**
   * Keep-clear zones at both ends of the bridge.
   *
   * Every scatter that produces a collider has to use these. Missing one is
   * enough to wall the bridge off, which is exactly what happened: bushes and
   * boulders had no exclusion at all.
   */
  _bridgeClearings(radius = 8) {
    return bridgeEnds().map((e) => [e.x, e.z, radius]);
  }

  _buildThickets() {
    // Walls standing in the river are skipped, so the water stays a route --
    // a fast, wet shortcut with a current that pushes you off course.
    const walls = this.maze.walls().filter((w) => {
      if (heightAt(w.cx, w.cz) < WATER_Y + 0.3) return false;
      const nearSpawn = Math.hypot(w.cx - SPAWN.x, w.cz - SPAWN.z) < SPAWN_CLEARING;
      const nearCamp = Math.hypot(w.cx - CAMP.x, w.cz - CAMP.z) < CAMP_CLEARING;
      const nearBridge = bridgeEnds().some(
        (e) => segmentDistance(e.x, e.z, w.x1, w.z1, w.x2, w.z2) < 11
      );
      return !nearSpawn && !nearCamp && !nearBridge;
    });
    this.thickets = buildThickets(
      this.scene, this.RAPIER, this.world, walls, this.rand, heightAt
    );
  }

  _buildTrees() {
    const spots = this._scatter(TREE_COUNT, 2.6, [
      [SPAWN.x, SPAWN.z, SPAWN_CLEARING],
      [CAMP.x, CAMP.z, CAMP_CLEARING],
      ...this._bridgeClearings(),
    ]);
    this.forest = buildForest(this.scene, this.RAPIER, this.world, spots, this.rand);
    this._buildUndergrowth();
    this._buildFallenLogs();
  }

  _buildUndergrowth() {
    // Bushes get collision -- pushing through undergrowth is the point.
    // Bramble does not, or a dark forest floor becomes impassable.
    const bushes = this._scatter(BUSH_COUNT, 2.4, [
      [SPAWN.x, SPAWN.z, SPAWN_CLEARING * 0.7],
      [CAMP.x, CAMP.z, CAMP_CLEARING * 0.8],
      ...this._bridgeClearings(),
    ], 0.45);
    buildUndergrowth(this.scene, this.RAPIER, this.world, bushes, this.rand,
      { collide: true });

    const bramble = this._scatter(BRAMBLE_COUNT, 1.3, [], 0.1);
    buildUndergrowth(this.scene, this.RAPIER, this.world, bramble, this.rand,
      { collide: false });
  }

  /** Logs lying on the ground: obstacles you jump rather than walk round. */
  _buildFallenLogs() {
    const spots = this._scatter(LOG_COUNT, 9, [
      [SPAWN.x, SPAWN.z, SPAWN_CLEARING],
      [CAMP.x, CAMP.z, CAMP_CLEARING],
      ...this._bridgeClearings(),
    ], 0.5);

    const geo = new THREE.CylinderGeometry(0.36, 0.44, 1, 8);
    geo.rotateZ(Math.PI / 2); // lie it down along x
    const logs = new THREE.InstancedMesh(geo, standard(0x2d2318), spots.length);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();

    spots.forEach((p, i) => {
      const len = 3.5 + this.rand() * 4.5;
      const girth = 0.75 + this.rand() * 0.6;
      e.set(0, this.rand() * Math.PI * 2, 0);
      q.setFromEuler(e);
      m.compose(
        new THREE.Vector3(p.x, p.y + 0.36 * girth, p.z), q,
        new THREE.Vector3(len, girth, girth)
      );
      logs.setMatrixAt(i, m);

      // Rapier cylinders stand along Y, so the body carries the rotation that
      // lays the log on its side and turns it to match.
      const lay = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, e.y, Math.PI / 2, 'YXZ')
      );
      const body = this.world.createRigidBody(
        this.RAPIER.RigidBodyDesc.fixed()
          .setTranslation(p.x, p.y + 0.36 * girth, p.z)
          .setRotation({ x: lay.x, y: lay.y, z: lay.z, w: lay.w })
      );
      this.world.createCollider(
        this.RAPIER.ColliderDesc.cylinder(len / 2, 0.4 * girth),
        body
      );
    });

    logs.instanceMatrix.needsUpdate = true;
    logs.castShadow = true;
    logs.receiveShadow = true;
    this.scene.add(logs);
  }

  _buildScatter() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    // --- pebbles: small, decorative, allowed in the shallows ---
    const stoneTex = stone(17);
    this.stoneMaterial = new THREE.MeshStandardMaterial({
      map: stoneTex.map,
      roughness: 0.92,
      metalness: 0,
    });
    const rocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 1), this.stoneMaterial, ROCK_COUNT
    );
    for (let i = 0; i < ROCK_COUNT; i++) {
      const x = (this.rand() * 2 - 1) * (WORLD - 2);
      const z = (this.rand() * 2 - 1) * (WORLD - 2);
      const y = heightAt(x, z);
      const s = 0.4 + this.rand() * 0.8;
      q.setFromEuler(
        new THREE.Euler(this.rand(), this.rand() * Math.PI * 2, this.rand())
      );
      m.compose(pos.set(x, y + s * 0.2, z), q, scl.set(s, s * 0.7, s));
      rocks.setMatrixAt(i, m);
    }

    for (const im of [rocks]) {
      im.instanceMatrix.needsUpdate = true;
      im.receiveShadow = true;
      this.scene.add(im);
    }

    this._buildBoulders();
    this._buildRiverRocks();
  }

  /**
   * The boulders standing in the channel. Same list the water shader breaks
   * foam around, so what you see and what you swim into are the same rocks.
   */
  _buildRiverRocks() {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const hullSource = new THREE.IcosahedronGeometry(1, 0).attributes.position.array;
    const rocks = new THREE.InstancedMesh(geo, this.stoneMaterial, RIVER_ROCKS.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();

    RIVER_ROCKS.forEach((r, i) => {
      const sx = r.r;
      const sy = r.h * 0.85;
      const sz = r.r * (0.8 + this.rand() * 0.5);
      q.setFromEuler(new THREE.Euler(
        (this.rand() - 0.5) * 0.5,
        this.rand() * Math.PI * 2,
        (this.rand() - 0.5) * 0.5
      ));
      // Bedded into the riverbed, breaking the surface.
      const y = heightAt(r.x, r.z) + sy * 0.75;
      m.compose(new THREE.Vector3(r.x, y, r.z), q, new THREE.Vector3(sx, sy, sz));
      rocks.setMatrixAt(i, m);

      const hull = new Float32Array(hullSource.length);
      for (let v = 0; v < hullSource.length; v += 3) {
        hull[v] = hullSource[v] * sx;
        hull[v + 1] = hullSource[v + 1] * sy;
        hull[v + 2] = hullSource[v + 2] * sz;
      }
      const desc = this.RAPIER.ColliderDesc.convexHull(hull);
      if (!desc) return;
      const body = this.world.createRigidBody(
        this.RAPIER.RigidBodyDesc.fixed()
          .setTranslation(r.x, y, r.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      );
      this.world.createCollider(desc, body);
    });

    rocks.instanceMatrix.needsUpdate = true;
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    this.scene.add(rocks);
  }

  /**
   * Boulders are big enough to walk into, so unlike the pebbles they get real
   * collision -- a convex hull of the actual drawn shape, not a stand-in
   * sphere, so what blocks you is what you can see.
   */
  _buildBoulders() {
    const spots = this._scatter(BOULDER_COUNT, 7, [
      [SPAWN.x, SPAWN.z, SPAWN_CLEARING * 0.6],
      [CAMP.x, CAMP.z, CAMP_CLEARING * 0.7],
      ...this._bridgeClearings(9),
    ], -1.4); // allowed to sit in the river, breaking up the current

    // Subdivided once so the bumps read as rock rather than a d20.
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const boulders = new THREE.InstancedMesh(geo, this.stoneMaterial, spots.length);
    const hullSource = new THREE.IcosahedronGeometry(1, 0).attributes.position.array;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();

    spots.forEach((p, i) => {
      const sx = 0.9 + this.rand() * 1.9;
      const sy = sx * (0.6 + this.rand() * 0.5);
      const sz = sx * (0.75 + this.rand() * 0.5);
      const e = new THREE.Euler(
        (this.rand() - 0.5) * 0.7,
        this.rand() * Math.PI * 2,
        (this.rand() - 0.5) * 0.7
      );
      q.setFromEuler(e);
      // Sunk slightly, so boulders look bedded into the ground not dropped on.
      const y = p.y + sy * 0.55;
      m.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(sx, sy, sz));
      boulders.setMatrixAt(i, m);

      // Same vertices, same scale -- the hull is the drawn shape.
      const hull = new Float32Array(hullSource.length);
      for (let v = 0; v < hullSource.length; v += 3) {
        hull[v] = hullSource[v] * sx;
        hull[v + 1] = hullSource[v + 1] * sy;
        hull[v + 2] = hullSource[v + 2] * sz;
      }
      const desc = this.RAPIER.ColliderDesc.convexHull(hull);
      if (!desc) return; // degenerate hull: skip rather than crash
      const body = this.world.createRigidBody(
        this.RAPIER.RigidBodyDesc.fixed()
          .setTranslation(p.x, y, p.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      );
      this.world.createCollider(desc, body);
    });

    boulders.instanceMatrix.needsUpdate = true;
    boulders.castShadow = true;
    boulders.receiveShadow = true;
    this.scene.add(boulders);
  }

  // ------------------------------------------------------------ campsite ---

  _buildCampsite() {
    const camp = new THREE.Group();
    camp.position.copy(CAMP);
    this.scene.add(camp);

    // --- fire ring ---
    const stoneGeo = new THREE.IcosahedronGeometry(0.22, 0);
    const stones = new THREE.InstancedMesh(stoneGeo, standard(0x4a4744), 9);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      q.setFromEuler(new THREE.Euler(this.rand(), this.rand(), this.rand()));
      m.compose(
        new THREE.Vector3(Math.cos(a) * 0.95, 0.1, Math.sin(a) * 0.95),
        q,
        new THREE.Vector3(1, 0.8, 1)
      );
      stones.setMatrixAt(i, m);
    }
    stones.instanceMatrix.needsUpdate = true;
    camp.add(stones);

    // --- logs, leaning into the middle ---
    const logMat = standard(0x2e2118);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.3, 6), logMat);
      log.position.set(Math.cos(a) * 0.3, 0.32, Math.sin(a) * 0.3);
      log.rotation.set(Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9);
      log.castShadow = true;
      camp.add(log);
    }

    // --- flames: unlit cones, so they read as light sources not lit objects --
    this.flames = [];
    for (let i = 0; i < 3; i++) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.26 - i * 0.06, 0.9 - i * 0.18, 6),
        new THREE.MeshBasicMaterial({
          color: [0xff7a1e, 0xffb43c, 0xffe08a][i],
          transparent: true,
          opacity: 0.9 - i * 0.1,
          depthWrite: false,
          fog: false,
        })
      );
      flame.position.set(0, 0.5 + i * 0.13, 0);
      camp.add(flame);
      this.flames.push(flame);
    }

    this.fireLight = new THREE.PointLight(0xff9a40, 40, 34, 2);
    this.fireLight.position.set(0, 1.1, 0);
    camp.add(this.fireLight);

    // The beacon. fog:false is the whole point -- this is the ONE thing that
    // stays visible across the map, so the player always has something to aim
    // at once they glimpse it between the trunks.
    const glowTex = radialTexture('255,150,60', 1, 2.4);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        opacity: 0.85,
      })
    );
    this.glow.position.set(0, 1.3, 0);
    this.glow.scale.setScalar(7);
    camp.add(this.glow);

    // Firelight on the smoke, hanging above the treetops. At ground level the
    // trunks hide the fire itself almost all the time, so without this the
    // level is a maze with no landmark. This sits higher than the canopy and
    // gives the player a direction to commit to from anywhere on the map.
    this.skyGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false, // deliberately shines through the canopy
        fog: false,
        opacity: 0.3,
      })
    );
    this.skyGlow.position.set(0, 15.5, 0);
    this.skyGlow.scale.setScalar(20);
    camp.add(this.skyGlow);

    // Smoke drifting up through that glow.
    const smokeTex = radialTexture('120,120,130', 1, 2);
    this.smoke = [];
    for (let i = 0; i < 7; i++) {
      const puff = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: smokeTex,
          transparent: true,
          depthWrite: false,
          opacity: 0.16,
        })
      );
      puff.userData.offset = i / 7;
      camp.add(puff);
      this.smoke.push(puff);
    }

    // --- tent ---
    const tentShape = new THREE.Shape();
    tentShape.moveTo(-1.35, 0);
    tentShape.lineTo(0, 1.75);
    tentShape.lineTo(1.35, 0);
    tentShape.closePath();
    const tentGeo = new THREE.ExtrudeGeometry(tentShape, {
      depth: 2.7,
      bevelEnabled: false,
    });
    tentGeo.translate(0, 0, -1.35);
    const tent = new THREE.Mesh(tentGeo, standard(0xb4562f, { roughness: 0.85 }));
    tent.position.set(-3.4, 0, -1.2);
    tent.rotation.y = 0.5;
    tent.castShadow = true;
    tent.receiveShadow = true;
    camp.add(tent);

    // --- the owner, waiting by the fire ---
    this.owner = new THREE.Group();
    this.owner.position.set(2.2, 0, 0.6);
    this.owner.rotation.y = -1.9; // turned toward the fire
    const skin = standard(0xd9a678, { roughness: 0.7, flatShading: false });
    const coat = standard(0xc8503c, { roughness: 0.9, flatShading: false });
    const trews = standard(0x2b3345, { flatShading: false });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.52, 4, 10), coat);
    torso.position.y = 1.06;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 10), skin);
    head.position.y = 1.56;
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.225, 14, 8,
      0, Math.PI * 2, 0, Math.PI * 0.55), standard(0x3d4d63, { flatShading: false }));
    hat.position.y = 1.60;
    for (const s of [-1, 1]) {
      const legMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 8), trews);
      legMesh.position.set(0.13 * s, 0.42, 0);
      this.owner.add(legMesh);
    }
    // Left arm is static; the right one waves once Sam is close.
    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.42, 4, 8), coat);
    armL.position.set(-0.33, 1.08, 0);
    armL.rotation.z = 0.25;
    this.waveArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.42, 4, 8), coat);
    this.waveArm.geometry.translate(0, -0.21, 0); // pivot at the shoulder
    this.waveArm.position.set(0.33, 1.28, 0);
    this.waveArm.rotation.z = -0.25;

    this.owner.add(torso, head, hat, armL, this.waveArm);
    this.owner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    camp.add(this.owner);

    // A lantern on a pole, a second small warm point in the clearing.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.4, 6), logMat);
    pole.position.set(3.6, 1.2, -2.4);
    camp.add(pole);
    const lantern = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.3, 0.24),
      new THREE.MeshBasicMaterial({ color: 0xffd99a, fog: false })
    );
    lantern.position.set(3.6, 2.3, -2.4);
    camp.add(lantern);
    const lanternLight = new THREE.PointLight(0xffc070, 6, 9, 2);
    lanternLight.position.copy(lantern.position);
    camp.add(lanternLight);

    this.camp = camp;
  }

  // ----------------------------------------------------------- fireflies ---

  _buildFireflies() {
    const count = 460;
    const positions = new Float32Array(count * 3);
    this.fireflySeed = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.fireflyPhase = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      let x, z;
      // Two thirds cluster along the river, where the damp air and the midges
      // are. The rest are scattered through the woods.
      if (this.rand() < 0.62) {
        x = (this.rand() * 2 - 1) * (WORLD - 8);
        z = riverZ(x) + (this.rand() * 2 - 1) * 16;
      } else {
        x = (this.rand() * 2 - 1) * (WORLD - 6);
        z = (this.rand() * 2 - 1) * (WORLD - 6);
      }
      // Fireflies hover just above whatever the ground is doing, including
      // drifting low over the water.
      const y = Math.max(WATER_Y, heightAt(x, z)) + 0.35 + this.rand() * 2.4;
      positions.set([x, y, z], i * 3);
      this.fireflySeed.set([x, y, z], i * 3);
      this.fireflyPhase[i] = this.rand() * Math.PI * 2;
      colors.set([0.74, 1, 0.54], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.fireflies = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        // Without a map, points render as hard squares.
        map: radialTexture('190,255,150', 1, 1.4),
        vertexColors: true,
        size: 0.16,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.scene.add(this.fireflies);
  }

  // -------------------------------------------------------------- update ---

  update(dt, playerPos) {
    this.time += dt;
    const t = this.time;
    this.bridge.update(dt, t);

    // Fire flicker: two out-of-step sine waves plus noise reads as a live
    // flame; a single sine reads as a pulsing bulb.
    const flicker =
      0.78 +
      Math.sin(t * 11.3) * 0.1 +
      Math.sin(t * 27.7) * 0.06 +
      Math.sin(t * 3.1) * 0.08;
    this.fireLight.intensity = 40 * flicker;
    this.glow.scale.setScalar(7 * (0.94 + flicker * 0.09));
    this.flames.forEach((f, i) => {
      f.scale.set(
        0.9 + Math.sin(t * (9 + i * 3) + i) * 0.13,
        0.85 + flicker * 0.3,
        0.9 + Math.cos(t * (8 + i * 4) + i) * 0.13
      );
      f.rotation.y = t * (0.8 + i * 0.4);
    });

    this.skyGlow.scale.setScalar(20 * (0.97 + flicker * 0.05));

    // Smoke: each puff rises, widens and fades, then loops back to the fire.
    this.smoke.forEach((puff) => {
      const p = (t * 0.11 + puff.userData.offset) % 1;
      puff.position.set(
        Math.sin(t * 0.6 + puff.userData.offset * 9) * p * 1.6,
        1.2 + p * 11,
        Math.cos(t * 0.5 + puff.userData.offset * 7) * p * 1.6
      );
      puff.scale.setScalar(1.2 + p * 5.5);
      puff.material.opacity = 0.19 * (1 - p) * Math.min(1, p * 5);
    });

    // Fireflies drift in slow lissajous loops around where they started.
    const arr = this.fireflies.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const sx = this.fireflySeed[i];
      const sy = this.fireflySeed[i + 1];
      const sz = this.fireflySeed[i + 2];
      arr[i] = sx + Math.sin(t * 0.5 + sx) * 0.9;
      arr[i + 1] = sy + Math.sin(t * 0.8 + sz) * 0.35;
      arr[i + 2] = sz + Math.cos(t * 0.42 + sz) * 0.9;
    }
    this.fireflies.geometry.attributes.position.needsUpdate = true;

    // Fireflies pulse rather than glowing steadily -- that on-off rhythm is
    // most of what makes them read as insects instead of floating dots.
    const col = this.fireflies.geometry.attributes.color.array;
    for (let i = 0, c = 0; c < col.length; i++, c += 3) {
      const pulse = Math.pow(
        Math.max(0, Math.sin(t * 1.9 + this.fireflyPhase[i])), 3
      );
      const b = 0.12 + pulse * 1.5;
      col[c] = 0.74 * b;
      col[c + 1] = 1.0 * b;
      col[c + 2] = 0.54 * b;
    }
    this.fireflies.geometry.attributes.color.needsUpdate = true;

    // The owner waves as Sam comes into view of the camp.
    const dist = playerPos.distanceTo(CAMP);
    const noticed = dist < 22;
    const target = noticed ? -2.4 + Math.sin(t * 7) * 0.5 : -0.25;
    this.waveArm.rotation.z += (target - this.waveArm.rotation.z) * (1 - Math.exp(-6 * dt));

    return { distance: dist, arrived: dist < GOAL_RADIUS };
  }
}

export { radialTexture };
