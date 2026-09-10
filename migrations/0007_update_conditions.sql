-- Migration: 0007_update_conditions.sql
-- Description: Update equipment conditions: New/Good -> Working, Fair -> Impaired, Poor -> Broken, and add 'In repairs'

UPDATE equipment SET condition = 'Working' WHERE condition IN ('New', 'Good');
UPDATE equipment SET condition = 'Impaired' WHERE condition = 'Fair';
UPDATE equipment SET condition = 'Broken' WHERE condition = 'Poor';
