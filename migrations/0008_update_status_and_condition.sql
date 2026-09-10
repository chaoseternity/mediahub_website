-- Migration: 0008_update_status_and_condition.sql
-- 1. Remove condition 'In repairs' completely -> map to 'Broken'
-- 2. Rename status 'Under Maintenance' to 'In Repairs' and remove 'Retired' -> map to 'In Repairs'

UPDATE equipment SET condition = 'Broken' WHERE condition = 'In repairs';
UPDATE equipment SET status = 'In Repairs' WHERE status IN ('Under Maintenance', 'Retired');

ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_condition_check;
ALTER TABLE equipment ADD CONSTRAINT equipment_condition_check CHECK(condition IN ('Working', 'Impaired', 'Broken'));
ALTER TABLE equipment ALTER COLUMN condition SET DEFAULT 'Working';

ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_status_check;
ALTER TABLE equipment ADD CONSTRAINT equipment_status_check CHECK(status IN ('Available', 'Checked Out', 'In Event', 'In Event (Rehearsal)', 'In Repairs'));
ALTER TABLE equipment ALTER COLUMN status SET DEFAULT 'Available';
