-- Migration: Add storage_map_layout table for custom visual storage map designer
CREATE TABLE IF NOT EXISTS storage_map_layout (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL UNIQUE,
  value      TEXT    NOT NULL,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
