import { useEffect, useRef, useState, type RefObject } from 'react';
// @ts-ignore - plain JS helper shared with the vanilla canvas globe
import { worldRect, onScreen, zoomDpr, prefersStatic as prefersStaticJs } from '../../scripts/slot-view.js';

/** What the zoom camera publishes on every frame (see scripts/zoom-camera.js -> publish()). */
export interface ZoomCam { s: number; open: boolean; zoom: number; flying: boolean; cx?: number; cy?: number; r?: number; vw?: number; h?: number }
declare global { interface Window { __zoomCam?: ZoomCam } }

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
 * Shared hook for every 3D island. Inside the zoomed collage world it computes on-screen-ness from the
 * camera math (no getBoundingClientRect per frame, which forced a layout on every scroll frame); outside
 * the world (e.g. a lab page) it falls back to one rect read per camera event / resize.
 */
export function useZoomView(slot: RefObject<HTMLElement | null>, cssSize: number): ZoomView {
  const [view, setView] = useState<ZoomView>({ dpr: 1, visible: true, open: false, tick: 0 });
  const last = useRef('');

  useEffect(() => {
    let wr = slot.current ? worldRect(slot.current) : null;
    const update = () => {
      const el = slot.current;
      const cam = window.__zoomCam;
      const dpr = zoomDpr(cam, cssSize);
      let vis = true;
      if (el && wr && wr.inWorld) vis = onScreen(wr, cam);
      else if (el) { const r = el.getBoundingClientRect(); vis = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; }
      const open = !!(cam && cam.open);
      const visible = vis && !open;
      const key = `${dpr}|${visible}|${open}`;
      setView((v) => {
        if (key === last.current) return { ...v, tick: v.tick + 1 };
        last.current = key;
        return { dpr, visible, open, tick: v.tick + 1 };
      });
    };
    const onResize = () => { wr = slot.current ? worldRect(slot.current) : null; update(); };
    update();
    window.addEventListener('zoomcam', update);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('zoomcam', update);
      window.removeEventListener('resize', onResize);
    };
  }, [slot, cssSize]);

  return view;
}

/** True when the visitor asked for reduced motion or is on a phone-width screen: keep the static fallback. */
export function prefersStatic(): boolean {
  return prefersStaticJs();
}
