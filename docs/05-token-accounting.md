# Token Accounting

> Specification for how Pew counts, aggregates, and reports token usage.
> Covers per-source field mappings, the `total_tokens` formula, and a
> cross-reference with vibeusage's accounting model.

## Token Fields

Every usage record carries five token counters:

| Field | Meaning |
|-------|---------|
| `input_tokens` | Tokens the model read as context, **including** cache-creation tokens |
| `cached_input_tokens` | Tokens served from prompt cache (subset of what the model processed) |
| `output_tokens` | Tokens the model generated as visible response |
| `reasoning_output_tokens` | Internal chain-of-thought / thinking tokens reported separately by some sources |
| `total_tokens` | Sum of the four tracked counters above |

### `total_tokens` Formula

```
total_tokens = input_tokens + cached_input_tokens + output_tokens + reasoning_output_tokens
```

This is Pew's current accounting rule and is computed directly from the four
stored counters. The rationale:

1. **Cached tokens are real work.** The model reads the full KV cache and
   uses it for attention — the compute is reduced, not eliminated.
2. **Single consistent formula across sources.** Some tools expose
   `reasoning` separately, some do not, and some expose a raw `total`.
   Pew avoids source-specific branching here and always sums the tracked fields.
3. **Intuitive semantics.** "How many tokens did I use?" should reflect
   everything the model touched, not a billing-weighted subset.

---

## Per-Source Field Mapping

### Claude Code

Raw fields (from `usage` object in JSONL):

| Raw Field | Maps To | Notes |
|-----------|---------|-------|
| `input_tokens` | `inputTokens` (partial) | Non-cached, non-creation input |
| `cache_creation_input_tokens` | `inputTokens` (added) | New cache entries; billed at full input rate |
| `cache_read_input_tokens` | `cachedInputTokens` | Cache hits; billed at ~10% of input rate |
| `output_tokens` | `outputTokens` | — |
| *(not emitted)* | `reasoningOutputTokens` = 0 | Claude Code logs do not expose reasoning tokens |

Effective mapping:
```
inputTokens         = input_tokens + cache_creation_input_tokens
cachedInputTokens   = cache_read_input_tokens
outputTokens        = output_tokens
reasoningOutputTokens = 0
```

### Gemini CLI

Raw fields (from `tokens` object in session JSON):

| Raw Field | Maps To | Notes |
|-----------|---------|-------|
| `input` | `inputTokens` | — |
| `cached` | `cachedInputTokens` | — |
| `output` | `outputTokens` (partial) | — |
| `tool` | `outputTokens` (added) | Tool-call tokens merged into output |
| `thoughts` | `reasoningOutputTokens` | Internal thinking tokens |

Gemini values are **cumulative** per session; the parser computes deltas.

### OpenCode

Raw fields (from `tokens` object in per-message JSON):

| Raw Field | Maps To | Notes |
|-----------|---------|-------|
| `input` | `inputTokens` (partial) | — |
| `cache.write` | `inputTokens` (added) | Cache creation; same treatment as Claude |
| `cache.read` | `cachedInputTokens` | — |
| `output` | `outputTokens` | — |
| `reasoning` | `reasoningOutputTokens` | — |

OpenCode values are **cumulative** per session; the parser computes deltas.

### OpenClaw

Raw fields (from `usage` object in JSONL):

| Raw Field | Maps To | Notes |
|-----------|---------|-------|
| `input` | `inputTokens` | — |
| `cacheRead` | `cachedInputTokens` (partial) | — |
| `cacheWrite` | `cachedInputTokens` (added) | Both read+write → cached (differs from Claude) |
| `output` | `outputTokens` | — |
| *(not emitted)* | `reasoningOutputTokens` = 0 | — |

---

## Aggregation

Parsed deltas are bucketed into UTC half-hour windows keyed by
`(source, model, hour_start)`. Within each bucket, all five token fields
are summed independently. `total_tokens` is computed from the summed
components using the formula above.

---

## Cross-Reference: vibeusage

vibeusage is a separate token tracking tool that reads the same local log
files. Its accounting model differs in structure but should produce
equivalent headline numbers when configured for the same sources.

### vibeusage's Two Totals

vibeusage stores two total fields per bucket:

| Field | Meaning |
|-------|---------|
| `total_tokens` | Raw total from the source tool (e.g. Claude API's own `usage.total_tokens`) |
| `billable_total_tokens` | Computed at ingest by `computeBillableTotalTokens()`, **source-specific** |

The dashboard and summary API display `billable_total_tokens`, not
`total_tokens`.

### vibeusage's `computeBillableTotalTokens` Rules

```
Source group          Formula                                     Sources
─────────────────────────────────────────────────────────────────────────────
BILLABLE_ADD_ALL      input + cached + output + reasoning         claude, opencode
BILLABLE_TOTAL        total_tokens (raw, as-is)                   gemini
BILLABLE_INPUT_OUTPUT input + output + reasoning                  codex, every-code
Fallback              input + output + reasoning                  everything else
```

For Claude and OpenCode (the dominant sources), vibeusage's
`billable_total_tokens` uses `input + cached + output + reasoning` — the
same formula Pew uses for `total_tokens`.

### Naming Clarification

vibeusage's name `billable_total_tokens` is **misleading**. It does not
reflect billing cost (which would require per-field price weighting like
`input × $3 + cached × $0.30 + output × $15`). It is a **gross token
count** — the same concept Pew calls `total_tokens`.

### Expected Alignment

When both tools process the same log files for the same time range:

- **Claude / OpenCode sources**: Pew's `total_tokens` should equal
  vibeusage's `billable_total_tokens` (both use `input + cached + output + reasoning`).
- **Gemini source**: Pew's `total_tokens` uses the component sum;
  vibeusage uses the raw `total_tokens` from the API. These may diverge
  if Gemini's raw total includes fields not captured by the four
  components.
- **Other sources**: vibeusage excludes cached from its fallback formula,
  so its number will be lower than Pew's.
