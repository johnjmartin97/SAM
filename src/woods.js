import * as THREE from 'three';

// A dark pine forest with a campsite somewhere in it.
//
// The stage is a navigation problem, not a platforming one: Sam can only see a
// few metres in any direction, so the forest has to be readable by landmark
// rather than by layout. The campfire glow is the one thing that carries
// through the fog, which makes it the beacon the whole level is built around.

const WORLD = 78; // half-extent of the playable ground
const TREE_COUNT = 620;
const FERN_COUNT = 900;
const ROCK_COUNT = 110;

export const SPAWN = new THREE.Vector3(4, 1.0, 62);
export const CAMP = new THREE.Vector3(-10, 0, -52);
export const GOAL_RADIUS = 5.5;

const SPAWN_CLEARING = 7;
const CAMP_CLEARING = 11;

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

    this._buildAtmosphere();
    this._buildGround();
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
    const moon = new THREE.HemisphereLight(0x2c3d5c, 0x05070a, 0.16);
    this.scene.add(moon);
    const moonDir = new THREE.DirectionalLight(0x8fa8d8, 0.14);
    moonDir.position.set(-30, 40, 20);
    this.scene.add(moonDir);
  }

  // -------------------------------------------------------------- ground ---

  _buildGround() {
    const geo = new THREE.PlaneGeometry(WORLD * 2, WORLD * 2, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(geo, standard(0x1a2417, { roughness: 1 }));
    ground.receiveShadow = true;
    this.scene.add(ground);

    const body = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)
    );
    this.world.createCollider(
      this.RAPIER.ColliderDesc.cuboid(WORLD, 0.5, WORLD),
      body
    );

    // Invisible walls, so wandering in the dark cannot take you off the map.
    for (const [x, z, hx, hz] of [
      [0, -WORLD, WORLD, 1],
      [0, WORLD, WORLD, 1],
      [-WORLD, 0, 1, WORLD],
      [WORLD, 0, 1, WORLD],
    ]) {
      const wall = this.world.createRigidBody(
        this.RAPIER.RigidBodyDesc.fixed().setTranslation(x, 6, z)
      );
      this.world.createCollider(this.RAPIER.ColliderDesc.cuboid(hx, 6, hz), wall);
    }
  }

  // --------------------------------------------------------------- trees ---

  /** Rejection sampling on a grid: cheap, and keeps trees from overlapping. */
  _scatter(count, minDist, clearings) {
    const cell = minDist;
    const grid = new Map();
    const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    const points = [];

    for (let attempt = 0; attempt < count * 40 && points.length < count; attempt++) {
      const x = (this.rand() * 2 - 1) * (WORLD - 3);
      const z = (this.rand() * 2 - 1) * (WORLD - 3);

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

      const p = { x, z };
      points.push(p);
      const k = key(x, z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
    }
    return points;
  }

  _buildTrees() {
    const spots = this._scatter(TREE_COUNT, 3.0, [
      [SPAWN.x, SPAWN.z, SPAWN_CLEARING],
      [CAMP.x, CAMP.z, CAMP_CLEARING],
    ]);

    const trunkGeo = new THREE.CylinderGeometry(0.17, 0.3, 1, 6);
    trunkGeo.translate(0, 0.5, 0); // origin at the base, so scaling grows upward
    const lowerGeo = new THREE.ConeGeometry(1, 1, 7);
    const upperGeo = new THREE.ConeGeometry(0.68, 1, 7);

    const trunks = new THREE.InstancedMesh(trunkGeo, standard(0x261c14), spots.length);
    const lower = new THREE.InstancedMesh(lowerGeo, standard(0x12220f), spots.length);
    const upper = new THREE.InstancedMesh(upperGeo, standard(0x16290f), spots.length);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    spots.forEach((p, i) => {
      const height = 6.5 + this.rand() * 6.5;
      const girth = 0.8 + this.rand() * 0.6;
      const spread = 1.5 + this.rand() * 0.9;
      const spin = this.rand() * Math.PI * 2;
      const lean = (this.rand() - 0.5) * 0.06;

      q.setFromEuler(new THREE.Euler(lean, spin, lean * 0.7));

      m.compose(pos.set(p.x, 0, p.z), q, scl.set(girth, height, girth));
      trunks.setMatrixAt(i, m);

      const canopyBase = height * 0.34;
      m.compose(
        pos.set(p.x, canopyBase, p.z), q,
        scl.set(spread, height * 0.52, spread)
      );
      lower.setMatrixAt(i, m);

      m.compose(
        pos.set(p.x, canopyBase + height * 0.34, p.z), q,
        scl.set(spread * 0.82, height * 0.46, spread * 0.82)
      );
      upper.setMatrixAt(i, m);

      // One collider per trunk. The canopy is above head height, so it is
      // decoration only -- you walk into trunks, not branches.
      const body = this.world.createRigidBody(
        this.RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, height / 2, p.z)
      );
      this.world.createCollider(
        this.RAPIER.ColliderDesc.cylinder(height / 2, 0.34 * girth),
        body
      );
    });

    for (const im of [trunks, lower, upper]) {
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      this.scene.add(im);
    }
  }

  _buildScatter() {
    // Ferns and rocks: no colliders, purely to stop the ground reading as an
    // empty plane when the light sweeps over it.
    const fernGeo = new THREE.ConeGeometry(0.42, 0.75, 5, 1, true);
    const ferns = new THREE.InstancedMesh(
      fernGeo,
      standard(0x203318, { side: THREE.DoubleSide }),
      FERN_COUNT
    );
    const rockGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, standard(0x33383a), ROCK_COUNT);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    for (let i = 0; i < FERN_COUNT; i++) {
      const x = (this.rand() * 2 - 1) * (WORLD - 2);
      const z = (this.rand() * 2 - 1) * (WORLD - 2);
      const s = 0.6 + this.rand() * 0.9;
      q.setFromEuler(new THREE.Euler(0, this.rand() * Math.PI * 2, 0));
      m.compose(pos.set(x, 0, z), q, scl.set(s, s * (0.7 + this.rand() * 0.6), s));
      ferns.setMatrixAt(i, m);
    }
    for (let i = 0; i < ROCK_COUNT; i++) {
      const x = (this.rand() * 2 - 1) * (WORLD - 2);
      const z = (this.rand() * 2 - 1) * (WORLD - 2);
      const s = 0.4 + this.rand() * 0.8;
      q.setFromEuler(
        new THREE.Euler(this.rand(), this.rand() * Math.PI * 2, this.rand())
      );
      m.compose(pos.set(x, s * 0.25, z), q, scl.set(s, s * 0.7, s));
      rocks.setMatrixAt(i, m);
    }

    for (const im of [ferns, rocks]) {
      im.instanceMatrix.needsUpdate = true;
      im.receiveShadow = true;
      this.scene.add(im);
    }
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
    const count = 220;
    const positions = new Float32Array(count * 3);
    this.fireflySeed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = (this.rand() * 2 - 1) * (WORLD - 6);
      const z = (this.rand() * 2 - 1) * (WORLD - 6);
      const y = 0.4 + this.rand() * 2.2;
      positions.set([x, y, z], i * 3);
      this.fireflySeed.set([x, y, z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.fireflies = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xbdff8a,
        size: 0.13,
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

    // The owner waves as Sam comes into view of the camp.
    const dist = playerPos.distanceTo(CAMP);
    const noticed = dist < 22;
    const target = noticed ? -2.4 + Math.sin(t * 7) * 0.5 : -0.25;
    this.waveArm.rotation.z += (target - this.waveArm.rotation.z) * (1 - Math.exp(-6 * dt));

    return { distance: dist, arrived: dist < GOAL_RADIUS };
  }
}

export { radialTexture };
