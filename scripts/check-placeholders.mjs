// Lists every placeholder left in the site, and blocks the launch build if any remain.
//
//   npm run check:placeholders        list them (never fails)
//   npm run build                     runs this before (source) and after (built HTML) the build;
//                                     it only warns until "launch": true in src/data/site.json,
//                                     then any placeholder fails the build, so the deploy can't ship it.
//   --strict / PLACEHOLDERS=strict    fail now, whatever site.json says
//
// What counts as a placeholder (the convention used across the site):
//   1. data items marked  "placeholder": true  (JSON)  or  placeholder: true  (markdown frontmatter)
//   2. any file inside a folder named  placeholder/  (sample images; sources in src/assets/placeholder/SOURCES.md)
//   3. leftover bracket text like  [City, Country]  in content, data or components
//   4. (after a build) any element with a  data-ph  attribute in the built HTML in dist/
// `npm run dev` never runs this, so local testing is never blocked.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = process.argv.slice(2);
const mode = args.includes('--dist') ? 'dist' : 'src';
const site = JSON.parse(readFileSync(join(ROOT, 'src/data/site.json'), 'utf8'));
const strict = args.includes('--strict') || process.env.PLACEHOLDERS === 'strict' || site.launch === true;

const rel = (p) => relative(ROOT, p).split(sep).join('/');
function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const hits = []; // { where, what }

if (mode === 'src') {
  const SRC = join(ROOT, 'src');
  for (const file of walk(SRC)) {
    const r = rel(file);
    if (/(^|\/)placeholder\//.test(r)) {
      if (!r.endsWith('SOURCES.md')) hits.push({ where: r, what: 'sample file in a placeholder/ folder' });
      continue;
    }
    if (!/\.(json|md|mdx|astro|ts|tsx|js|mjs)$/.test(r)) continue;
    const text = readFileSync(file, 'utf8');

    // 1. flagged data items
    if (r.endsWith('.json')) {
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      const items = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data) : [];
      items.forEach((it, i) => {
        if (it && typeof it === 'object' && it.placeholder === true) {
          const label = it.name || it.title || it.what || it.caption || it.id || it.file || `item ${i + 1}`;
          const at = text.indexOf(JSON.stringify(it.id ?? it.file ?? it.name ?? '').slice(1, -1));
          hits.push({ where: `${r}${at > 0 ? ':' + lineOf(text, at) : ''}`, what: `"${label}"` });
        }
      });
    } else if (/\.mdx?$/.test(r)) {
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (fm && /^placeholder:\s*true\s*$/m.test(fm[1])) {
        const title = fm[1].match(/^title:\s*"?(.*?)"?\s*$/m)?.[1] ?? r;
        hits.push({ where: r, what: `"${title}"` });
      }
    }

    // 3. leftover bracket text in content, data and markup: [Capitalized words], but not markdown links
    //    [text](url). Scripts are skipped (TypeScript tuple types look like [A, B]).
    if (/\.(json|mdx?|astro)$/.test(r)) for (const m of text.matchAll(/\[([A-Z][A-Za-z0-9 ,.'’&/-]{1,48})\](?!\()/g)) {
      hits.push({ where: `${r}:${lineOf(text, m.index)}`, what: `bracket text ${m[0]}` });
    }
  }
} else {
  const DIST = join(ROOT, 'dist');
  if (!existsSync(DIST)) { console.error('check-placeholders: no dist/ folder; run the build first.'); process.exit(strict ? 1 : 0); }
  for (const file of walk(DIST)) {
    if (!file.endsWith('.html')) continue;
    const html = readFileSync(file, 'utf8');
    const n = (html.match(/\sdata-ph(?=[\s>=\/])/g) || []).length;
    if (n) hits.push({ where: rel(file), what: `${n} placeholder element${n > 1 ? 's' : ''} (data-ph)` });
  }
}

const label = mode === 'src' ? 'source' : 'built site';
if (!hits.length) {
  console.log(`check-placeholders (${label}): no placeholders left.`);
  process.exit(0);
}
const color = (c, s) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
console.log(color(strict ? 31 : 33, `check-placeholders (${label}): ${hits.length} placeholder${hits.length > 1 ? 's' : ''} left`));
const width = Math.min(60, Math.max(...hits.map((h) => h.where.length)));
for (const h of hits) console.log(`  ${h.where.padEnd(width)}  ${h.what}`);
if (strict) {
  console.log(color(31, '\nLaunch build blocked: replace these, or set "launch": false in src/data/site.json for a test build.'));
  process.exit(1);
}
console.log(color(33, '\n(Not blocking: "launch" is false in src/data/site.json. Set it to true for the final build.)'));
