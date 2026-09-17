import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/cli-upgrade-notice/route";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbWrite } from "@/lib/db";
import { createMockDbWrite, makeJsonRequest } from "./test-utils";

vi.mock("@/lib/auth-helpers", () => ({ resolveUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDbWrite: vi.fn() }));

describe("CLI 3.0 upgrade notice", () => {
  let db: DatabaseSync;
  let dbWrite: ReturnType<typeof createMockDbWrite>;
  const request = (body = {}) => makeJsonRequest("POST", "/api/cli-upgrade-notice", body);

  beforeEach(() => {
    vi.clearAllMocks();
    db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('alice'), ('bob');");
    db.exec(readFileSync(resolve("scripts/migrations/027-cli-upgrade-notice.sql"), "utf8"));
    dbWrite = createMockDbWrite();
    dbWrite.execute.mockImplementation(async (sql: string, params: SQLInputValue[] = []) => ({
      changes: Number(db.prepare(sql).run(...params).changes),
      duration: 0,
    }));
    vi.mocked(getDbWrite).mockResolvedValue(dbWrite);
    vi.mocked(resolveUser).mockResolvedValue({ userId: "alice" });
  });

  afterEach(() => db.close());

  it("requires authentication before accessing notice state", async () => {
    vi.mocked(resolveUser).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(getDbWrite).not.toHaveBeenCalled();
  });

  it("shows the notice once for the account, including subsequent browsers", async () => {
    const first = await POST(request());
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await first.json()).toEqual({ show: true });
    expect(await (await POST(request())).json()).toEqual({ show: false });
    expect(db.prepare("SELECT cli_upgrade_notice_seen_at FROM users WHERE id = 'alice'").get())
      .toEqual({ cli_upgrade_notice_seen_at: expect.any(String) });
  });

  it("only lets one concurrent dashboard claim the notice", async () => {
    const responses = await Promise.all([POST(request()), POST(request())]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies.filter((body) => body.show)).toHaveLength(1);
  });

  it("keeps each account independent and ignores a supplied user ID", async () => {
    expect(await (await POST(request({ userId: "bob" }))).json()).toEqual({ show: true });
    vi.mocked(resolveUser).mockResolvedValue({ userId: "bob" });
    expect(await (await POST(request())).json()).toEqual({ show: true });
    expect(await (await POST(request())).json()).toEqual({ show: false });
  });

  it("does not rewrite the seen timestamp on subsequent visits", async () => {
    db.prepare("UPDATE users SET cli_upgrade_notice_seen_at = ? WHERE id = ?").run("2026-09-18 00:00:00", "alice");
    expect(await (await POST(request())).json()).toEqual({ show: false });
    expect(db.prepare("SELECT cli_upgrade_notice_seen_at FROM users WHERE id = 'alice'").get())
      .toEqual({ cli_upgrade_notice_seen_at: "2026-09-18 00:00:00" });
  });

  it("does not claim a notice for a deleted account", async () => {
    vi.mocked(resolveUser).mockResolvedValue({ userId: "deleted" });
    expect(await (await POST(request())).json()).toEqual({ show: false });
  });

  it("returns a fixed error when storage is unavailable and can recover on the next visit", async () => {
    dbWrite.execute.mockRejectedValueOnce(new Error("PRIVATE database error"));
    const failed = await POST(request());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "Could not load CLI upgrade notice" });
    expect(await (await POST(request())).json()).toEqual({ show: true });
  });
});
