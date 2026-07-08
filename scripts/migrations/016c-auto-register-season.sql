-- ============================================================
-- Add auto season registration toggle to teams
-- ============================================================
-- When enabled, the team is automatically registered for every
-- newly created season. Owner can still manually withdraw.
-- Default 0 preserves existing manual-registration behavior.
-- ============================================================

ALTER TABLE teams ADD COLUMN auto_register_season INTEGER NOT NULL DEFAULT 0;
