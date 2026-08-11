import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Sam: one skinned mesh on a 25-bone rig, with six animation clips baked into
// the model file by tools/blender/make_samoyed.py.
//
// This replaced a version that rotated seven rigid objects from JavaScript.
// The difference is not only fidelity: with a skeleton the SURFACE deforms, so
// the body bends through a stride and the fur bends with it. Nothing here
// computes a joint angle any more -- the game picks a clip and a playback
// speed, and cross-fades.

const CLIPS = ['Idle', 'Walk', 'Run', 'Airborne', 'Swim', 'Shake'];

// Cycles per metre travelled. Driving playback by DISTANCE rather than by the
// clock is what keeps the paws planted instead of skating.
const STRIDE = { Walk: 1.05, Run: 0.62 };

export async function loadSamoyed(url = '/models/samoyed.glb') {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;

  let skinnedFur = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    // See the note in fur.js: self-shadowing under his own lamp is all
    // artifact, so he casts but does not receive.
    o.receiveShadow = false;
    o.frustumCulled = false; // he is the camera's subject; never cull him
    if (o.isSkinnedMesh && o.material?.name === 'Fur') skinnedFur = o;
  });

  const clips = {};
  for (const clip of gltf.animations) clips[clip.name] = clip;
  const missing = CLIPS.filter((name) => !clips[name]);
  if (missing.length) {
    throw new Error(`samoyed.glb is missing clips: ${missing.join(', ')}`);
  }

  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const name of CLIPS) {
    const action = mixer.clipAction(clips[name]);
    action.enabled = true;
    action.setEffectiveWeight(name === 'Idle' ? 1 : 0);
    if (name === 'Shake') action.setLoop(THREE.LoopOnce, 1);
    action.play();
    actions[name] = action;
  }

  return new Samoyed(root, mixer, actions, skinnedFur);
}

class Samoyed {
  constructor(root, mixer, actions, skinnedFur) {
    this.root = root;
    this.mixer = mixer;
    this.actions = actions;
    this.skinnedFur = skinnedFur;
    this._current = 'Idle';
    this._shaking = false;

    // Shake is a one-off, so it has to hand control back when it ends.
    mixer.addEventListener('finished', (e) => {
      if (e.action === this.actions.Shake) this._shaking = false;
    });
  }

  /** Cross-fade to a clip. Cheap to call every frame with the same name. */
  _to(name, fade = 0.22) {
    if (this._current === name) return;
    const from = this.actions[this._current];
    const to = this.actions[name];
    to.reset();
    to.setEffectiveWeight(1);
    to.play();
    from.crossFadeTo(to, fade, false);
    this._current = name;
  }

  /** Play the shake once, over the top of whatever else is going on. */
  shake() {
    const action = this.actions.Shake;
    action.reset();
    action.setEffectiveWeight(1);
    action.play();
    this._shaking = true;
  }

  get clip() {
    return this._current;
  }

  /**
   * `state` comes straight from the player: how fast, on what, in what.
   * Choosing the clip is the only decision made here.
   */
  update(dt, { speed, grounded, swimming }) {
    if (swimming) {
      this._to('Swim');
      this.actions.Swim.timeScale = 1;
    } else if (!grounded) {
      this._to('Airborne', 0.12);
    } else if (speed > 4.2) {
      this._to('Run');
      this.actions.Run.timeScale = Math.max(0.35, speed * STRIDE.Run);
    } else if (speed > 0.45) {
      this._to('Walk');
      this.actions.Walk.timeScale = Math.max(0.35, speed * STRIDE.Walk);
    } else {
      this._to('Idle');
    }

    this.actions.Shake.setEffectiveWeight(this._shaking ? 1 : 0);
    this.mixer.update(dt);
  }
}
