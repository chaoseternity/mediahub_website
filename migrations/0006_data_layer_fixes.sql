-- Migration 0006: data-layer fixes
--
-- 1. checkout_reminders gets a window_key and a UNIQUE (checkout_id, reminder_type, window_key)
--    index. The reminder job claims a (checkout, type, window) slot by inserting the row BEFORE
--    sending the email, so two concurrent runs can never both send the same reminder.
--    Pre-existing rows keep window_key = NULL (NULLs never conflict in a UNIQUE index).
--
-- 2. Tag names become unique case-insensitively ("Laptop" and "laptop" are the same tag).
--    Existing case/whitespace duplicates are merged into the lowest-id tag first (equipment
--    links are moved over), then names are trimmed and the unique expression index created.
--
-- 3. Index event_equipment(equipment_id) for the per-item active-event lookups.

-- ---------------------------------------------------------------------------
-- 1. Reminder idempotency
-- ---------------------------------------------------------------------------

ALTER TABLE checkout_reminders ADD COLUMN window_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_unique_window
  ON checkout_reminders(checkout_id, reminder_type, window_key);

-- ---------------------------------------------------------------------------
-- 2. Case-insensitive unique tag names
-- ---------------------------------------------------------------------------

-- Point every equipment link at the canonical (lowest id) tag of its case-insensitive group.
INSERT OR IGNORE INTO equipment_tags (equipment_id, tag_id)
SELECT et.equipment_id,
       (SELECT MIN(t2.id) FROM tags t2 WHERE LOWER(TRIM(t2.name)) = LOWER(TRIM(t.name)))
FROM equipment_tags et
JOIN tags t ON t.id = et.tag_id;

-- Remove links to the duplicate tags (explicitly, in case foreign keys are not enforced).
DELETE FROM equipment_tags
WHERE tag_id IN (
  SELECT t.id FROM tags t
  WHERE t.id <> (SELECT MIN(t2.id) FROM tags t2 WHERE LOWER(TRIM(t2.name)) = LOWER(TRIM(t.name)))
);

-- Remove the duplicate tags themselves.
DELETE FROM tags
WHERE id <> (SELECT MIN(t2.id) FROM tags t2 WHERE LOWER(TRIM(t2.name)) = LOWER(TRIM(tags.name)));

-- Names are now unique after trimming, so trimming cannot violate UNIQUE(name).
UPDATE tags SET name = TRIM(name) WHERE name <> TRIM(name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_lower ON tags(LOWER(name));

-- ---------------------------------------------------------------------------
-- 3. Index for "which events is this item in" lookups (one-row-per-equipment queries).
--    event_equipment's primary key starts with event_id, so equipment_id alone was a scan.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_event_equipment_equipment ON event_equipment(equipment_id);
