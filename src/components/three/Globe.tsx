import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Stage } from './Stage';

const GRAPE_LITE = '#8F86C0';
const LIME = '#C2F970';

function circle(fn: (t: number) => THREE.Vector3, seg = 96) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= seg; i++) pts.push(fn((i / seg) * Math.PI * 2));
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/** Lat/long wireframe built from line loops: no textures, no model file. */
function WireGlobe() {
  const spin = useRef<THREE.Group>(null);
  const lines = useMemo(() => {
    const out: THREE.BufferGeometry[] = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      const phi = THREE.MathUtils.degToRad(lat);
      const r = Math.cos(phi), y = Math.sin(phi);
      out.push(circle((t) => new THREE.Vector3(r * Math.cos(t), y, r * Math.sin(t))));
    }
    for (let lon = 0; lon < 180; lon += 30) {
      const th = THREE.MathUtils.degToRad(lon);
      out.push(circle((t) => new THREE.Vector3(Math.cos(t) * Math.cos(th), Math.sin(t), Math.cos(t) * Math.sin(th))));
    }
    return out;
  }, []);
  const rim = useMemo(() => circle((t) => new THREE.Vector3(Math.cos(t), Math.sin(t), 0), 160), []);
  // Marker on the surface, like the lime dot on the CSS globe.
  const marker = useMemo(() => {
    const phi = THREE.MathUtils.degToRad(40), th = THREE.MathUtils.degToRad(-50);
    return new THREE.Vector3(Math.cos(phi) * Math.cos(th), Math.sin(phi), Math.cos(phi) * Math.sin(th));
  }, []);

  useFrame((_, dt) => { if (spin.current) spin.current.rotation.y += Math.min(dt, 0.05) * 0.18; });

  return (
    <>
      <group rotation={[0.35, 0, -0.18]}>
        <group ref={spin}>
          {lines.map((g, i) => (
            <lineLoop key={i} geometry={g}>
              <lineBasicMaterial color={GRAPE_LITE} />
            </lineLoop>
          ))}
          <mesh position={marker}>
            <sphereGeometry args={[0.07, 24, 16]} />
            <meshBasicMaterial color={LIME} />
          </mesh>
        </group>
      </group>
      {/* Silhouette ring facing the camera, so the outline reads like the CSS fallback. */}
      <lineLoop geometry={rim}>
        <lineBasicMaterial color={GRAPE_LITE} />
      </lineLoop>
    </>
  );
}

/** The globe in the grape disc. Mounted with client:visible from collage/GlobeDisc.astro. */
export default function Globe() {
  return (
    <Stage size={294} camZ={3.05}>
      <WireGlobe />
    </Stage>
  );
}
