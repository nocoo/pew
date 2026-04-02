-- Migration 014: Default is_public to ON for all users
--
-- Previously users had to explicitly opt-in to public visibility.
-- Now public visibility is the default: existing users are set to public,
-- and the schema default is changed from 0 to 1.
--
-- Note: SQLite does not support ALTER COLUMN DEFAULT. The new default is
-- enforced at the application layer. This migration backfills existing users.

-- Set all users to public
UPDATE users SET is_public = 1 WHERE is_public = 0;
