-- Each account sees the CLI 3.0 upgrade notice once, across browsers/devices.
ALTER TABLE users ADD COLUMN cli_upgrade_notice_seen_at TEXT;
