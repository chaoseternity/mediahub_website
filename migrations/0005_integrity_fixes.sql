-- Migration 0005: data-integrity fixes
--
-- 1. At most ONE open checkout per equipment item (enforced by a partial unique index).
--    Any pre-existing duplicate open checkouts are closed first (the newest open checkout
--    per item is kept) so the index can always be created.
-- 2. Audit sessions/records survive user deletion: audit_sessions.started_by becomes
--    nullable with ON DELETE SET NULL, and a started_by_name snapshot column is added.
--
-- NOTE on the audit rebuild: with foreign keys enabled, DROP TABLE performs an implicit
-- DELETE that fires ON DELETE CASCADE. audit_records cascades from audit_sessions, so we
-- build *_new copies of BOTH tables (audit_records_new references audit_sessions_new),
-- copy the data, drop the old child table before the old parent, then rename. Modern
-- SQLite (legacy_alter_table=OFF, the default and what D1 uses) rewrites the FK reference
-- in audit_records_new when audit_sessions_new is renamed.

PRAGMA defer_foreign_keys = true;

-- ---------------------------------------------------------------------------
-- 1. One open checkout per equipment
-- ---------------------------------------------------------------------------

-- Close older duplicate open checkouts. The newest open checkout (latest checked_out_at,
-- ties broken by highest id) stays open; older ones are marked returned at the moment the
-- newest one started, and annotated so the history explains what happened.
UPDATE checkouts
SET
  returned_at = (
    SELECT MAX(c2.checked_out_at) FROM checkouts c2
    WHERE c2.equipment_id = checkouts.equipment_id AND c2.returned_at IS NULL
  ),
  notes = TRIM(COALESCE(notes, '') || ' [Auto-closed by migration 0005: duplicate open checkout]')
WHERE returned_at IS NULL
  AND EXISTS (
    SELECT 1 FROM checkouts c2
    WHERE c2.equipment_id = checkouts.equipment_id
      AND c2.returned_at IS NULL
      AND c2.id <> checkouts.id
      AND (
        julianday(c2.checked_out_at) > julianday(checkouts.checked_out_at)
        OR (julianday(c2.checked_out_at) = julianday(checkouts.checked_out_at) AND c2.id > checkouts.id)
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkouts_one_open ON checkouts(equipment_id) WHERE returned_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Rebuild audit_sessions / audit_records
-- ---------------------------------------------------------------------------

CREATE TABLE audit_sessions_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  started_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_by_name TEXT,
  status          TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed', 'cancelled')),
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT,
  total_items     INTEGER DEFAULT 0,
  found_count     INTEGER DEFAULT 0,
  missing_count   INTEGER DEFAULT 0,
  notes           TEXT
);

CREATE TABLE audit_records_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES audit_sessions_new(id) ON DELETE CASCADE,
  equipment_id  INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'missing' CHECK(status IN ('exists', 'missing')),
  scanned_at    TEXT,
  scanned_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  method        TEXT CHECK(method IN ('nfc', 'qr', 'manual')),
  UNIQUE(session_id, equipment_id)
);

-- Copy sessions, snapshotting the starter's name. Dangling user references (only possible
-- if FKs were ever disabled) are nulled rather than failing the migration.
INSERT INTO audit_sessions_new
  (id, name, started_by, started_by_name, status, started_at, completed_at, total_items, found_count, missing_count, notes)
SELECT
  a.id, a.name, u.id, u.name, a.status, a.started_at, a.completed_at, a.total_items, a.found_count, a.missing_count, a.notes
FROM audit_sessions a
LEFT JOIN users u ON u.id = a.started_by;

-- Copy records whose session and equipment still exist (anything else would already have
-- been cascaded away with FKs enabled).
INSERT INTO audit_records_new
  (id, session_id, equipment_id, status, scanned_at, scanned_by, method)
SELECT
  r.id, r.session_id, r.equipment_id, r.status, r.scanned_at,
  (SELECT u.id FROM users u WHERE u.id = r.scanned_by),
  r.method
FROM audit_records r
WHERE EXISTS (SELECT 1 FROM audit_sessions_new s WHERE s.id = r.session_id)
  AND EXISTS (SELECT 1 FROM equipment e WHERE e.id = r.equipment_id);

-- Drop the child first so dropping the parent cannot cascade into anything.
DROP TABLE audit_records;
DROP TABLE audit_sessions;

ALTER TABLE audit_sessions_new RENAME TO audit_sessions;
ALTER TABLE audit_records_new RENAME TO audit_records;

CREATE INDEX IF NOT EXISTS idx_audit_records_session ON audit_records(session_id, status);

-- "In Event" / "In Event (Rehearsal)" are display-only statuses computed from active events.
-- A bug in updateEquipment persisted them, leaving items permanently un-checkout-able.
-- Reset any stored value to what the checkout state says it should be.
UPDATE equipment
SET status = CASE
      WHEN EXISTS (SELECT 1 FROM checkouts c WHERE c.equipment_id = equipment.id AND c.returned_at IS NULL)
        THEN 'Checked Out'
      ELSE 'Available'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE status IN ('In Event', 'In Event (Rehearsal)');
