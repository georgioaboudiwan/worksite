CREATE TABLE members_new (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'foreman' CHECK (role IN ('owner','foreman')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (user_id <> owner_id)
);
INSERT INTO members_new (user_id, owner_id, role, created_at) SELECT user_id, owner_id, role, created_at FROM members;
DROP TABLE members;
ALTER TABLE members_new RENAME TO members;
CREATE INDEX members_owner ON members(owner_id);

CREATE TABLE invites_new (
  code_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'foreman' CHECK (role IN ('owner','foreman')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO invites_new (code_hash, owner_id, role, expires_at, created_at) SELECT code_hash, owner_id, role, expires_at, created_at FROM invites;
DROP TABLE invites;
ALTER TABLE invites_new RENAME TO invites;
CREATE INDEX invites_owner ON invites(owner_id);
