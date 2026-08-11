import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { heightAt, riverZ, riverHalfWidth, waterDepth, WATER_Y } from './terrain.js';

// The other animals in the woods.
//
// All of them are ambient: nothing here threatens Sam, and nothing here can be
// caught. They exist so the forest feels inhabited rather than empty, and so
// that something moves when you are lost and nothing else is happening.
//
// Every model keeps the Samoyed's naming contract -- head, tail, leg_front_L
// and so on -- so one animation helper drives all four species.

const SPECIES = ['rabbit', 'squirrel', 'bear', 'fish'];

const COUNTS = {
  rabbit: 16,
  squirrel: 18,
  bear: 3,
  fish: 26,
};

/** Load every animal model once. Missing files are skipped, not fatal. */
export async function loadAnimals() {
  const loader = new GLTFLoader();
  const models = {};
  await Promise.all(
    SPECIES.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`/models/${name}.glb`);
        gltf.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        models[name] = gltf.scene;
      } catch (err) {
        console.warn(`SAM: no ${name} model —`, err.message);
      }
    })
  );
  return models;
}

function partsOf(root) {
  const find = (n) => root.getObjectByName(n) ?? null;
  return {
    head: find('head'),
    tail: find('tail'),
    body: find('body'),
    legs: [
      find('leg_front_L'), find('leg_front_R'),
      find('leg_back_L'), find('leg_back_R'),
    ],
  };
}

/** One walk cycle, shared by everything on four legs. */
function animateLegs(parts, cycle, swing) {
  const [fl, fr, bl, br] = parts.legs;
  if (fl) fl.rotation.x = Math.sin(cycle) * swing;
  if (br) br.rotation.x = Math.sin(cycle) * swing;
  if (fr) fr.rotation.x = Math.sin(cycle + Math.PI) * swing;
  if (bl) bl.rotation.x = Math.sin(cycle + Math.PI) * swing;
}

export class Wildlife {
  constructor(scene, models, rand) {
    this.scene = scene;
    this.rand = rand;
    this.animals = [];
    this.time = 0;
    this._v = new THREE.Vector3();

    if (models.rabbit) this._spawnLand('rabbit', models.rabbit, COUNTS.rabbit);
    if (models.squirrel) this._spawnLand('squirrel', models.squirrel, COUNTS.squirrel);
    if (models.bear) this._spawnLand('bear', models.bear, COUNTS.bear);
    if (models.fish) this._spawnFish(models.fish, COUNTS.fish);
  }

