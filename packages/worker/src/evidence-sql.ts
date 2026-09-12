/** Absolute, source-revision-ordered snapshots; event ownership and time never move. */
export const EVIDENCE_UPSERT_SQL = `INSERT INTO usage_evidence
  (user_id, device_id, event_id, group_id, source, model, hour_start, timestamp,
   call_type, origin, provider, granularity, time_precision, interval_start, interval_end, call_count, snapshot_seq,
   input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, device_id, event_id) DO UPDATE SET
  input_tokens = excluded.input_tokens, cached_input_tokens = excluded.cached_input_tokens,
  output_tokens = excluded.output_tokens, reasoning_output_tokens = excluded.reasoning_output_tokens,
  total_tokens = excluded.total_tokens, interval_end = excluded.interval_end,
  call_count = excluded.call_count, snapshot_seq = excluded.snapshot_seq
WHERE excluded.snapshot_seq > usage_evidence.snapshot_seq
  AND excluded.source = usage_evidence.source AND excluded.model = usage_evidence.model
  AND excluded.group_id = usage_evidence.group_id AND excluded.hour_start = usage_evidence.hour_start
  AND excluded.timestamp = usage_evidence.timestamp AND excluded.call_type = usage_evidence.call_type
  AND excluded.origin = usage_evidence.origin AND excluded.provider = usage_evidence.provider
  AND excluded.granularity = usage_evidence.granularity AND excluded.time_precision = usage_evidence.time_precision
  AND excluded.interval_start IS usage_evidence.interval_start`;
