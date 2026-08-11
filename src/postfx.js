import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// The camera, rather than the renderer.
//
// Most of what separates a competent real-time scene from one that looks shot
// rather than rendered happens after the geometry is drawn: contact shading,
// bloom, a lens that is not mathematically perfect, and grain. None of it adds
// detail -- it adds the imperfections an eye expects.

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.055 },
    uVignette: { value: 0.55 },
    uAberration: { value: 0.0022 },
    uLift: { value: new THREE.Color(0.012, 0.016, 0.028) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    uniform vec3 uLift;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);

      // Real lenses split colour toward the edges of the frame, and never in
      // the middle. Constant aberration just looks broken.
      vec2 off = c * r2 * uAberration;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;

      col *= 1.0 - uVignette * smoothstep(0.15, 1.0, r2 * 2.2);

      // Grain lives in the shadows. Putting it everywhere reads as noise;
      // putting it in the dark reads as film.
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 137.0) - 0.5;
      col += g * uGrain * (1.0 - smoothstep(0.0, 0.55, luma));

      // Lift the blacks a touch, so shadows read as air rather than as holes.
      col += uLift * (1.0 - smoothstep(0.0, 0.25, luma));

      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function buildComposer(renderer, scene, camera) {
  const size = new THREE.Vector2(innerWidth, innerHeight);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Contact shading. In a scene lit by one moving lamp this is what puts
  // objects ON the ground rather than floating above it.
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({
    radius: 0.45,
    distanceExponent: 1.2,
    thickness: 1.0,
    scale: 1.1,
    samples: 16,
    screenSpaceRadius: false,
  });
  composer.addPass(gtao);

  // Bloom runs before tone mapping, so its threshold is in raw linear light,
  // where ordinary lit surfaces already sit above 1.
  const bloom = new UnrealBloomPass(size, 0.55, 0.72, 1.1);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  // The grade runs after tone mapping, in display space, which is the only
  // place grain and vignette make sense.
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  composer.addPass(new SMAAPass());

  return {
    composer,
    gtao,
    bloom,
    grade,
    update(dt) {
      grade.uniforms.uTime.value += dt;
    },
    setSize(w, h) {
      composer.setSize(w, h);
      bloom.setSize(w, h);
      gtao.setSize(w, h);
    },
  };
}
