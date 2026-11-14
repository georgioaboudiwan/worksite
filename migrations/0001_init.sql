CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(email) BETWEEN 3 AND 254),
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  pw_iter INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE throttle (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE TABLE business (
  owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 120),
  lbp_rate REAL NOT NULL DEFAULT 89500 CHECK (lbp_rate > 0),
  hours_per_day REAL NOT NULL DEFAULT 8 CHECK (hours_per_day > 0 AND hours_per_day <= 24),
  period TEXT NOT NULL DEFAULT 'week' CHECK (period IN ('day','week','month')),
  week_start INTEGER NOT NULL DEFAULT 1 CHECK (week_start BETWEEN 0 AND 6),
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','ar'))
);

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  location TEXT CHECK (location IS NULL OR length(location) <= 200),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (id, owner_id)
);
CREATE INDEX sites_owner ON sites(owner_id);

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  trade TEXT CHECK (trade IS NULL OR length(trade) <= 60),
  daily_rate REAL NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (id, owner_id)
);
CREATE INDEX workers_owner ON workers(owner_id);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  site_id TEXT,
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','worked','absent')),
  days REAL NOT NULL DEFAULT 0 CHECK (days >= 0 AND days <= 2),
  hours REAL CHECK (hours IS NULL OR (hours >= 0 AND hours <= 24)),
  rate REAL NOT NULL DEFAULT 0 CHECK (rate >= 0),
  amount REAL GENERATED ALWAYS AS (CASE WHEN status = 'worked' THEN round(days * rate, 2) ELSE 0 END) STORED,
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (worker_id, day),
  FOREIGN KEY (worker_id, owner_id) REFERENCES workers(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (site_id, owner_id) REFERENCES sites(id, owner_id)
);
CREATE INDEX entries_owner_day ON entries(owner_id, day);
CREATE INDEX entries_site ON entries(site_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  paid_on TEXT NOT NULL CHECK (paid_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','LBP')),
  lbp_amount REAL CHECK (lbp_amount IS NULL OR lbp_amount > 0),
  lbp_rate REAL CHECK (lbp_rate IS NULL OR lbp_rate > 0),
  method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','transfer','whish','omt','other')),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (currency = 'USD' OR (lbp_amount IS NOT NULL AND lbp_rate IS NOT NULL)),
  FOREIGN KEY (worker_id, owner_id) REFERENCES workers(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX payments_owner_day ON payments(owner_id, paid_on);
CREATE INDEX payments_worker ON payments(worker_id);
