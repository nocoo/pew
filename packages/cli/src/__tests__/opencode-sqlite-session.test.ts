import { describe, it, expect } from "vitest";
import {
  collectOpenCodeSqliteSessions,
  type SessionRow,
  type SessionMessageRow,
} from "../parsers/opencode-sqlite-session.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionRow(
  id: string,
  overrides: Partial<SessionRow> = {},
): SessionRow {
  return {
    id,
    project_id: "proj_abc",
    title: `Session ${id}`,
    time_created: 1771120700000,
    time_updated: 1771121000000,
    ...overrides,
  };
}

function msgRow(
  sessionId: string,
  role: string,
  overrides: Partial<Omit<SessionMessageRow, "session_id" | "data">> & {
    data?: Record<string, unknown>;
  } = {},
): SessionMessageRow {
  const { data: dataOverrides, ...restOverrides } = overrides;
  return {
    session_id: sessionId,
    role,
    time_created: 1771120749000,
    data: JSON.stringify({
      role,
      modelID: "claude-opus-4.6",
      time: {
        created: 1771120749059,
        completed: 1771120822000,
      },
      ...dataOverrides,
    }),
    ...restOverrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectOpenCodeSqliteSessions", () => {
  it("should collect sessions with message counts", () => {
    const sessions = [sessionRow("ses_001")];
    const messages: SessionMessageRow[] = [
      msgRow("ses_001", "user", { time_created: 1771120700000 }),
      msgRow("ses_001", "assistant", { time_created: 1771120749000 }),
      msgRow("ses_001", "user", { time_created: 1771120800000 }),
      msgRow("ses_001", "assistant", { time_created: 1771120822000 }),
    ];

    const result = collectOpenCodeSqliteSessions(sessions, messages);

    expect(result).toHaveLength(1);
    const s = result[0];
    expect(s.sessionKey).toBe("opencode:ses_001");
    expect(s.source).toBe("opencode");
    expect(s.kind).toBe("human");
    expect(s.userMessages).toBe(2);
    expect(s.assistantMessages).toBe(2);
    expect(s.totalMessages).toBe(4);
  });

  it("should compute duration from message timestamps", () => {
    const sessions = [sessionRow("ses_001")];
    const messages: SessionMessageRow[] = [
      msgRow("ses_001", "user", {
        time_created: 1771120700000,
        data: { role: "user", time: { created: 1771120700000 } },
      }),
      msgRow("ses_001", "assistant", {
        time_created: 1771121000000,
        data: {
          role: "assistant",
          modelID: "claude-opus-4.6",
          time: { created: 1771120900000, completed: 1771121000000 },
        },
      }),
    ];

    const result = collectOpenCodeSqliteSessions(sessions, messages);

    expect(result).toHaveLength(1);
    expect(result[0].durationSeconds).toBe(300); // (1771121000000 - 1771120700000) / 1000
  });

  it("should use last assistant model", () => {
    const sessions = [sessionRow("ses_001")];
    const messages: SessionMessageRow[] = [
      msgRow("ses_001", "assistant", {
        time_created: 1771120749000,
        data: {
          role: "assistant",
          modelID: "gemini-2.5-flash",
          time: { created: 1771120749000 },
        },
      }),
      msgRow("ses_001", "assistant", {
        time_created: 1771120822000,
        data: {
          role: "assistant",
          modelID: "claude-opus-4.6",
          time: { created: 1771120822000, completed: 1771120900000 },
        },
      }),
    ];

    const result = collectOpenCodeSqliteSessions(sessions, messages);

    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("claude-opus-4.6");
  });

  it("should handle multiple sessions", () => {
    const sessions = [
      sessionRow("ses_001", { time_created: 1771120700000, time_updated: 1771121000000 }),
      sessionRow("ses_002", { time_created: 1771122000000, time_updated: 1771123000000 }),
    ];
    const messages: SessionMessageRow[] = [
      msgRow("ses_001", "user", { time_created: 1771120700000, data: { role: "user", time: { created: 1771120700000 } } }),
      msgRow("ses_001", "assistant", { time_created: 1771121000000, data: { role: "assistant", modelID: "model-a", time: { completed: 1771121000000 } } }),
      msgRow("ses_002", "user", { time_created: 1771122000000, data: { role: "user", time: { created: 1771122000000 } } }),
      msgRow("ses_002", "assistant", { time_created: 1771123000000, data: { role: "assistant", modelID: "model-b", time: { completed: 1771123000000 } } }),
    ];

    const result = collectOpenCodeSqliteSessions(sessions, messages);

    expect(result).toHaveLength(2);
    expect(result[0].sessionKey).toBe("opencode:ses_001");
    expect(result[0].model).toBe("model-a");
    expect(result[1].sessionKey).toBe("opencode:ses_002");
    expect(result[1].model).toBe("model-b");
  });

  it("should return empty for no sessions", () => {
    const result = collectOpenCodeSqliteSessions([], []);
    expect(result).toEqual([]);
  });

  it("should skip sessions with no messages", () => {
    const sessions = [sessionRow("ses_empty")];
    const messages: SessionMessageRow[] = [];

    const result = collectOpenCodeSqliteSessions(sessions, messages);

    // Session with no messages should still produce a snapshot
    // using session table timestamps as fallback
    expect(result).toHaveLength(1);
    expect(result[0].totalMessages).toBe(0);
    expect(result[0].userMessages).toBe(0);
    expect(result[0].assistantMessages).toBe(0);
  });

  it("should count tool and system roles in totalMessages", () => {
    const sessions = [sessionRow("ses_001")];
    const messages: SessionMessageRow[] = [
      msgRow("ses_001", "user", { time_created: 1771120700000, data: { role: "user", time: { created: 1771120700000 } } }),
      msgRow("ses_001", "assistant", { time_created: 1771120749000 }),
      msgRow("ses_001", "tool", { time_created: 1771120800000, data: { role: "tool", time: { created: 1771120800000 } } }),
      msgRow("ses_001", "system", { time_created: 1771120850000, data: { role: "system", time: { created: 1771120850000 } } }),
    ];

    const result = collectOpenCodeSqliteSessions(sessions, messages);

    expect(result).toHaveLength(1);
    expect(result[0].userMessages).toBe(1);
    expect(result[0].assistantMessages).toBe(1);
    expect(result[0].totalMessages).toBe(4);
  });

  it("should use project_id as projectRef", () => {
    const sessions = [sessionRow("ses_001", { project_id: "proj_hash_123" })];
    const messages: SessionMessageRow[] = [
      msgRow("ses_001", "assistant", { time_created: 1771120749000 }),
    ];

    const result = collectOpenCodeSqliteSessions(sessions, messages);

    expect(result).toHaveLength(1);
    expect(result[0].projectRef).toBe("c1d68243f4a93662"); // sha256("proj_hash_123")[0:16]
  });

  it("should handle corrupted message data JSON", () => {
    const sessions = [sessionRow("ses_001")];
    const messages: SessionMessageRow[] = [
      { session_id: "ses_001", role: "assistant", time_created: 1771120749000, data: "{{bad}}" },
      msgRow("ses_001", "user", { time_created: 1771120800000, data: { role: "user", time: { created: 1771120800000 } } }),
    ];

    const result = collectOpenCodeSqliteSessions(sessions, messages);

    expect(result).toHaveLength(1);
    // Bad message still counted by role column, but time extraction fails gracefully
    expect(result[0].totalMessages).toBe(2);
  });

  it("should fallback to data.model when data.modelID is missing", () => {
    const sessions = [sessionRow("ses_fallback")];
    const messages: SessionMessageRow[] = [
      {
        session_id: "ses_fallback",
        role: "assistant",
        time_created: 1771120749000,
        data: JSON.stringify({
          role: "assistant",
          model: "gpt-4o",
          time: { created: 1771120749000, completed: 1771120822000 },
        }),
      },
    ];

    const result = collectOpenCodeSqliteSessions(sessions, messages);

    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("gpt-4o");
  });

  it("should fallback to session table timestamps when messages lack time", () => {
    const sessions = [sessionRow("ses_001", {
      time_created: 1771120700000,
      time_updated: 1771121000000,
    })];
    const messages: SessionMessageRow[] = [
      { session_id: "ses_001", role: "assistant", time_created: 1771120749000, data: JSON.stringify({ role: "assistant" }) },
    ];

    const result = collectOpenCodeSqliteSessions(sessions, messages);

    expect(result).toHaveLength(1);
    // Should use session table time_created / time_updated as fallback
    expect(result[0].durationSeconds).toBe(300);
  });
});
