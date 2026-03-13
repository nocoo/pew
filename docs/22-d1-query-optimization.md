# 22 - D1 Query Optimization

> Collected 2026-03-13 via `wrangler d1 insights pew-db --timePeriod 7d`

## Current Index Inventory

### usage_records

| Index | Columns |
|-------|---------|
| UNIQUE (implicit autoindex) | `(user_id, device_id, source, model, hour_start)` |
| `idx_usage_user_time` | `(user_id, hour_start)` |
| `idx_usage_source` | `(source)` |
| `idx_usage_device` | `(user_id, device_id)` |

### session_records

| Index | Columns |
|-------|---------|
| UNIQUE (implicit autoindex) | `(user_id, session_key)` |
| `idx_session_user_time` | `(user_id, started_at)` |
| `idx_session_source` | `(source)` |
| `idx_session_kind` | `(kind)` |

---

## Top Queries by Total Duration (7 days)

### Q1: Dashboard hourly usage aggregation — 7.9s total

```sql
SELECT source, model, hour_start,
  SUM(input_tokens) AS input_tokens, ...
FROM usage_records
WHERE user_id = ? AND hour_start >= ? AND hour_start < ?
GROUP BY hour_start, source, model
ORDER BY hour_start ASC, source, model
```

| Metric | Value |
|--------|-------|
| Total duration | 7912ms |
| Executions | 743 |
| Avg duration | 10.6ms |
| Avg rows read | 4108 |
| Query efficiency | 31.7% |

**Analysis**: `idx_usage_user_time (user_id, hour_start)` should cover the WHERE clause. The 31.7% efficiency suggests it IS using the index for filtering but still scanning ~4100 rows per call. This is the expected row count for a user with many records in the time window — the index narrows to `user_id + hour_start range` but every matching row must be read for the SUM aggregation. With ~4k rows per query and 743 executions, this is the single biggest consumer of read units.

**Optimization**: A covering index `(user_id, hour_start, source, model, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens)` would let SQLite satisfy the entire query from the index without touching the table. However, D1/SQLite covering indexes on wide columns have diminishing returns. The more practical approach is to ensure the data volume per user stays manageable or introduce a pre-aggregated daily summary table.

### Q2: Session records UPSERT — 6.4s total

```sql
INSERT INTO session_records (...) VALUES (...)
ON CONFLICT (user_id, session_key) DO UPDATE SET ...
WHERE excluded.snapshot_at >= session_records.snapshot_at
```

| Metric | Value |
|--------|-------|
| Total duration | 6359ms |
| Executions | 69,175 |
| Avg duration | 0.09ms |
| Avg rows read | 2 |

**Analysis**: Extremely efficient per call (0.09ms, 2 rows read). High total duration is purely from volume (69k executions). The UNIQUE index on `(user_id, session_key)` handles the conflict detection perfectly.

**Optimization**: None needed — this is already optimal. Batch size is controlled by the Worker's 50-query-per-invocation limit.

### Q3: Dashboard daily usage aggregation — 5.3s total

```sql
SELECT source, model, date(hour_start) AS hour_start,
  SUM(input_tokens) AS input_tokens, ...
FROM usage_records
WHERE user_id = ? AND hour_start >= ? AND hour_start < ?
GROUP BY date(hour_start), source, model
ORDER BY hour_start ASC, source, model
```

| Metric | Value |
|--------|-------|
| Total duration | 5253ms |
| Executions | 1035 |
| Avg duration | 5.1ms |
| Avg rows read | 4004 |
| Query efficiency | 2.6% |

