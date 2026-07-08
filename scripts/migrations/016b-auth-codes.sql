-- Migration 016: Add auth_codes table for one-time CLI authentication codes.
--
-- Allows users to generate short-lived codes on the web UI for headless CLI login.
-- Codes expire after 5 minutes and can only be used once.
--
-- Apply via: wrangler d1 execute pew-db --remote --file scripts/migrations/016b-auth-codes.sql

CREATE TABLE IF NOT EXISTS auth_codes (
  code       TEXT PRIMARY KEY,            -- Human-readable code (e.g. ABCD-1234)
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,               -- ISO 8601 UTC datetime
  used_at    TEXT,                        -- Non-null = code has been consumed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for cleanup job to find expired codes efficiently
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at);

-- Index for user lookup (e.g. to invalidate previous codes)
CREATE INDEX IF NOT EXISTS idx_auth_codes_user ON auth_codes(user_id);
