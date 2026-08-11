import * as THREE from 'three';
import { WORLD, WATER_Y } from './terrain.js';

// The river surface.
//
// The shader knows the terrain height function, which buys three things a flat
// blue plane cannot have: the water clips itself exactly at the shoreline (so
// the plane can be a plain rectangle), it gets darker as the bed drops away,
// and it grows foam in the shallows. The wave height is duplicated in JS below
// so that Sam bobs on exactly the waves you can see.

/** Surface displacement. MUST stay identical to WAVES in the shader. */
export function waveHeight(x, z, t) {
  return (
    0.055 * Math.sin(x * 0.9 + t * 1.7) +
    0.04 * Math.sin(z * 1.3 - t * 2.1) +
    0.03 * Math.sin((x + z) * 0.6 + t * 1.1)
  );
}

const TERRAIN_GLSL = /* glsl */ `
  float riverZf(float x) { return 2.0 + 8.0 * sin(x * 0.026) + 4.5 * sin(x * 0.061 + 1.3); }
  float riverHWf(float x) { return 8.5 + 2.2 * sin(x * 0.04 + 0.7); }

  // Mirror of heightAt() in terrain.js.
  float terrainH(vec2 p) {
    float h = 0.95 + 0.5 * sin(p.x * 0.045) * cos(p.y * 0.038)
                   + 0.25 * sin(p.x * 0.11 + p.y * 0.07);
    float d = abs(p.y - riverZf(p.x));
    float w = riverHWf(p.x);
    float carve = 1.0 - smoothstep(w * 0.3, w + 7.5, d);
    return h - 3.3 * carve;
  }

  // Mirror of waveHeight() above.
  float waveH(vec2 p, float t) {
    return 0.055 * sin(p.x * 0.9 + t * 1.7)
         + 0.040 * sin(p.y * 1.3 - t * 2.1)
         + 0.030 * sin((p.x + p.y) * 0.6 + t * 1.1);
  }

  float ripple(vec2 p, float t) {
    return 0.010 * sin(p.x * 5.3 - t * 4.1)
         + 0.008 * sin(p.y * 6.7 + t * 3.3)
         + 0.006 * sin((p.x - p.y) * 8.1 + t * 5.7);
  }
`;

export class Water {
  constructor(scene) {
    // Only spans the valley -- everywhere else the shader would discard anyway.
    const width = WORLD * 2;
    const depth = 66;
    const geo = new THREE.PlaneGeometry(width, depth, 190, 84);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, WATER_Y, 2);

    this.uniforms = {
      uTime: { value: 0 },
      uWaterY: { value: WATER_Y },
      uShallow: { value: new THREE.Color(0x2b4a52) },
      uDeep: { value: new THREE.Color(0x060f16) },
      uFoam: { value: new THREE.Color(0xbcd6dd) },
    };

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.08,
      metalness: 0.16,
      transparent: true,
      // Water is lit almost entirely by Sam's lamp and the campfire, so the
      // specular response is the whole look.
      envMapIntensity: 0,
    });

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           varying vec3 vWorld;
           ${TERRAIN_GLSL}`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
           // Flatten the swell as the bed rises, the way real water goes
           // glassy in the shallows.
           float dep = ${WATER_Y.toFixed(3)} - terrainH(wp.xz);
           float calm = smoothstep(0.0, 0.9, dep);
           transformed.y += waveH(wp.xz, uTime) * calm;
           vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           uniform float uWaterY;
           uniform vec3 uShallow;
           uniform vec3 uDeep;
           uniform vec3 uFoam;
           varying vec3 vWorld;
           ${TERRAIN_GLSL}`
        )
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
           {
             // Analytic slope of the wave field, plus finer ripples that only
             // exist in the normal. This is what makes the lamp glitter on the
             // surface instead of sitting on it as a flat disc.
             vec2 p = vWorld.xz;
             float e = 0.35;
             float hx = (waveH(p + vec2(e, 0.0), uTime) + ripple(p + vec2(e, 0.0), uTime))
                      - (waveH(p - vec2(e, 0.0), uTime) + ripple(p - vec2(e, 0.0), uTime));
             float hz = (waveH(p + vec2(0.0, e), uTime) + ripple(p + vec2(0.0, e), uTime))
                      - (waveH(p - vec2(0.0, e), uTime) + ripple(p - vec2(0.0, e), uTime));
             vec3 wn = normalize(vec3(-hx / (2.0 * e) * 2.4, 1.0, -hz / (2.0 * e) * 2.4));
             normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
           }`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           {
             float dep = uWaterY - terrainH(vWorld.xz);
             // Outside the channel there is no water at all. This is what
             // gives a shoreline that follows the ground exactly.
             if (dep <= 0.0) discard;

             float t = clamp(dep / 1.5, 0.0, 1.0);
             diffuseColor.rgb *= mix(uShallow, uDeep, t);

             // Foam where the water runs thin over the bed.
             float foam = 1.0 - smoothstep(0.0, 0.30, dep);
             foam *= 0.55 + 0.45 * sin(vWorld.x * 3.1 + vWorld.z * 2.7 + uTime * 2.2);
             diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, clamp(foam, 0.0, 1.0) * 0.75);

             diffuseColor.a = mix(0.55, 0.93, t) + clamp(foam, 0.0, 1.0) * 0.3;
           }`
        );
    };
    material.customProgramCacheKey = () => 'water';

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  update(dt) {
    this.uniforms.uTime.value += dt;
  }

  get time() {
    return this.uniforms.uTime.value;
  }
}
