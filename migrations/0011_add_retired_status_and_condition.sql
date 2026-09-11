-- Migration: 0011_add_retired_status_and_condition.sql
-- Add 'Retired' condition and 'Unavailable (Retired)' status

ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_condition_check;
ALTER TABLE equipment ADD CONSTRAINT equipment_condition_check CHECK(condition IN ('Working', 'Impaired', 'Broken', 'Missing', 'Retired'));
ALTER TABLE equipment ALTER COLUMN condition SET DEFAULT 'Working';

ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_status_check;
ALTER TABLE equipment ADD CONSTRAINT equipment_status_check CHECK(status IN ('Available', 'Checked Out', 'In Event', 'In Event (Rehearsal)', 'Unavailable (In Repairs)', 'Unavailable (Broken)', 'Unavailable (Missing)', 'Unavailable (Retired)'));
ALTER TABLE equipment ALTER COLUMN status SET DEFAULT 'Available';
