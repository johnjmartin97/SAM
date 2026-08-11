import * as THREE from 'three';

// Every platform is authored once here and produces both the visible mesh and
// the physics collider, so the two can never drift apart.
const PLATFORMS = [
  // [x, y, z, width, height, depth, colorIndex]
  [0, -0.5, 0, 40, 1, 40, 0], // ground
  [6, 0.6, -4, 4, 1.2, 4, 1],
  [11, 1.8, -7, 3.5, 1.2, 3.5, 1],
  [15, 3.0, -11, 3, 1.2, 3, 1],
  [12, 4.4, -16, 3, 1.2, 6, 2],
  [6, 5.6, -18, 3, 1.2, 3, 2],
  [0, 6.8, -18, 3, 1.2, 3, 2],
  [-6, 6.8, -14, 5, 1.2, 5, 3],
  [-9, 2.2, -6, 3, 1.2, 3, 1],
  [-14, 0.9, 0, 4, 1.2, 4, 1],
  // low wall to bump into, proves collision from the side
  [0, 0.9, 8, 10, 2.8, 1, 4],
];

const PALETTE = [0x4f7a52, 0x8b6f47, 0x9c6b52, 0xb06a7a, 0x5a6a8a];

export function buildLevel(scene, RAPIER, world) {
  const group = new THREE.Group();
  scene.add(group);

  for (const [x, y, z, w, h, d, c] of PLATFORMS) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: PALETTE[c], roughness: 0.95, flatShading: true })
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), body);
  }

  return group;
}

// Where the player starts, and how far they can fall before being reset.
export const SPAWN = new THREE.Vector3(0, 1.2, 6);
export const KILL_Y = -12;