**Analysis**: Same pattern as Q1 but with `date(hour_start)` function in GROUP BY. The 2.6% efficiency (vs Q1's 31.7%) is because the function call prevents SQLite from using the index for grouping — it must evaluate `date()` on every row. Similar row count (~4k) confirms same scan pattern.

**Optimization**: Same as Q1. The `date()` function in GROUP BY doesn't hurt much since all rows must be read anyway for SUM aggregation.

### Q4: Usage records UPSERT — 2.6s total

```sql
INSERT INTO usage_records (...) VALUES (...)
ON CONFLICT (user_id, device_id, source, model, hour_start) DO UPDATE SET ...
```

| Metric | Value |
|--------|-------|
| Total duration | 2622ms |
| Executions | 26,494 |
| Avg duration | 0.1ms |
| Avg rows read | 3 |

**Analysis**: Efficient per call. Same pattern as Q2.

**Optimization**: None needed.

### Q5: Sessions list with project JOIN — 1.8s total (SLOWEST per call)

```sql
SELECT sr.*, p.name AS project_name
FROM session_records sr
LEFT JOIN project_aliases pa ON pa.user_id = sr.user_id AND pa.source = sr.source AND pa.project_ref = sr.project_ref
LEFT JOIN projects p ON p.id = pa.project_id
WHERE sr.user_id = ? AND sr.started_at >= ? AND sr.started_at < ?
ORDER BY sr.started_at DESC
```

| Metric | Value |
|--------|-------|
| Total duration | 1800ms |
| Executions | 67 |
| Avg duration | **26.9ms** |
| Avg rows read | 3219 |
| Query efficiency | 99.97% |

**Analysis**: Highest per-call latency at 26.9ms. The 99.97% efficiency is misleading — D1 reports this when JOINs produce many intermediate rows. The `idx_session_user_time (user_id, started_at)` covers the WHERE + ORDER BY, but the double LEFT JOIN against `project_aliases` and `projects` multiplies the scan cost. Each of the ~100 session rows requires a lookup in `project_aliases (user_id, source, project_ref)` — this is covered by the UNIQUE index, so lookups are O(1). The bottleneck is the sheer number of session_records rows being read (3219 avg vs ~100 expected results), suggesting the index is not being used efficiently or there's an issue with the range scan.

**Optimization**: ⚠️ **API contract change required.** The current `/api/sessions` endpoint computes summary stats (`total_sessions`, `total_duration_seconds`, etc.) in-memory from the full query result (see `route.ts`). Simply adding `LIMIT` to this query would turn those summaries into "current page" aggregates, silently breaking the contract. The correct approach is to **split into two queries**: (1) a paginated `SELECT ... LIMIT ? OFFSET ?` for the session list, and (2) a separate lightweight `SELECT COUNT(*), SUM(duration_seconds), ... WHERE user_id = ? AND started_at >= ? AND started_at < ?` for the summary. This is not a low-risk tweak — it requires API redesign and client-side pagination support. The existing `idx_session_user_time (user_id, started_at)` already covers the WHERE + ORDER BY for both queries.

> **Note**: The earlier suggestion to widen `idx_session_user_time` to include `(source, project_ref)` has been removed. Those columns are only used in the LEFT JOIN, not in the WHERE or ORDER BY — appending them would not reduce the index range scan on `session_records`. This assumption needs validation via `EXPLAIN QUERY PLAN` before any index changes are made.

---

## Top Queries by Avg Rows Read (scan-heavy)

### Q6: Leaderboard (all-time, no time filter) — avg 15,231 rows

```sql
SELECT ur.user_id, u.name, ..., SUM(ur.total_tokens) AS total_tokens
FROM usage_records ur
JOIN users u ON u.id = ur.user_id
WHERE u.is_public = 1 AND u.slug IS NOT NULL
GROUP BY ur.user_id
ORDER BY total_tokens DESC LIMIT ?
```

**Analysis**: Full table scan of `usage_records` — no `hour_start` filter means `idx_usage_user_time` is useless. Every row in the table is read. 15k rows now, will grow linearly.

**Optimization**: This is the strongest candidate for a **materialized summary table** (e.g., `user_token_totals` updated on each ingest). ⚠️ **Product decision (not a performance tweak)**: Adding a time floor (e.g., "all-time" = last 365 days) would change the public interface semantics. The current `/api/leaderboard` API explicitly allows `period=all` with no `fromDate`, meaning full-history aggregation (see `route.ts`). Redefining "all-time" to mean a rolling window is a product-level decision that should be evaluated separately from caching/indexing optimizations.

### Q7: Orphan project refs query — avg 3,234 rows

```sql
SELECT sr.source, sr.project_ref, COUNT(*), ...
FROM session_records sr
WHERE sr.user_id = ? AND sr.project_ref IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM project_aliases pa WHERE ...)
GROUP BY sr.source, sr.project_ref
```

**Analysis**: Scans all session_records for a user, then for each row runs a correlated subquery against project_aliases. The `idx_session_user_time` helps filter by user_id but without `project_ref` filtering, all rows are read.

**Optimization**: Add index `(user_id, source, project_ref)` on `session_records`. The three-column index aligns with the actual query pattern: the NOT EXISTS correlated subquery joins on `pa.user_id = sr.user_id AND pa.source = sr.source AND pa.project_ref = sr.project_ref`, and the GROUP BY is `sr.source, sr.project_ref`. A two-column `(user_id, project_ref)` index would miss `source` and poorly serve both the JOIN and GROUP BY. Alternatively, move orphan detection to a background job rather than running on every page load.

---

## Recommended Index Changes

> **⚠️ Validation required**: The analysis below is based on D1 Insights metrics (duration, rows read, efficiency %). Index usage assumptions have **not** been verified with `EXPLAIN QUERY PLAN`. Before implementing any index changes, run `EXPLAIN QUERY PLAN` against the target queries on production D1 to confirm which indexes are actually being selected and whether proposed changes would alter the query plan.

### Priority 1: No schema changes needed (application-level)

| Change | Impact | Effort |
|--------|--------|--------|
| Split sessions list (Q5) into paginated query + separate summary query | Reduces 3219 -> ~50 rows for list; summary stays accurate | **Medium** (API contract change, requires client pagination) |
| Cache leaderboard results (60s TTL) | 246 executions -> ~10 | Low |

### Priority 2: New indexes

| Index | Table | Columns | Benefits |
|-------|-------|---------|----------|
| `idx_session_user_source_project` | `session_records` | `(user_id, source, project_ref)` | Q7 orphan detection + GROUP BY |

### Priority 3: Materialized summaries (future)

If `usage_records` grows beyond 50k rows, consider a `user_daily_totals` table updated on each ingest batch, reducing dashboard queries from scanning raw records to scanning pre-aggregated daily rows (~365 rows/user/year vs ~15k raw rows).

---

## Redundant Indexes

| Index | Reason |
|-------|--------|
| `idx_project_aliases_lookup (user_id, source, project_ref)` | Duplicates UNIQUE constraint autoindex on same columns |
| `idx_usage_source (source)` | Never appears in any top query; source is always filtered after user_id |
| `idx_session_source (source)` | Same — never queried alone |
| `idx_session_kind (kind)` | Same — never queried alone |

These can be dropped to reduce write amplification on INSERTs (each INSERT must update every index). Dropping 4 redundant indexes saves ~4 index writes per row on high-volume tables.

---

## Data Snapshot (2026-03-13)

- `usage_records`: ~15k rows (based on full-scan leaderboard reading 15,231)
- `session_records`: ~15.5k rows (based on DELETE reading 15,481)
- Busiest period: 69,175 session UPSERTs + 26,494 usage UPSERTs in 7 days
