import { Suspense } from 'react';
import { useGLTF, Center, Bounds } from '@react-three/drei';
import { Stage } from './Stage';

function Model({ src }: { src: string }) {
  const { scene } = useGLTF(src);
  return <primitive object={scene} />;
}

/**
 * Drop-in slot for a .glb/.gltf model anywhere in the collage world or a section page.
 * In an .astro file, inside a positioned box marked `data-three-host`:
 *
 *   <div data-three-host style="position:relative;width:300px;height:300px">
 *     <img class="css-fallback" src={url('models/thing.png')} alt="" />
 *     <ModelSlot client:visible src={url('models/thing.glb')} size={300} />
 *   </div>
 *
 * Put the model in public/models/. No model ships with the site yet.
 */
export default function ModelSlot({ src, size = 300, spin = true }: { src: string; size?: number; spin?: boolean }) {
  return (
    <Stage size={size} animate={spin}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[2, 3, 4]} intensity={1.2} />
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={1.1}>
          <Center>
            <Model src={src} />
          </Center>
        </Bounds>
      </Suspense>
    </Stage>
  );
}
