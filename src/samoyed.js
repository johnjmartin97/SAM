import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Two ways to get a dog, both returning the same shape:
//   { root, head, tail, body, legs: { frontL, frontR, backL, backR } }
//
// loadSamoyed()   -- the real model, built by tools/blender/make_samoyed.py.
// createSamoyed() -- a box placeholder, used if the model is missing.
//
// The Blender script gives every part the same name and pivot point as the
// placeholder, so animateSamoyed() below drives either one unchanged.

const PART_NAMES = {
  head: 'head',
  tail: 'tail',
  body: 'body',
  frontL: 'leg_front_L',
  frontR: 'leg_front_R',
  backL: 'leg_back_L',
  backR: 'leg_back_R',
};

export async function loadSamoyed(url = '/models/samoyed.glb') {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;

  const find = (name) => {
    const o = root.getObjectByName(name);
    if (!o) throw new Error(`samoyed.glb is missing the part named "${name}"`);
    return o;
  };

  const rig = {
    root,
    head: find(PART_NAMES.head),
    tail: find(PART_NAMES.tail),
    body: find(PART_NAMES.body),
    legs: {
      frontL: find(PART_NAMES.frontL),
      frontR: find(PART_NAMES.frontR),
      backL: find(PART_NAMES.backL),
      backR: find(PART_NAMES.backR),
    },
  };

  // Remember where the body rests so the trot bob is relative to it.
  rig.bodyRestY = rig.body.position.y;

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      // See the note in fur.js: self-shadowing under his own lamp is all
      // artifact, so he casts but does not receive.
      o.receiveShadow = false;
    }
  });

  return rig;
}

const CREAM = 0xf6f1e7;
const SHADOW_CREAM = 0xe3dccd;
const NOSE = 0x2b2b30;

function box(w, h, d, color) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true })
  );
}

// A limb whose pivot sits at the hip/shoulder, so rotating it swings the leg.
function leg(x, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0.42, z);
  const upper = box(0.17, 0.42, 0.17, CREAM);
  upper.position.y = -0.21;
  const paw = box(0.2, 0.12, 0.24, SHADOW_CREAM);
  paw.position.set(0, -0.46, 0.02);
  pivot.add(upper, paw);
  return pivot;
}

export function createSamoyed() {
  const root = new THREE.Group();

  const body = box(0.55, 0.5, 0.95, CREAM);
  body.position.y = 0.62;
  root.add(body);

  const chest = box(0.58, 0.46, 0.35, CREAM);
  chest.position.set(0, 0.66, -0.4);
  root.add(chest);

  // Head assembly, pivoted at the neck so it can tilt as one piece.
  const head = new THREE.Group();
  head.position.set(0, 0.92, -0.62);
  const skull = box(0.42, 0.38, 0.4, CREAM);
  head.add(skull);
  const snout = box(0.22, 0.18, 0.26, CREAM);
  snout.position.set(0, -0.06, -0.3);
  head.add(snout);
  const nose = box(0.11, 0.09, 0.08, NOSE);
  nose.position.set(0, -0.02, -0.45);
  head.add(nose);
  for (const s of [-1, 1]) {
    const eye = box(0.07, 0.09, 0.05, NOSE);
    eye.position.set(0.11 * s, 0.06, -0.2);
    head.add(eye);
    const ear = box(0.14, 0.18, 0.08, SHADOW_CREAM);
    ear.position.set(0.14 * s, 0.24, 0.02);
    ear.rotation.z = -0.25 * s;
    head.add(ear);
  }
  root.add(head);

  // Curled tail, pivoted at the base.
  const tail = new THREE.Group();
  tail.position.set(0, 0.8, 0.45);
  const t1 = box(0.14, 0.3, 0.14, CREAM);
  t1.position.y = 0.14;
  const t2 = box(0.13, 0.13, 0.3, CREAM);
  t2.position.set(0, 0.3, 0.1);
  tail.add(t1, t2);
  root.add(tail);

  const legs = {
    frontL: leg(-0.19, -0.3),
    frontR: leg(0.19, -0.3),
    backL: leg(-0.19, 0.32),
    backR: leg(0.19, 0.32),
  };
  for (const l of Object.values(legs)) root.add(l);

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return { root, head, tail, legs, body, bodyRestY: body.position.y };
}

// Simple procedural animation: a trot cycle that speeds up with movement, plus
// a tucked pose in the air. Keeps the prototype readable without a rig.
export function animateSamoyed(
  dog,
  { speed, grounded, time, dt, gaitPhase = null, swimming = false, shake = 0 }
) {
  const gait = Math.min(speed / 6, 1);
  // Driven by distance travelled when it is available, so the paws stay
  // planted on the ground instead of skating over it.
  const cycle = gaitPhase !== null ? gaitPhase : time * (6 + gait * 8);
  const swing = gait * 0.85;

  if (swimming) {
    // A dog paddle: the front legs do nearly all the work, reaching forward
    // and pulling down, while the back legs kick shallowly behind.
    const paddle = time * 13;
    dog.legs.frontL.rotation.x = -0.35 + Math.sin(paddle) * 0.5;
    dog.legs.frontR.rotation.x = -0.35 + Math.sin(paddle + Math.PI) * 0.5;
    dog.legs.backL.rotation.x = 0.3 + Math.sin(paddle + Math.PI) * 0.28;
    dog.legs.backR.rotation.x = 0.3 + Math.sin(paddle) * 0.28;
    dog.body.position.y = dog.bodyRestY + Math.sin(time * 2.6) * 0.015;
  } else if (grounded) {
    dog.legs.frontL.rotation.x = Math.sin(cycle) * swing;
    dog.legs.backR.rotation.x = Math.sin(cycle) * swing;
    dog.legs.frontR.rotation.x = Math.sin(cycle + Math.PI) * swing;
    dog.legs.backL.rotation.x = Math.sin(cycle + Math.PI) * swing;
    dog.body.position.y = dog.bodyRestY + Math.abs(Math.sin(cycle)) * 0.03 * gait;
  } else {
    // Airborne: tuck the front legs forward, trail the back legs.
    const t = Math.min(1, dt * 12);
    dog.legs.frontL.rotation.x += (-0.9 - dog.legs.frontL.rotation.x) * t;
    dog.legs.frontR.rotation.x += (-0.9 - dog.legs.frontR.rotation.x) * t;
    dog.legs.backL.rotation.x += (0.7 - dog.legs.backL.rotation.x) * t;
    dog.legs.backR.rotation.x += (0.7 - dog.legs.backR.rotation.x) * t;
  }

  if (swimming) {
    dog.head.rotation.x = -0.2; // nose held clear of the water
    dog.tail.rotation.x = -0.1;
  } else {
    dog.head.rotation.x = gait * 0.12;
    dog.tail.rotation.x = -0.5 + Math.sin(time * 9) * 0.12 * (0.4 + gait);
  }

  // Shaking off: the dog rolls about its own spine, with the head and tail
  // lagging behind the body -- that lag is what sells it as a whip rather
  // than a rigid object spinning.
  const wag = swimming ? 0 : Math.sin(time * 7) * 0.18;
  dog.body.rotation.z = Math.sin(time * 40) * 0.62 * shake;
  dog.head.rotation.z = Math.sin(time * 40 - 0.7) * 0.75 * shake;
  dog.tail.rotation.z = wag + Math.sin(time * 40 - 1.4) * 0.8 * shake;
}
