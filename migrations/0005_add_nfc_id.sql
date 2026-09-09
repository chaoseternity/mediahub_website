-- Add NFC card identifier to users and checkouts
ALTER TABLE users ADD COLUMN nfc_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nfc_id ON users(nfc_id);
ALTER TABLE checkouts ADD COLUMN nfc_id TEXT;
