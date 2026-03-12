# 17 — VSCode Copilot Token Tracking Research

> Research spike: can we extract token usage from VSCode Copilot Chat local data?

## Status: Validated — Exact tokens available

---

## Context

pew currently tracks 6 AI coding tools (Claude Code, Codex, Gemini CLI, OpenCode, OpenClaw, VS Code Copilot),
all of which write structured logs locally with **exact** token counts provided by
their respective APIs.

VSCode + GitHub Copilot Chat is the most popular AI coding tool. Initial
investigation incorrectly concluded that local data lacked token counts and
would require char-based estimation. **This was wrong.**

### Key Finding

`request.result.metadata` contains **exact** server-reported token counts:

- `promptTokens` — exact input tokens (server-side, includes full context)
- `outputTokens` — exact output tokens

Verified against 5 real session files (4 workspace + 1 empty-window):

| Category | Count | % |
|----------|-------|---|
| Total requests | 31 | 100% |
| With exact token fields | 25 | 80.6% |
| Has `result` but no token fields | 3 | 9.7% |
| Empty `result` (`{}`) | 2 | 6.5% |
| No `result` line at all | 1 | 3.2% |

### Requests Without Tokens Are NOT Necessarily Non-Billable

The 3 "has result, no tokens" requests had **substantial partial output** and
multiple tool-call rounds (up to 70 response items, 35 tool-call rounds, 10+
minutes elapsed). These consumed real API quota — the server simply did not
report token counts in the metadata. They correlate with `modelState` values
2 and 3 (vs. value 1 for all 25 exact-token requests).

| `modelState` | Meaning (inferred) | Token fields? | Count |
|-------------|-------------------|---------------|-------|
| `1` | Normal completion | Always present | 25 |
| `2` | Abnormal completion | Missing | 3 (1 no-tokens + 2 empty) |
| `3` | Abnormal completion (different?) | Missing | 2 |
| (none) | In-progress / abandoned | No result line | 1 |

**Implementation decision**: skip these requests — do not emit records. The parser
logs a debug warning with the request index and `modelState` so users can audit
skipped turns. No `incomplete`/`estimated` flags in the storage layer — the
schema change cost is not justified for ~19% of requests whose actual token
cost is unknown.

---

## Data Locations (macOS)

```
~/Library/Application Support/Code/User/
├── workspaceStorage/<workspace-hash>/
│   ├── chatSessions/<session-uuid>.jsonl         # <-- main data source
│   ├── chatEditingSessions/<session-uuid>/state.json
│   └── GitHub.copilot-chat/
│       ├── chat-session-resources/               # tool call artifacts
│       ├── local-index.1.db                      # code embedding index
│       └── workspace-chunks.db                   # chunk embeddings
├── globalStorage/
│   ├── github.copilot-chat/                      # extension assets (no usage data)
│   ├── emptyWindowChatSessions/*.jsonl            # sessions outside any workspace
│   └── state.vscdb                               # SQLite KV store (no token data)
└── chatLanguageModels.json                        # model registry
```

### Cross-Platform Paths

Both stable and Insiders builds use the same structure under different directories:

| Platform | Stable | Insiders |
|----------|--------|----------|
| macOS | `~/Library/Application Support/Code/User/` | `~/Library/Application Support/Code - Insiders/User/` |
| Linux | `~/.config/Code/User/` | `~/.config/Code - Insiders/User/` |
| Windows | `%APPDATA%/Code/User/` | `%APPDATA%/Code - Insiders/User/` |

### File Discovery

- Scan both `Code/` and `Code - Insiders/` base directories
- One `chatSessions/` directory per **workspace** (keyed by workspace hash)
- Multiple workspaces → multiple `workspaceStorage/*/chatSessions/` directories
- `globalStorage/emptyWindowChatSessions/` for window-less sessions
- No single index file — must scan all workspace directories

---

## JSONL File Format: CRDT Operation Log

Each `.jsonl` file is a **CRDT-style append-only operation log**, not a simple array
of messages. Three operation kinds:

