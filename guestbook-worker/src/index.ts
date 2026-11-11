// Guestbook API for the collage site (static, on Cloudflare Pages and GitHub Pages). Cloudflare Worker + D1.
//   GET  /entries?before=<id>&limit=30  newest visible entries (no doodle bytes, just `doodle: true`)
//   POST /entries                       { name, message, link?, doodle? }  -> the created entry
//   GET  /doodle/:id                    the entry's doodle as image/png, cached
// Rate limit: 1 post / 30 s and 10 posts / day per SHA-256(IP_SALT + CF-Connecting-IP).

interface D1Result<T> { results: T[] }
interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<{ meta: { last_row_id: number } }>;
}
interface Env { DB: { prepare(sql: string): D1Stmt }; IP_SALT?: string; EXTRA_ORIGINS?: string }

const ORIGINS = new Set(['https://taniwankenobi.github.io', 'https://tanishq.quest', 'https://www.tanishq.quest', 'https://tanishq-quest.pages.dev', 'http://localhost:4321', 'http://[::1]:4321']);
// Optional comma-separated extra origins (e.g. another local dev port), from a var or .dev.vars.
let extraOrigins = new Set<string>();
const MAX_BODY = 260_000;            // bytes of JSON accepted at all
const MAX_DOODLE_B64 = 200_000;      // ~150 KB of PNG once decoded
const COOLDOWN_MS = 30_000;
const DAY_MS = 86_400_000;
const PER_DAY = 10;
const DOODLE_PREFIX = 'data:image/png;base64,';

type Row = { id: number; name: string; message: string; link: string | null; created_at: number; has_doodle: number };

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin') || '';
  const h: Record<string, string> = { Vary: 'Origin' };
  if (ORIGINS.has(o) || extraOrigins.has(o)) {
    h['Access-Control-Allow-Origin'] = o;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(req), ...extra },
  });
}
const fail = (req: Request, status: number, error: string, message: string, extra: Record<string, string> = {}) =>
  json(req, { error, message }, status, extra);

const shape = (r: Row) => ({
  id: r.id, name: r.name, message: r.message, link: r.link, created_at: r.created_at, doodle: !!r.has_doodle,
});

// Trim, drop control characters (newlines kept in messages), and count length in code points.
function clean(v: unknown, multiline: boolean): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\r\n?/g, '\n').replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '');
  return (multiline ? s.replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ')).trim();
}
const len = (s: string) => [...s].length;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeB64(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function list(req: Request, env: Env, url: URL): Promise<Response> {
  const before = Number.parseInt(url.searchParams.get('before') || '', 10);
  const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '30', 10) || 30));
  const where = Number.isFinite(before) && before > 0 ? 'AND id < ?2' : '';
  const stmt = env.DB.prepare(
    `SELECT id, name, message, link, created_at, doodle IS NOT NULL AS has_doodle
       FROM entries WHERE hidden = 0 ${where} ORDER BY id DESC LIMIT ?1`,
  );
  // Fetch one extra row to know whether there is another page.
  const { results } = await (where ? stmt.bind(limit + 1, before) : stmt.bind(limit + 1)).all<Row>();
  const more = results.length > limit;
  const page = results.slice(0, limit).map(shape);
  return json(req, { entries: page, next: more ? page[page.length - 1].id : null }, 200, { 'Cache-Control': 'no-store' });
}

