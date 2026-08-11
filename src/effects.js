import * as THREE from 'three';
import { heightAt, WATER_Y } from './terrain.js';

// Water that has left the river: splashes, the wake behind a swimming dog,
// and the drips that come off a wet Samoyed for a good while afterwards.

const GRAVITY = 15;

/** A pool of droplets. Nothing is allocated once the pool is built. */
export class Droplets {
  constructor(scene, max = 900) {
    this.max = max;
    this.next = 0;

    this.position = new Float32Array(max * 3);
    this.velocity = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);

    for (let i = 0; i < max; i++) this.position[i * 3 + 1] = -600; // parked

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xcfe8f5) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (260.0 / max(0.001, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          gl_FragColor = vec4(uColor, smoothstep(0.25, 0.02, d) * vAlpha);
        }`,
    });

    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
  }

  _spawn(x, y, z, vx, vy, vz, life, size) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.position[i * 3] = x;
    this.position[i * 3 + 1] = y;
    this.position[i * 3 + 2] = z;
    this.velocity[i * 3] = vx;
    this.velocity[i * 3 + 1] = vy;
    this.velocity[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.alpha[i] = 1;
  }

  /** A burst thrown upward and outward -- entering the water, or a footfall. */
  splash(pos, count = 40, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.6 * power;
      this._spawn(
        pos.x + Math.cos(a) * 0.3,
        WATER_Y + 0.05,
        pos.z + Math.sin(a) * 0.3,
        Math.cos(a) * r,
        (1.9 + Math.random() * 2.6) * power,
        Math.sin(a) * r,
        0.5 + Math.random() * 0.6,
        2 + Math.random() * 3.5
      );
    }
  }

  /** Slow drops falling off a wet coat. */
  drip(pos, count = 1) {
    for (let i = 0; i < count; i++) {
      this._spawn(
        pos.x + (Math.random() - 0.5) * 0.62,
        pos.y + 0.32 + Math.random() * 0.32,
        pos.z + (Math.random() - 0.5) * 0.95,
        (Math.random() - 0.5) * 0.25,
        -0.15 - Math.random() * 0.3,
        (Math.random() - 0.5) * 0.25,
        1.1 + Math.random() * 0.7,
        1.8 + Math.random() * 1.8
      );
    }
  }

  /** The radial spray from a dog shaking itself dry. */
  shake(pos, facing, count = 26) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2.6 + Math.random() * 3.4;
      this._spawn(
        pos.x + (Math.random() - 0.5) * 0.5,
        pos.y + 0.45 + Math.random() * 0.55,
        pos.z + (Math.random() - 0.5) * 0.8,
        Math.cos(a) * r,
        0.9 + Math.random() * 2.2,
        Math.sin(a) * r,
        0.55 + Math.random() * 0.5,
        2 + Math.random() * 2.8
      );
    }
  }

  update(dt) {
    const p = this.position;
    const v = this.velocity;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;

      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        p[i * 3 + 1] = -600;
        this.alpha[i] = 0;
        continue;
      }

      v[i * 3 + 1] -= GRAVITY * dt;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;

      // Land on whichever surface is higher: the riverbed, or the water.
      const ground = heightAt(p[i * 3], p[i * 3 + 2]);
      const surface = Math.max(ground, ground < WATER_Y ? WATER_Y : ground);
      if (p[i * 3 + 1] <= surface) {
        this.life[i] = 0;
        p[i * 3 + 1] = -600;
        this.alpha[i] = 0;
        continue;
      }

      // Fade out over the last third of the drop's life.
      this.alpha[i] = Math.min(1, (this.life[i] / this.maxLife[i]) * 3);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

/** Expanding rings on the surface, left behind by anything moving in water. */
export class Ripples {
  constructor(scene, count = 16) {
    this.rings = [];
    const geo = new THREE.RingGeometry(0.4, 0.52, 28);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0x9fc6d4,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      mesh.visible = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.rings.push({ mesh, age: 0, life: 0 });
    }
    this.next = 0;
    this.cooldown = 0;
  }

  spawn(x, z, life = 1.8) {
    const r = this.rings[this.next];
    this.next = (this.next + 1) % this.rings.length;
    r.mesh.position.set(x, WATER_Y + 0.03, z);
    r.mesh.scale.setScalar(0.4);
    r.mesh.visible = true;
    r.age = 0;
    r.life = life;
  }

  /** Call every frame; `emit` is true while something is disturbing the water. */
  update(dt, emit, x, z) {
    this.cooldown -= dt;
    if (emit && this.cooldown <= 0) {
      this.spawn(x, z);
      this.cooldown = 0.28;
    }
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.mesh.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(0.4 + t * 4.2);
      r.mesh.material.opacity = 0.5 * (1 - t) * (1 - t);
    }
  }
}
