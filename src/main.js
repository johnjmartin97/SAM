import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './input.js';
import { Player } from './player.js';
import { FollowCamera } from './camera.js';
import { loadSamoyed, createSamoyed } from './samoyed.js';
import { Fur } from './fur.js';
import { Woods, SPAWN, CAMP, radialTexture } from './woods.js';

await RAPIER.init();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.1, 300);

const world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // gravity is in the controller
const woods = new Woods(scene, RAPIER, world);

// The campfire throws the only real shadows in the level, which is what makes
// the clearing feel like a room with walls of trees.
woods.fireLight.castShadow = true;
woods.fireLight.shadow.mapSize.set(1024, 1024);
woods.fireLight.shadow.camera.near = 0.4;
woods.fireLight.shadow.camera.far = 34;
woods.fireLight.shadow.bias = -0.005;

let dog;
try {
  dog = await loadSamoyed();
} catch (err) {
  console.warn('SAM: falling back to the placeholder dog —', err.message);
  dog = createSamoyed();
}

const input = new Input(renderer.domElement);
const player = new Player(scene, RAPIER, world, dog, { spawn: SPAWN, killY: -20 });
const fur = new Fur().apply(dog.root);
const follow = new FollowCamera(camera, world, RAPIER);
follow.distance = 5.5; // pulled in: the forest is tight and the fog is close

// Sam's own pool of light. This is the "circle of vision" -- nearly everything
// the player can see, they can see because of this lamp.
const lamp = new THREE.PointLight(0xffe9c9, 26, 15, 2);
lamp.castShadow = false; // a second shadow-casting point light is not worth it
scene.add(lamp);

// A soft dark patch under Sam, standing in for a real shadow from that lamp.
const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(2.1, 2.1),
  new THREE.MeshBasicMaterial({
    map: radialTexture('0,0,0', 0.6, 1.7),
    transparent: true,
    depthWrite: false,
  })
);
contact.rotation.x = -Math.PI / 2;
scene.add(contact);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ----------------------------------------------------------------- stage ---

const statsEl = document.getElementById('stats');
const bannerEl = document.getElementById('banner');
const bannerTimeEl = document.getElementById('banner-time');

let elapsed = 0;
let arrived = false;

function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function finish() {
  arrived = true;
  bannerTimeEl.textContent = `Home in ${formatTime(elapsed)}`;
  bannerEl.classList.add('show');
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && arrived) location.reload();
});

// ------------------------------------------------------------------ loop ---

let last = performance.now();
let statsTimer = 0;
const wind = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  if (!arrived) elapsed += dt;

  const state = player.update(dt, input, follow.yaw);
  const pos = player.position;
  follow.update(dt, input, pos);
  world.step();

  lamp.position.set(pos.x, pos.y + 0.95, pos.z);
  contact.position.set(pos.x, pos.y + 0.02, pos.z);
  contact.visible = state.grounded;

  const stage = woods.update(dt, pos);
  if (stage.arrived && !arrived) finish();

  wind.copy(player.velocity).multiplyScalar(-0.009);
  wind.y = THREE.MathUtils.clamp(wind.y * 0.6, -0.05, 0.05);
  scene.updateMatrixWorld();
  fur.update(wind);

  renderer.render(scene, camera);

  statsTimer += dt;
  if (statsTimer > 0.15) {
    statsTimer = 0;
    statsEl.textContent = arrived
      ? 'Stage complete'
      : `${formatTime(elapsed)} in the woods` +
        (input.locked ? '' : ' — click to look around');
  }
}
requestAnimationFrame(frame);

window.SAM = { player, follow, woods, scene, world, CAMP };
