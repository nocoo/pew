-- Migration 004: invite_codes table
-- Single-use invite codes for gating new user registration.
-- Admins generate codes; new users must provide one to sign up.

CREATE TABLE IF NOT EXISTS invite_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL UNIQUE,       -- 8-char uppercase alphanumeric
  created_by TEXT    NOT NULL REFERENCES users(id),
  used_by    TEXT,                          -- NULL = unused, user ID or 'pending:<email>'
  used_at    TEXT,                          -- ISO 8601 timestamp
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invite_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_used_by ON invite_codes(used_by);
