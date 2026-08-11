import * as THREE from 'three';
import { animateSamoyed } from './samoyed.js';
import { heightAt, flowAt, WATER_Y } from './terrain.js';
import { waveHeight } from './water.js';

// Tuning lives in one place. These numbers are the "feel" of the game.
export const TUNING = {
  walkSpeed: 3.4,
  runSpeed: 7.2,
  groundAccel: 42, // how fast we reach target speed on the ground
  groundBrake: 26,
  airAccel: 14, // reduced air control, but not zero
  jumpHeight: 2.05, // metres at the apex of a standing jump
  gravity: 26,
  fallGravityBoost: 1.7, // heavier on the way down; makes jumps feel snappy
  lowJumpBoost: 2.2, // releasing Space early cuts the jump short
  coyoteTime: 0.11, // grace period to still jump after walking off a ledge
  jumpBuffer: 0.12, // pressing jump just before landing still counts
  turnRate: 14, // how fast the dog rotates to face travel direction
  capsuleRadius: 0.3,
  capsuleHalfHeight: 0.25,

  // --- water ---
  swimSpeed: 2.9,
  swimAccel: 9,
  swimTurnRate: 6,
  paddleLift: 5.5, // holding jump while swimming pushes you up the bank
  buoyancy: 46, // spring pulling the body toward its floating depth
  buoyDamping: 7.5, // without this he bobs like a cork forever
  floatDepth: 0.44, // how far below the surface the feet settle
  swimThreshold: 0.62, // submersion at which walking becomes swimming
  currentStrength: 2.2, // multiplier on the river's own flow
  dryTime: 30, // seconds from soaked to dry, if he does not shake
};

const FEET_OFFSET = TUNING.capsuleRadius + TUNING.capsuleHalfHeight;
const BODY_HEIGHT = 1.05; // roughly how tall Sam is, for submersion maths

export class Player {
  constructor(scene, RAPIER, world, dog, { spawn, killY = -30 } = {}) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.spawn = spawn ? spawn.clone() : new THREE.Vector3(0, 1.2, 0);
    this.killY = killY;

