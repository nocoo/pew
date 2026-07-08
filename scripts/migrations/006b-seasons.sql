-- ============================================================
-- Seasons
-- ============================================================

CREATE TABLE IF NOT EXISTS seasons (
  id          TEXT PRIMARY KEY,           -- UUID
  name        TEXT NOT NULL,              -- Display name, e.g. "Season 1"
  slug        TEXT NOT NULL UNIQUE,       -- URL-safe, e.g. "s1"
  start_date  TEXT NOT NULL,              -- YYYY-MM-DD (UTC)
  end_date    TEXT NOT NULL,              -- YYYY-MM-DD (UTC), inclusive
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Season team registrations
-- ============================================================

CREATE TABLE IF NOT EXISTS season_teams (
  id            TEXT PRIMARY KEY,         -- UUID
  season_id     TEXT NOT NULL REFERENCES seasons(id),
  team_id       TEXT NOT NULL REFERENCES teams(id),
  registered_by TEXT NOT NULL REFERENCES users(id),  -- must be team owner
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(season_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_season_teams_season ON season_teams(season_id);
CREATE INDEX IF NOT EXISTS idx_season_teams_team   ON season_teams(team_id);

-- ============================================================
-- Season snapshots (frozen results after season ends)
-- ============================================================

CREATE TABLE IF NOT EXISTS season_snapshots (
  id          TEXT PRIMARY KEY,           -- UUID
  season_id   TEXT NOT NULL REFERENCES seasons(id),
  team_id     TEXT NOT NULL REFERENCES teams(id),
  rank        INTEGER NOT NULL,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(season_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_season ON season_snapshots(season_id);

-- ============================================================
-- Season member snapshots (per-member contribution detail)
-- ============================================================

CREATE TABLE IF NOT EXISTS season_member_snapshots (
  id            TEXT PRIMARY KEY,         -- UUID
  season_id     TEXT NOT NULL REFERENCES seasons(id),
  team_id       TEXT NOT NULL REFERENCES teams(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  total_tokens        INTEGER NOT NULL DEFAULT 0,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(season_id, team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_member_snapshot_season ON season_member_snapshots(season_id);
CREATE INDEX IF NOT EXISTS idx_member_snapshot_team   ON season_member_snapshots(season_id, team_id);
