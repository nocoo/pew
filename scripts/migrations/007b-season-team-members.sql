-- ============================================================
-- Frozen roster: members locked at registration time
--
-- Environments that already ran 006b-seasons.sql before this
-- table existed need this separate migration. The IF NOT EXISTS
-- clause makes it safe to run on fresh databases too.
-- ============================================================

CREATE TABLE IF NOT EXISTS season_team_members (
  id          TEXT PRIMARY KEY,           -- UUID
  season_id   TEXT NOT NULL REFERENCES seasons(id),
  team_id     TEXT NOT NULL REFERENCES teams(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  joined_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(season_id, team_id, user_id),
  UNIQUE(season_id, user_id)             -- one team per user per season
);

CREATE INDEX IF NOT EXISTS idx_stm_season      ON season_team_members(season_id);
CREATE INDEX IF NOT EXISTS idx_stm_season_team ON season_team_members(season_id, team_id);