| kind | Name | Description |
|------|------|-------------|
| `0` | **Snapshot** | Full session state. First line of file. May have empty `requests[]` |
| `1` | **Set** | Overwrite value at a JSON path, e.g. `['requests', 0, 'result']` |
| `2` | **Append** | Append to array at path, e.g. `['requests']` or `['requests', N, 'response']` |

### Reconstructing Session State

To get the current session state, replay all operations in order:

```
line 0 (kind=0): state = snapshot.v
line N (kind=1): set(state, line.k, line.v)      # e.g. state.requests[0].result = v
line N (kind=2): append(state, line.k, line.v)    # e.g. state.requests.push(...v)
```

The `k` field is a JSON path array like `["requests", 0, "response"]`.

**Optimization**: Full CRDT replay (materializing the entire session state including
response bodies) is NOT needed. However, the parser MUST maintain a **per-file
request-index → metadata mapping** (`index → { modelId, timestamp }`) because:

- `kind=1` result lines only carry the request **index** (e.g. `k = ["requests", 3, "result"]`)
  — they do NOT contain `modelId` or `timestamp`
- `modelId` and `timestamp` come from earlier `kind=2` appends to `["requests"]`
  or from the `kind=0` snapshot

On **first parse** of a file, the parser scans all lines and builds this mapping
naturally. On **incremental sync** (resuming from a byte offset), the mapping from
prior lines is no longer in memory. Two options:

1. **Persist the index→metadata mapping** alongside the byte-offset cursor
   (e.g. in `cursors.json`), so incremental reads can correlate new `kind=1`
   result lines with their request metadata
2. **Always replay from the start of each file** but skip emitting records for
   already-processed request indices (tracked via cursor)

Option 1 is more efficient for large session files. Option 2 is simpler but
re-reads the entire file each sync cycle.

In either case, the parser does NOT need to materialize response bodies
(`kind=2` appends to `["requests", N, "response"]`), which are the bulk of
the file size.

---

## Token Extraction Strategy

### Primary: Exact Server-Reported Tokens (~81% coverage)

Token data lives in `kind=1` Set operations targeting `['requests', N, 'result']`:

```jsonc
{
  "kind": 1,
  "k": ["requests", 0, "result"],
  "v": {
    "timings": { "totalElapsed": 356743, "firstProgress": 6613 },
    "details": "Claude Opus 4.6 • 3x",
    "metadata": {
      "promptTokens": 36533,      // <-- EXACT input tokens
      "outputTokens": 937,        // <-- EXACT output tokens
      "agentId": "...",
      "sessionId": "...",
      "renderedUserMessage": "...",
      "renderedGlobalContext": "...",
      "toolCallResults": [...],
      "toolCallRounds": [...]
    }
  }
}
```

Model ID and timestamp come from the request itself (either in `kind=0` snapshot
or `kind=2` append to `['requests']`):

```jsonc
{
  "kind": 2,
  "k": ["requests"],
  "v": [{
    "modelId": "copilot/claude-opus-4.6",   // strip "copilot/" prefix
    "timestamp": 1772780377684               // Unix ms
  }]
}
```

### Fallback: Requests Without Token Fields (~19%)

The ~19% of requests lacking `promptTokens`/`outputTokens` fall into three categories:

| Category | Count | Has partial output? | Billable? |
|----------|-------|-------------------|-----------|
| Has `result` with metadata, no token fields | 3 | Yes (up to 70 response items) | Likely yes |
| Empty `result` (`{}`) | 2 | Check response items | Unknown |
| No `result` line at all | 1 | Possibly in-progress | Unknown |

These are NOT uniformly "incomplete/non-billable" — several had extensive tool-call
rounds and elapsed times >10 minutes.

**Strategy**: **Skip** — requests without exact `promptTokens`/`outputTokens`
are not emitted as records. No `incomplete`/`estimated` flags in the storage
layer. The parser logs a debug-level warning with the request index and
`modelState` so users can audit skipped turns if needed.

This means ~19% of requests in the sample set are unaccounted for. This is
an acceptable trade-off: adding metadata flags would require schema changes
across core types, queue, D1, worker, and frontend for a minority of
requests whose actual token cost is unknown anyway.

