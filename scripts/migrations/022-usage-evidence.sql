-- Additive: preserve usage_records and its legacy ON CONFLICT target.
-- Apply before deploying the evidence ingest/read routes; no historical writes.
CREATE TABLE IF NOT EXISTS usage_evidence (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  hour_start TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  call_type TEXT NOT NULL,
  origin TEXT NOT NULL,
  provider TEXT NOT NULL,
  granularity TEXT NOT NULL,
  time_precision TEXT NOT NULL,
  interval_start TEXT,
  interval_end TEXT,
  call_count INTEGER,
  snapshot_seq INTEGER NOT NULL CHECK (snapshot_seq > 0),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  cached_input_tokens INTEGER NOT NULL CHECK (cached_input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  reasoning_output_tokens INTEGER NOT NULL CHECK (reasoning_output_tokens >= 0),
  total_tokens INTEGER NOT NULL CHECK (total_tokens = input_tokens + cached_input_tokens + output_tokens + reasoning_output_tokens),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_evidence_user_time ON usage_evidence(user_id, hour_start);

-- One row per ORIGINAL bucket, so bucket-count queries keep their meaning.
-- Zero-total ledger checkpoints carry replay state, not activity.
CREATE VIEW IF NOT EXISTS usage_totals AS
SELECT user_id, device_id, source, model, hour_start,
       SUM(input_tokens) AS input_tokens, SUM(cached_input_tokens) AS cached_input_tokens,
       SUM(output_tokens) AS output_tokens, SUM(reasoning_output_tokens) AS reasoning_output_tokens,
       SUM(total_tokens) AS total_tokens, SUM(evidence_tokens) AS evidence_tokens,
       SUM(approximate_tokens) AS approximate_tokens, MIN(created_at) AS created_at
FROM (
  SELECT user_id, device_id, source, model, hour_start,
         input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
         0 AS evidence_tokens, 0 AS approximate_tokens, created_at
  FROM usage_records
  UNION ALL
  SELECT user_id, device_id, source, model, hour_start,
         input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
         total_tokens AS evidence_tokens,
         CASE WHEN time_precision = 'exact' THEN 0 ELSE total_tokens END AS approximate_tokens, created_at
  FROM usage_evidence WHERE total_tokens > 0
)
GROUP BY user_id, device_id, source, model, hour_start;
