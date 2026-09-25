-- Migration: Add checkout_reminders table for automated return reminders
CREATE TABLE IF NOT EXISTS checkout_reminders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  checkout_id   INTEGER NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
  reminder_type TEXT    NOT NULL CHECK(reminder_type IN ('due_soon', 'overdue')),
  sent_to_email TEXT    NOT NULL,
  sent_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reminders_checkout ON checkout_reminders(checkout_id, reminder_type);
