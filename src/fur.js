import * as THREE from 'three';

// Shell fur.
//
// The trick: draw the same mesh many times, each copy pushed a little further
// out along its own surface normals, and punch hair-shaped holes through every
// copy. Cells that survive to the outer shells read as long strands, cells
// that get cut early read as short ones. Stacked up, the eye reads hair --
// not geometry. This is how real-time games do fur, and it costs one extra
// draw call per furred part rather than a million modelled hairs.
//
// Shell 0 is the original solid mesh, so there is always skin under the coat.

const SHELLS = 16;

// Fur length per body part, in metres. Samoyeds carry a long coat on the body
// and tail, and a much shorter one on the face.
const LENGTH = {
  body: 0.115,
  head: 0.05,
  tail: 0.145,
  leg_front_L: 0.07,
  leg_front_R: 0.07,
  leg_back_L: 0.085,
  leg_back_R: 0.085,
};

const DEFAULT_LENGTH = 0.08;

// Only these materials grow fur. Eyes, nose and inner ears stay bare.
const FURRED_MATERIALS = new Set(['Fur']);

const COMMON = /* glsl */ `
  // Cheap 3D hash. Same cell -> same value, every frame and every shell,
  // which is what makes a strand hold together across the layers.
  float furHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
`;

export class Fur {
  constructor() {
    this.meshes = [];
    this._wind = new THREE.Vector3();
    this._inv = new THREE.Matrix3();
    this._v = new THREE.Vector3();
  }

  /** Grow fur on every furred mesh under `root`. */
  apply(root) {
    const targets = [];
    root.traverse((o) => {
      if (o.isMesh && o.material && FURRED_MATERIALS.has(o.material.name)) {
        targets.push(o);
      }
    });

    for (const mesh of targets) {
      const part = this._partName(mesh, root);
      const length = LENGTH[part] ?? DEFAULT_LENGTH;

      const geometry = mesh.geometry.clone();
      const shellIndex = new Float32Array(SHELLS);
      for (let i = 0; i < SHELLS; i++) shellIndex[i] = (i + 1) / SHELLS;
      geometry.setAttribute('aShell', new THREE.InstancedBufferAttribute(shellIndex, 1));

      const uniforms = {
        uLength: { value: length },
        uDensity: { value: 105 },
        uRootDark: { value: 0.5 },
        uDroop: { value: length * 0.42 },
        // Object-space vectors, refreshed each frame on the CPU so gravity and
        // wind stay world-aligned no matter how the limb is rotated.
        uDown: { value: new THREE.Vector3(0, -1, 0) },
        uWind: { value: new THREE.Vector3() },
        // 0 = dry, 1 = just out of the river.
        uWet: { value: 0 },
      };

      const material = mesh.material.clone();
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);

        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
             attribute float aShell;
             varying float vShell;
             varying vec3 vFurPos;
             uniform float uLength;
             uniform float uDroop;
             uniform vec3 uDown;
             uniform vec3 uWind;
             uniform float uWet;`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vShell = aShell;
             vFurPos = position;
             // Strands bend more the further out they go, so the coat hangs
             // and sways from the tips rather than pivoting at the skin.
             float furT = aShell;
             float bend = furT * furT;
             // Wet fur lies flat and hangs heavier than dry fur.
             float wetLen = mix(1.0, 0.42, uWet);
             float wetDroop = mix(1.0, 1.9, uWet);
             transformed += objectNormal * (uLength * furT * wetLen)
                          + uDown * (uDroop * bend * wetDroop)
                          + uWind * bend;`
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
             varying float vShell;
             varying vec3 vFurPos;
             uniform float uDensity;
             uniform float uRootDark;
             uniform float uWet;
             ${COMMON}`
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             {
               // One strand per cell. Its length is the cell's hash value, so
               // a shell beyond that length simply is not drawn here.
               // Wet fur clumps: coarser cells mean fewer, thicker spikes
               // instead of an even coat.
               float density = uDensity * mix(1.0, 0.5, uWet);
               float strand = furHash(floor(vFurPos * density));
               if (strand < vShell) discard;
               // Light does not reach the base of a coat: darken toward the
               // skin. This is what stops the fur looking like a flat decal.
               // Never brighter than the coat's own colour: pushing tips above
               // 1.0 is free fuel for bloom, and white fur needs no help.
               diffuseColor.rgb *= mix(uRootDark, 1.0, vShell);
               // Water darkens a coat and kills its sheen.
               diffuseColor.rgb *= mix(1.0, 0.6, uWet);
             }`
          );
      };
      // Without this, three.js may reuse the un-patched shader program.
      material.customProgramCacheKey = () => 'fur';

      const shells = new THREE.InstancedMesh(geometry, material, SHELLS);
      const identity = new THREE.Matrix4();
      for (let i = 0; i < SHELLS; i++) shells.setMatrixAt(i, identity);
      shells.instanceMatrix.needsUpdate = true;

      // Fur extends past the original bounds, and the base mesh already casts
      // the shadow, so let the shells skip culling and the shadow pass.
      shells.frustumCulled = false;
      shells.castShadow = false;
      shells.receiveShadow = true;
      shells.name = `${mesh.name}_fur`;

      // Parented to the mesh, so it inherits every transform for free.
      mesh.add(shells);
      this.meshes.push({ mesh, uniforms });
    }

    return this;
  }

  _partName(mesh, root) {
    for (let o = mesh; o && o !== root; o = o.parent) {
      if (LENGTH[o.name] !== undefined) return o.name;
    }
    return mesh.name;
  }

  /** 0 = dry, 1 = soaked. Drives length, clumping and colour together. */
  setWetness(w) {
    for (const { uniforms } of this.meshes) uniforms.uWet.value = w;
  }

  /**
   * Push the coat around. `worldWind` is a world-space displacement -- feed it
   * the negated player velocity and the fur trails behind as the dog runs.
   */
  update(worldWind) {
    this._wind.copy(worldWind);
    for (const { mesh, uniforms } of this.meshes) {
      this._inv.setFromMatrix4(mesh.matrixWorld).invert();
      uniforms.uDown.value.set(0, -1, 0).applyMatrix3(this._inv).normalize();
      uniforms.uWind.value.copy(this._wind).applyMatrix3(this._inv);
    }
  }
}
