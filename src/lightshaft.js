import * as THREE from 'three';

// Visible light in the air.
//
// A lamp in fog should have a *shape* -- a cone of lit mist hanging under it.
// Full volumetric lighting means raymarching the shadow map every frame, which
// is not worth it here. A soft additive cone gets most of the read for almost
// nothing, because the thing the eye is actually looking for is the silhouette
// of the beam, not physically correct scattering.

const ShaftShader = {
  vertexShader: /* glsl */ `
    varying vec3 vLocal;
    varying vec3 vNormalW;
    varying vec3 vViewW;
    void main() {
      vLocal = position;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vViewW = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uHeight;
    uniform float uRadius;
    uniform float uIntensity;
    varying vec3 vLocal;
    varying vec3 vNormalW;
    varying vec3 vViewW;

    void main() {
      // 0 on the axis, 1 at the rim.
      float r = clamp(length(vLocal.xz) / uRadius, 0.0, 1.0);
      // 0 at the lamp, 1 at the ground.
      float h = clamp((uHeight * 0.5 - vLocal.y) / uHeight, 0.0, 1.0);

      // Bright and tight near the source, wide and faint by the ground --
      // which is what a beam in mist actually does.
      float a = pow(1.0 - r, 2.6) * pow(1.0 - h, 1.4);

      // Without this the cone reads as a solid triangle, because what is being
      // shaded is a SURFACE, and a surface has a hard silhouette. Fading by
      // how squarely the surface faces the camera softens that edge to
      // nothing, which is what makes it look like lit air instead of a cone.
      float facing = abs(dot(normalize(vNormalW), normalize(vViewW)));
      a *= pow(facing, 1.7);

      a *= uIntensity;
      gl_FragColor = vec4(uColor * a, a);
    }`,
};

/**
 * A cone of lit air. The tip sits at the origin of the returned mesh, so it
 * can simply be parented to (or moved with) the light it belongs to.
 */
export function createLightShaft({
  color = 0xffd9a8,
  height = 3.2,
  radius = 2.1,
  intensity = 0.5,
} = {}) {
  const geo = new THREE.ConeGeometry(radius, height, 20, 1, true);
  // ConeGeometry puts the tip at +height/2; drop it so the tip is the origin.
  geo.translate(0, -height / 2, 0);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uHeight: { value: height },
      uRadius: { value: radius },
      uIntensity: { value: intensity },
    },
    vertexShader: ShaftShader.vertexShader,
    fragmentShader: ShaftShader.fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData.uniforms = material.uniforms;
  return mesh;
}
