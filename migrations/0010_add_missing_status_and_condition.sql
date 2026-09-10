-- Migration: 0010_add_missing_status_and_condition.sql
-- Add 'Missing' condition and 'Unavailable (Missing)' status

ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_condition_check;
ALTER TABLE equipment ADD CONSTRAINT equipment_condition_check CHECK(condition IN ('Working', 'Impaired', 'Broken', 'Missing'));
ALTER TABLE equipment ALTER COLUMN condition SET DEFAULT 'Working';

ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_status_check;
ALTER TABLE equipment ADD CONSTRAINT equipment_status_check CHECK(status IN ('Available', 'Checked Out', 'In Event', 'In Event (Rehearsal)', 'Unavailable (In Repairs)', 'Unavailable (Broken)', 'Unavailable (Missing)'));
ALTER TABLE equipment ALTER COLUMN status SET DEFAULT 'Available';
