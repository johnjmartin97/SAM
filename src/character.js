import * as THREE from 'three';

// How brightly Sam responds to light.
//
// Why this exists: three.js tests a light's `layers` against the CAMERA, not
// against each object, so there is no way to say "this lamp lights everything
// except the dog". The light list is global. The equivalent has to be done at
// the other end -- on the dog's own materials.
//
// It is needed because a white Samoyed and a forest floor are about seven
// times apart in albedo before any light is involved. Expose the ground
// correctly and he blows out; expose him correctly and the woods go black. A
// real camera solves this with dynamic range; here the character simply gets
// his own exposure.
//
// The knee is a soft ceiling rather than a hard clamp, so he still shades and
// still brightens near the campfire instead of flattening to a silhouette.

const PATCHED = Symbol('characterExposure');

function patchMaterial(material, uniforms) {
  if (!material || material[PATCHED]) return;
  material[PATCHED] = true;

  // Other code (the fur shader, the wind) may already own onBeforeCompile,
  // so wrap it rather than replacing it.
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);

    shader.uniforms.uCharExposure = uniforms.exposure;
    shader.uniforms.uCharKnee = uniforms.knee;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uCharExposure;
         uniform float uCharKnee;`
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
         gl_FragColor.rgb *= uCharExposure;
         // Soft shoulder: values roll off toward a ceiling instead of clipping.
         gl_FragColor.rgb = gl_FragColor.rgb / (1.0 + gl_FragColor.rgb * uCharKnee);`
      );
  };

  // customProgramCacheKey is a method on Material.prototype, so it always
  // exists and the default implementation reads `this`. It has to be called
  // bound to the material -- calling it detached throws.
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function () {
    return `${previousKey.call(this)}|charexp`;
  };
  material.needsUpdate = true;
}

/**
 * Give everything under `root` its own exposure.
 * Call AFTER the fur is applied, so the fur shells are patched too.
 */
export function applyCharacterExposure(root, { exposure = 0.085, knee = 0.55 } = {}) {
  const uniforms = {
    exposure: { value: exposure },
    knee: { value: knee },
  };

  root.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) patchMaterial(m, uniforms);
  });

  return {
    get exposure() {
      return uniforms.exposure.value;
    },
    set exposure(v) {
      uniforms.exposure.value = v;
    },
    get knee() {
      return uniforms.knee.value;
    },
    set knee(v) {
      uniforms.knee.value = v;
    },
  };
}
