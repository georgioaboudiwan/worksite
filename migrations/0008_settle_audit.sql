ALTER TABLE payments ADD COLUMN until TEXT CHECK (until IS NULL OR until GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]');
ALTER TABLE entries ADD COLUMN paid_by TEXT;
ALTER TABLE entries ADD COLUMN del_by TEXT;
ALTER TABLE entries ADD COLUMN del_at TEXT;
ALTER TABLE adjustments ADD COLUMN paid_by TEXT;
CREATE INDEX entries_paid_by ON entries(paid_by) WHERE paid_by IS NOT NULL;
CREATE INDEX adjustments_paid_by ON adjustments(paid_by) WHERE paid_by IS NOT NULL;

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT,
  user_id TEXT,
  email TEXT,
  action TEXT NOT NULL,
  kind TEXT,
  row_id TEXT,
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 4000),
  ip TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX audit_owner ON audit(owner_id, id);

ALTER TABLE workers ADD COLUMN assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX workers_assigned ON workers(assigned_to) WHERE assigned_to IS NOT NULL;
