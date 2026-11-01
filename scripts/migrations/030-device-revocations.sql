CREATE TABLE IF NOT EXISTS device_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_records_device
  ON device_records (device_id);

CREATE TRIGGER IF NOT EXISTS delete_device_alias_with_record
AFTER DELETE ON device_records
FOR EACH ROW
BEGIN
  DELETE FROM device_aliases
  WHERE user_id = OLD.user_id AND device_id = OLD.device_id;
END;

INSERT OR IGNORE INTO device_records (user_id, device_id)
SELECT user_id, device_id FROM usage_bases
WHERE (event_id = '' OR total_tokens > 0)
GROUP BY user_id, device_id;

INSERT OR IGNORE INTO device_records (user_id, device_id)
SELECT user_id, device_id FROM device_aliases
GROUP BY user_id, device_id;

CREATE TABLE IF NOT EXISTS device_revocations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_revocations_device
  ON device_revocations (device_id);

CREATE TRIGGER IF NOT EXISTS register_evidence_device_before_insert
BEFORE INSERT ON usage_evidence
FOR EACH ROW
WHEN NEW.total_tokens > 0 AND NOT EXISTS (
  SELECT 1 FROM device_revocations
  WHERE user_id = NEW.user_id AND device_id = NEW.device_id
)
BEGIN
  INSERT INTO device_records (user_id, device_id, created_at, updated_at)
  VALUES (NEW.user_id, NEW.device_id, datetime('now'), datetime('now'))
  ON CONFLICT (user_id, device_id) DO UPDATE
    SET updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS ignore_revoked_evidence_insert
BEFORE INSERT ON usage_evidence
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM device_revocations
  WHERE user_id = NEW.user_id AND device_id = NEW.device_id
)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER IF NOT EXISTS ignore_revoked_evidence_update
BEFORE UPDATE ON usage_evidence
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM device_revocations
  WHERE user_id = NEW.user_id AND device_id = NEW.device_id
)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER IF NOT EXISTS register_accounting_device_before_insert
BEFORE INSERT ON usage_details
FOR EACH ROW
WHEN (NEW.event_id = '' OR EXISTS (
  SELECT 1 FROM usage_evidence
  WHERE user_id = NEW.user_id AND device_id = NEW.device_id AND event_id = NEW.event_id AND total_tokens > 0
)) AND NOT EXISTS (
  SELECT 1 FROM device_revocations
  WHERE user_id = NEW.user_id AND device_id = NEW.device_id
)
BEGIN
  INSERT INTO device_records (user_id, device_id, created_at, updated_at)
  VALUES (NEW.user_id, NEW.device_id, datetime('now'), datetime('now'))
  ON CONFLICT (user_id, device_id) DO UPDATE
    SET updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS ignore_revoked_details_insert
BEFORE INSERT ON usage_details
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM device_revocations
  WHERE user_id = NEW.user_id AND device_id = NEW.device_id
)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER IF NOT EXISTS ignore_revoked_details_update
BEFORE UPDATE ON usage_details
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM device_revocations
  WHERE user_id = NEW.user_id AND device_id = NEW.device_id
)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER IF NOT EXISTS register_usage_device
AFTER INSERT ON usage_records
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM device_revocations
  WHERE user_id = NEW.user_id AND device_id = NEW.device_id
)
BEGIN
  INSERT INTO device_records (user_id, device_id, created_at, updated_at)
  VALUES (NEW.user_id, NEW.device_id, datetime('now'), datetime('now'))
  ON CONFLICT (user_id, device_id) DO UPDATE
    SET updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS register_usage_device_update
AFTER UPDATE ON usage_records
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM device_revocations
  WHERE user_id = NEW.user_id AND device_id = NEW.device_id
)
BEGIN
  INSERT INTO device_records (user_id, device_id, created_at, updated_at)
  VALUES (NEW.user_id, NEW.device_id, datetime('now'), datetime('now'))
  ON CONFLICT (user_id, device_id) DO UPDATE
    SET updated_at = excluded.updated_at;
END;