### char/4 Estimation Accuracy (measured against real data)

| Method | Median Error |
|--------|-------------|
| Input: `message.text` + `variableData` chars / 4 | ~95.9% (useless) |
| Input: above + `renderedUserMessage` + `toolCallResults` chars / 4 | ~82.8% (bad) |
| Output: `response[].value` chars / 4 | ~49.5% (unreliable) |

**Conclusion**: char/4 estimation should only be used as a last resort. The exact
fields are available for the vast majority of requests.

---

## Available Metadata Per Request

### Token Data (from `result.metadata`)

| Field | Description | Availability |
|-------|-------------|-------------|
| `promptTokens` | Exact input tokens (full context) | ~81% of requests (`modelState=1`) |
| `outputTokens` | Exact output tokens | ~81% of requests (`modelState=1`) |

### Request Metadata

| Field | Path | Example |
|-------|------|---------|
| Model ID | `request.modelId` | `"copilot/claude-opus-4.6"`, `"copilot/claude-opus-4.6-1m"` |
| Timestamp | `request.timestamp` | `1772780377684` (Unix ms) |
| Request ID | `request.requestId` | `"request_29c78eba-..."` |
| Extension version | `request.agent.extensionVersion` | `"0.38.0"` |
| Total elapsed (ms) | `result.timings.totalElapsed` | `356743` |
| First token (ms) | `result.timings.firstProgress` | `6613` |
| Premium multiplier | `result.details` | `"Claude Opus 4.6 • 3x"` |
| Max input tokens | `inputState.selectedModel.metadata.maxInputTokens` | `127805` |
| Max output tokens | `inputState.selectedModel.metadata.maxOutputTokens` | `64000` |
| Multiplier numeric | `inputState.selectedModel.metadata.multiplierNumeric` | `3` |

### Model ID Normalization

| Raw `modelId` | Normalized Model | Notes |
|---------------|-----------------|-------|
| `copilot/claude-opus-4.6` | `claude-opus-4.6` | Strip `copilot/` prefix |
| `copilot/claude-opus-4.6-1m` | `claude-opus-4.6-1m` | 1M context variant, 6x multiplier |

---

## Comparison with Existing Sources

| Source | Input Tokens | Output Tokens | Data Quality |
|--------|-------------|---------------|--------------|
| Claude Code | Exact | Exact | API-reported per message |
| Gemini CLI | Exact | Exact | Cumulative in session JSON |
| OpenCode | Exact | Exact | Per-message in JSON/SQLite |
| OpenClaw | Exact | Exact | API-reported per message |
| **VSCode Copilot** | **Exact** | **Exact** | **Server-reported, ~81% coverage; ~19% missing (abnormal completions)** |

---

## Implementation Plan

### Source Type

```typescript
source: "vscode-copilot"  // new Source enum value
```

### Implementation Scope

This is NOT a parser-only change. Adding VSCode Copilot support touches multiple
layers of the stack:

| Layer | File(s) | Change |
|-------|---------|--------|
| **Core types** | `packages/core/src/types.ts` | Add `"vscode-copilot"` to `Source` union; add `VscodeCopilotCursor` to `FileCursor` union; extend `CursorState` if needed |
| **Parser** | `packages/cli/src/parsers/vscode-copilot.ts` | New parser module (CRDT JSONL → `UsageRecord[]`) |
| **CLI wiring** | `packages/cli/src/parsers/index.ts` | Register new parser in discovery/dispatch |
| **Queue schema** | `packages/core/src/types.ts` (`QueueRecord`) | No change — requests without exact tokens are skipped, not emitted with flags |
| **Worker ingest** | `packages/worker/` | D1 `INSERT` must accept `"vscode-copilot"` as a valid source value |
| **Web dashboard** | `packages/web/` | Source filter UI, color/icon mapping, any `Source`-exhaustive switches |
| **Notifier** | `packages/cli/src/` | File-watch setup for `workspaceStorage/*/chatSessions/` directories |

