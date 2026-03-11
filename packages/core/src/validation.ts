/**
 * Shared runtime validation for ingest records.
 *
 * Used by both Next.js API routes and Cloudflare Worker
 * for defense-in-depth validation.
 */

import type { SessionKind, Source } from "./types.js";
import {
  MAX_STRING_LENGTH,
  VALID_SESSION_KINDS,
  VALID_SOURCES,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

/** Check if value is one of the 6 supported Source values */
export function isValidSource(s: unknown): s is Source {
  return typeof s === "string" && VALID_SOURCES.has(s);
}

/** Check if value is a valid SessionKind */
export function isValidSessionKind(k: unknown): k is SessionKind {
  return typeof k === "string" && VALID_SESSION_KINDS.has(k);
}

/**
 * Validate ISO 8601 date string format with semantic checks.
 *
 * Accepts: "2026-03-07T10:30:00Z", "2026-03-07T10:30:00.000Z",
 *          "2026-03-07T10:30:00+08:00"
 * Rejects: "9999-99-99T99:99:99", trailing garbage, non-dates
 */
export function isValidISODate(s: unknown): boolean {
  if (typeof s !== "string") return false;

  // Full ISO 8601 with anchored regex:
  // YYYY-MM-DDThh:mm:ss followed by optional fractional seconds,
  // then required timezone (Z or +/-HH:MM)
  const ISO_STRICT_RE =
    /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

  if (!ISO_STRICT_RE.test(s)) return false;

  // Final semantic check: ensure the date actually parses
  const ts = Date.parse(s);
  return Number.isFinite(ts);
}

/** Check if value is a non-negative integer */
export function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** Check if value is a non-negative finite number (integer or float) */
export function isNonNegativeFinite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** Check if value is a valid YYYY-MM month string */
export function isValidMonth(s: unknown): s is string {
  return (
    typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
  );
}

/**
 * Check if value is a non-empty string within length limit.
 * @param maxLength - max allowed length (default MAX_STRING_LENGTH)
 */
export function isNonEmptyString(
  s: unknown,
  maxLength: number = MAX_STRING_LENGTH,
): s is string {
  return typeof s === "string" && s.length > 0 && s.length <= maxLength;
}

/**
 * Check if value is null or a string within length limit.
 * @param maxLength - max allowed length (default MAX_STRING_LENGTH)
 */
export function isNullableString(
  s: unknown,
  maxLength: number = MAX_STRING_LENGTH,
): s is string | null {
  if (s === null) return true;
  return typeof s === "string" && s.length <= maxLength;
}

// ---------------------------------------------------------------------------
// Ingest record types (runtime, shared between Next.js and Worker)
// ---------------------------------------------------------------------------

/** Token ingest record (snake_case, matching DB schema) */
export interface IngestRecord {
  source: string;
  model: string;
  hour_start: string;
  /** Stable device identifier (optional for backward compat — old CLIs omit it) */
  device_id?: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

/** Session ingest record (snake_case, matching DB schema) */
export interface SessionIngestRecord {
  session_key: string;
  source: string;
  kind: string;
  started_at: string;
  last_message_at: string;
  duration_seconds: number;
  user_messages: number;
  assistant_messages: number;
  total_messages: number;
  project_ref: string | null;
  model: string | null;
  snapshot_at: string;
}

/** Payload sent from Next.js to Worker for token ingest */
export interface IngestRequest {
  userId: string;
  records: IngestRecord[];
}

/** Payload sent from Next.js to Worker for session ingest */
export interface SessionIngestRequest {
  userId: string;
  records: SessionIngestRecord[];
}

// ---------------------------------------------------------------------------
// Validation result type
// ---------------------------------------------------------------------------

export type ValidationResult<T> =
  | { valid: true; record: T }
  | { valid: false; error: string };

// ---------------------------------------------------------------------------
// Record validators (type-safe narrowing)
// ---------------------------------------------------------------------------

/**
 * Validate a single token ingest record.
 * Returns a discriminated union: { valid: true, record } or { valid: false, error }.
 */
export function validateIngestRecord(
  r: unknown,
  index: number,
): ValidationResult<IngestRecord> {
  if (typeof r !== "object" || r === null) {
    return { valid: false, error: `record[${index}]: must be an object` };
  }

  const rec = r as Record<string, unknown>;

  if (!isValidSource(rec.source)) {
    return {
      valid: false,
      error: `record[${index}]: invalid source "${String(rec.source)}"`,
    };
  }
  if (!isNonEmptyString(rec.model)) {
    return { valid: false, error: `record[${index}]: model is required (non-empty string, max ${MAX_STRING_LENGTH} chars)` };
  }
  if (!isValidISODate(rec.hour_start)) {
    return { valid: false, error: `record[${index}]: invalid hour_start format (ISO 8601 required)` };
  }

  // Optional device_id (backward compat: old CLIs don't send it)
  if (rec.device_id !== undefined && !isNonEmptyString(rec.device_id)) {
    return { valid: false, error: `record[${index}]: device_id must be a non-empty string if provided` };
  }

  const tokenFields = [
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ] as const;

  for (const field of tokenFields) {
    if (!isNonNegativeInteger(rec[field])) {
      return {
        valid: false,
        error: `record[${index}]: ${field} must be a non-negative integer`,
      };
    }
  }

  return { valid: true, record: rec as unknown as IngestRecord };
}

/**
 * Validate a single session ingest record.
 * Returns a discriminated union: { valid: true, record } or { valid: false, error }.
 */
export function validateSessionIngestRecord(
  r: unknown,
  index: number,
): ValidationResult<SessionIngestRecord> {
  if (typeof r !== "object" || r === null) {
    return { valid: false, error: `record[${index}]: must be an object` };
  }

  const rec = r as Record<string, unknown>;

  if (!isNonEmptyString(rec.session_key)) {
    return { valid: false, error: `record[${index}]: session_key is required` };
  }
  if (!isValidSource(rec.source)) {
    return {
      valid: false,
      error: `record[${index}]: invalid source "${String(rec.source)}"`,
    };
  }
  if (!isValidSessionKind(rec.kind)) {
    return {
      valid: false,
      error: `record[${index}]: invalid kind "${String(rec.kind)}"`,
    };
  }

  // Date fields
  if (!isValidISODate(rec.started_at)) {
    return { valid: false, error: `record[${index}]: invalid started_at format` };
  }
  if (!isValidISODate(rec.last_message_at)) {
    return { valid: false, error: `record[${index}]: invalid last_message_at format` };
  }
  if (!isValidISODate(rec.snapshot_at)) {
    return { valid: false, error: `record[${index}]: invalid snapshot_at format` };
  }

  // Non-negative integer fields
  const intFields = [
    "duration_seconds",
    "user_messages",
    "assistant_messages",
    "total_messages",
  ] as const;

  for (const field of intFields) {
    if (!isNonNegativeInteger(rec[field])) {
      return {
        valid: false,
        error: `record[${index}]: ${field} must be a non-negative integer`,
      };
    }
  }

  // Nullable string fields
  if (!isNullableString(rec.project_ref)) {
    return { valid: false, error: `record[${index}]: project_ref must be a string or null` };
  }
  if (!isNullableString(rec.model)) {
    return { valid: false, error: `record[${index}]: model must be a string or null` };
  }

  return { valid: true, record: rec as unknown as SessionIngestRecord };
}

// ---------------------------------------------------------------------------
// Budget validation
// ---------------------------------------------------------------------------

/** Validated budget input ready for DB upsert */
export interface BudgetInput {
  month: string;
  budget_usd: number | null;
  budget_tokens: number | null;
}

/**
 * Validate a budget PUT request body.
 * Returns a discriminated union: { valid: true, record } or { valid: false, error }.
 */
export function validateBudgetInput(
  body: unknown,
): ValidationResult<BudgetInput> {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "body must be an object" };
  }

  const b = body as Record<string, unknown>;

  if (!isValidMonth(b.month)) {
    return { valid: false, error: "month required in YYYY-MM format" };
  }

  const hasBudgetUsd = "budget_usd" in b && b.budget_usd != null;
  const hasBudgetTokens = "budget_tokens" in b && b.budget_tokens != null;

  if (!hasBudgetUsd && !hasBudgetTokens) {
    return {
      valid: false,
      error: "At least one of budget_usd or budget_tokens is required",
    };
  }

  if (hasBudgetUsd && !isNonNegativeFinite(b.budget_usd)) {
    return {
      valid: false,
      error: "budget_usd must be a non-negative number",
    };
  }

  if (hasBudgetTokens && !isNonNegativeFinite(b.budget_tokens)) {
    return {
      valid: false,
      error: "budget_tokens must be a non-negative number",
    };
  }

  return {
    valid: true,
    record: {
      month: b.month as string,
      budget_usd: hasBudgetUsd ? (b.budget_usd as number) : null,
      budget_tokens: hasBudgetTokens ? (b.budget_tokens as number) : null,
    },
  };
}
