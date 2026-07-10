/**
 * Unit tests for session-sync internal helpers (toQueueRecord, sourceKey).
 *
 * These cover defensive branches that are not naturally exercised through
 * end-to-end executeSessionSync flows:
 *   - toQueueRecord: re-hash branch when a parser supplies an unhashed projectRef
 *   - sourceKey: every Source enum value (mapped + null + exhaustiveness throw)
 */
import { describe, it, expect } from "vitest";
import { toQueueRecord, sourceKey } from "../commands/session-sync.js";
import { hashProjectRef } from "../utils/hash-project-ref.js";
import type { SessionSnapshot, Source } from "@pew/core";

function makeSnap(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionKey: "claude-code:abc",
    source: "claude-code",
    kind: "single",
    startedAt: "2026-04-01T00:00:00Z",
    lastMessageAt: "2026-04-01T00:10:00Z",
    durationSeconds: 600,
    userMessages: 2,
    assistantMessages: 2,
    totalMessages: 4,
    projectRef: null,
    model: "claude-sonnet-4-5",
    snapshotAt: "2026-04-01T00:10:00Z",
    ...overrides,
  };
}

describe("toQueueRecord", () => {
  it("passes null projectRef through unchanged", () => {
    const r = toQueueRecord(makeSnap({ projectRef: null }));
    expect(r.project_ref).toBeNull();
    expect(r.session_key).toBe("claude-code:abc");
    expect(r.source).toBe("claude-code");
  });

  it("passes through an already-hashed 16-char hex projectRef unchanged", () => {
    const valid = "0123456789abcdef";
    const r = toQueueRecord(makeSnap({ projectRef: valid }));
    expect(r.project_ref).toBe(valid);
  });

  it("re-hashes a non-hex projectRef as defense-in-depth", () => {
    const raw = "/Users/alice/myproject";
    const expected = hashProjectRef(raw);
    const r = toQueueRecord(makeSnap({ projectRef: raw }));
    expect(r.project_ref).toBe(expected);
    expect(r.project_ref).not.toBe(raw);
    expect(r.project_ref).toMatch(/^[a-f0-9]{16}$/);
  });

  it("re-hashes a wrong-length hex string (e.g. full sha256)", () => {
    // 64-char hex still doesn't match the 16-char requirement
    const wrongLen = "a".repeat(64);
    const r = toQueueRecord(makeSnap({ projectRef: wrongLen }));
    expect(r.project_ref).toBe(hashProjectRef(wrongLen));
    expect(r.project_ref).not.toBe(wrongLen);
  });

  it("re-hashes a string with non-hex chars", () => {
    const notHex = "ZZZZZZZZZZZZZZZZ"; // 16 chars but not hex
    const r = toQueueRecord(makeSnap({ projectRef: notHex }));
    expect(r.project_ref).toBe(hashProjectRef(notHex));
  });

  it("maps all snake_case fields correctly", () => {
    const snap = makeSnap({
      sessionKey: "codex:s1",
      source: "codex",
      kind: "subagent",
      startedAt: "2026-04-02T00:00:00Z",
      lastMessageAt: "2026-04-02T01:00:00Z",
      durationSeconds: 3600,
      userMessages: 5,
      assistantMessages: 6,
      totalMessages: 11,
      projectRef: "0123456789abcdef",
      model: "gpt-5",
      snapshotAt: "2026-04-02T01:00:00Z",
    });
    expect(toQueueRecord(snap)).toEqual({
      session_key: "codex:s1",
      source: "codex",
      kind: "subagent",
      started_at: "2026-04-02T00:00:00Z",
      last_message_at: "2026-04-02T01:00:00Z",
      duration_seconds: 3600,
      user_messages: 5,
      assistant_messages: 6,
      total_messages: 11,
      project_ref: "0123456789abcdef",
      model: "gpt-5",
      snapshot_at: "2026-04-02T01:00:00Z",
    });
  });
});

describe("sourceKey", () => {
  // Sources that map to a result key
  const mapped: Array<[Source, string]> = [
    ["claude-code", "claude"],
    ["codex", "codex"],
    ["copilot-cli", "copilotCli"],
    ["gemini-cli", "gemini"],
    ["kosmos", "kosmos"],
    ["opencode", "opencode"],
    ["openclaw", "openclaw"],
    ["pi", "pi"],
    ["pmstudio", "pmstudio"],
    ["grok", "grok"],
  ];

  for (const [src, key] of mapped) {
    it(`maps ${src} → ${key}`, () => {
      expect(sourceKey(src)).toBe(key);
    });
  }

  // Sources without session drivers map to null
  it("returns null for vscode-copilot (no session driver)", () => {
    expect(sourceKey("vscode-copilot")).toBeNull();
  });

  it("returns null for hermes (no session driver)", () => {
    expect(sourceKey("hermes")).toBeNull();
  });

  it("throws on unknown source (defensive runtime check)", () => {
    expect(() => sourceKey("not-a-real-source" as Source)).toThrow(
      /Unknown source/,
    );
  });
});
