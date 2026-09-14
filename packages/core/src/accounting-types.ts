import type { QueueRecord, Source } from "./types.js";

/** Original Pew counters, retained verbatim as the reconciliation basis. */
export type LegacyTokenCounts = Pick<QueueRecord, "input_tokens" | "cached_input_tokens" |
  "output_tokens" | "reasoning_output_tokens" | "total_tokens">;

/** Recorded input/output totals. Cache and reasoning fields are subsets, never extra usage. */
export interface AccountingCounts {
  input_total_tokens: number;
  cache_read_input_tokens: number | null;
  cache_write_input_tokens: number | null;
  cache_write_5m_input_tokens: number | null;
  cache_write_1h_input_tokens: number | null;
  output_total_tokens: number;
  reasoning_output_tokens: number | null;
}

/** Decimal integers survive JSON and SQLite without a floating-point round trip. */
export interface ReportedCost {
  units: string;
  scale: number;
  currency: "USD";
  kind: "actual" | "estimate" | "included" | "unknown";
  status: "complete" | "partial" | "unknown";
  source: string;
}

export interface AccountingGroup {
  basis: LegacyTokenCounts;
  counts: AccountingCounts | null;
  origin: string;
  model: string;
  provider: string | null;
  /** Safe route label or hash, never a billing URL. */
  route: string | null;
  service_tier: string | null;
  /** Request context range, classified BEFORE aggregation; null for session/operation totals. */
  context_tokens_min: number | null;
  context_tokens_max: number | null;
  request_count: number | null;
  quality: "reported" | "derived" | "legacy" | "invalid";
  reported_costs: ReportedCost[];
  /** Safe numeric diagnostics, never source bodies. Raw totals cannot imply cache writes. */
  diagnostics: Array<{ code: "total_mismatch" | "invalid_counts" | "aggregate_context"; raw_total_tokens: number | null }>;
}

/** Absolute companion snapshot. This record must NEVER enter the legacy usage SUM path. */
export interface AccountingRecord {
  details_version: 1;
  source: Source;
  model: string;
  device_id: string;
  hour_start: string;
  /** null references the original bucket; otherwise references usage_evidence. */
  event_id: string | null;
  evidence_snapshot_seq: number | null;
  /** Durable accepted source-snapshot sequence, retained across cursor resets; not a token sum. */
  source_revision: number;
  parser_revision: number;
  /** Independently ordered classification revision for the same source snapshot. */
  detail_revision: number;
  basis: LegacyTokenCounts;
  /** Mutually exclusive groups whose legacy vectors sum exactly to basis. */
  groups: AccountingGroup[];
}

/** Optional read-side annotation; pending groups must not participate in calculations. */
export interface AccountingAnnotation {
  status: "matched" | "pending";
  basis: LegacyTokenCounts;
  groups: AccountingGroup[];
}

export type AccountingAckStatus = "applied" | "duplicate" | "superseded" | "base_mismatch" | "conflict";
export interface AccountingAck {
  key: string;
  source_revision: number;
  parser_revision: number;
  detail_revision: number;
  status: AccountingAckStatus;
}
