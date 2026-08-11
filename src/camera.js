import * as THREE from 'three';
import { CAMERA_FILTER } from './collision.js';

// Third-person follow camera. Orbits the player, eases toward its target so it
// lags a little behind fast movement, and pulls in when a wall is in the way.
export class FollowCamera {
  constructor(camera, world, RAPIER) {
    this.camera = camera;
    this.world = world;
    this.RAPIER = RAPIER;
    this.yaw = 0; // sits behind the player looking down the course (-Z)
    this.pitch = 0.28;
    this.distance = 7;
    this.sensitivity = 0.0022;
    this.height = 1.15;
    this.smoothed = new THREE.Vector3(0, 2, 0);
    this._target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._dist = this.distance; // eased, so the camera never snaps
    this._probe = new RAPIER.Ball(0.35);
    this._identity = { x: 0, y: 0, z: 0, w: 1 };
    // The cast starts at head height, where the probe overlaps Sam's own
    // capsule -- so without excluding him every cast reports a hit at zero
    // distance and the camera pins itself to his back.
    this.ignoreCollider = null;
  }

  update(dt, input, playerPos) {
    const look = input.takeLook();
    this.yaw -= look.x * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + look.y * this.sensitivity,
      -0.45,
      1.15
    );

    // Ease the focus point rather than snapping to the player every frame.
    this._target.set(playerPos.x, playerPos.y + this.height, playerPos.z);
    this.smoothed.lerp(this._target, 1 - Math.exp(-12 * dt));

    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp
    );

    // Keep the camera out of geometry. A single ray misses anything the
    // camera's own bulk would clip, so sweep a small sphere instead -- the
    // camera has width, and a ray does not.
    let wanted = this.distance;
    const hit = this.world.castShape(
      this.smoothed, this._identity, dir, this._probe,
      0, this.distance, true,
      undefined, CAMERA_FILTER, this.ignoreCollider ?? undefined
    );
    if (hit) wanted = Math.max(1.4, hit.time_of_impact - 0.1);

    // Ease toward it. Pulling in fast is fine -- being inside a tree is worse
    // than a quick move -- but easing back out stops the camera lurching every
    // time a trunk passes behind Sam.
    const rate = wanted < this._dist ? 26 : 5;
    this._dist += (wanted - this._dist) * (1 - Math.exp(-rate * dt));

    this._desired.copy(this.smoothed).addScaledVector(dir, this._dist);
    this.camera.position.copy(this._desired);
    this.camera.lookAt(this.smoothed);
  }
}
