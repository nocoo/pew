# Privacy Policy

**Last updated:** 2026-03-12

pew tracks AI coding tool usage statistics. It is designed to **never** collect the content of your work — no prompts, no code, no project names, no file paths.

## What pew collects

### Token usage (aggregated)

| Field | Description |
|-------|-------------|
| Source | Which AI tool (e.g. "claude-code", "gemini-cli") |
| Model | Model name (e.g. "claude-sonnet-4-20250514") |
| Token counts | Input, cached input, output, reasoning output |
| Time bucket | 30-minute window (not exact request timestamps) |
| Device ID | Random UUID generated once per CLI install |

Token data is **aggregated into 30-minute buckets** before leaving your machine. Individual request-level granularity is discarded.

### Session metadata

| Field | Description |
|-------|-------------|
| Session key | Opaque identifier from the AI tool (e.g. "claude:abc123") |
| Source | Which AI tool |
| Timestamps | When the session started and when the last message was sent |
| Duration | Wall-clock seconds |
| Message counts | User messages, assistant messages, total |
| Model | Last model used in the session |
| Project reference | **SHA-256 hash** (see below) |

### Project references (hashed)

pew groups sessions by project, but **never transmits project names or file paths**. Instead:

1. Each parser extracts a raw project identifier (e.g. a directory name, a working directory path, an upstream project ID).
2. The identifier is hashed: `SHA-256(raw)[0:16]` — a one-way, irreversible 16-character hex string.
3. A defense-in-depth gateway in the CLI re-hashes any value that doesn't match the expected hex format before upload.

The server stores only the hash. You can optionally assign these opaque hashes to human-readable project names in the web dashboard — that mapping is your choice, not automatic.

### Account information

| Field | Source |
|-------|--------|
| Email | Google OAuth sign-in |
| Display name | Google profile |
| Profile photo URL | Google profile |

This is standard OAuth data required for authentication.

## What pew does NOT collect

- **Conversation content** — prompts, responses, tool calls, code — never parsed, never stored
- **File paths** — hashed before transmission; raw paths exist only in local cursor files
- **Project names** — only opaque hashes are transmitted
- **Code or repository content** — pew reads only AI tool log/metadata files
- **Hardware identifiers** — Device ID is a random UUID, not derived from your machine

## What stays on your machine

| Data | Location |
|------|----------|
| Cursor state (file paths, byte offsets) | `~/.config/pew/cursors.json` |
| Upload queue | `~/.config/pew/queue.jsonl` |
| API key | `~/.config/pew/config.json` |

Cursor files contain absolute file paths (needed to track read progress), but this data **never leaves your device**.

## Raw data is read-only

pew **never modifies, deletes, or moves** your AI tool log files (`~/.claude/`, `~/.gemini/`, `~/.local/share/opencode/`, `~/.openclaw/`). It only reads them.

## Data storage

Usage data is stored in Cloudflare D1 (SQLite). OAuth tokens are stored as part of the standard NextAuth authentication flow.

## Open source

pew is open source under the MIT license. You can audit exactly what data is collected by reading the source code — specifically:

- `packages/cli/src/parsers/` — what data is extracted from each AI tool
- `packages/cli/src/utils/hash-project-ref.ts` — the hashing function
- `packages/cli/src/commands/session-sync.ts` — the defense-in-depth gateway (`toQueueRecord()`)
- `packages/core/src/types.ts` — the complete data schema
