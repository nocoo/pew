-- Add logo_url column to teams table.
-- Stores the full CDN URL of the team logo (unique per upload, no cache busting needed).
-- NULL means no logo uploaded yet.
ALTER TABLE teams ADD COLUMN logo_url TEXT;
