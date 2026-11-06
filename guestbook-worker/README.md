# guestbook-worker

The backend for the site's guestbook: a Cloudflare Worker with a D1 (SQLite) database. The site itself stays
static on GitHub Pages and calls this Worker from the browser.

Routes:
- `GET /entries?before=<id>&limit=30`: newest visible notes, `{ entries, next }` (`next` is the `before` value for "load more").
- `POST /entries`: JSON `{ name, message, link?, doodle? }`. `doodle` is a `data:image/png;base64,...` URL of at most about 150 KB.
- `GET /doodle/<id>`: the note's doodle as `image/png`.

Limits: name 1–40 characters, message 1–500, link http(s) only and at most 200 characters. Each visitor (keyed by a
salted SHA-256 hash of their IP, never the raw IP) can post once per 30 seconds and 10 times a day.
CORS allows `https://taniwankenobi.github.io`, `http://localhost:4321` and `http://[::1]:4321`.

## Setup (PowerShell)

Run these from the repo root in Windows PowerShell.

1. Install:

   ```powershell
   cd guestbook-worker
   npm install
   ```

2. Log in to Cloudflare (opens a browser):

   ```powershell
   npx wrangler login
   ```

3. Create the database:

   ```powershell
   npx wrangler d1 create guestbook
   ```

   Copy the `database_id` it prints into `wrangler.toml`, replacing `00000000-0000-0000-0000-000000000000`.

4. Create the table:

   ```powershell
   npx wrangler d1 execute guestbook --remote --file schema.sql
   ```

5. Set the IP-hash salt, then deploy. For the salt, paste any long random string when prompted; a fresh GUID works:

   ```powershell
   [guid]::NewGuid().ToString()
   npx wrangler secret put IP_SALT
   npx wrangler deploy
   ```

   `deploy` prints the Worker URL, for example `https://guestbook.<your-subdomain>.workers.dev`.

6. Hide a note (moderation). Find its id first, then hide it:

   ```powershell
   npx wrangler d1 execute guestbook --remote --command "SELECT id, name, message FROM entries ORDER BY id DESC LIMIT 20"
   npx wrangler d1 execute guestbook --remote --command "UPDATE entries SET hidden=1 WHERE id=123"
   ```

   Replace `123` with the note's id. Set `hidden=0` to bring it back. A hidden note's doodle may stay in browser caches for up to a week.

7. Point the site at the Worker. In the repo root, create `.env.production` with the URL from step 5 and commit it
   (the URL is public anyway; the GitHub Pages build reads this file):

   ```powershell
   cd ..
   Set-Content -Path .env.production -Value "PUBLIC_GUESTBOOK_URL=https://guestbook.<your-subdomain>.workers.dev" -Encoding ascii
   git add .env.production
   git commit -m "Connect guestbook"
   ```

   Until this is set, the guestbook shows a disabled form and sample notes.

## Local testing (no Cloudflare account needed)

```powershell
cd guestbook-worker
$env:WRANGLER_SEND_METRICS = "false"
Set-Content -Path .dev.vars -Value "IP_SALT=local-dev-salt" -Encoding ascii
npx wrangler d1 execute guestbook --local --file schema.sql
npx wrangler dev
```

Then, in a second PowerShell window from the repo root:

```powershell
$env:PUBLIC_GUESTBOOK_URL = "http://localhost:8787"
npx astro dev
```

If Astro picks another port (say 4322, because 4321 is busy), add it to `.dev.vars` as
`EXTRA_ORIGINS=http://localhost:4322,http://[::1]:4322` and restart `wrangler dev`.

`.wrangler/` (local database) and `.dev.vars` are git-ignored. Delete `.wrangler` to wipe local test notes.
