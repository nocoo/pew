-- ============================================================
-- Add snapshot_ready flag to seasons table
-- ============================================================
-- Controls whether the leaderboard reads from frozen snapshot
-- tables or falls back to real-time aggregation.
-- Set to false before snapshot generation begins, true after
-- all rows are written. This prevents readers from seeing
-- partially-updated snapshot data during non-atomic batch writes.
-- ============================================================

ALTER TABLE seasons ADD COLUMN snapshot_ready INTEGER NOT NULL DEFAULT 0;
