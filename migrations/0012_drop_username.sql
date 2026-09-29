-- Drop the retired users.username column (display names now come solely from the OAuth name).
--
-- SQLite can't DROP COLUMN a UNIQUE column, so the users table is rebuilt without it. D1 always
-- enforces foreign keys, and DROP TABLE users performs an implicit DELETE that fires every
-- ON DELETE CASCADE / SET NULL action on the tables referencing users (defer_foreign_keys only
-- defers the constraint checks, not those actions). So every affected row and link is
-- snapshotted first, and restored once users exists again with the same ids.

PRAGMA defer_foreign_keys = true;

-- 1. Snapshot rows removed by ON DELETE CASCADE, and links cleared by ON DELETE SET NULL.
CREATE TABLE mig12_event_oics        AS SELECT * FROM event_oics;
CREATE TABLE mig12_event_ics         AS SELECT * FROM event_ics;
CREATE TABLE mig12_event_deployments AS SELECT * FROM event_deployments;
CREATE TABLE mig12_reservations      AS SELECT * FROM reservations;
CREATE TABLE mig12_handover_codes    AS SELECT * FROM handover_codes;
CREATE TABLE mig12_events_created_by        AS SELECT id, created_by FROM events WHERE created_by IS NOT NULL;
CREATE TABLE mig12_event_equipment_added_by AS SELECT event_id, equipment_id, section, added_by FROM event_equipment WHERE added_by IS NOT NULL;
CREATE TABLE mig12_sop_uploaded_by          AS SELECT id, uploaded_by FROM sop_documents WHERE uploaded_by IS NOT NULL;
CREATE TABLE mig12_audit_sessions_started_by AS SELECT id, started_by FROM audit_sessions WHERE started_by IS NOT NULL;
CREATE TABLE mig12_audit_records_scanned_by  AS SELECT id, scanned_by FROM audit_records WHERE scanned_by IS NOT NULL;
CREATE TABLE mig12_users_seq AS SELECT seq FROM sqlite_sequence WHERE name = 'users';

-- Clear the cascade tables explicitly so the restore below is exact whether or not the
-- cascades fire.
DELETE FROM event_oics;
DELETE FROM event_ics;
DELETE FROM event_deployments;
DELETE FROM reservations;
DELETE FROM handover_codes;

-- 2. Rebuild users without username, keeping every id.
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

INSERT INTO users_new (id, name, email, google_id, image, role, provider, created_at)
  SELECT id, name, email, google_id, image, role, provider, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Never reuse the id of a previously deleted user.
UPDATE sqlite_sequence
  SET seq = MAX(seq, COALESCE((SELECT seq FROM mig12_users_seq), 0))
  WHERE name = 'users';

-- 3. Restore the snapshots.
INSERT INTO event_oics        SELECT * FROM mig12_event_oics;
INSERT INTO event_ics         SELECT * FROM mig12_event_ics;
INSERT INTO event_deployments SELECT * FROM mig12_event_deployments;
INSERT INTO reservations      SELECT * FROM mig12_reservations;
INSERT INTO handover_codes    SELECT * FROM mig12_handover_codes;

UPDATE events SET created_by =
  (SELECT b.created_by FROM mig12_events_created_by b WHERE b.id = events.id)
  WHERE id IN (SELECT id FROM mig12_events_created_by);
UPDATE event_equipment SET added_by =
  (SELECT b.added_by FROM mig12_event_equipment_added_by b
    WHERE b.event_id = event_equipment.event_id
      AND b.equipment_id = event_equipment.equipment_id
      AND b.section = event_equipment.section)
  WHERE EXISTS (SELECT 1 FROM mig12_event_equipment_added_by b
    WHERE b.event_id = event_equipment.event_id
      AND b.equipment_id = event_equipment.equipment_id
      AND b.section = event_equipment.section);
UPDATE sop_documents SET uploaded_by =
  (SELECT b.uploaded_by FROM mig12_sop_uploaded_by b WHERE b.id = sop_documents.id)
  WHERE id IN (SELECT id FROM mig12_sop_uploaded_by);
UPDATE audit_sessions SET started_by =
  (SELECT b.started_by FROM mig12_audit_sessions_started_by b WHERE b.id = audit_sessions.id)
  WHERE id IN (SELECT id FROM mig12_audit_sessions_started_by);
UPDATE audit_records SET scanned_by =
  (SELECT b.scanned_by FROM mig12_audit_records_scanned_by b WHERE b.id = audit_records.id)
  WHERE id IN (SELECT id FROM mig12_audit_records_scanned_by);

-- 4. Clean up.
DROP TABLE mig12_event_oics;
DROP TABLE mig12_event_ics;
DROP TABLE mig12_event_deployments;
DROP TABLE mig12_reservations;
DROP TABLE mig12_handover_codes;
DROP TABLE mig12_events_created_by;
DROP TABLE mig12_event_equipment_added_by;
DROP TABLE mig12_sop_uploaded_by;
DROP TABLE mig12_audit_sessions_started_by;
DROP TABLE mig12_audit_records_scanned_by;
DROP TABLE mig12_users_seq;

PRAGMA defer_foreign_keys = false;