async function create(req: Request, env: Env): Promise<Response> {
  if (!env.IP_SALT) return fail(req, 500, 'not_configured', 'The guestbook is missing its IP_SALT secret.');
  if (!(req.headers.get('Content-Type') || '').includes('application/json'))
    return fail(req, 415, 'bad_content_type', 'Send JSON (Content-Type: application/json).');
  const declared = Number(req.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY) return fail(req, 413, 'too_large', 'That note is too big (the doodle may be too detailed).');
  const raw = await req.text();
  if (raw.length > MAX_BODY) return fail(req, 413, 'too_large', 'That note is too big (the doodle may be too detailed).');
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    body = parsed;
  } catch { return fail(req, 400, 'bad_json', 'The request body is not valid JSON.'); }

  const fields: Record<string, string> = {};
  const name = clean(body.name, false);
  const message = clean(body.message, true);
  const linkIn = clean(body.link, false);
  if (!name) fields.name = 'Add your name.';
  else if (len(name) > 40) fields.name = 'Names can be up to 40 characters.';
  if (!message) fields.message = 'Write a message.';
  else if (len(message) > 500) fields.message = 'Messages can be up to 500 characters.';

  let link: string | null = null;
  if (linkIn) {
    if (linkIn.length > 200) fields.link = 'Links can be up to 200 characters.';
    else {
      try {
        const u = new URL(linkIn);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
        link = u.href.length <= 200 ? u.href : linkIn;
      } catch { fields.link = 'Links must start with http:// or https://.'; }
    }
  }

  let doodle: string | null = null;
  if (body.doodle != null && body.doodle !== '') {
    const d = body.doodle;
    if (typeof d !== 'string' || !d.startsWith(DOODLE_PREFIX)) fields.doodle = 'Doodles must be a PNG image.';
    else {
      const b64 = d.slice(DOODLE_PREFIX.length);
      if (b64.length > MAX_DOODLE_B64) fields.doodle = 'That doodle is too big (about 150 KB max).';
      else if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) fields.doodle = 'That doodle is not valid base64.';
      else {
        const bytes = decodeB64(b64);
        if (!bytes || bytes.length < 8 || !PNG_MAGIC.every((b, i) => bytes[i] === b)) fields.doodle = 'Doodles must be a PNG image.';
        else doodle = b64;
      }
    }
  }
  if (Object.keys(fields).length) return json(req, { error: 'invalid', message: 'Some fields need a fix.', fields }, 400);

  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await sha256(env.IP_SALT + '|' + ip);
  const now = Date.now();
  const rate = await env.DB.prepare(
    'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM entries WHERE ip_hash = ?1 AND created_at > ?2',
  ).bind(ipHash, now - DAY_MS).first<{ n: number; last: number | null }>();
  if (rate?.last && now - rate.last < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - rate.last)) / 1000);
    return fail(req, 429, 'slow_down', `Please wait ${wait} seconds before posting again.`, { 'Retry-After': String(wait) });
  }
  if ((rate?.n ?? 0) >= PER_DAY)
    return fail(req, 429, 'daily_limit', 'You have left 10 notes today. Come back tomorrow!', { 'Retry-After': '3600' });

  const res = await env.DB.prepare(
    'INSERT INTO entries (name, message, link, doodle, created_at, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  ).bind(name, message, link, doodle, now, ipHash).run();
  const id = res.meta.last_row_id;
  return json(req, { entry: { id, name, message, link, created_at: now, doodle: !!doodle } }, 201);
}

async function doodle(req: Request, env: Env, id: number): Promise<Response> {
  const row = await env.DB.prepare('SELECT doodle FROM entries WHERE id = ?1 AND hidden = 0')
    .bind(id).first<{ doodle: string | null }>();
  const bytes = row?.doodle ? decodeB64(row.doodle) : null;
  if (!bytes) return new Response('Not found', { status: 404, headers: { ...cors(req), 'Cache-Control': 'no-store' } });
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      // A doodle never changes; a week keeps moderation (hiding) effective within a reasonable time.
      'Cache-Control': 'public, max-age=604800',
      'X-Content-Type-Options': 'nosniff',
      ...cors(req),
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    extraOrigins = new Set((env.EXTRA_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean));
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    try {
      if (path === '/entries') {
        if (req.method === 'GET') return await list(req, env, url);
        if (req.method === 'POST') return await create(req, env);
        return fail(req, 405, 'method_not_allowed', 'Use GET or POST.', { Allow: 'GET, POST, OPTIONS' });
      }
      const m = path.match(/^\/doodle\/(\d+)(?:\.png)?$/);
      if (m && req.method === 'GET') return await doodle(req, env, Number(m[1]));
      if (path === '/') return json(req, { ok: true, service: 'guestbook' });
      return fail(req, 404, 'not_found', 'No such route.');
    } catch (e) {
      console.error(e);
      return fail(req, 500, 'server_error', 'Something went wrong on our side. Try again in a bit.');
    }
  },
};