**Decision**: no `incomplete`/`estimated` flags in the storage layer. Requests
without exact token fields are skipped by the parser (see Fallback Strategy above).

### Parser Design

Unlike other parsers that process raw API responses, the VSCode Copilot parser
must handle CRDT-style operation logs with an index-based correlation challenge:

1. **Scans** `workspaceStorage/*/chatSessions/*.jsonl` + `emptyWindowChatSessions/*.jsonl`
2. **Builds index→metadata mapping** from `kind=0` snapshot requests and
   `kind=2` appends to `["requests"]` — extracts `modelId`, `timestamp` per index
3. **Extracts tokens** from `kind=1` lines where `k[2] == "result"`:
   - `v.metadata.promptTokens` → `inputTokens`
   - `v.metadata.outputTokens` → `outputTokens`
   - Uses request index (`k[1]`) to look up `modelId` and `timestamp` from the mapping
4. **Skips** requests without exact token fields (logs debug warning with index + `modelState`)
5. **Persists** the index→metadata mapping in cursor state for incremental sync
   (so new `kind=1` result lines arriving after the offset can still be correlated)

#### Incremental Sync Strategy

The JSONL file is append-only, so byte-offset cursoring works. But new `kind=1`
result lines reference request indices whose `kind=2` definitions may be before
the saved offset. The cursor must therefore persist:

```typescript
interface VscodeCopilotFileCursor {
  offset: number;                                    // byte offset for next read
  processedRequestIndices: number[];                 // indices already emitted (JSON-serializable)
  requestMeta: Record<number, {                      // index → metadata mapping
    modelId: string;
    timestamp: number;
  }>;
}
```

All fields are plain JSON-serializable types (`number[]`, not `Set<number>`)
to match the existing `CursorState` persistence model in `cursors.json`.

On incremental read, the parser reads from `offset`, encounters new `kind=1`
result lines, and joins against the persisted `requestMeta` to produce records.

### Token Mapping

| VSCode Field | pew `TokenDelta` Field | Notes |
|-------------|----------------------|-------|
| `promptTokens` | `inputTokens` | Exact. No cache breakdown available |
| `outputTokens` | `outputTokens` | Exact |
| (none) | `cachedInputTokens` | Not available — set to 0 |
| (none) | `reasoningOutputTokens` | Not available — set to 0 |

**Limitation**: VSCode Copilot does not break down input tokens into cached vs
uncached. `cachedInputTokens` will always be 0. If `thinking` response items
exist, we *could* estimate reasoning tokens from their text length, but the
exact count is not provided.

### Cursor Type

Byte-offset cursor with persisted request metadata (see Parser Design above).
Unlike simpler byte-offset cursors (Claude Code / OpenClaw), this cursor must
also store `requestMeta` and `processedRequestIndices` to support index→metadata
correlation across incremental reads.

### Resolved Questions

1. **VSCode Insiders**: Same structure under `Code - Insiders/User/`. Parser
   should scan both `Code/` and `Code - Insiders/` base directories.
2. **Cursor IDE / Windsurf / Cody / Continue**: Out of scope for now. These are
   separate products with potentially different formats — future research spikes
   if there's demand.
3. **File rotation**: Unknown whether VSCode ever truncates JSONL files. The
   parser uses byte-offset cursoring — once data is read and emitted, rotation
   does not cause data loss. If a file is truncated below the cursor offset,
   the inode/size check will detect it and trigger a full re-read.
4. **cachedInputTokens / reasoningOutputTokens**: Set to 0. VSCode does not
    report these breakdowns. This means pew will **undercount** for VSCode
   Copilot compared to sources that do report cache/reasoning tokens — the
   numbers are a lower bound, never an overcount.

### Resolved: Multi-Turn Token Accounting

**`promptTokens` is a per-turn independent value (billing semantics), not
cumulative.** Each turn reports the total input tokens sent to the model for
that API call, including the full conversation history up to that point.

Verified across 2 multi-turn sessions (13 + 8 turns with exact tokens):
- Values generally increase as conversation history grows
- But non-monotonic drops occur (e.g. −48,096 tokens between turns) when
  context is trimmed or a new context window is started
