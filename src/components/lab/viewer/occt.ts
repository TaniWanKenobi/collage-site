// STEP / IGES / BREP import via occt-import-js (OpenCascade compiled to wasm, ~7.6 MB).
// This module is only imported when one of those files is dropped, so the wasm never loads otherwise.
// Parsing runs in a worker so the page stays responsive on big assemblies.
import jsUrl from 'occt-import-js/dist/occt-import-js.js?url';
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';

export interface OcctMesh {
  name?: string;
  color?: [number, number, number];
  position: Float32Array;
  normal?: Float32Array;
  index: Uint32Array;
  faces?: { first: number; last: number; color: [number, number, number] | null }[];
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { ok: (m: OcctMesh[]) => void; fail: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const js = new URL(jsUrl, location.href).href;
  const wasm = new URL(wasmUrl, location.href).href;
  const src = `
    importScripts(${JSON.stringify(js)});
    let ready = null;
    onmessage = async (ev) => {
      const { id, format, buffer, params } = ev.data;
      try {
        ready = ready || occtimportjs({ locateFile: () => ${JSON.stringify(wasm)} });
        const occt = await ready;
        const r = occt.ReadFile(format, new Uint8Array(buffer), params);
        if (!r || !r.success) throw new Error('OpenCascade could not read this ' + format.toUpperCase() + ' file');
        const meshes = []; const transfer = [];
        for (const m of r.meshes) {
          const position = new Float32Array(m.attributes.position.array);
          const normal = m.attributes.normal ? new Float32Array(m.attributes.normal.array) : undefined;
          const index = new Uint32Array(m.index.array);
          transfer.push(position.buffer, index.buffer); if (normal) transfer.push(normal.buffer);
          meshes.push({ name: m.name, color: m.color, position, normal, index, faces: m.brep_faces });
        }
        postMessage({ id, meshes }, transfer);
      } catch (e) { postMessage({ id, error: String(e && e.message || e) }); }
    };`;
  worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  worker.onmessage = (ev) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    ev.data.error ? p.fail(new Error(ev.data.error)) : p.ok(ev.data.meshes);
  };
  worker.onerror = (ev) => {
    const err = new Error(ev.message || 'occt worker failed to start');
    pending.forEach((p) => p.fail(err));
    pending.clear();
    worker = null;
  };
  return worker;
}

/** format: 'step' | 'iges' | 'brep'. linearDeflection is relative to the bounding box (smaller = finer). */
export function readCad(format: 'step' | 'iges' | 'brep', buffer: ArrayBuffer, linearDeflection: number): Promise<OcctMesh[]> {
  const id = ++seq;
  const params = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection, angularDeflection: 0.5 };
  return new Promise((ok, fail) => {
    pending.set(id, { ok, fail });
    getWorker().postMessage({ id, format, buffer, params }, [buffer]);
  });
}
