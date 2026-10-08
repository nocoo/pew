import type { LeaderboardSnapshot, LeaderboardSnapshotRow } from "@pew/core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/leaderboard/route";
import * as dbModule from "@/lib/db";
import { isAdminUser } from "@/lib/admin";
import { createMockDbRead, loadMockedAuthHelpers, makeGetRequest } from "./test-utils";

vi.mock("@/lib/db", () => ({ getDbRead: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ resolveUser: vi.fn() }));
vi.mock("@/lib/admin", () => ({ isAdminUser: vi.fn() }));
const { resolveUser } = await loadMockedAuthHelpers();

function row(overrides: Partial<LeaderboardSnapshotRow> = {}): LeaderboardSnapshotRow {
  return {
    user_id: "u1", name: "Alice", nickname: null, image: null, slug: "alice",
    total_tokens: 1000, input_tokens: 500, output_tokens: 400, cached_input_tokens: 100,
    teams: [], session_count: 0, total_duration_seconds: 0, ...overrides,
  };
}

function snapshot(rows: LeaderboardSnapshotRow[] = [], overrides: Partial<LeaderboardSnapshot> = {}): LeaderboardSnapshot {
  return { key: "opaque", revision: "1", id: "snapshot-1", generatedAt: Date.now(), expiresAt: Date.now() + 600_000, rows, ...overrides };
}

