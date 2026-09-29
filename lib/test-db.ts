/**
 * Test-only helper: sets up the full schema on an in-memory better-sqlite3 DB.
 */
import Database from "better-sqlite3";

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL UNIQUE,
    username   TEXT    UNIQUE,
    google_id  TEXT,
    image      TEXT,
    role       TEXT    NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','verified','viewer')),
    provider   TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS nfc_cards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nfc_value   TEXT    NOT NULL UNIQUE,
    member_name TEXT    NOT NULL,
    notes       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS equipment (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    description   TEXT,
    serial_number TEXT,
    condition     TEXT    NOT NULL DEFAULT 'Working'
                  CHECK(condition IN ('Working','Impaired','Broken','Missing','Retired')),
    quantity      INTEGER NOT NULL DEFAULT 1,
    location      TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'Available'
                  CHECK(status IN ('Available','Checked Out','In Event','In Event (Rehearsal)','Unavailable (In Repairs)','Unavailable (Broken)','Unavailable (Missing)','Unavailable (Retired)')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS equipment_tags (
    equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (equipment_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS checkouts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id        INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    checked_out_by      INTEGER REFERENCES users(id),
    checked_out_by_name TEXT    NOT NULL,
    checked_out_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    expected_return_at  TEXT,
    returned_at         TEXT,
    notes               TEXT,
    checkout_location   TEXT,
    nfc_value           TEXT,
    nfc_id              TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT    NOT NULL,
    description          TEXT,
    start_time           TEXT    NOT NULL,
    end_time             TEXT    NOT NULL,
    location             TEXT    NOT NULL,
    created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    has_rehearsal        INTEGER DEFAULT 0,
    rehearsal_start_time TEXT,
    rehearsal_end_time   TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS event_oics (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS event_ics (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section  TEXT    NOT NULL DEFAULT 'photo' CHECK(section IN ('photo','video','av')),
    PRIMARY KEY (event_id, user_id, section)
  );

  CREATE TABLE IF NOT EXISTS event_equipment (
    event_id           INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    equipment_id       INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    section            TEXT    NOT NULL DEFAULT 'photo' CHECK(section IN ('photo','video','av')),
    used_for_rehearsal INTEGER DEFAULT 0,
    added_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    added_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (event_id, equipment_id, section)
  );

  CREATE TABLE IF NOT EXISTS event_deployments (
    event_id            INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section             TEXT    NOT NULL DEFAULT 'photo' CHECK(section IN ('photo','video','av')),
    attending_rehearsal INTEGER DEFAULT 0,
    added_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    added_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    response_status     TEXT    NOT NULL DEFAULT 'pending' CHECK(response_status IN ('pending', 'confirmed', 'declined')),
    response_token      TEXT,
    responded_at        TEXT,
    PRIMARY KEY (event_id, user_id, section)
  );

  CREATE TABLE IF NOT EXISTS event_section_rehearsals (
    event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    section       TEXT    NOT NULL CHECK(section IN ('photo','video','av')),
    participating INTEGER DEFAULT 0,
    PRIMARY KEY (event_id, section)
  );

  CREATE TABLE IF NOT EXISTS sop_documents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    category     TEXT    NOT NULL DEFAULT 'General',
    content      TEXT    NOT NULL,
    file_name    TEXT,
    file_type    TEXT,
    file_size    INTEGER,
    uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checkout_reminders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    checkout_id   INTEGER NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
    reminder_type TEXT    NOT NULL CHECK(reminder_type IN ('due_soon', 'overdue')),
    sent_to_email TEXT    NOT NULL,
    sent_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    window_key    TEXT
  );

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

  CREATE TABLE IF NOT EXISTS audit_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    started_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    started_by_name TEXT,
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

  CREATE TABLE IF NOT EXISTS storage_map_layout (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT    NOT NULL UNIQUE,
    value      TEXT    NOT NULL,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_reminders_checkout ON checkout_reminders(checkout_id, reminder_type);
  CREATE INDEX IF NOT EXISTS idx_reservations_eq_time ON reservations(equipment_id, start_time, end_time);
  CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(reserved_by);
  CREATE INDEX IF NOT EXISTS idx_handover_code ON handover_codes(code);
  CREATE INDEX IF NOT EXISTS idx_handover_checkout ON handover_codes(checkout_id);
  CREATE INDEX IF NOT EXISTS idx_audit_records_session ON audit_records(session_id, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_checkouts_one_open ON checkouts(equipment_id) WHERE returned_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_unique_window ON checkout_reminders(checkout_id, reminder_type, window_key);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_lower ON tags(LOWER(name));
  CREATE INDEX IF NOT EXISTS idx_event_equipment_equipment ON event_equipment(equipment_id);
`;

let testDbInstance: Database.Database | null = null;

export function setTestDb(db: any): void {
  testDbInstance = db;
}

export function getTestDb(): any {
  return testDbInstance;
}

export function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}
