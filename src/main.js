import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './input.js';
import { Player } from './player.js';
import { FollowCamera } from './camera.js';
import { loadSamoyed, createSamoyed } from './samoyed.js';
import { Fur } from './fur.js';
import { Woods, SPAWN, CAMP, radialTexture } from './woods.js';
import { Water } from './water.js';
import { Droplets, Ripples } from './effects.js';
import { Ambience } from './audio.js';
import { Wildlife, loadAnimals } from './wildlife.js';
import { updateWind } from './trees.js';
import { applyCharacterExposure } from './character.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

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
console.log(
  `SAM: forest — ${woods.forest.counts.trees} trees, ` +
  `${woods.forest.counts.cards + woods.thickets.cards} foliage cards, ` +
  `${woods.thickets.walls} thicket walls, ${world.colliders.len()} colliders`
);
const water = new Water(scene);
const droplets = new Droplets(scene);
const ripples = new Ripples(scene);

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

const ambience = new Ambience();
// Browsers refuse to start audio until the user does something; the existing
// click-to-look is the natural moment.
renderer.domElement.addEventListener('click', () => ambience.start(), { once: true });

// The other animals. Ambient only: nothing here threatens Sam.
const animalModels = await loadAnimals();
const wildlife = new Wildlife(scene, animalModels, Math.random);

const input = new Input(renderer.domElement);
const player = new Player(scene, RAPIER, world, dog, { spawn: SPAWN, killY: -20 });
const fur = new Fur().apply(dog.root);

// Sam gets his own exposure. A white dog and a dark forest floor are about
// seven times apart in albedo, so one lamp cannot expose both: he has to be
// turned down at his own materials. Must run after the fur, so the fur shells
// are covered too.
const samExposure = applyCharacterExposure(dog.root, { exposure: 1.0, knee: 1.15 });
const follow = new FollowCamera(camera, world, RAPIER);
follow.distance = 5.5; // pulled in: the forest is tight and the fog is close
follow.ignoreCollider = player.collider; // or every cast hits Sam himself

// Sam's own pool of light -- the "circle of vision". Nearly everything the
// player can see, they can see because of this lamp.
//
// It hangs ABOVE him, not on him. A point light sitting inside the dog is only
// centimetres from white fur, and with inverse-square falloff that lights his
// coat about ten times as hard as it lights the ground: he blows out to pure
// white and bloom turns him into a sun. Lifting the light and softening its
// falloff keeps the pool on the ground while leaving the dog merely lit.
const LAMP_HEIGHT = 2.4;
const lamp = new THREE.PointLight(0xffe9c9, 40, 18, 1.35);
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

// Bloom. In a night scene lit by one lamp and one fire, letting the bright
// things bleed into the dark does more for realism than any extra geometry --
// it is how a camera and an eye both actually behave.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Bloom runs before tone mapping, so it sees raw linear light values that go
// well above 1. The threshold has to be set in those terms, not in 0-1 screen
// terms, or ordinary lit surfaces start glowing.
const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  0.5, // strength
  0.7, // radius
  1.15 // threshold: the flames and lantern, not anything merely well lit
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
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
let dripTimer = 0;
let shakeSpray = 0;
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

  lamp.position.set(pos.x, pos.y + LAMP_HEIGHT, pos.z);
  contact.position.set(pos.x, pos.y + 0.02, pos.z);
  contact.visible = state.grounded && state.submersion < 0.15;

  updateWind(dt);
  wildlife.update(dt, pos, state.swimming);
  const stage = woods.update(dt, pos);
  if (stage.arrived && !arrived) finish();

  // ---- water ----
  water.update(dt);

  if (state.entered) {
    droplets.splash(pos, 55, 1.15);
    ambience.splash(1);
  }
  if (state.startedShake) {
    shakeSpray = 0.75;
    ambience.shake();
  }

  // A swimming or wading dog leaves a wake.
  ripples.update(dt, state.submersion > 0.12 && state.speed > 0.6, pos.x, pos.z);

  // Kicked-up spray while wading at speed.
  if (state.submersion > 0.1 && state.submersion < 0.7 && state.speed > 2.6) {
    if (Math.random() < state.speed * 0.12) droplets.splash(pos, 3, 0.45);
  }

  // The shake throws water in every direction for about a second.
  if (shakeSpray > 0) {
    shakeSpray -= dt;
    droplets.shake(pos, player.facing, 5);
  }

  // Drying off: the wetter he is, the faster he drips.
  if (state.wetness > 0.04 && state.submersion < 0.1) {
    dripTimer -= dt;
    if (dripTimer <= 0) {
      droplets.drip(pos, 1 + (Math.random() < state.wetness ? 1 : 0));
      dripTimer = 0.035 + (1 - state.wetness) * 0.5;
    }
  }

  droplets.update(dt);
  ambience.update(dt, {
    position: pos,
    speed: state.speed,
    grounded: state.grounded,
    submersion: state.submersion,
    wetness: state.wetness,
    campDistance: stage.distance,
  });

  fur.setWetness(state.wetness);

  wind.copy(player.velocity).multiplyScalar(-0.009);
  wind.y = THREE.MathUtils.clamp(wind.y * 0.6, -0.05, 0.05);
  scene.updateMatrixWorld();
  fur.update(wind);

  composer.render();

  statsTimer += dt;
  if (statsTimer > 0.15) {
    statsTimer = 0;
    const wet = state.wetness > 0.05 ? `  ·  ${Math.round(state.wetness * 100)}% wet` : '';
    statsEl.textContent = arrived
      ? 'Stage complete'
      : `${formatTime(elapsed)} in the woods` +
        (state.swimming ? '  ·  swimming' : '') + wet +
        (input.locked ? '' : ' — click to look around');
  }
}
requestAnimationFrame(frame);

// Exposed so the look can be tuned live from the console, e.g.
//   SAM.exposure.exposure = 0.04;  // how brightly Sam responds to light
//   SAM.bloom.threshold = 1.4;  SAM.lamp.intensity = 60;
window.SAM = {
  player, follow, woods, scene, world, CAMP, lamp, bloom, water, fur, ambience,
  wildlife,
  exposure: samExposure,
};
