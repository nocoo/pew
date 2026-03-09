-- Migration 003: model_pricing table
-- Stores per-model token pricing (USD per 1M tokens), managed by admins.

CREATE TABLE IF NOT EXISTS model_pricing (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  model      TEXT    NOT NULL,
  input      REAL    NOT NULL,  -- USD per 1M input tokens
  output     REAL    NOT NULL,  -- USD per 1M output tokens
  cached     REAL,              -- USD per 1M cached input tokens (NULL = input * 0.1)
  source     TEXT,              -- optional: source-specific override (e.g. "claude-code")
  note       TEXT,              -- optional admin note
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(model, source)
);
