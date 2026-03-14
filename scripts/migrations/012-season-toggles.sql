-- ============================================================
-- Add season rule toggles
-- ============================================================
-- Three per-season flags that control registration, roster
-- changes, and withdrawal behavior during active seasons.
-- Default 0 preserves existing behavior (locked during active).
-- ============================================================

ALTER TABLE seasons ADD COLUMN allow_late_registration INTEGER NOT NULL DEFAULT 0;
ALTER TABLE seasons ADD COLUMN allow_roster_changes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE seasons ADD COLUMN allow_late_withdrawal INTEGER NOT NULL DEFAULT 0;
