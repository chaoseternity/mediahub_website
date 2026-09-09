-- Migration: 0006_remove_purchase_date.sql
-- Description: Drop purchase_date column from equipment table

ALTER TABLE equipment DROP COLUMN IF EXISTS purchase_date;
