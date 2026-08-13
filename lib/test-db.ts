/**
 * Test-only helper: sets up the full schema on an in-memory better-sqlite3 DB.
 */
import Database from "better-sqlite3";

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL UNIQUE,
    username   TEXT,
    google_id  TEXT,
    image      TEXT,
    role       TEXT    NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','verified','viewer')),
    provider   TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
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
    purchase_date TEXT,
    condition     TEXT    NOT NULL DEFAULT 'Good'
                  CHECK(condition IN ('New','Good','Fair','Poor')),
    quantity      INTEGER NOT NULL DEFAULT 1,
    location      TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'Available'
                  CHECK(status IN ('Available','Checked Out','In Event','In Event (Rehearsal)','Under Maintenance','Retired')),
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
    equipment_id        INTEGER NOT NULL REFERENCES equipment(id),
    checked_out_by      INTEGER REFERENCES users(id),
    checked_out_by_name TEXT    NOT NULL,
    checked_out_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    expected_return_at  TEXT,
    returned_at         TEXT,
    notes               TEXT,
    checkout_location   TEXT
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
    PRIMARY KEY (event_id, user_id, section)
  );

  CREATE TABLE IF NOT EXISTS event_section_rehearsals (
    event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    section       TEXT    NOT NULL CHECK(section IN ('photo','video','av')),
    participating INTEGER DEFAULT 0,
    PRIMARY KEY (event_id, section)
  );
`;

export function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}
