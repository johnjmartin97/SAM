import * as THREE from 'three';
import { animateSamoyed } from './samoyed.js';
import { SPAWN, KILL_Y } from './level.js';

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
};

const FEET_OFFSET = TUNING.capsuleRadius + TUNING.capsuleHalfHeight;

export class Player {
  constructor(scene, RAPIER, world, dog) {
    this.RAPIER = RAPIER;
    this.world = world;

    this.dog = dog;
    scene.add(this.dog.root);

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        SPAWN.x,
        SPAWN.y + FEET_OFFSET,
        SPAWN.z
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
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);

    this.velocity = new THREE.Vector3();
    this.grounded = false;
    this.timeSinceGrounded = 99;
    this.timeSinceJumpPress = 99;
    this.jumpHeld = false;
    this.facing = Math.PI; // start looking down the course, not at the camera
    this.time = 0;
    this.wasJumpDown = false;
  }

  get position() {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - FEET_OFFSET, t.z);
  }

  respawn() {
    this.body.setTranslation({ x: SPAWN.x, y: SPAWN.y + FEET_OFFSET, z: SPAWN.z }, true);
    this.velocity.set(0, 0, 0);
  }

  update(dt, input, cameraYaw) {
    this.time += dt;
    const T = TUNING;

    // --- intent, rotated into world space by where the camera is looking ---
    const axis = input.moveAxis();
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    // The camera looks along (-sin, -cos), so forward must carry those signs.
    const wishX = axis.x * cos - axis.y * sin;
    const wishZ = -(axis.x * sin + axis.y * cos);
    const hasInput = axis.x !== 0 || axis.y !== 0;

    const targetSpeed = input.running ? T.runSpeed : T.walkSpeed;
    const targetX = wishX * targetSpeed;
    const targetZ = wishZ * targetSpeed;

    const accel = this.grounded ? (hasInput ? T.groundAccel : T.groundBrake) : T.airAccel;
    const blend = 1 - Math.exp(-accel * dt); // frame-rate independent approach
    this.velocity.x += (targetX - this.velocity.x) * blend;
    this.velocity.z += (targetZ - this.velocity.z) * blend;

    // --- jump, with coyote time and input buffering ---
    const jumpDown = input.down('Space');
    if (jumpDown && !this.wasJumpDown) this.timeSinceJumpPress = 0;
    this.wasJumpDown = jumpDown;
    this.timeSinceJumpPress += dt;
    this.timeSinceGrounded = this.grounded ? 0 : this.timeSinceGrounded + dt;

    const canJump = this.timeSinceGrounded <= T.coyoteTime;
    const wantsJump = this.timeSinceJumpPress <= T.jumpBuffer;
    if (canJump && wantsJump) {
      this.velocity.y = Math.sqrt(2 * T.gravity * T.jumpHeight);
      this.timeSinceJumpPress = 99;
      this.timeSinceGrounded = 99;
      this.grounded = false;
    }

    // Variable-height jump: fall faster, and cut the rise if Space is released.
    let g = T.gravity;
    if (this.velocity.y < 0) g *= T.fallGravityBoost;
    else if (this.velocity.y > 0 && !jumpDown) g *= T.lowJumpBoost;
    this.velocity.y -= g * dt;
    this.velocity.y = Math.max(this.velocity.y, -40);

    // --- resolve movement against the world ---
    const desired = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: t.x + moved.x,
      y: t.y + moved.y,
      z: t.z + moved.z,
    });

    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    // Stopped short vertically without being grounded means we hit a ceiling.
    if (!this.grounded && this.velocity.y > 0 && Math.abs(moved.y - desired.y) > 1e-4) {
      this.velocity.y = 0;
    }
    this.justLanded = this.grounded && !wasGrounded;

    // --- face the direction of travel ---
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (planarSpeed > 0.4) {
      const want = Math.atan2(this.velocity.x, this.velocity.z);
      let delta = want - this.facing;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // shortest way round
      this.facing += delta * (1 - Math.exp(-T.turnRate * dt));
    }

    // --- present ---
    const p = this.position;
    this.dog.root.position.copy(p);
    this.dog.root.rotation.y = this.facing + Math.PI; // model faces -Z
    animateSamoyed(this.dog, {
      speed: planarSpeed,
      grounded: this.grounded,
      time: this.time,
      dt,
    });

    if (p.y < KILL_Y) this.respawn();

    return { speed: planarSpeed, grounded: this.grounded };
  }
}
