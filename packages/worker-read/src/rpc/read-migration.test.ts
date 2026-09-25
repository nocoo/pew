import { describe, expect, it, vi } from "vitest";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { handleSeasonsRpc, type SeasonsRpcRequest } from "./seasons";
import { handleAdminRpc, type AdminRpcRequest } from "./admin";

function mockDb(rows: unknown[] = []) {
  const all = vi.fn().mockResolvedValue({ results: rows });
  const bind = vi.fn().mockReturnValue({ all });
  const prepare = vi.fn().mockReturnValue({ bind, all });
  return { db: { prepare } as unknown as D1Database, prepare, bind };
}

describe("remaining read RPCs", () => {
  it.each([
    ["seasons.listAutoRegisterTeams", { seasonId: "s1" }, [{ id: "t1", created_by: "u1" }], [{ id: "t1", created_by: "u1" }], ["s1"], "auto_register_season = 1"],
    ["seasons.listRosterSyncSeasons", { teamId: "t1" }, [{ season_id: "s1" }], ["s1"], ["t1"], "datetime(s.end_date) >= datetime('now')"],
    ["seasons.getRegisteredTeamIds", { seasonId: "s1" }, [{ team_id: "t1" }], ["t1"], ["s1"], "season_teams"],
    ["seasons.getRosterUserIds", { seasonId: "s1", teamId: "t1" }, [{ user_id: "u1" }], ["u1"], ["s1", "t1"], "season_team_members"],
  ])("%s binds identifiers and returns the roster data", async (method, params, rows, result, bindings, sql) => {
    const mock = mockDb(rows as unknown[]);
    const res = await handleSeasonsRpc({ method, ...params as object } as SeasonsRpcRequest, mock.db, {} as KVNamespace);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result });
    expect(mock.bind).toHaveBeenCalledWith(...bindings as string[]);
    expect(mock.prepare).toHaveBeenCalledWith(expect.stringContaining(sql as string));
  });

  it.each([
    { method: "seasons.listAutoRegisterTeams", seasonId: "" },
    { method: "seasons.listRosterSyncSeasons", teamId: "" },
    { method: "seasons.getRegisteredTeamIds", seasonId: "" },
    { method: "seasons.getRosterUserIds", seasonId: "s1", teamId: "" },
    { method: "seasons.getRosterUserIds", seasonId: "", teamId: "t1" },
  ])("rejects missing roster identifiers: $method", async (request) => {
    const mock = mockDb();
    const res = await handleSeasonsRpc(request as SeasonsRpcRequest, mock.db, {} as KVNamespace);
    expect(res.status).toBe(400);
    expect(mock.prepare).not.toHaveBeenCalled();
  });

  it("looks up selected users without accepting SQL", async () => {
    const rows = [{ id: "u1", name: "Alice", email: "a@test", image: null, slug: "alice" }];
    const mock = mockDb(rows);
    const id = "u1'); DROP TABLE users; --";
    const res = await handleAdminRpc({ method: "admin.getUsersByIds", userIds: [id] } as AdminRpcRequest, mock.db);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: rows });
    expect(mock.prepare).toHaveBeenCalledWith("SELECT id, name, email, image, slug FROM users WHERE id IN (?)");
    expect(mock.bind).toHaveBeenCalledWith(id);
  });

  it.each([0, -480, 330])("groups usage by local day with offset %s and bound filters", async (tzOffset) => {
    const mock = mockDb([{ date: "2026-01-01", user_id: "u1", total_tokens: 42, source: "s", model: "m" }]);
    const res = await handleAdminRpc({ method: "admin.getUsageComparison", userIds: ["u1", "u2"], fromDate: "2026-01-01T00:00:00.000Z", toDate: "2026-02-01T00:00:00.000Z", tzOffset, source: "s' --", model: "m' --" } as AdminRpcRequest, mock.db);
    expect(res.status).toBe(200);
    expect(mock.bind).toHaveBeenCalledWith(String(-tzOffset), "u1", "u2", "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z", "s' --", "m' --");
    const sql = mock.prepare.mock.calls[0]![0];
    expect(sql).toContain("hour_start >= ?");
    expect(sql).toContain("hour_start < ?");
    expect(sql).toContain("GROUP BY date, user_id, source, model");
    expect(sql).not.toContain("s' --");
  });

  it("allows absent comparison filters with UTC grouping", async () => {
    const mock = mockDb();
    const res = await handleAdminRpc({ method: "admin.getUsageComparison", userIds: ["u1"], fromDate: "2026-01-01", toDate: "2026-02-01" } as AdminRpcRequest, mock.db);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: [] });
    expect(mock.bind).toHaveBeenCalledWith("0", "u1", "2026-01-01", "2026-02-01");
  });

  it.each([
    { userIds: [] }, { userIds: "u1" }, { userIds: [1] }, { userIds: [""] },
    { userIds: Array.from({ length: 11 }, () => "u1") },
  ])("rejects invalid user lists", async (params) => {
    for (const method of ["admin.getUsersByIds", "admin.getUsageComparison"]) {
      const mock = mockDb();
      const res = await handleAdminRpc({ method, ...params } as AdminRpcRequest, mock.db);
      expect(res.status).toBe(400);
      expect(mock.prepare).not.toHaveBeenCalled();
    }
  });

  it.each([
    { fromDate: "bad" }, { toDate: "bad" }, { fromDate: null },
    { tzOffset: 841 }, { tzOffset: 0.5 }, { tzOffset: "0); DROP TABLE users" },
    { source: {} }, { model: [] },
  ])("rejects invalid comparison parameters", async (params) => {
    const mock = mockDb();
    const res = await handleAdminRpc({ method: "admin.getUsageComparison", userIds: ["u1"], fromDate: "2026-01-01", toDate: "2026-02-01", ...params } as AdminRpcRequest, mock.db);
    expect(res.status).toBe(400);
    expect(mock.prepare).not.toHaveBeenCalled();
  });
});
