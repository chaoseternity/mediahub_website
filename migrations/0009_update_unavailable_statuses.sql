-- Migration: 0009_update_unavailable_statuses.sql
-- 1. Rename status 'In Repairs' to 'Unavailable (In Repairs)'
-- 2. Equipments with 'Broken' condition are automatically assigned 'Unavailable (Broken)'

UPDATE equipment SET status = 'Unavailable (In Repairs)' WHERE status = 'In Repairs';
UPDATE equipment SET status = 'Unavailable (Broken)' WHERE condition = 'Broken';

ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_status_check;
ALTER TABLE equipment ADD CONSTRAINT equipment_status_check CHECK(status IN ('Available', 'Checked Out', 'In Event', 'In Event (Rehearsal)', 'Unavailable (In Repairs)', 'Unavailable (Broken)'));
ALTER TABLE equipment ALTER COLUMN status SET DEFAULT 'Available';
