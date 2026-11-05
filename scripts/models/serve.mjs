// Tiny static server for headless model renders (scripts/models/render.html).
// Usage: node scripts/models/serve.mjs [port]   (default 4390; serves the repo root)
// POST /__save?name=<file>.webp writes the request body to public/models/<file>.webp.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public', 'models');
const port = Number(process.argv[2] || 4390);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.wasm': 'application/wasm' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/__save') {
      const name = path.basename(url.searchParams.get('name') || '');
      if (!/^[\w.-]+\.webp$/.test(name)) { res.writeHead(400).end('bad name'); return; }
      const chunks = []; for await (const c of req) chunks.push(c);
      await writeFile(path.join(OUT, name), Buffer.concat(chunks));
      res.writeHead(200).end('ok'); return;
    }
    const file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`render server on http://127.0.0.1:${port}`));
