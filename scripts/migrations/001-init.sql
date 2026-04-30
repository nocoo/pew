-- Squashed schema: all tables and indexes for pew-db
-- Replaces previous migrations 002-007 and untracked DDL.
-- Apply via: wrangler d1 execute pew-db --remote --file scripts/migrations/001-init.sql

-- ============================================================
-- Auth tables (NextAuth.js adapter)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  email_verified  TEXT,
  name            TEXT,
  image           TEXT,
  slug            TEXT UNIQUE,
  nickname        TEXT,
  is_public       INTEGER NOT NULL DEFAULT 0,
  api_key         TEXT UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  provider            TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          INTEGER,
  token_type          TEXT,
  scope               TEXT,
  id_token            TEXT,
  UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  session_token TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT NOT NULL,
  token      TEXT NOT NULL,
  expires    TEXT NOT NULL,
  PRIMARY KEY(identifier, token)
);

-- ============================================================
-- Usage tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS usage_records (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 TEXT    NOT NULL REFERENCES users(id),
  source                  TEXT    NOT NULL,
  model                   TEXT    NOT NULL,
  hour_start              TEXT    NOT NULL,
  device_id               TEXT    NOT NULL DEFAULT 'default',
  input_tokens            INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens           INTEGER NOT NULL DEFAULT 0,
  reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens            INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, device_id, source, model, hour_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_records(user_id, hour_start);
CREATE INDEX IF NOT EXISTS idx_usage_device    ON usage_records(user_id, device_id);

-- ============================================================
-- Session statistics
-- ============================================================

CREATE TABLE IF NOT EXISTS session_records (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             TEXT    NOT NULL REFERENCES users(id),
  session_key         TEXT    NOT NULL,
  source              TEXT    NOT NULL,
  kind                TEXT    NOT NULL DEFAULT 'human',
  started_at          TEXT    NOT NULL,
  last_message_at     TEXT    NOT NULL,
  duration_seconds    INTEGER NOT NULL DEFAULT 0,
  user_messages       INTEGER NOT NULL DEFAULT 0,
  assistant_messages  INTEGER NOT NULL DEFAULT 0,
  total_messages      INTEGER NOT NULL DEFAULT 0,
  project_ref         TEXT,
  model               TEXT,
  snapshot_at         TEXT    NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, session_key)
);

CREATE INDEX IF NOT EXISTS idx_session_user_time           ON session_records(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_session_user_source_project ON session_records(user_id, source, project_ref);

-- ============================================================
-- Invite codes (single-use registration gate)
-- ============================================================

CREATE TABLE IF NOT EXISTS invite_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL UNIQUE,
  created_by TEXT    NOT NULL REFERENCES users(id),
  used_by    TEXT,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invite_code    ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_used_by ON invite_codes(used_by);

-- ============================================================
-- Teams
-- ============================================================

CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  invite_code TEXT NOT NULL UNIQUE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  logo_url    TEXT
);

CREATE TABLE IF NOT EXISTS team_members (
  id        TEXT PRIMARY KEY,
  team_id   TEXT NOT NULL REFERENCES teams(id),
  user_id   TEXT NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  UNIQUE(team_id, user_id)
);

-- ============================================================
-- User budgets (per-month limits)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_budgets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT    NOT NULL REFERENCES users(id),
  month         TEXT    NOT NULL,
  budget_usd    REAL,
  budget_tokens INTEGER,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_budget_user ON user_budgets(user_id);

-- ============================================================
-- Projects (two-layer: user-defined projects + alias mappings)
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

CREATE TABLE IF NOT EXISTS project_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  project_ref TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, source, project_ref)
);

CREATE INDEX IF NOT EXISTS idx_project_aliases_project ON project_aliases(project_id);

-- ============================================================
-- Project tags (lightweight labels)
-- ============================================================

CREATE TABLE IF NOT EXISTS project_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, project_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_project_tags_project
  ON project_tags(project_id);

CREATE INDEX IF NOT EXISTS idx_project_tags_user_tag
  ON project_tags(user_id, tag);

-- ============================================================
-- App-wide settings (key-value store)
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default: max 5 members per team
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('max_team_members', '5');
