-- Widen the role CHECK constraint to include 'verified'.
-- D1 enforces FK constraints even during table swaps, so we must first drop
-- the FK from checkouts (which references users), swap users, then restore it.

-- Step 1: rebuild checkouts without the users FK
CREATE TABLE checkouts_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id        INTEGER NOT NULL REFERENCES equipment(id),
  checked_out_by      INTEGER,
  checked_out_by_name TEXT    NOT NULL,
  checked_out_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  expected_return_at  TEXT,
  returned_at         TEXT,
  notes               TEXT
);
INSERT INTO checkouts_new SELECT * FROM checkouts;
DROP TABLE checkouts;
ALTER TABLE checkouts_new RENAME TO checkouts;

-- Step 2: rebuild users with the widened CHECK constraint
CREATE TABLE users_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  email      TEXT    NOT NULL UNIQUE,
  google_id  TEXT,
  image      TEXT,
  role       TEXT    NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','verified','viewer')),
  provider   TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO users_new SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Step 3: restore checkouts with the FK back in place
CREATE TABLE checkouts_fk (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id        INTEGER NOT NULL REFERENCES equipment(id),
  checked_out_by      INTEGER REFERENCES users(id),
  checked_out_by_name TEXT    NOT NULL,
  checked_out_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  expected_return_at  TEXT,
  returned_at         TEXT,
  notes               TEXT
);
INSERT INTO checkouts_fk SELECT * FROM checkouts;
DROP TABLE checkouts;
ALTER TABLE checkouts_fk RENAME TO checkouts;

