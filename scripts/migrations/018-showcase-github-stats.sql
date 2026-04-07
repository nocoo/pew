-- ============================================================
-- Add GitHub stats fields to showcases
-- ============================================================

ALTER TABLE showcases ADD COLUMN stars INTEGER NOT NULL DEFAULT 0;
ALTER TABLE showcases ADD COLUMN forks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE showcases ADD COLUMN language TEXT;
ALTER TABLE showcases ADD COLUMN license TEXT;
ALTER TABLE showcases ADD COLUMN topics TEXT;       -- JSON array stored as text
ALTER TABLE showcases ADD COLUMN homepage TEXT;
