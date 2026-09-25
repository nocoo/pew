import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWorkerDbRead } from "@/lib/db-worker";

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WORKER_READ_URL = "https://pew.test.workers.dev";
  process.env.WORKER_READ_SECRET = "test-secret";
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("createWorkerDbRead", () => {
  it("throws when WORKER_READ_URL is missing", () => {
    delete process.env.WORKER_READ_URL;
    expect(() => createWorkerDbRead()).toThrow("WORKER_READ_URL");
  });

  it("throws when WORKER_READ_SECRET is missing", () => {
    delete process.env.WORKER_READ_SECRET;
    expect(() => createWorkerDbRead()).toThrow("WORKER_READ_SECRET");
  });

  it("exposes typed methods without a SQL escape hatch", () => {
    const db = createWorkerDbRead();
    expect(db).not.toHaveProperty("query");
    expect(db).not.toHaveProperty("firstOrNull");
  });

  it("sends only method parameters to the RPC endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ result: [] }),
    );
    const db = createWorkerDbRead();
    await db.getAdminUsageComparison(["u1", "u2"], "2026-01-01", "2026-02-01", { tzOffset: -480, source: "s", model: "m" });
    expect(fetchSpy).toHaveBeenCalledWith("https://pew.test.workers.dev/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-secret" },
      body: JSON.stringify({ method: "admin.getUsageComparison", userIds: ["u1", "u2"], fromDate: "2026-01-01", toDate: "2026-02-01", tzOffset: -480, source: "s", model: "m" }),
    });
  });

  it.each([
    ["listOrgMembersAdmin", ["o1"], { method: "organizations.listMembersAdmin", orgId: "o1" }],
    ["countOrgMembers", ["o1"], { method: "organizations.countMembers", orgId: "o1" }],
    ["getTeamMemberUserIds", ["t1"], { method: "teams.getMemberUserIds", teamId: "t1" }],
    ["getTeamOwner", ["t1"], { method: "teams.getOwner", teamId: "t1" }],
    ["listAutoRegisterTeams", ["s1"], { method: "seasons.listAutoRegisterTeams", seasonId: "s1" }],
    ["listRosterSyncSeasons", ["t1"], { method: "seasons.listRosterSyncSeasons", teamId: "t1" }],
    ["getRegisteredTeamIds", ["s1"], { method: "seasons.getRegisteredTeamIds", seasonId: "s1" }],
    ["getRosterUserIds", ["s1", "t1"], { method: "seasons.getRosterUserIds", seasonId: "s1", teamId: "t1" }],
    ["getAdminUsersByIds", [["u1"]], { method: "admin.getUsersByIds", userIds: ["u1"] }],
  ] as const)("%s forwards typed identifiers", async (method, args, request) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ result: [] }));
    const db = createWorkerDbRead();
    const call = db[method] as (...args: unknown[]) => Promise<unknown>;
    expect(await call(...args)).toEqual([]);
    expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string)).toEqual(request);
  });

  it.each([
    [Response.json({ error: "RPC failed" }, { status: 500 }), "RPC failed"],
    [new Response("error", { status: 500 }), "Worker returned 500"],
  ])("preserves RPC errors", async (response, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(createWorkerDbRead().getUserById("u1")).rejects.toThrow(message);
  });
});
