import * as THREE from 'three';

// Third-person follow camera. Orbits the player, eases toward its target so it
// lags a little behind fast movement, and pulls in when a wall is in the way.
export class FollowCamera {
  constructor(camera, world, RAPIER) {
    this.camera = camera;
    this.world = world;
    this.RAPIER = RAPIER;
    this.yaw = Math.PI;
    this.pitch = 0.28;
    this.distance = 7;
    this.sensitivity = 0.0022;
    this.height = 1.15;
    this.smoothed = new THREE.Vector3(0, 2, 0);
    this._target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
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

    // Keep the camera out of geometry: cast toward where it wants to sit.
    let dist = this.distance;
    const ray = new this.RAPIER.Ray(this.smoothed, dir);
    const hit = this.world.castRay(ray, this.distance, true);
    if (hit) dist = Math.max(1.4, hit.timeOfImpact - 0.25);

    this._desired.copy(this.smoothed).addScaledVector(dir, dist);
    this.camera.position.copy(this._desired);
    this.camera.lookAt(this.smoothed);
  }
}
