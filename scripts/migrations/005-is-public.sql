-- Add is_public column to users table
-- Users must explicitly opt-in to public visibility via Settings.
-- Default 0 = private. Backfill existing users who already have a slug
-- (they were already public under the old implicit model).

ALTER TABLE users ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing users with a slug were already public — preserve that.
UPDATE users SET is_public = 1 WHERE slug IS NOT NULL;
