/**
 * ZCode SQLite parser (token pipeline).
 *
 * Consumes ZcodeUsageDb (adapter handle) and produces disjoint ParsedDelta[]
 * suitable for pew's bucket aggregator. Also enforces "reasoning ⊆ output vs
 * disjoint" resolution via provider_total (doc §一挑战 6, §3.3).
 *
 * Pure function — no DB opening, no fs. Adapter injection is the DI seam
 * so unit tests can hand in a fake ZcodeUsageDb.
 */

import type { ParsedDelta } from "./claude.js";
import { isAllZero } from "../utils/token-delta.js";
import type {
  ZcodeUsageDb,
  ZcodeUsageRow,
} from "./zcode-types.js";

/** Result of one parseZcodeSqlite() run. */
export interface ZcodeSqliteResult {
  deltas: ParsedDelta[];
  /**
   * Highest completed_at seen from the returned batch (in epoch ms).
   * Callers persist this as `cursor.lastCompletedAt`. Zero when the batch
   * was empty (caller keeps the prior watermark).
   */
  maxCompletedAt: number;
  /** IDs at exactly maxCompletedAt — used as next-run `lastProcessedIds`. */
  boundaryIds: string[];
  /**
   * Raw rows queried (some may be filtered out due to isAllZero). Callers
   * report as `dbsScanned`, and driver.rowCount for progress display.
   */
  rowCount: number;
  /**
   * Non-fatal advisories collected during this run. Currently only:
   *   "zcode provider_total mismatch: got …"
   * Emitted at most once per run() (bool latch — see §3.4).
   */
  warnings: string[];
}

/**
 * Normalize one ZCode `model_usage` row to disjoint pew TokenDelta.
 *
 * Handles two independent ambiguities:
 *   1. cache_creation position: ZCode source shows cache_creation is inside
 *      input_tokens when input_tokens > 0; otherwise it falls back to
 *      `cache_creation + cache_read` as the input side. See doc §1.4.
 *   2. reasoning position: undetermined a priori. Match provider_total
 *      against inclusiveOutput (`reasoning ⊆ output`, subtract) vs
 *      disjointOutput (`reasoning ⟂ output`, keep). If neither matches,
 *      warn + fall back to inclusive semantics. See doc §一挑战 6.
 */
export function normalizeZcodeUsage(raw: ZcodeUsageRow): {
  tokens: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number };
  warn?: string;
} {
  const cacheRead = Math.max(0, raw.cacheReadInputTokens);
  const cacheWrite = Math.max(0, raw.cacheCreationInputTokens);
  const inputRaw = Math.max(0, raw.inputTokens);
  const outputRaw = Math.max(0, raw.outputTokens);
  const reasoning = Math.max(0, raw.reasoningTokens);

  // cache_creation stays in input bucket. cache_read is the only thing that
  // moves to `cached`.
  const inputSide =
    inputRaw > 0 ? Math.max(0, inputRaw - cacheRead) : cacheWrite;

  const reportedTotal = raw.providerTotalTokens ?? raw.computedTotalTokens;
  const inclusiveOutputTotal =
    inputRaw > 0 ? inputRaw + outputRaw : cacheWrite + cacheRead + outputRaw;
  const disjointOutputTotal = inclusiveOutputTotal + reasoning;

  let output: number;
  let warn: string | undefined;
  if (reportedTotal === inclusiveOutputTotal) {
    // reasoning already inside output_tokens
    output = Math.max(0, outputRaw - reasoning);
  } else if (reportedTotal === disjointOutputTotal) {
    // reasoning disjoint from output_tokens
    output = outputRaw;
  } else {
    // Neither matches: fall back to inclusive semantics (observed today's CLI)
    // and surface the mismatch.
    output = Math.max(0, outputRaw - reasoning);
    warn =
      `zcode provider_total mismatch: got ${reportedTotal}, ` +
      `expected ${inclusiveOutputTotal} (inclusive) or ` +
      `${disjointOutputTotal} (disjoint)`;
  }

  return {
    tokens: {
      inputTokens: inputSide,
      cachedInputTokens: cacheRead,
      outputTokens: output,
      reasoningOutputTokens: reasoning,
    },
    warn,
  };
}

export interface ParseZcodeSqliteOpts {
  db: ZcodeUsageDb;
  lastCompletedAt: number | null;
  lastProcessedIds?: readonly string[];
}

/**
 * Read new rows from a ZcodeUsageDb, apply disjoint normalization, and
 * return ParsedDelta[] plus watermark/dedup fields for cursor advancement.
 */
export function parseZcodeSqlite(opts: ParseZcodeSqliteOpts): ZcodeSqliteResult {
  const { db, lastCompletedAt } = opts;
  const skipIds = opts.lastProcessedIds ?? [];

  const rows = db.queryUsageRows(lastCompletedAt, skipIds);

  const deltas: ParsedDelta[] = [];
  const warnings: string[] = [];
  let mismatchWarned = false;
  let maxCompletedAt = 0;
  const boundaryIds: string[] = [];

  for (const row of rows) {
    const normalized = normalizeZcodeUsage(row);
    if (normalized.warn && !mismatchWarned) {
      warnings.push(normalized.warn);
      mismatchWarned = true;
    }

    if (row.completedAt > maxCompletedAt) {
      maxCompletedAt = row.completedAt;
      boundaryIds.length = 0;
      boundaryIds.push(row.id);
    } else if (row.completedAt === maxCompletedAt) {
      boundaryIds.push(row.id);
    }

    // Drop terminal-but-zero rows; cursor still advances via boundaryIds/
    // maxCompletedAt so we don't re-scan them next time.
    if (isAllZero(normalized.tokens)) continue;

    deltas.push({
      source: "zcode",
      model: row.modelId,
      timestamp: new Date(row.completedAt).toISOString(),
      tokens: normalized.tokens,
    });
  }

  return {
    deltas,
    maxCompletedAt,
    boundaryIds,
    rowCount: rows.length,
    warnings,
  };
}
