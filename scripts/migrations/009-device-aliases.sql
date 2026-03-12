-- Migration 009: Add device_aliases table for human-readable device names.
--
-- Allows users to assign friendly aliases (e.g. "MacBook Pro") to their
-- device UUIDs. One alias per device per user, with case-insensitive
-- uniqueness enforced via a functional index.
--
-- Apply via: wrangler d1 execute pew-db --remote --file scripts/migrations/009-device-aliases.sql

CREATE TABLE IF NOT EXISTS device_aliases (
  user_id    TEXT NOT NULL REFERENCES users(id),
  device_id  TEXT NOT NULL,
  alias      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_id)
);

-- Case-insensitive uniqueness: one alias name per user, regardless of casing
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_alias_unique
  ON device_aliases (user_id, LOWER(TRIM(alias)));
