import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useZoomView, prefersStatic } from './useZoomView';
// @ts-ignore - plain JS helper
import { whenIdle } from '../../scripts/slot-view.js';

/** Re-render on demand when the camera moves, and keep animating only while visible. */
function Driver({ animate, tick }: { animate: boolean; tick: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { invalidate(); }, [tick, invalidate]);
  useFrame(() => { if (animate) invalidate(); });
  return null;
}

/**
 * One 3D slot in the collage. Every model (the globe now, GLBs later) renders through this:
 * demand frameloop, zoom-aware pixel ratio, hidden while a page is open, paused off-screen,
 * and after the canvas is created it adds `three-live` to its host (`.globe-disc` or any
 * `[data-three-host]` ancestor) so the static `.css-fallback` inside it hides.
 */
export function Stage({ size, animate = true, children, camZ = 3.2 }: { size: number; animate?: boolean; children: ReactNode; camZ?: number }) {
  const slot = useRef<HTMLDivElement>(null);
  // Starts off on the server and first client render (no hydration mismatch); the empty div is what
  // client:visible observes, so it must always render.
  const [enabled, setEnabled] = useState(false);
  // The WebGL context is created only after the page has loaded and gone idle: 3D is never on the critical path.
  useEffect(() => {
    if (prefersStatic()) return;
    let off = false;
    whenIdle(() => { if (!off) setEnabled(true); });
    return () => { off = true; };
  }, []);
  const view = useZoomView(slot, size);
  const [drawn, setDrawn] = useState(false);

  // While the canvas is hidden (page open), give the host back its static fallback.
  useEffect(() => {
    const host = slot.current?.closest('.globe-disc, [data-three-host]');
    host?.classList.toggle('three-live', drawn && view.visible);
  }, [drawn, view.visible]);

  return (
    <div ref={slot} style={{ position: 'absolute', inset: 0, visibility: view.visible ? 'visible' : 'hidden' }}>
      {enabled && (
      <Canvas
        flat
        frameloop="demand"
        // Measure the untransformed layout box (294px); zoom sharpness comes from dpr, not from size.
        resize={{ offsetSize: true, scroll: false }}
        dpr={view.dpr}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        camera={{ position: [0, 0, camZ], fov: 40 }}
        onCreated={() => setDrawn(true)}
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <Driver animate={animate && view.visible} tick={view.tick} />
        {children}
      </Canvas>
      )}
    </div>
  );
}
