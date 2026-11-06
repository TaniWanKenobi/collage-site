-- Guestbook entries. `hidden = 1` removes an entry from the public list (moderation) without deleting it.
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  link       TEXT,
  doodle     TEXT,               -- base64 PNG bytes (no data: prefix), served by GET /doodle/:id
  created_at INTEGER NOT NULL,   -- unix time, milliseconds
  ip_hash    TEXT    NOT NULL,   -- SHA-256(salt + IP), only used for rate limiting
  hidden     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS entries_visible ON entries (hidden, id DESC);
CREATE INDEX IF NOT EXISTS entries_ip ON entries (ip_hash, created_at);