describe("GET /api/leaderboard", () => {
  let mockDb: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T10:01:02.345Z"));
    mockDb = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDb);
    resolveUser.mockResolvedValue({ userId: "test-user" });
    vi.mocked(isAdminUser).mockResolvedValue(false);
    mockDb.getLeaderboardRevision.mockResolvedValue("1");
    mockDb.getLeaderboardSnapshot.mockImplementation(async () => snapshot());
  });

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("accepts Antigravity on the harness leaderboard", async () => {
    const res = await GET(makeGetRequest("/api/leaderboard", { source: "antigravity" }));
    expect(res.status).toBe(200);
    expect(mockDb.getLeaderboardSnapshot.mock.calls[0]?.[0].source).toBe("antigravity");
  });

  it("does not filter retired historical usage out of overall rankings", async () => {
    mockDb.getLeaderboardSnapshot.mockResolvedValue(snapshot([row({ total_tokens: 9876 })]));
    const res = await GET(makeGetRequest("/api/leaderboard", { period: "all" }));
    expect(res.status).toBe(200);
    expect(mockDb.getLeaderboardSnapshot.mock.calls[0]?.[0].source).toBeUndefined();
    const body = await res.json();
    expect(body.entries[0].total_tokens).toBe(9876);
  });

  it.each(["week", "month"])("reuses a UTC ten-minute window for %s snapshots", async (period) => {
    for (const now of ["2026-09-19T10:01:02.345Z", "2026-09-19T10:09:59.999Z", "2026-09-19T10:10:00.000Z"]) {
      vi.setSystemTime(new Date(now));
      expect((await GET(makeGetRequest("/api/leaderboard", { period }))).status).toBe(200);
    }
    const day = period === "week" ? "2026-09-12" : "2026-08-20";
    expect(mockDb.getLeaderboardSnapshot.mock.calls.map(([req]) => req.fromDate)).toEqual([
      `${day}T10:00:00.000Z`, `${day}T10:10:00.000Z`,
    ]);
    expect(mockDb.getLeaderboardRevision).toHaveBeenCalledTimes(6);
  });

  it.each([
    [{ period: "year" }, "Invalid period"],
    [{ limit: "0" }, "limit must be"],
    [{ limit: "200" }, "limit must be"],
    [{ limit: "abc" }, "limit must be"],
    [{ offset: "-1" }, "offset must be"],
    [{ offset: "abc" }, "offset must be"],
    [{ offset: "1x" }, "offset must be"],
    [{ offset: "1.5" }, "offset must be"],
    [{ offset: "1e2" }, "offset must be"],
    [{ offset: "9007199254740992" }, "offset must be"],
    [{ limit: "2x" }, "limit must be"],
    [{ model: "x".repeat(1025) }, "model must be"],
    [{ model: "\u4e2d".repeat(1025) }, "model must be"],
    [{ snapshot: "x".repeat(129) }, "snapshot must be"],
    [{ snapshot: "\u4e2d" }, "snapshot must be"],
    [{ snapshot: "bad/id" }, "snapshot must be"],
    [{ snapshot: "" }, "snapshot must be"],
    [{ team: "t1", org: "o1" }, "Cannot specify both"],
    [{ source: "bogus" }, "Invalid source"],
    [{ source: "codex", model: "o3" }, "Cannot specify both source and model"],
  ])("rejects invalid parameters %j before reading shared data", async (params, message) => {
    const res = await GET(makeGetRequest("/api/leaderboard", params));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(message);
    expect(mockDb.getLeaderboardSnapshot).not.toHaveBeenCalled();
    expect(mockDb.getLeaderboardRevision).not.toHaveBeenCalled();
  });

  it.each(["week", "month", "all"])("accepts period %s", async (period) => {
    const res = await GET(makeGetRequest("/api/leaderboard", { period }));
    expect(res.status).toBe(200);
    expect((await res.json()).period).toBe(period);
  });

  it("defaults to a global week with 20 entries and exposes snapshot metadata", async () => {
    mockDb.getLeaderboardSnapshot.mockResolvedValue(snapshot(Array.from({ length: 21 }, (_, i) => row({ user_id: `u${i}` }))));
    const res = await GET(makeGetRequest("/api/leaderboard"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ period: "week", scope: "global", hasMore: true, snapshotId: "snapshot-1", generatedAt: Date.now(), expiresAt: Date.now() + 600_000 });
    expect(body.scopeId).toBeUndefined();
    expect(body.entries).toHaveLength(20);
    expect(mockDb.getLeaderboardSnapshot).toHaveBeenCalledWith({ fromDate: "2026-09-26T10:00:00.000Z" });
  });

  it("omits the date filter for all-time snapshots", async () => {
    await GET(makeGetRequest("/api/leaderboard", { period: "all" }));
    expect(mockDb.getLeaderboardSnapshot).toHaveBeenCalledWith({});
  });

  it("maps full snapshot rows without dropping identity, teams or session totals", async () => {
    const teams = [{ id: "t1", name: "Alpha", logoUrl: "https://example.com/t1.jpg" }, { id: "t2", name: "Beta", logoUrl: null }];
    mockDb.getLeaderboardSnapshot.mockResolvedValue(snapshot([
      row({ nickname: "alice-nick", image: "https://example.com/alice.jpg", teams, session_count: 42, total_duration_seconds: 3600 }),
      row({ user_id: "u2", name: "Bob", slug: null }),
    ]));
    const body = await (await GET(makeGetRequest("/api/leaderboard"))).json();
    expect(body.entries[0]).toEqual({
      rank: 1, user: { id: "u1", name: "alice-nick", image: "https://example.com/alice.jpg", slug: "alice" }, teams,
      total_tokens: 1000, input_tokens: 500, output_tokens: 400, cached_input_tokens: 100, session_count: 42, total_duration_seconds: 3600,
    });
    expect(body.entries[1]).toMatchObject({ rank: 2, user: { name: "Bob", slug: null }, teams: [], session_count: 0, total_duration_seconds: 0 });
    expect(body.hasMore).toBe(false);
  });

  it("returns no entries for an empty snapshot", async () => {
    const body = await (await GET(makeGetRequest("/api/leaderboard"))).json();
    expect(body.entries).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  it("slices one cached full ranking across page sizes, preserving absolute ranks", async () => {
    mockDb.getLeaderboardSnapshot.mockResolvedValue(snapshot(Array.from({ length: 5 }, (_, i) => row({ user_id: `u${i}` }))));
    const first = await (await GET(makeGetRequest("/api/leaderboard", { limit: "2" }))).json();
    const second = await (await GET(makeGetRequest("/api/leaderboard", { limit: "3", offset: "2", snapshot: first.snapshotId }))).json();
    expect(first.entries.map((entry: { rank: number }) => entry.rank)).toEqual([1, 2]);
    expect(first.hasMore).toBe(true);
    expect(second.entries.map((entry: { rank: number }) => entry.rank)).toEqual([3, 4, 5]);
    expect(second.hasMore).toBe(false);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(mockDb.getLeaderboardSnapshot).toHaveBeenCalledTimes(1);
  });

  it("supports offset-only HTTP clients without requiring a snapshot", async () => {
    mockDb.getLeaderboardSnapshot.mockResolvedValue(snapshot([row(), row({ user_id: "u2" })]));
    const res = await GET(makeGetRequest("/api/leaderboard", { offset: "1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).entries[0]).toMatchObject({ rank: 2, user: { id: "u2" } });
  });

  it("rejects a supplied mismatched snapshot without exposing rows", async () => {
    const id = "old-snapshot";
    const res = await GET(makeGetRequest("/api/leaderboard", { snapshot: id, offset: "20" }));
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Leaderboard changed. Restart pagination.", code: "LEADERBOARD_CHANGED" });
  });

  it("rejects old pagination after revocation instead of exposing a cached identity", async () => {
    mockDb.getLeaderboardSnapshot.mockResolvedValueOnce(snapshot([row()]));
    const first = await (await GET(makeGetRequest("/api/leaderboard"))).json();
    mockDb.getLeaderboardRevision.mockResolvedValue("2");
    mockDb.getLeaderboardSnapshot.mockResolvedValue(snapshot([], { revision: "2", id: "snapshot-2" }));
    expect((await GET(makeGetRequest("/api/leaderboard", { snapshot: first.snapshotId, offset: "1" }))).status).toBe(409);
    const restarted = await (await GET(makeGetRequest("/api/leaderboard"))).json();
    expect(restarted.entries).toEqual([]);
    expect(restarted.snapshotId).toBe("snapshot-2");
  });

  it("rejects old pagination when absolute expiry produces a new snapshot", async () => {
    const first = await (await GET(makeGetRequest("/api/leaderboard", { period: "all" }))).json();
    vi.advanceTimersByTime(600_000);
    mockDb.getLeaderboardSnapshot.mockResolvedValue(snapshot([], { id: "snapshot-2" }));
    expect((await GET(makeGetRequest("/api/leaderboard", { period: "all", snapshot: first.snapshotId }))).status).toBe(409);
  });

  it("continues pagination if a refreshed snapshot has the same content ID", async () => {
    const first = await (await GET(makeGetRequest("/api/leaderboard", { period: "all" }))).json();
    vi.advanceTimersByTime(600_000);
    const res = await GET(makeGetRequest("/api/leaderboard", { period: "all", snapshot: first.snapshotId }));
    expect(res.status).toBe(200);
    expect((await res.json()).snapshotId).toBe(first.snapshotId);
    expect(mockDb.getLeaderboardSnapshot).toHaveBeenCalledTimes(2);
  });

  it.each(["team", "org"] as const)("checks live %s membership before every shared cache read", async (scope) => {
    const membership = scope === "team" ? mockDb.checkTeamMembershipExists : mockDb.checkOrgMembership;
    membership.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const params = { [scope]: "scope-id" };
    const first = await GET(makeGetRequest("/api/leaderboard", params));
    expect((await first.json())).toMatchObject({ scope, scopeId: "scope-id" });
    expect(mockDb.getLeaderboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({ [`${scope}Id`]: "scope-id" }));
    const denied = await GET(makeGetRequest("/api/leaderboard", params));
    expect(denied.status).toBe(403);
    expect(membership).toHaveBeenCalledTimes(2);
    expect(membership).toHaveBeenLastCalledWith("scope-id", "test-user");
    expect(mockDb.getLeaderboardRevision).toHaveBeenCalledTimes(4);
    expect(mockDb.getLeaderboardSnapshot).toHaveBeenCalledTimes(1);
  });

  it.each(["team", "org"] as const)("fails closed when %s membership changes while authorization is pending", async (scope) => {
    const membership = scope === "team" ? mockDb.checkTeamMembershipExists : mockDb.checkOrgMembership;
    let finishAuthorization!: (value: boolean) => void;
    membership.mockReturnValueOnce(new Promise<boolean>((resolve) => { finishAuthorization = resolve; }));
    const response = GET(makeGetRequest("/api/leaderboard", { [scope]: "scope-id" }));
    await vi.waitFor(() => expect(membership).toHaveBeenCalledTimes(1));
    expect(mockDb.getLeaderboardRevision).toHaveBeenCalledTimes(1);
    mockDb.getLeaderboardRevision.mockResolvedValue("2");
    mockDb.getLeaderboardSnapshot.mockResolvedValue(snapshot([row()], { revision: "2", id: "snapshot-2" }));
    finishAuthorization(true);
    const res = await response;
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Leaderboard changed. Restart pagination.", code: "LEADERBOARD_CHANGED" });
    membership.mockResolvedValue(false);
    expect((await GET(makeGetRequest("/api/leaderboard", { [scope]: "scope-id" }))).status).toBe(403);
  });

  it.each(["x", "\u4e2d"])("accepts 1024 JS characters intact for model names using %s", async (character) => {
    const model = character.repeat(1024);
    const id = "a".repeat(128);
    mockDb.getLeaderboardSnapshot.mockResolvedValue(snapshot([], { id }));
    expect((await GET(makeGetRequest("/api/leaderboard", { model, snapshot: id, offset: String(Number.MAX_SAFE_INTEGER) }))).status).toBe(200);
    expect(mockDb.getLeaderboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({ model }));
  });

  it.each(["team", "org"] as const)("downgrades anonymous %s requests to global without permission caching", async (scope) => {
    resolveUser.mockResolvedValue(null);
    const res = await GET(makeGetRequest("/api/leaderboard", { [scope]: "scope-id" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ scope: "global" });
    expect(mockDb.getLeaderboardSnapshot.mock.calls[0]?.[0]).not.toHaveProperty(`${scope}Id`);
    expect(mockDb.checkTeamMembershipExists).not.toHaveBeenCalled();
    expect(mockDb.checkOrgMembership).not.toHaveBeenCalled();
  });

  it.each(["team", "org"])("preserves the live admin bypass for %s scopes", async (scope) => {
    vi.mocked(isAdminUser).mockResolvedValue(true);
    const res = await GET(makeGetRequest("/api/leaderboard", { [scope]: "scope-id" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scope, scopeId: "scope-id" });
    expect(mockDb.checkTeamMembershipExists).not.toHaveBeenCalled();
    expect(mockDb.checkOrgMembership).not.toHaveBeenCalled();
  });

  it.each(["claude-code", "codex", "copilot-cli", "gemini-cli", "grok", "hermes", "kosmos", "omp", "opencode", "openclaw", "pi", "pmstudio", "vscode-copilot", "workbuddy", "zcode"])("preserves source filtering for %s", async (source) => {
    mockDb.getLeaderboardSnapshot.mockResolvedValue(snapshot([row({ session_count: 2, total_duration_seconds: 10 })]));
    const res = await GET(makeGetRequest("/api/leaderboard", { source }));
    expect(res.status).toBe(200);
    expect(mockDb.getLeaderboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({ source }));
    expect((await res.json()).entries[0]).toMatchObject({ session_count: 2, total_duration_seconds: 10 });
  });

  it("preserves model-filtered null session statistics", async () => {
    mockDb.getLeaderboardSnapshot.mockResolvedValue(snapshot([row({ session_count: null, total_duration_seconds: null })]));
    const res = await GET(makeGetRequest("/api/leaderboard", { model: "o3" }));
    expect(mockDb.getLeaderboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({ model: "o3" }));
    expect((await res.json()).entries[0]).toMatchObject({ session_count: null, total_duration_seconds: null });
  });

  it.each([{}, { source: "codex" }, { model: "o3" }, { team: "t1", source: "codex" }, { org: "o1" }])("prevents HTTP caching for %j", async (params) => {
    mockDb.checkTeamMembershipExists.mockResolvedValue(true);
    mockDb.checkOrgMembership.mockResolvedValue(true);
    const res = await GET(makeGetRequest("/api/leaderboard", params));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each(["getLeaderboardRevision", "getLeaderboardSnapshot"] as const)("fails closed on %s failure", async (method) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockDb[method].mockRejectedValue(new Error("D1 down"));
    const res = await GET(makeGetRequest("/api/leaderboard"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to load leaderboard" });
  });
});
