# 32 — Proxy Token Gap Investigation

> When Claude Code routes through a local reverse proxy (e.g. raven),
> approximately 18% of consumed tokens are invisible to pew's JSONL-based
> pipeline. This document records the investigation methodology, findings,
> and architectural rationale for accepting this as a known limitation.

## Background

pew counts Claude Code tokens by parsing `~/.claude/projects/**/*.jsonl` —
the local log files that Claude Code writes after each API interaction.
When Claude Code is configured to use a local proxy (raven) that forwards
requests to GitHub Copilot's upstream API, a discrepancy emerges: the proxy
sees more tokens than what ends up in the JSONL files.

This investigation was conducted 2026-03-26 to quantify the gap and
determine whether it represents a bug in pew or an inherent limitation of
the data source.

---

## Architecture: Two Token Observation Points

```
┌─────────────────────┐
│   Claude Code CLI   │
│                     │
│  Writes JSONL log   │ ← observation point A (pew reads here)
│  on message complete│
└─────────┬───────────┘
          │ POST /v1/messages
          ▼
┌─────────────────────┐
│    raven proxy      │
│    (localhost)      │
│                     │
│  Logs every request │ ← observation point B (raven SQLite)
│  to local SQLite    │
└─────────┬───────────┘
          │ POST /v1/chat/completions (translated)
          ▼
┌─────────────────────┐
│  GitHub Copilot API │
│    (upstream)       │
└─────────────────────┘
```

**Point A** (JSONL): Only records requests that Claude Code considers
"complete" — the assistant message was fully received and the JSONL
`assistant` line was written.

**Point B** (proxy): Records every request that successfully received
tokens from upstream, regardless of what Claude Code does afterward.

---

## Token Field Mapping

The two systems use different token accounting for the same underlying API
call:

| Dimension    | pew (from JSONL)                           | raven (from proxy)                  |
| ------------ | ------------------------------------------ | ----------------------------------- |
| Input tokens | `input_tokens + cache_creation`            | `prompt_tokens - cached_tokens`     |
| Cached       | `cache_read_input_tokens` (separate field) | Subtracted from input, not stored   |
| Output       | `output_tokens`                            | `completion_tokens`                 |
| Total        | `input + cached + output + reasoning`      | `input + output` (generated column) |

**Key difference**: pew's `input_tokens` field (fresh input, no cache)
equals raven's `input_tokens` field (`prompt - cached`). The definitions
converge for non-cached token accounting. The divergence in `total_tokens`
is purely from pew including `cached_input_tokens` while raven excludes it.

For this investigation, we compare using the **same definition**:
`input_tokens + output_tokens` (no cached), making both sides directly
comparable.

---

## Methodology

### Step 1: Validate pew's JSONL pipeline (control)

Compared pew's local JSONL parsing against D1 database records for this
device over 3 days, using byte-level cursor comparison:

```
=== COMPARISON (this device, aligned time window) ===
✅ Exact match:    108 buckets
⚠️  Edge mismatch:   2 (boundary effects)
🔵 Local only:       1 (current session, not yet synced)

Excluding edge buckets: diff = 0 tokens (0.0000%)
```

**Conclusion**: pew's parser extracts 100% of what the JSONL files contain.
The pipeline from local files → D1 is lossless.

### Step 2: Cross-reference raven vs JSONL

Compared raven's SQLite database against JSONL data for the same 14-hour
window (spanning two calendar days):

```
CST Hour       Raven  JSONL   R.input      J.input     Δ input    R.output   J.output    Δ output
14:00 CST        565    543   3,000,730    2,397,948   -602,782     298,045    186,485    -111,560
17:00 CST        722    695   4,193,811    3,711,071   -482,740     276,673    239,941     -36,732
09:00 CST        810    762  10,178,356    7,119,232 -3,059,124     629,172    328,172    -301,000
  ...
─────────────────────────────────────────────────────────────────────────────────────────────────
TOTAL           6,975  6,721  57,978,585  48,114,679 -9,863,906   4,147,319  2,773,815  -1,373,504
```

### Step 3: Characterize missing requests

```
Total raven requests:   6,975
Total JSONL entries:    6,721
Missing (not in JSONL):   254 (3.6% of requests)

Average tokens per normal request:  in=8,312   out=595
Average tokens per missing request: in=38,834  out=5,407
                                    (4.7× avg) (9.1× avg)
```