    this.dog = dog;
    scene.add(this.dog.root);

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.spawn.x,
        this.spawn.y + FEET_OFFSET,
        this.spawn.z
      )
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(TUNING.capsuleHalfHeight, TUNING.capsuleRadius),
      this.body
    );

    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.4, 0.2, true);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((38 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);

    this.velocity = new THREE.Vector3();
    this.grounded = false;
    this.timeSinceGrounded = 99;
    this.timeSinceJumpPress = 99;
    this.facing = Math.PI;
    this.time = 0;
    this.wasJumpDown = false;

    // --- water state ---
    this.submersion = 0;
    this.swimming = false;
    this.wading = false;
    this.wetness = 0;
    this.timeSinceWater = 999;
    this.hasShaken = true;
    this.shakeTimer = 0;

    this._flow = new THREE.Vector2();
    this._pos = new THREE.Vector3();
  }

  get position() {
    const t = this.body.translation();
    return this._pos.set(t.x, t.y - FEET_OFFSET, t.z);
  }

  respawn() {
    const s = this.spawn;
    this.body.setTranslation({ x: s.x, y: s.y + FEET_OFFSET, z: s.z }, true);
    this.velocity.set(0, 0, 0);
  }

  update(dt, input, cameraYaw) {
    this.time += dt;
    const T = TUNING;
    const clamp = THREE.MathUtils.clamp;

    const t0 = this.body.translation();
    const feetY = t0.y - FEET_OFFSET;

    // ---------------------------------------------------------- water ---
    // There is only water here if the ground is below the waterline; the
    // river carved into the terrain is the only place that is true.
    const bedY = heightAt(t0.x, t0.z);
    const surfaceY = WATER_Y + waveHeight(t0.x, t0.z, this.time);
    const hasWater = bedY < WATER_Y;

    const wasSubmerged = this.submersion;
    this.submersion = hasWater
      ? clamp((surfaceY - feetY) / BODY_HEIGHT, 0, 1)
      : 0;

    this.swimming = this.submersion >= T.swimThreshold;
    this.wading = !this.swimming && this.submersion > 0.06;
    const entered = this.submersion > 0.35 && wasSubmerged <= 0.35;

    // ----------------------------------------------------- intent ------
    const axis = input.moveAxis();
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const wishX = axis.x * cos - axis.y * sin;
    const wishZ = -(axis.x * sin + axis.y * cos);
    const hasInput = axis.x !== 0 || axis.y !== 0;

    let targetSpeed;
    let accel;
    if (this.swimming) {
      targetSpeed = T.swimSpeed;
      accel = T.swimAccel;
    } else {
      targetSpeed = input.running ? T.runSpeed : T.walkSpeed;
      // Wading is heavy going: the deeper you are, the more it drags.
      targetSpeed *= 1 - 0.55 * this.submersion;
      accel = this.grounded ? (hasInput ? T.groundAccel : T.groundBrake) : T.airAccel;
    }

    const blend = 1 - Math.exp(-accel * dt);
    this.velocity.x += (wishX * targetSpeed - this.velocity.x) * blend;
    this.velocity.z += (wishZ * targetSpeed - this.velocity.z) * blend;

    // ------------------------------------------------------ vertical ---
    const jumpDown = input.down('Space');
    if (jumpDown && !this.wasJumpDown) this.timeSinceJumpPress = 0;
    this.wasJumpDown = jumpDown;
    this.timeSinceJumpPress += dt;
    this.timeSinceGrounded = this.grounded ? 0 : this.timeSinceGrounded + dt;

    if (this.swimming) {
      // Buoyancy as a damped spring toward the floating depth. The wave term
      // is already in surfaceY, so he genuinely rides the swell.
      const floatY = surfaceY - T.floatDepth;
      const err = floatY - feetY;
      this.velocity.y +=
        (err * T.buoyancy - this.velocity.y * T.buoyDamping) * dt;
      if (jumpDown) this.velocity.y += T.paddleLift * dt;
      this.velocity.y = clamp(this.velocity.y, -5, 5);
    } else {
      const canJump = this.timeSinceGrounded <= T.coyoteTime;
      const wantsJump = this.timeSinceJumpPress <= T.jumpBuffer;
      if (canJump && wantsJump) {
        this.velocity.y = Math.sqrt(2 * T.gravity * T.jumpHeight);
        this.timeSinceJumpPress = 99;
        this.timeSinceGrounded = 99;
        this.grounded = false;
      }
      let g = T.gravity;
      if (this.velocity.y < 0) g *= T.fallGravityBoost;
      else if (this.velocity.y > 0 && !jumpDown) g *= T.lowJumpBoost;
      this.velocity.y -= g * dt;
      this.velocity.y = Math.max(this.velocity.y, -40);
    }

    // -------------------------------------------------------- resolve ---
    const desired = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };

    // The current carries him downstream whether he likes it or not, and
    // grips harder the deeper he is in the channel.
    if (this.submersion > 0.2) {
      flowAt(t0.x, t0.z, this._flow);
      const grip = this.submersion * T.currentStrength;
      desired.x += this._flow.x * grip * dt;
      desired.z += this._flow.y * grip * dt;
    }

    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    this.body.setNextKinematicTranslation({
      x: t0.x + moved.x,
      y: t0.y + moved.y,
      z: t0.z + moved.z,
    });

    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded() && !this.swimming;
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    if (!this.swimming && !this.grounded && this.velocity.y > 0 &&
        Math.abs(moved.y - desired.y) > 1e-4) {
      this.velocity.y = 0;
    }
    this.justLanded = this.grounded && !wasGrounded;

    // ---------------------------------------------------------- facing ---
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (planarSpeed > 0.35) {
      const want = Math.atan2(this.velocity.x, this.velocity.z);
      let delta = want - this.facing;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      const rate = this.swimming ? T.swimTurnRate : T.turnRate;
      this.facing += delta * (1 - Math.exp(-rate * dt));
    }

    // --------------------------------------------------------- wetness ---
    if (this.submersion > 0.15) {
      this.wetness = 1;
      this.timeSinceWater = 0;
      this.hasShaken = false;
    } else {
      this.timeSinceWater += dt;
      this.wetness = Math.max(0, this.wetness - dt / T.dryTime);
    }

    // A dog out of a river shakes itself as soon as it has its feet under it.
    let startedShake = false;
    if (
      !this.hasShaken &&
      this.wetness > 0.55 &&
      this.timeSinceWater > 1.2 &&
      this.grounded &&
      planarSpeed < 1.5
    ) {
      this.shakeTimer = 1.05;
      this.hasShaken = true;
      startedShake = true;
    }
    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      this.wetness = Math.max(0.22, this.wetness - dt * 0.42);
    }
    // Ramp the shake in and out so it does not start and stop with a snap.
    const shake =
      this.shakeTimer > 0
        ? Math.sin(clamp(this.shakeTimer / 1.05, 0, 1) * Math.PI) * 1.6
        : 0;

    // ----------------------------------------------------------- present ---
    const p = this.position;
    this.dog.root.position.copy(p);
    this.dog.root.rotation.y = this.facing + Math.PI;
    animateSamoyed(this.dog, {
      speed: planarSpeed,
      grounded: this.grounded,
      swimming: this.swimming,
      shake: Math.min(1, shake),
      time: this.time,
      dt,
    });

    if (p.y < this.killY) this.respawn();

    return {
      speed: planarSpeed,
      grounded: this.grounded,
      swimming: this.swimming,
      wading: this.wading,
      submersion: this.submersion,
      wetness: this.wetness,
      shaking: this.shakeTimer > 0,
      startedShake,
      entered,
    };
  }
}
