-- D1 initial schema for inventory-tracker
-- Run with: wrangler d1 migrations apply inventory-tracker-db

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  email      TEXT    NOT NULL UNIQUE,
  google_id  TEXT,
  image      TEXT,
  role       TEXT    NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','viewer')),
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
                CHECK(status IN ('Available','Checked Out','Under Maintenance','Retired')),
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
  notes               TEXT
);
