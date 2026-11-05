// "Grape duotone" look: a view-space lambert term mapped onto onyx -> grape -> lime-tint, plus a lime rim.
import * as THREE from 'three';

export function duotoneMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      cDark: { value: new THREE.Color('#172315') },
      cMid: { value: new THREE.Color('#564D80') },
      cLight: { value: new THREE.Color('#EFFDD8') },
      cRim: { value: new THREE.Color('#C2F970') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 cDark; uniform vec3 cMid; uniform vec3 cLight; uniform vec3 cRim;
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float d = dot(n, normalize(vec3(0.45, 0.8, 0.6))) * 0.5 + 0.5;
        vec3 c = d < 0.55 ? mix(cDark, cMid, smoothstep(0.0, 0.55, d)) : mix(cMid, cLight, smoothstep(0.55, 1.0, d));
        float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 3.0);
        gl_FragColor = vec4(mix(c, cRim, rim * 0.6), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
