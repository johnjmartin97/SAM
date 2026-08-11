import * as THREE from 'three';
import * as TEX from './textures.js';
import { SOFT_GROUPS } from './collision.js';

// The forest.
//
// A tree here is a trunk mesh plus a few dozen flat cards, each carrying an
// alpha-cut picture of a needle spray or a leaf clump. That is how trees are
// built in real-time engines, and it is the difference between a green cone
// and something with a ragged, layered edge you can see the sky through.
//
// Everything is instanced: all conifer foliage in the whole forest is one draw
// call, all broadleaf foliage another. Per-instance colour keeps six hundred
// trees from looking like one tree copied six hundred times.

/* ------------------------------------------------------------- geometry -- */

/**
 * A trunk: tapered, gently bent, with a flare where it meets the ground.
 * Built at height 1 so instances can scale it; radii are in world units.
 *
 * The root flare is worth the trouble -- a cylinder meeting the ground at a
 * hard right angle is one of the strongest "this is a video game" signals.
 */
function trunkGeometry({
  rBase, rTop, flare = 0.2, bend = 0.15, gnarl = 0.05, seed = 1,
  radial = 8, rings = 12,
}) {
  let a = seed * 9871;
  const rand = () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };

  const positions = [];
  const uvs = [];
  const indices = [];

  // Where the spine drifts as it rises. Squared, so the lean develops
  // higher up rather than tipping the whole trunk off its base.
  const bendDirX = Math.cos(seed * 2.4);
  const bendDirZ = Math.sin(seed * 2.4);

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    // Radius: taper toward the top, plus a flare that dies away quickly.
    const radius =
      THREE.MathUtils.lerp(rBase, rTop, Math.pow(t, 0.7)) +
      flare * Math.exp(-t * 11) * rBase;

    const cx = bendDirX * bend * t * t;
    const cz = bendDirZ * bend * t * t;

    for (let i = 0; i <= radial; i++) {
      const u = i / radial;
      const ang = u * Math.PI * 2;
      // Gnarl: per-ring lumps, so the trunk is not a perfect circle.
      const lump = 1 + Math.sin(ang * 3 + r * 1.7) * gnarl + (rand() - 0.5) * gnarl;
      positions.push(
        cx + Math.cos(ang) * radius * lump,
        t,
        cz + Math.sin(ang) * radius * lump
      );
      // v repeats up the trunk so bark keeps a constant real-world scale.
      uvs.push(u * 2, t * 3.2);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < radial; i++) {
      const A = r * (radial + 1) + i;
      const B = A + radial + 1;
      indices.push(A, B, A + 1, A + 1, B, B + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Four trunk shapes, shared across species by scaling.
const TRUNK_VARIANTS = [
  { key: 'straight', rBase: 0.26, rTop: 0.11, flare: 0.16, bend: 0.06, gnarl: 0.03 },
  { key: 'tapered', rBase: 0.34, rTop: 0.09, flare: 0.26, bend: 0.16, gnarl: 0.06 },
  { key: 'gnarled', rBase: 0.44, rTop: 0.17, flare: 0.36, bend: 0.42, gnarl: 0.17 },
  { key: 'slender', rBase: 0.19, rTop: 0.07, flare: 0.10, bend: 0.26, gnarl: 0.02 },
];

/* -------------------------------------------------------------- species -- */

// foliage.kind: 'needle' | 'leaf' | 'scrub' | null
// crown.shape: 'cone' (conifers) | 'blob' (broadleaf)
export const SPECIES = [
  {
    name: 'scots pine',
    weight: 0.15,
    height: [12, 19], girth: [0.85, 1.35],
    trunk: 'tapered', bark: 'furrowed', barkTint: 0x8a6a4a,
    // Scots pines self-prune: a long bare trunk, foliage only up top.
    crown: { shape: 'cone', from: 0.66, to: 1.0, whorls: 5, per: 7,
             radius: [2.3, 3.3], droop: 0.22, card: [2.5, 1.5], tint: 0x5c7a42 },
    kind: 'needle',
  },
  {
    name: 'norway spruce',
    weight: 0.19,
    height: [11, 20], girth: [0.7, 1.1],
    trunk: 'straight', bark: 'furrowed', barkTint: 0x6a5540,
    crown: { shape: 'cone', from: 0.16, to: 1.0, whorls: 11, per: 8,
             radius: [0.6, 2.9], droop: 0.55, card: [2.2, 1.3], tint: 0x40613a },
    kind: 'needle',
  },
  {
    name: 'young fir',
    weight: 0.11,
    height: [1.8, 4.2], girth: [0.7, 1.2],
    trunk: 'straight', bark: 'furrowed', barkTint: 0x5c4a38,
    // Skirts the ground. This is the one you actually have to walk around.
    crown: { shape: 'cone', from: 0.02, to: 1.0, whorls: 7, per: 7,
             radius: [0.5, 1.5], droop: 0.5, card: [1.4, 0.95], tint: 0x37552f },
    kind: 'needle', blocksGround: true,
  },
  {
    name: 'silver birch',
    weight: 0.13,
    height: [8, 14], girth: [0.6, 1.0],
    trunk: 'slender', bark: 'papery', barkTint: 0xd8d3c6,
    crown: { shape: 'blob', from: 0.55, to: 1.0, whorls: 6, per: 9,
             radius: [1.4, 2.4], droop: 0.75, card: [1.9, 1.5], tint: 0x76913f },
    kind: 'leaf',
  },
  {
    name: 'oak',
    weight: 0.09,
    height: [9, 14], girth: [1.3, 2.1],
    trunk: 'gnarled', bark: 'furrowed', barkTint: 0x6b5842,
    crown: { shape: 'blob', from: 0.44, to: 1.0, whorls: 6, per: 12,
             radius: [2.6, 4.4], droop: 0.3, card: [2.8, 2.2], tint: 0x4e6a30 },
    kind: 'leaf',
  },
  {
    name: 'beech',
    weight: 0.09,
    height: [11, 17], girth: [0.9, 1.5],
    trunk: 'smoothTall', bark: 'smooth', barkTint: 0x8a8578,
    crown: { shape: 'blob', from: 0.58, to: 1.0, whorls: 6, per: 10,
             radius: [2.0, 3.3], droop: 0.45, card: [2.4, 1.9], tint: 0x5f7c36 },
    kind: 'leaf',
  },
  {
    name: 'dead snag',
    weight: 0.09,
    height: [4.5, 11], girth: [0.7, 1.3],
    trunk: 'gnarled', bark: 'furrowed', barkTint: 0x4a4034,
    crown: null, kind: null, limbs: 4,
  },
  {
    name: 'sapling',
    weight: 0.09,
    height: [1.2, 2.6], girth: [0.5, 0.9],
    trunk: 'slender', bark: 'smooth', barkTint: 0x7a7060,
    crown: { shape: 'blob', from: 0.4, to: 1.0, whorls: 3, per: 5,
             radius: [0.45, 0.8], droop: 0.5, card: [0.9, 0.7], tint: 0x74913f },
    kind: 'leaf', blocksGround: true,
  },
  {
    name: 'stump',
    weight: 0.06,
    height: [0.4, 1.1], girth: [1.5, 2.6],
    trunk: 'tapered', bark: 'furrowed', barkTint: 0x4e4030,
    crown: null, kind: null, blocksGround: true,
  },
];

// The trunk variant table is keyed by name; 'smoothTall' reuses 'straight'.
const VARIANT_FOR = {
  straight: 'straight', tapered: 'tapered', gnarled: 'gnarled',
  slender: 'slender', smoothTall: 'straight',
};

/* --------------------------------------------------------------- helper -- */

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _basis = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _axis = new THREE.Vector3(1, 0, 0);
const _fallback = new THREE.Vector3(1, 0, 0);
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();

/**
 * Orient a foliage card so its long axis runs along `dir` (out from the
 * trunk), with a random roll about that axis so cards do not all face the
 * same way.
 */
function cardMatrix(out, origin, dir, len, width, roll) {
  _x.copy(dir).normalize();
  // Guard against a branch pointing straight up, where the cross product dies.
  _z.crossVectors(_x, Math.abs(_x.y) > 0.97 ? _fallback : _up).normalize();
  _y.crossVectors(_z, _x).normalize();

  _basis.makeBasis(_x, _y, _z);
  _q.setFromRotationMatrix(_basis);
  _q.multiply(_roll.setFromAxisAngle(_axis, roll));

  // Thirty thousand cards get built at load, so nothing here allocates.
  _pos.copy(_x).multiplyScalar(len * 0.5).add(origin);
  out.compose(_pos, _q, _scale.set(len, width, 1));
  return out;
}

/* ----------------------------------------------------------------- wind -- */

const windUniforms = { uTime: { value: 0 }, uWindStrength: { value: 1 } };

/**
 * Make a material sway. Recomputes the world position after instancing, so
 * the whole forest moves together as gusts roll across it rather than every
 * tree wobbling on its own clock.
 */
function applyWind(material, strength) {
  const local = { value: strength };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uSway = local;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uWindStrength;
         uniform float uSway;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         {
           vec4 op = vec4(transformed, 1.0);
           #ifdef USE_INSTANCING
             op = instanceMatrix * op;
           #endif
           vec3 wp = (modelMatrix * op).xyz;
           float phase = wp.x * 0.28 + wp.z * 0.21;
           float gust = sin(uTime * 0.75 + phase)
                      + 0.42 * sin(uTime * 1.9 + phase * 1.7)
                      + 0.18 * sin(uTime * 4.3 + phase * 3.1);
           // Nothing near the ground moves; the top of a tree moves a lot.
           float hgt = clamp((wp.y - 0.7) * 0.10, 0.0, 1.6);
           vec3 disp = vec3(0.16, 0.03, 0.11) * gust * hgt * uSway * uWindStrength;
           mvPosition.xyz += (viewMatrix * vec4(disp, 0.0)).xyz;
           gl_Position = projectionMatrix * mvPosition;
         }`
      );
  };
  material.customProgramCacheKey = () => `wind${strength}`;
  return material;
}

export function updateWind(dt) {
  windUniforms.uTime.value += dt;
}

/* ---------------------------------------------------------------- build -- */

export function buildForest(scene, RAPIER, world, spots, rand) {
  // --- shared materials -------------------------------------------------
  const barkMaps = {
    furrowed: TEX.bark('furrowed', 2),
    papery: TEX.bark('papery', 7),
    smooth: TEX.bark('smooth', 13),
  };

  const barkMaterials = {};
  for (const [style, { map, canvas }] of Object.entries(barkMaps)) {
    barkMaterials[style] = applyWind(
      new THREE.MeshStandardMaterial({
        map,
        normalMap: TEX.normalFromCanvas(canvas, style === 'papery' ? 1.2 : 2.6),
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: style === 'papery' ? 0.82 : 0.95,
        metalness: 0,
      }),
      0.25 // trunks barely move
    );
  }

  const foliageMaterial = (map, rough) =>
    applyWind(
      new THREE.MeshStandardMaterial({
        map,
        alphaTest: 0.42, // cut, not blended: keeps depth sorting honest
        side: THREE.DoubleSide,
        roughness: rough,
        metalness: 0,
        // A leaf is thin enough to pass light. Standing in for real
        // translucency: foliage never goes fully black, which is what stops
        // the canopy reading as a flat cut-out against the sky.
        emissive: new THREE.Color(0x16240e),
        emissiveIntensity: 1,
      }),
      1
    );

  const foliageMats = {
    needle: foliageMaterial(TEX.needleSpray(3), 0.88),
    leaf: foliageMaterial(TEX.leafCluster(5), 0.8),
    scrub: foliageMaterial(TEX.scrub(9), 0.9),
  };

  const trunkGeos = {};
  for (const v of TRUNK_VARIANTS) trunkGeos[v.key] = trunkGeometry({ ...v, seed: 3 });

  const cardGeo = new THREE.PlaneGeometry(1, 1);

  // --- sort every spot into a species -----------------------------------
  const totalWeight = SPECIES.reduce((s, k) => s + k.weight, 0);
  const pick = () => {
    let r = rand() * totalWeight;
    for (const s of SPECIES) {
      r -= s.weight;
      if (r <= 0) return s;
    }
    return SPECIES[0];
  };

  const trunkBuckets = {}; // barkStyle|variant -> array of {matrix, color}
  const cards = { needle: [], leaf: [], scrub: [] };
  const limbs = [];

  const m = new THREE.Matrix4();
  const colorTmp = new THREE.Color();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();

  const push = (bucket, matrix, color) => {
    if (!trunkBuckets[bucket]) trunkBuckets[bucket] = [];
    trunkBuckets[bucket].push({ matrix: matrix.clone(), color: color.clone() });
  };

  for (const spot of spots) {
    const sp = pick();
    const height = THREE.MathUtils.lerp(sp.height[0], sp.height[1], rand());
    const girth = THREE.MathUtils.lerp(sp.girth[0], sp.girth[1], rand());
    const variant = VARIANT_FOR[sp.trunk];
    const spin = rand() * Math.PI * 2;
    const lean = (rand() - 0.5) * 0.05;

    _q.setFromEuler(new THREE.Euler(lean, spin, lean * 0.8));
    m.compose(
      new THREE.Vector3(spot.x, spot.y, spot.z),
      _q,
      new THREE.Vector3(girth, height, girth)
    );

    // Per-tree bark colour, so no two trunks are quite the same.
    colorTmp.setHex(sp.barkTint);
    const v = 0.72 + rand() * 0.5;
    colorTmp.multiplyScalar(v);
    push(`${sp.bark}|${variant}`, m, colorTmp);

    const trunkRadius = TRUNK_VARIANTS.find((t) => t.key === variant).rBase * girth;

    // --- collision on the trunk ---
    addCylinder(RAPIER, world, spot.x, spot.y + height / 2, spot.z,
      height / 2, trunkRadius * 1.1);

    // --- dead snags get bare limbs instead of foliage ---
    if (sp.limbs) {
      for (let k = 0; k < sp.limbs; k++) {
        const a = rand() * Math.PI * 2;
        const tilt = 0.55 + rand() * 0.6;
        const len = 1.0 + rand() * 2.2;
        origin.set(spot.x, spot.y + height * (0.45 + rand() * 0.48), spot.z);
        dir.set(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
        const lm = new THREE.Matrix4();
        _q.setFromUnitVectors(_up, dir.clone().normalize());
        lm.compose(
          dir.clone().multiplyScalar(len * 0.5).add(origin),
          _q,
          new THREE.Vector3(girth * 0.5, len, girth * 0.5)
        );
        limbs.push({ matrix: lm, color: colorTmp.clone() });
      }
    }

    // --- foliage ---
    if (sp.crown && sp.kind) {
      const c = sp.crown;
      const list = cards[sp.kind];
      const base = colorTmp.setHex(c.tint);
      // Whole-tree colour shift, then per-card jitter on top.
      const treeShade = 0.72 + rand() * 0.55;
      const treeHue = (rand() - 0.5) * 0.05;

      for (let w = 0; w < c.whorls; w++) {
        const t = c.whorls === 1 ? 0.5 : w / (c.whorls - 1);
        const y = spot.y + height * THREE.MathUtils.lerp(c.from, c.to, t);

        // Cone crowns taper to a point; blob crowns bulge in the middle.
        let radius;
        if (c.shape === 'cone') {
          radius = THREE.MathUtils.lerp(c.radius[1], c.radius[0], t) * girth;
        } else {
          radius = c.radius[1] * girth * Math.sin(Math.min(1, 0.18 + t * 0.9) * Math.PI);
          radius = Math.max(radius, c.radius[0] * girth * 0.5);
        }

        const per = Math.max(3, Math.round(c.per * (c.shape === 'cone' ? 1 - t * 0.45 : 1)));
        for (let i = 0; i < per; i++) {
          const a = (i / per) * Math.PI * 2 + w * 1.31 + rand() * 0.4;
          const droop = c.droop * (0.55 + rand() * 0.9);
          dir.set(Math.cos(a), -droop + (rand() - 0.5) * 0.25, Math.sin(a));
          origin.set(spot.x + Math.cos(a) * radius * 0.12, y, spot.z + Math.sin(a) * radius * 0.12);

          const len = radius * (0.85 + rand() * 0.5) * (c.card[0] / 2.2);
          const wid = c.card[1] * girth * (0.75 + rand() * 0.5);
          const cm = new THREE.Matrix4();
          cardMatrix(cm, origin, dir, len, wid, rand() * Math.PI * 2);

          const shade = treeShade * (0.82 + rand() * 0.36);
          const col = new THREE.Color(base.r, base.g, base.b);
          col.offsetHSL(treeHue, (rand() - 0.5) * 0.06, 0);
          col.multiplyScalar(shade);
          list.push({ matrix: cm, color: col });
        }
      }

      // --- collision on the foliage ---
      addFoliageCollider(RAPIER, world, sp, spot, height, girth, c);
    }
  }

  // --- turn the buckets into instanced meshes ---------------------------
  const meshes = [];
  const makeInstanced = (geo, mat, items, cast = true) => {
    if (!items.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, i) => {
      im.setMatrixAt(i, it.matrix);
      im.setColorAt(i, it.color);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = cast;
    // Alpha-cut cards are one polygon thick and double sided. Under a close
    // point light the depth comparison has nothing sensible to compare, and
    // the result is hard black blotches crawling over every leaf. Foliage is
    // lit directly and not shadowed.
    im.receiveShadow = cast;
    // Wind moves vertices outside their original bounds.
    im.frustumCulled = false;
    scene.add(im);
    meshes.push(im);
    return im;
  };

  for (const [key, items] of Object.entries(trunkBuckets)) {
    const [style, variant] = key.split('|');
    makeInstanced(trunkGeos[variant], barkMaterials[style], items);
  }
  if (limbs.length) {
    makeInstanced(
      new THREE.CylinderGeometry(0.04, 0.1, 1, 5).translate(0, 0.5, 0),
      barkMaterials.furrowed, limbs
    );
  }
  // Foliage does not cast shadows: only the campfire casts any, and alpha-cut
  // shadow maps on 18,000 cards would cost far more than they are worth.
  for (const kind of ['needle', 'leaf', 'scrub']) {
    makeInstanced(cardGeo, foliageMats[kind], cards[kind], false);
  }

  return {
    meshes,
    cardMaterials: foliageMats,
    counts: {
      trees: spots.length,
      cards: cards.needle.length + cards.leaf.length + cards.scrub.length,
    },
  };
}

/* ------------------------------------------------------------ colliders -- */

function addCylinder(RAPIER, world, x, y, z, halfHeight, radius, soft = false) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
  );
  const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius);
  if (soft) desc.setCollisionGroups(SOFT_GROUPS);
  world.createCollider(desc, body);
}

function addBall(RAPIER, world, x, y, z, radius, soft = false) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
  );
  const desc = RAPIER.ColliderDesc.ball(radius);
  if (soft) desc.setCollisionGroups(SOFT_GROUPS);
  world.createCollider(desc, body);
}

/**
 * Collision for the canopy.
 *
 * Above head height this does not change where Sam can walk -- it stops the
 * camera flying through branches, which is what you actually notice. For
 * species that skirt the ground it is real, walkable-world collision.
 */
function addFoliageCollider(RAPIER, world, sp, spot, height, girth, c) {
  const bottom = spot.y + height * c.from;
  const top = spot.y + height * c.to;
  const mid = (bottom + top) * 0.5;
  const maxR = c.radius[1] * girth;

  if (c.shape === 'cone') {
    // Rapier cones point +Y, which is exactly a conifer crown.
    addBall(RAPIER, world, spot.x, mid, spot.z, maxR * 0.7, true);
  } else {
    addBall(RAPIER, world, spot.x, mid, spot.z, maxR * 0.8, true);
  }
}

/**
 * Bushes and bramble: the undergrowth. Bushes get collision, so the forest
 * floor is something you pick your way through rather than a smooth plane
 * with scenery painted on it.
 */
export function buildUndergrowth(scene, RAPIER, world, spots, rand, { collide = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: TEX.scrub(21),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });
  applyWind(mat, 1.4); // undergrowth is light and moves most
  mat.customProgramCacheKey = () => 'wind-scrub';

  const geo = new THREE.PlaneGeometry(1, 1);
  const items = [];
  const m = new THREE.Matrix4();
  const dir = new THREE.Vector3();
  const origin = new THREE.Vector3();

  for (const spot of spots) {
    const size = 0.7 + rand() * 1.5;
    const cards = 5 + ((rand() * 6) | 0);
    const tint = new THREE.Color(0x4a6630).multiplyScalar(0.7 + rand() * 0.6);

    for (let i = 0; i < cards; i++) {
      const a = (i / cards) * Math.PI * 2 + rand() * 0.7;
      const rise = 0.25 + rand() * 0.7;
      dir.set(Math.cos(a), rise, Math.sin(a));
      origin.set(spot.x, spot.y + 0.05, spot.z);
      const cm = new THREE.Matrix4();
      cardMatrix(cm, origin, dir, size * (0.8 + rand() * 0.6), size * 0.9, rand() * 6.28);
      items.push({
        matrix: cm,
        color: tint.clone().multiplyScalar(0.8 + rand() * 0.4),
      });
    }

    if (collide) {
      addBall(RAPIER, world, spot.x, spot.y + size * 0.35, spot.z, size * 0.45, true);
    }
  }

  if (!items.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    im.setMatrixAt(i, it.matrix);
    im.setColorAt(i, it.color);
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = false;
  im.receiveShadow = false; // see the note in _multimesh
  im.frustumCulled = false;
  scene.add(im);
  return im;
}

/* --------------------------------------------------------------- thickets -- */

/**
 * The maze walls: bands of impassable scrub, deadfall and young conifers.
 *
 * Collision is ONE box per wall rather than a collider per bush. That keeps
 * the count sane, and more importantly it makes the barrier exactly the thing
 * check-maze.mjs reasons about -- no chance of a gap opening up between two
 * bushes that the solver believed was sealed. The box is set narrower than the
 * planting, so you push into the foliage before you stop rather than hitting
 * an invisible wall in mid-air.
 */
export function buildThickets(scene, RAPIER, world, walls, rand, heightAt) {
  const scrubMat = new THREE.MeshStandardMaterial({
    map: TEX.scrub(31),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.92,
  });
  applyWind(scrubMat, 1.1);
  scrubMat.customProgramCacheKey = () => 'wind-thicket';

  const needleMat = new THREE.MeshStandardMaterial({
    map: TEX.needleSpray(37),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });
  applyWind(needleMat, 0.8);
  needleMat.customProgramCacheKey = () => 'wind-thicket-needle';

  const cardGeo = new THREE.PlaneGeometry(1, 1);
  const scrubCards = [];
  const needleCards = [];

  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const HALF_THICK = 0.8; // collider half-depth; planting spreads wider

  for (const w of walls) {
    const alongX = w.axis === 'x';
    const len = w.length;

    // --- the barrier itself ---
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(w.cx, heightAt(w.cx, w.cz) + 1.1, w.cz)
    );
    const wallDesc = RAPIER.ColliderDesc.cuboid(
      alongX ? len / 2 : HALF_THICK,
      1.5,
      alongX ? HALF_THICK : len / 2
    ).setCollisionGroups(SOFT_GROUPS);
    world.createCollider(wallDesc, body);

    // --- the planting that explains it ---
    const clumps = 7;
    for (let k = 0; k < clumps; k++) {
      const t = (k + 0.5) / clumps;
      const jitterAcross = (rand() - 0.5) * 1.7;
      const x = alongX
        ? w.x1 + (w.x2 - w.x1) * t + (rand() - 0.5) * 0.8
        : w.cx + jitterAcross;
      const z = alongX
        ? w.cz + jitterAcross
        : w.z1 + (w.z2 - w.z1) * t + (rand() - 0.5) * 0.8;
      const y = heightAt(x, z);
      const tint = new THREE.Color(0x3c5427).multiplyScalar(0.62 + rand() * 0.55);

      // Low scrub, splayed outward.
      const bushCards = 5 + ((rand() * 4) | 0);
      const size = 1.1 + rand() * 1.1;
      for (let i = 0; i < bushCards; i++) {
        const a = (i / bushCards) * Math.PI * 2 + rand() * 0.8;
        dir.set(Math.cos(a), 0.3 + rand() * 0.8, Math.sin(a));
        origin.set(x, y + 0.05, z);
        const cm = new THREE.Matrix4();
        cardMatrix(cm, origin, dir, size * (0.85 + rand() * 0.6), size, rand() * 6.28);
        scrubCards.push({
          matrix: cm,
          color: tint.clone().multiplyScalar(0.82 + rand() * 0.4),
        });
      }

      // Every other clump gets a young conifer, for height and silhouette.
      if (rand() < 0.55) {
        const h = 1.6 + rand() * 2.2;
        const whorls = 5;
        for (let wI = 0; wI < whorls; wI++) {
          const ft = wI / (whorls - 1);
          const per = 5;
          const radius = (1.3 - ft * 0.95) * (0.7 + rand() * 0.5);
          for (let i = 0; i < per; i++) {
            const a = (i / per) * Math.PI * 2 + wI * 1.3;
            dir.set(Math.cos(a), -0.42 + (rand() - 0.5) * 0.2, Math.sin(a));
            origin.set(x, y + 0.25 + ft * h * 0.85, z);
            const cm = new THREE.Matrix4();
            cardMatrix(cm, origin, dir, radius * 1.25, radius * 0.95, rand() * 6.28);
            needleCards.push({
              matrix: cm,
              color: new THREE.Color(0x35522c).multiplyScalar(0.7 + rand() * 0.5),
            });
          }
        }
      }
    }
  }

  const add = (items, mat) => {
    if (!items.length) return null;
    const im = new THREE.InstancedMesh(cardGeo, mat, items.length);
    items.forEach((it, i) => {
      im.setMatrixAt(i, it.matrix);
      im.setColorAt(i, it.color);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = false; // see the note in _multimesh
    im.frustumCulled = false;
    scene.add(im);
    return im;
  };

  add(scrubCards, scrubMat);
  add(needleCards, needleMat);

  return { cards: scrubCards.length + needleCards.length, walls: walls.length };
}
