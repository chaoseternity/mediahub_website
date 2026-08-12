-- Add a user-chosen display name (username) separate from the OAuth-provided name.
-- Existing users are seeded with the local part of their email address.

ALTER TABLE users ADD COLUMN username TEXT;
UPDATE users SET username = SUBSTR(email, 1, INSTR(email, '@') - 1);
