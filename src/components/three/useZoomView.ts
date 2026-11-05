import { useEffect, useRef, useState, type RefObject } from 'react';

/** What the zoom camera publishes on every frame (see scripts/zoom-camera.js -> publish()). */
export interface ZoomCam { s: number; open: boolean; zoom: number; flying: boolean }
declare global { interface Window { __zoomCam?: ZoomCam } }

// Largest backing-store edge allowed, so a 294px slot at 10x zoom does not allocate a 6000px canvas.
const MAX_CANVAS_PX = 3072;

export interface ZoomView {
  /** Pixel ratio for the canvas: devicePixelRatio x the world's current scale, capped. Keeps lines sharp when zoomed in. */
  dpr: number;
  /** The slot is on screen and no page is open over it: worth rendering. */
  visible: boolean;
  /** A zoom page is more than half opaque: the island must not show over it. */
  open: boolean;
  /** Increments whenever the camera moves, so callers can invalidate a demand frameloop. */
  tick: number;
}

/**
 * Shared hook for every 3D island that lives inside the collage world. The canvas sits inside the
 * scaled 1440x900 world (so pieces stack over it correctly); this hook keeps it sharp and idle.
 */
export function useZoomView(slot: RefObject<HTMLElement | null>, cssSize: number): ZoomView {
  const [view, setView] = useState<ZoomView>({ dpr: 1, visible: true, open: false, tick: 0 });
  const last = useRef('');

  useEffect(() => {
    const update = () => {
      const el = slot.current;
      const cam = window.__zoomCam ?? { s: 1, open: false, zoom: 0, flying: false };
      const base = window.devicePixelRatio || 1;
      const cap = MAX_CANVAS_PX / Math.max(1, cssSize);
      // Round to 0.25 steps so the backing store is not resized every frame of a flight.
      const dpr = Math.min(cap, Math.max(1, Math.round(base * cam.s * 4) / 4));
      let onScreen = true;
      if (el) {
        const r = el.getBoundingClientRect();
        onScreen = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
      }
      const visible = onScreen && !cam.open;
      const key = `${dpr}|${visible}|${cam.open}`;
      setView((v) => {
        if (key === last.current) return { ...v, tick: v.tick + 1 };
        last.current = key;
        return { dpr, visible, open: cam.open, tick: v.tick + 1 };
      });
    };
    update();
    window.addEventListener('zoomcam', update);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('zoomcam', update);
      window.removeEventListener('resize', update);
    };
  }, [slot, cssSize]);

  return view;
}

/** True when the visitor asked for reduced motion or is on a phone-width screen: keep the static fallback. */
export function prefersStatic(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth < 760;
}