  _landSpot(minHeight = 0.5) {
    for (let i = 0; i < 60; i++) {
      const x = (this.rand() * 2 - 1) * 70;
      const z = (this.rand() * 2 - 1) * 70;
      if (heightAt(x, z) > WATER_Y + minHeight) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(0, 0, 40);
  }

  _spawnLand(kind, model, count) {
    for (let i = 0; i < count; i++) {
      const root = model.clone(true);
      const home = this._landSpot();
      root.position.set(home.x, heightAt(home.x, home.z), home.z);
      root.rotation.y = this.rand() * Math.PI * 2;
      this.scene.add(root);

      this.animals.push({
        kind,
        root,
        parts: partsOf(root),
        home,
        // Squirrels remember one tree and always run for it.
        climbY: 0,
        state: 'idle',
        timer: this.rand() * 4,
        heading: root.rotation.y,
        speed: 0,
        phase: this.rand() * Math.PI * 2,
      });
    }
  }

  _spawnFish(model, count) {
    for (let i = 0; i < count; i++) {
      // Fish live in the channel, so they are placed by the river, not the map.
      let x = 0;
      let z = 0;
      for (let k = 0; k < 40; k++) {
        x = (this.rand() * 2 - 1) * 70;
        z = riverZ(x) + (this.rand() * 2 - 1) * riverHalfWidth(x) * 0.7;
        if (waterDepth(x, z) > 0.8) break;
      }
      const root = model.clone(true);
      root.position.set(x, WATER_Y - 0.35 - this.rand() * 0.5, z);
      this.scene.add(root);

      this.animals.push({
        kind: 'fish',
        root,
        parts: partsOf(root),
        heading: this.rand() * Math.PI * 2,
        speed: 0.6 + this.rand() * 0.7,
        phase: this.rand() * Math.PI * 2,
        state: 'swim',
        timer: 0,
      });
    }
  }

  update(dt, playerPos, playerSwimming) {
    this.time += dt;
    for (const a of this.animals) {
      // Anything well outside the fog is not worth animating.
      const distance = a.root.position.distanceTo(playerPos);
      if (distance > 40) continue;

      switch (a.kind) {
        case 'rabbit': this._rabbit(a, dt, playerPos, distance); break;
        case 'squirrel': this._squirrel(a, dt, playerPos, distance); break;
        case 'bear': this._bear(a, dt, playerPos, distance); break;
        case 'fish': this._fish(a, dt, playerPos, distance, playerSwimming); break;
      }
    }
  }

  _stepForward(a, dt, speed) {
    a.root.position.x += Math.sin(a.heading) * speed * dt;
    a.root.position.z += Math.cos(a.heading) * speed * dt;
    a.root.position.y = heightAt(a.root.position.x, a.root.position.z);
    a.root.rotation.y = a.heading + Math.PI; // models face -Z, like Sam
  }

  _fleeHeading(a, playerPos) {
    return Math.atan2(
      a.root.position.x - playerPos.x,
      a.root.position.z - playerPos.z
    );
  }

  // Freeze, then bolt -- which is the whole of a rabbit.
  _rabbit(a, dt, playerPos, distance) {
    a.timer -= dt;
    if (a.state === 'idle') {
      if (distance < 9) {
        a.state = 'flee';
        a.timer = 1.8 + this.rand() * 2.0;
        a.heading = this._fleeHeading(a, playerPos);
      } else if (a.timer <= 0) {
        // A small idle hop, so they are not statues.
        a.timer = 3 + this.rand() * 6;
        a.heading += (this.rand() - 0.5) * 2.2;
      }
      // Ears and nose twitch on the spot.
      if (a.parts.head) {
        a.parts.head.rotation.x = Math.sin(this.time * 3 + a.phase) * 0.05;
        a.parts.head.rotation.z = Math.sin(this.time * 7.3 + a.phase) * 0.04;
      }
      animateLegs(a.parts, 0, 0);
      a.root.position.y = heightAt(a.root.position.x, a.root.position.z);
    } else {
      // Hops rather than runs: the body arcs and the legs tuck.
      const hop = Math.abs(Math.sin(this.time * 7 + a.phase));
      this._stepForward(a, dt, 5.2);
      a.root.position.y += hop * 0.22;
      const tuck = -0.5 - hop * 0.5;
      for (const l of a.parts.legs) if (l) l.rotation.x = tuck;
      if (a.timer <= 0) {
        a.state = 'idle';
        a.timer = 2 + this.rand() * 4;
      }
    }
  }

  // Bolts for the nearest trunk and goes up it.
  _squirrel(a, dt, playerPos, distance) {
    a.timer -= dt;
    if (a.state === 'idle') {
      if (distance < 8) {
        a.state = 'climb';
        a.timer = 4 + this.rand() * 3;
        a.heading = this._fleeHeading(a, playerPos);
      }
      animateLegs(a.parts, this.time * 2, 0.05);
      if (a.parts.tail) {
        // The tail flicks constantly. It is most of the read at a distance.
        a.parts.tail.rotation.x = -0.5 + Math.sin(this.time * 4 + a.phase) * 0.35;
      }
      a.root.position.y = heightAt(a.root.position.x, a.root.position.z);
    } else {
      // Scurry, then climb: height ramps up while forward motion stops.
      const climbing = a.timer < 2.6;
      if (!climbing) {
        this._stepForward(a, dt, 4.4);
        animateLegs(a.parts, this.time * 22, 0.7);
        a.climbY = 0;
      } else {
        a.climbY = Math.min(4.2, a.climbY + dt * 2.6);
        a.root.position.y = heightAt(a.root.position.x, a.root.position.z) + a.climbY;
        a.root.rotation.x = -1.15; // nose up the trunk
        animateLegs(a.parts, this.time * 16, 0.5);
      }
      if (a.timer <= 0) {
        a.state = 'idle';
        a.root.rotation.x = 0;
        a.climbY = 0;
        a.timer = 5 + this.rand() * 6;
      }
    }
  }

  // Wanders, ignores Sam, and ambles off if he crowds it. No threat.
  _bear(a, dt, playerPos, distance) {
    a.timer -= dt;
    if (a.timer <= 0) {
      a.timer = 4 + this.rand() * 7;
      a.heading += (this.rand() - 0.5) * 2.4;
      a.speed = this.rand() < 0.35 ? 0 : 0.9 + this.rand() * 0.6;
    }
    if (distance < 7) {
      // Not aggression -- just a big animal deciding you are too close.
      a.heading = this._fleeHeading(a, playerPos);
      a.speed = 1.9;
      a.timer = Math.max(a.timer, 1.5);
    }
    // Turn back at the map edge rather than walking into the invisible wall.
    if (Math.abs(a.root.position.x) > 70 || Math.abs(a.root.position.z) > 70) {
      a.heading = Math.atan2(-a.root.position.x, -a.root.position.z);
    }
    // Bears do not swim here; turn away from the water.
    const ahead = new THREE.Vector3(
      a.root.position.x + Math.sin(a.heading) * 2.5, 0,
      a.root.position.z + Math.cos(a.heading) * 2.5
    );
    if (heightAt(ahead.x, ahead.z) < WATER_Y + 0.4) a.heading += 2.0;

    this._stepForward(a, dt, a.speed);
    animateLegs(a.parts, this.time * (2 + a.speed * 2.4), Math.min(0.5, a.speed * 0.3));
    if (a.parts.head) {
      a.parts.head.rotation.x = 0.1 + Math.sin(this.time * 1.3 + a.phase) * 0.08;
      a.parts.head.rotation.y = Math.sin(this.time * 0.7 + a.phase) * 0.22;
    }
  }

  // Holds station in the current, and scatters if Sam swims into the shoal.
  _fish(a, dt, playerPos, distance, playerSwimming) {
    const p = a.root.position;
    const scattered = playerSwimming && distance < 7;
    const speed = scattered ? 3.4 : a.speed;

    if (scattered) {
      a.heading = this._fleeHeading(a, playerPos);
    } else {
      // Drift downstream and wander gently within the channel.
      a.heading += Math.sin(this.time * 0.6 + a.phase) * dt * 1.4;
      // Steer back toward the middle of the river if drifting out.
      const centre = riverZ(p.x);
      const across = p.z - centre;
      if (Math.abs(across) > riverHalfWidth(p.x) * 0.75) {
        a.heading = Math.atan2(0, -Math.sign(across)) + (this.rand() - 0.5) * 0.4;
      }
    }

    p.x += Math.sin(a.heading) * speed * dt;
    p.z += Math.cos(a.heading) * speed * dt;

    // Wrap around rather than piling up at the ends of the river.
    if (p.x > 72) p.x = -72;
    if (p.x < -72) p.x = 72;

    const depth = waterDepth(p.x, p.z);
    if (depth < 0.5) {
      // Beached: turn back toward deep water.
      a.heading += Math.PI * 0.6;
    }
    p.y = WATER_Y - Math.min(0.9, 0.25 + depth * 0.35);

    a.root.rotation.y = a.heading + Math.PI;
    // The tail does all the work.
    if (a.parts.tail) {
      a.parts.tail.rotation.y = Math.sin(this.time * (6 + speed * 3) + a.phase) * 0.55;
    }
    a.root.rotation.z = Math.sin(this.time * (4 + speed * 2) + a.phase) * 0.09;
  }
}
