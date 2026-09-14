-- Annotation only. No UPDATE/DELETE of collected tokens and no change to their unique key.
CREATE TABLE IF NOT EXISTS usage_details (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  hour_start TEXT NOT NULL,
  event_id TEXT NOT NULL DEFAULT '',
  evidence_snapshot_seq INTEGER,
  details_version INTEGER NOT NULL CHECK (details_version = 1),
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  parser_revision INTEGER NOT NULL CHECK (parser_revision > 0),
  detail_revision INTEGER NOT NULL CHECK (detail_revision > 0),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  cached_input_tokens INTEGER NOT NULL CHECK (cached_input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  reasoning_output_tokens INTEGER NOT NULL CHECK (reasoning_output_tokens >= 0),
  total_tokens INTEGER NOT NULL CHECK (total_tokens = input_tokens + cached_input_tokens + output_tokens + reasoning_output_tokens),
  groups_json TEXT NOT NULL CHECK (json_valid(groups_json) AND json_type(groups_json) = 'array'),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_id, source, model, hour_start, event_id)
);
CREATE INDEX IF NOT EXISTS idx_details_user_time ON usage_details(user_id, hour_start);

CREATE VIEW IF NOT EXISTS usage_bases AS
SELECT user_id, device_id, source, model, hour_start, '' AS event_id, NULL AS evidence_snapshot_seq,
       input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
       0 AS evidence_tokens, 0 AS approximate_tokens, created_at
FROM usage_records
UNION ALL
SELECT user_id, device_id, source, model, hour_start, event_id, snapshot_seq AS evidence_snapshot_seq,
       input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
       total_tokens AS evidence_tokens,
       CASE WHEN time_precision = 'exact' THEN 0 ELSE total_tokens END AS approximate_tokens, created_at
FROM usage_evidence;

DROP VIEW IF EXISTS usage_totals;
CREATE VIEW usage_totals AS
SELECT b.user_id, b.device_id, b.source, b.model, b.hour_start,
       SUM(b.input_tokens) AS input_tokens, SUM(b.cached_input_tokens) AS cached_input_tokens,
       SUM(b.output_tokens) AS output_tokens, SUM(b.reasoning_output_tokens) AS reasoning_output_tokens,
       SUM(b.total_tokens) AS total_tokens, SUM(b.evidence_tokens) AS evidence_tokens,
       SUM(b.approximate_tokens) AS approximate_tokens, MIN(b.created_at) AS created_at,
       json_group_array(CASE WHEN d.user_id IS NULL THEN NULL ELSE json_object(
         'status', CASE WHEN b.input_tokens = d.input_tokens AND b.cached_input_tokens = d.cached_input_tokens
           AND b.output_tokens = d.output_tokens AND b.reasoning_output_tokens = d.reasoning_output_tokens
           AND b.total_tokens = d.total_tokens AND b.evidence_snapshot_seq IS d.evidence_snapshot_seq THEN 'matched' ELSE 'pending' END,
         'basis', json_object('input_tokens', d.input_tokens, 'cached_input_tokens', d.cached_input_tokens,
           'output_tokens', d.output_tokens, 'reasoning_output_tokens', d.reasoning_output_tokens, 'total_tokens', d.total_tokens),
         'groups', json(d.groups_json)) END) AS accounting_json
FROM usage_bases b LEFT JOIN usage_details d ON b.user_id = d.user_id AND b.device_id = d.device_id
  AND b.source = d.source AND b.model = d.model AND b.hour_start = d.hour_start AND b.event_id = d.event_id
WHERE b.event_id = '' OR b.total_tokens > 0
GROUP BY b.user_id, b.device_id, b.source, b.model, b.hour_start;
