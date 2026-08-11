import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './input.js';
import { buildLevel } from './level.js';
import { Player } from './player.js';
import { FollowCamera } from './camera.js';
import { loadSamoyed, createSamoyed } from './samoyed.js';
import { Fur } from './fur.js';

await RAPIER.init();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc4e8);
scene.fog = new THREE.Fog(0x8fc4e8, 45, 110);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);

// Sky bounce + one warm key light that casts the shadows.
scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x5a5040, 1.15));
const sun = new THREE.DirectionalLight(0xfff2d8, 2.0);
sun.position.set(14, 24, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -35;
sun.shadow.camera.right = 35;
sun.shadow.camera.top = 35;
sun.shadow.camera.bottom = -35;
sun.shadow.camera.far = 80;
sun.shadow.bias = -0.0008;
scene.add(sun);

const world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // gravity handled by the controller
buildLevel(scene, RAPIER, world);

// Use the Blender-built model; fall back to the box placeholder if it is
// missing or malformed, so a bad export never leaves you with a blank screen.
let dog;
try {
  dog = await loadSamoyed();
} catch (err) {
  console.warn('SAM: falling back to the placeholder dog —', err.message);
  dog = createSamoyed();
}

const input = new Input(renderer.domElement);
const player = new Player(scene, RAPIER, world, dog);
const fur = new Fur().apply(dog.root);
const follow = new FollowCamera(camera, world, RAPIER);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const statsEl = document.getElementById('stats');
let last = performance.now();
let statsTimer = 0;
const wind = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  // Clamp dt so a stalled tab does not teleport the player through the floor.
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  const state = player.update(dt, input, follow.yaw);
  follow.update(dt, input, player.position);
  world.step();

  // The coat trails behind the dog: push it opposite to travel, and let it
  // lift a little as he rises through a jump.
  wind.copy(player.velocity).multiplyScalar(-0.009);
  wind.y = THREE.MathUtils.clamp(wind.y * 0.6, -0.05, 0.05);
  scene.updateMatrixWorld();
  fur.update(wind);

  renderer.render(scene, camera);

  statsTimer += dt;
  if (statsTimer > 0.12) {
    statsTimer = 0;
    statsEl.textContent =
      `speed ${state.speed.toFixed(1)}  ` +
      `${state.grounded ? 'grounded' : 'airborne'}  ` +
      `${input.locked ? '' : '— click to look around'}`;
  }
}
requestAnimationFrame(frame);

// Expose for debugging from the console.
window.SAM = { player, follow, scene, world };
