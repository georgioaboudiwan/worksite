ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'wage' CHECK (kind IN ('wage','advance'));

ALTER TABLE sites ADD COLUMN client TEXT CHECK (client IS NULL OR length(client) <= 120);

ALTER TABLE business ADD COLUMN payday INTEGER NOT NULL DEFAULT 6 CHECK (payday BETWEEN 0 AND 6);
ALTER TABLE business ADD COLUMN weekly_email INTEGER NOT NULL DEFAULT 1 CHECK (weekly_email IN (0,1));
ALTER TABLE business ADD COLUMN overtime_multiplier REAL NOT NULL DEFAULT 1.5 CHECK (overtime_multiplier >= 1 AND overtime_multiplier <= 3);

CREATE TABLE adjustments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  kind TEXT NOT NULL CHECK (kind IN ('bonus','deduction','overtime')),
  amount REAL NOT NULL CHECK (amount > 0),
  hours REAL CHECK (hours IS NULL OR (hours > 0 AND hours <= 24)),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (worker_id, owner_id) REFERENCES workers(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX adjustments_owner_day ON adjustments(owner_id, day);
CREATE INDEX adjustments_worker ON adjustments(worker_id);

CREATE TABLE site_txns (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
  category TEXT CHECK (category IS NULL OR length(category) <= 60),
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','LBP')),
  lbp_amount REAL CHECK (lbp_amount IS NULL OR lbp_amount > 0),
  lbp_rate REAL CHECK (lbp_rate IS NULL OR lbp_rate > 0),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (currency = 'USD' OR (lbp_amount IS NOT NULL AND lbp_rate IS NOT NULL)),
  FOREIGN KEY (site_id, owner_id) REFERENCES sites(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX site_txns_owner_day ON site_txns(owner_id, day);
CREATE INDEX site_txns_site ON site_txns(site_id);

CREATE TABLE members (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'foreman' CHECK (role IN ('foreman')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX members_owner ON members(owner_id);

CREATE TABLE invites (
  code_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'foreman' CHECK (role IN ('foreman')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX invites_owner ON invites(owner_id);

CREATE TABLE weekly_reports (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, week)
);
