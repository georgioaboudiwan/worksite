ALTER TABLE business ADD COLUMN phone TEXT CHECK (phone IS NULL OR length(phone) <= 80);
ALTER TABLE business ADD COLUMN website TEXT CHECK (website IS NULL OR length(website) <= 120);

CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  content TEXT NOT NULL CHECK (length(content) <= 100000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX docs_owner ON docs(owner_id);

CREATE TABLE push_subs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE CHECK (length(endpoint) <= 1000),
  p256dh TEXT NOT NULL CHECK (length(p256dh) <= 200),
  auth TEXT NOT NULL CHECK (length(auth) <= 100),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX push_subs_user ON push_subs(user_id);

CREATE TABLE app_keys (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
