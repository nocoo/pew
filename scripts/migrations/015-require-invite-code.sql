-- Migration 015: Add require_invite_code setting
--
-- Controls whether new user registration requires an invite code.
-- Default is 'true' (invite code required).
--
-- Apply via: wrangler d1 execute pew-db --remote --file scripts/migrations/015-require-invite-code.sql

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('require_invite_code', 'true');
