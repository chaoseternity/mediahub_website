-- Add optional checkout location to checkouts table
ALTER TABLE checkouts ADD COLUMN checkout_location TEXT;
