-- Squashed schema: all tables and indexes for pew-db
-- Replaces previous migrations 002-005 and untracked DDL.
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
  input_tokens            INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens           INTEGER NOT NULL DEFAULT 0,
  reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens            INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, source, model, hour_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_records(user_id, hour_start);
CREATE INDEX IF NOT EXISTS idx_usage_source    ON usage_records(source);

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

CREATE INDEX IF NOT EXISTS idx_session_user_time ON session_records(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_session_source    ON session_records(source);
CREATE INDEX IF NOT EXISTS idx_session_kind      ON session_records(kind);

-- ============================================================
-- Model pricing (admin-managed)
-- ============================================================

CREATE TABLE IF NOT EXISTS model_pricing (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  model      TEXT    NOT NULL,
  input      REAL    NOT NULL,
  output     REAL    NOT NULL,
  cached     REAL,
  source     TEXT,
  note       TEXT,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(model, source)
);

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
  created_at  TEXT NOT NULL
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