- `outputTokens` are always independent small values (tens to thousands)

**Decision**: sum `promptTokens` directly across turns. This measures total
API consumption and matches billing. No incremental diffing needed.

---

## Appendix: Sample Data

### Complete kind=1 Result (with tokens)

```jsonc
{
  "kind": 1,
  "k": ["requests", 0, "result"],
  "v": {
    "timings": { "totalElapsed": 356743, "firstProgress": 6613 },
    "details": "Claude Opus 4.6 • 3x",
    "metadata": {
      "promptTokens": 36533,
      "outputTokens": 937,
      "agentId": "github.copilot.editsAgent",
      "cacheKey": "...",
      "codeBlocks": [...],
      "modelMessageId": "...",
      "renderedGlobalContext": "...",
      "renderedUserMessage": "...",
      "responseId": "response_dc6357b6-...",
      "sessionId": "3a08f728-...",
      "toolCallResults": [...],
      "toolCallRounds": [...]
    }
  }
}
```

### Incomplete kind=1 Result (no tokens)

```jsonc
{
  "kind": 1,
  "k": ["requests", 7, "result"],
  "v": {
    "timings": { "totalElapsed": 538892, "firstProgress": 8300 },
    "metadata": {
      "agentId": "...",
      "modelMessageId": "...",
      "responseId": "...",
      "sessionId": "...",
      "toolCallResults": [...],
      "toolCallRounds": [...]
      // NOTE: no promptTokens, no outputTokens
    }
  }
}
```

### kind=2 Request Append (for modelId + timestamp)

```jsonc
{
  "kind": 2,
  "k": ["requests"],
  "v": [{
    "requestId": "request_29c78eba-...",
    "timestamp": 1772780377684,
    "modelId": "copilot/claude-opus-4.6",
    "message": { "text": "用户输入的原始文本..." },
    "agent": { "extensionVersion": "0.38.0", ... }
  }]
}
```

### Observed Models

```
copilot/claude-opus-4.6       (multiplier: 3x)
copilot/claude-opus-4.6-1m    (multiplier: 6x, 1M context)
```

---

## Implementation Status

### Completed (branch: `tokenvscodetokenlog`)

All CLI-side integration is complete and tested:

| Layer | File(s) | Status |
|-------|---------|--------|
| Core types | `packages/core/src/types.ts` | `"vscode-copilot"` in `Source` union, `VscodeCopilotCursor` in `FileCursor` union |
| Parser | `packages/cli/src/parsers/vscode-copilot.ts` | CRDT JSONL parser (19 tests) |
| Discovery | `packages/cli/src/discovery/sources.ts` | `discoverVscodeCopilotFiles()` multi-dir scanning (8 tests) |
| Paths | `packages/cli/src/utils/paths.ts` | `resolveVscodeCopilotDirs()` platform-aware resolution |
| Token driver | `packages/cli/src/drivers/token/vscode-copilot-token-driver.ts` | `FileTokenDriver<VscodeCopilotCursor>` implementation (9 tests) |
| Registry | `packages/cli/src/drivers/registry.ts` | Registered with array-length guard |
| Sync orchestrator | `packages/cli/src/commands/sync.ts` | `vscodeCopilotDirs` option, source counts, filesScanned |
| Session sync | `packages/cli/src/commands/session-sync.ts` | Counts initialized (no session driver yet) |
| CLI | `packages/cli/src/cli.ts` | `isSource()`, `executeSync`/`executeNotify`/`executeStatus` wiring, output lines |
| Notify | `packages/cli/src/commands/notify.ts` | Pass-through of `vscodeCopilotDirs` |
| Status | `packages/cli/src/commands/status.ts` | `classifySource()` for multi-dir array |

### Not Yet Implemented

| Layer | Notes |
|-------|-------|
| Worker ingest | D1 TEXT column accepts any source string — no change needed |
| Web dashboard | Filter/color/icon for `"vscode-copilot"` — separate PR |
| Session driver | No session tracking for VSCode Copilot (no hook mechanism) |
