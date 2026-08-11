import * as THREE from 'three';

// Shell fur, on a skinned character.
//
// The same surface is drawn SHELLS times, each copy pushed further out along
// its own normals, with hair-shaped holes punched through every copy. Cells
// that survive to the outer shells read as long strands, cells cut early read
// as short ones. Stacked up, the eye reads hair rather than geometry.
//
// The shells used to be one InstancedMesh. That cannot work once the dog is
// skinned -- instancing and skinning are mutually exclusive in three.js -- so
// each shell is now its own SkinnedMesh sharing the SAME skeleton. That costs
// one draw call per shell for one character, which is a fair price for fur
// that actually follows the bones.

const SHELLS = 16;
const LENGTH = 0.105; // metres, on the body -- the longest it ever gets
const DENSITY = 105;

// Fur length varies over the animal, and getting this wrong buries the face.
// A Samoyed is short-coated on the muzzle and skull and heavily coated
// everywhere else; ten centimetres of fur over the whole dog grows straight
// over his nose, eyes and ears, which is exactly what happened when this was
// one constant.
//
// Written against model-space position, which is the bind pose: the muzzle is
// around z = -1.0, the skull -0.7, the ruff -0.35, the tail +0.5.
const REGION_GLSL = /* glsl */ `
  float furLengthAt(vec3 p) {
    // 0 on the muzzle, 1 behind the skull where the ruff begins.
    float back = smoothstep(-0.86, -0.52, p.z);
    float len = mix(0.010, ${LENGTH.toFixed(3)}, back);
    // The ears stand above everything else and must stay nearly bare, or the
    // pink inside them never shows.
    float low = smoothstep(1.30, 1.10, p.y);
    len *= mix(0.22, 1.0, low);
    return len;
  }
`;

const COMMON = /* glsl */ `
  // Cheap 3D hash. Same cell -> same value, every frame and every shell, which
  // is what makes a strand hold together across the layers.
  float furHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
`;

export class Fur {
  constructor() {
    this.shells = [];
    this.uniforms = {
      uWet: { value: 0 },
      uDown: { value: new THREE.Vector3(0, -1, 0) },
      uWind: { value: new THREE.Vector3() },
      uRootDark: { value: 0.68 },
    };
    this._inv = new THREE.Matrix3();
    this._wetness = -1;
  }

  /** Grow fur on the model's skinned fur surface. */
  apply(dog) {
    const base = dog.skinnedFur;
    if (!base) {
      console.warn('SAM: no skinned fur surface found; coat not applied');
      return this;
    }

    for (let i = 0; i < SHELLS; i++) {
      // Shell 0 is the solid coat; the rest are the strands above it.
      const t = (i + 1) / SHELLS;
      const material = this._material(base.material, t);

      const shell = new THREE.SkinnedMesh(base.geometry, material);
      // Share the skeleton rather than copying it, so the shells deform with
      // exactly the same bones as the skin underneath -- no drift.
      shell.bind(base.skeleton, base.bindMatrix);
      shell.bindMode = base.bindMode;
      shell.frustumCulled = false;
      shell.castShadow = false;
      shell.receiveShadow = false;
      shell.name = `fur_shell_${i}`;
      base.parent.add(shell);
      this.shells.push({ node: shell, material });
    }

    this.base = base;
    return this;
  }

  _material(source, shellT) {
    const material = source.clone();
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uShell = { value: shellT };
      shader.uniforms.uWet = this.uniforms.uWet;
      shader.uniforms.uDown = this.uniforms.uDown;
      shader.uniforms.uWind = this.uniforms.uWind;
      shader.uniforms.uRootDark = this.uniforms.uRootDark;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uShell;
           uniform float uWet;
           uniform vec3 uDown;
           uniform vec3 uWind;
           varying vec3 vFurPos;
           ${REGION_GLSL}`
        )
        // AFTER skinning, so the offset follows the deformed surface rather
        // than the bind pose. Putting it in begin_vertex would leave the coat
        // behind whenever a bone moved.
        .replace(
          '#include <skinning_vertex>',
          `#include <skinning_vertex>
           vFurPos = position;
           {
             float bend = uShell * uShell;
             float wetLen = mix(1.0, 0.42, uWet);
             float wetDroop = mix(1.0, 1.9, uWet);
             float len = furLengthAt(position);
             vec3 n = normalize(objectNormal);
             transformed += n * (len * uShell * wetLen)
                          + uDown * (len * 0.42 * bend * wetDroop)
                          + uWind * bend;
           }`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uShell;
           uniform float uWet;
           uniform float uRootDark;
           varying vec3 vFurPos;
           ${COMMON}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           {
             // Wet fur clumps: coarser cells mean fewer, thicker spikes.
             float density = ${DENSITY.toFixed(1)} * mix(1.0, 0.5, uWet);
             float strand = furHash(floor(vFurPos * density));
             if (strand < uShell) discard;
             // Light does not reach the base of a coat.
             diffuseColor.rgb *= mix(uRootDark, 1.0, uShell);
             diffuseColor.rgb *= mix(1.0, 0.6, uWet);
           }`
        );
    };
    material.customProgramCacheKey = () => `fur${shellT.toFixed(3)}`;
    material.needsUpdate = true;
    return material;
  }

  /** 0 = dry, 1 = soaked. Drives length, clumping and colour together. */
  setWetness(w) {
    if (Math.abs(w - this._wetness) < 0.005) return;
    this._wetness = w;
    this.uniforms.uWet.value = w;
  }

  /**
   * Push the coat around. `worldWind` is a world-space displacement -- feed it
   * the negated player velocity and the fur trails behind as he runs.
   */
  update(worldWind) {
    if (!this.base) return;
    this._inv.setFromMatrix4(this.base.matrixWorld).invert();
    this.uniforms.uDown.value.set(0, -1, 0).applyMatrix3(this._inv).normalize();
    this.uniforms.uWind.value.copy(worldWind).applyMatrix3(this._inv);
  }
}
