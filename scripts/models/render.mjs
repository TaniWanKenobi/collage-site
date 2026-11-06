// Render a poster .webp for a GLB using agent-browser (headless Chrome) and render.html.
// Usage: node scripts/models/render.mjs <id> [--az 35] [--el 22] [--fit 0.82] [--bg transparent|0d160b] [--style cel+ink|clay|original]
//   Reads public/models/<id>.glb, writes public/models/<id>.webp (1200×900).
// Needs: agent-browser on PATH. Starts serve.mjs on port 4390 for the duration.
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [id, ...rest] = process.argv.slice(2);
if (!id) { console.error('usage: render.mjs <id> [--az deg] [--el deg] [--fit f] [--bg hex|transparent]'); process.exit(1); }
const opt = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
const PORT = 4390;

// On Windows, call the native agent-browser exe directly: going through the .cmd shim means
// cmd.exe, which splits the render URL at every '&'.
function agentBrowserBin() {
  if (process.platform !== 'win32') return 'agent-browser';
  const root = execFileSync(process.execPath, [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'root', '-g'], { encoding: 'utf8' }).trim();
  const exe = path.join(root, 'agent-browser', 'bin', 'agent-browser-win32-x64.exe');
  if (!existsSync(exe)) throw new Error('agent-browser native exe not found at ' + exe);
  return exe;
}
const AB = agentBrowserBin();
// Wait for our own server: if the port is taken, another server (maybe another checkout) would answer instead.
const server = spawn(process.execPath, [path.join(here, 'serve.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((ok, fail) => {
  server.stdout.on('data', (d) => { if (String(d).includes('render server on')) ok(); });
  server.on('exit', () => fail(new Error(`serve.mjs could not start on port ${PORT} (in use?)`)));
});
const ab = (...a) => execFileSync(AB, ['--session', 'model-render', ...a], { encoding: 'utf8' }).trim();
try {
  // ?v= keeps the browser from drawing a cached copy of an older .glb
  const qs = new URLSearchParams({ model: `/public/models/${id}.glb?v=${Date.now()}`, save: `${id}.webp`, az: opt('az', '35'), el: opt('el', '22'), fit: opt('fit', '0.82'), bg: opt('bg', 'transparent'), style: opt('style', 'cel+ink') });
  ab('set', 'viewport', '1200', '900');
  ab('open', `http://127.0.0.1:${PORT}/scripts/models/render.html?${qs}`);
  ab('wait', '--timeout', '60000', '--fn', 'window.__stats && window.__stats.ready && (window.__stats.saved || window.__stats.error)');
  console.log(ab('eval', 'JSON.stringify(window.__stats)'));
} finally {
  try { ab('close'); } catch {}
  server.kill();
}