Missing requests are **disproportionately large** — long-running generations
that hit the `max_tokens` ceiling (32,000 output tokens) or ran for 100-400
seconds.

---

## Root Cause

### Why requests go missing from JSONL

Claude Code writes an `assistant` line to JSONL only when it considers the
API response **complete**. Three scenarios cause a request to be processed by
the proxy but never logged to JSONL:

1. **User interruption (Ctrl+C)** — The user cancels a long-running
   generation. The proxy has already forwarded upstream tokens (Copilot
   generated them), but Claude Code discards the partial response without
   writing a log line.

2. **Stream error / timeout** — A network interruption mid-stream. The proxy
   logged the tokens received before the error; Claude Code treats the
   response as failed.

3. **Context window compaction** — During multi-turn tool-use loops, Claude
   Code may decide to compact the conversation, discarding intermediate API
   calls that were never written to the log.

### Why missing requests are larger than average

Interrupted requests are biased toward the **longest-running** generations:

- Short requests (1-5s) complete before the user has time to interrupt
- Long requests (100-400s) are more likely to be cancelled, hit timeouts,
  or trigger context compaction
- The `max_tokens` ceiling (32,000) is hit almost exclusively by these
  long-running requests

This creates a selection bias: the requests most likely to be missing are
also the ones consuming the most tokens.

---

## Quantified Impact

| Metric                       | Value                    |
| ---------------------------- | ------------------------ |
| Missing requests             | 3.6% of total            |
| Missing input tokens         | 17.0% of proxy total     |
| Missing output tokens        | 33.1% of proxy total     |
| Missing total (input+output) | **18.1%** of proxy total |

The 3.6% missing request rate translates to an 18.1% token gap because
missing requests are 5-9× larger than average.

---

## Decision: Accept as Known Limitation

This gap is **by design** — it is an inherent property of the JSONL data
source, not a bug in pew's parsing or aggregation logic.

### Why we accept it

1. **pew's JSONL parser is provably complete** — 100% of data in the files
   is captured. The gap exists upstream of pew.

2. **Claude Code controls what it logs** — pew is a read-only consumer of
   `.claude/` files (project invariant: never modify user's AI tool logs).
   We cannot force Claude Code to log interrupted requests.

3. **Proxy-based counting has its own trade-offs** — raven only sees traffic
   that routes through it. Direct Anthropic API calls, Codex, Gemini CLI,
   and other sources are invisible to raven. JSONL remains the only
   universal data source across all supported AI tools.

4. **The gap is consistent** — approximately 18% undercount on proxy-routed
   traffic, roughly stable across hours and days. Users can apply a mental
   adjustment if needed.

### Future options (not planned)

- **raven → pew ingest API**: raven could POST its token data directly to
  pew's ingest endpoint, using `source=claude-code-proxy` to avoid
  double-counting with JSONL data. This would require deduplication logic
  to handle the overlap between raven and JSONL for non-interrupted requests.

- **Claude Code upstream fix**: If Claude Code adds logging for interrupted
  requests (even partial usage), the gap would close automatically.

---

## Appendix: Verification Commands

### Compare JSONL totals against D1 for a specific device

```bash
# Parse local JSONL for a time range
find ~/.claude/projects/ -name "*.jsonl" -mtime -3 | \
  xargs grep -l '"usage"' | head -20

# Query D1 for the same device + time range
curl -s -X POST https://<WORKER_READ_URL>/api/query \
  -H "Authorization: Bearer <WORKER_READ_SECRET>" \
  -d '{"sql": "SELECT hour_start, SUM(total_tokens) ... WHERE device_id = ?", "params": ["<DEVICE_ID>"]}'
```

### Compare raven SQLite against JSONL for a specific hour

```bash
# Raven hourly totals (example: SQLite query)
# SELECT (timestamp / 3600000) * 3600000 as bucket,
#        COUNT(*), SUM(input_tokens), SUM(output_tokens)
# FROM requests WHERE timestamp >= <EPOCH_MS> GROUP BY bucket

# JSONL hourly totals (scan files, filter by timestamp range,
# sum input_tokens + output_tokens for non-zero entries)
```

### Identify missing requests

For a specific hour, count unique `message.id` values in JSONL assistant
lines and compare against raven's request count. The difference is the
number of interrupted/unlogged requests.
