-- Migration: Add reservations, handover_codes, audit_sessions, and audit_records

CREATE TABLE IF NOT EXISTS reservations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id      INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  reserved_by       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reserved_by_name  TEXT NOT NULL,
  start_time        TEXT NOT NULL,
  end_time          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled', 'fulfilled')),
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reservations_eq_time ON reservations(equipment_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(reserved_by);

CREATE TABLE IF NOT EXISTS handover_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  checkout_id   INTEGER NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  from_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code          TEXT NOT NULL UNIQUE,
  qr_payload    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'claimed', 'expired', 'revoked')),
  claimed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claimed_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_handover_code ON handover_codes(code);
CREATE INDEX IF NOT EXISTS idx_handover_checkout ON handover_codes(checkout_id);

CREATE TABLE IF NOT EXISTS audit_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  started_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed', 'cancelled')),
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT,
  total_items   INTEGER DEFAULT 0,
  found_count   INTEGER DEFAULT 0,
  missing_count INTEGER DEFAULT 0,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS audit_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'missing' CHECK(status IN ('exists', 'missing')),
  scanned_at    TEXT,
  scanned_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  method        TEXT CHECK(method IN ('nfc', 'qr', 'manual')),
  UNIQUE(session_id, equipment_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_records_session ON audit_records(session_id, status);
