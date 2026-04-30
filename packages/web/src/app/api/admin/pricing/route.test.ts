import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST, PUT, DELETE } from "./route";
import {
  createMockDbRead,
  createMockDbWrite,
  makeJsonRequest,
  makeGetRequest,
} from "@/__tests__/test-utils";

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  resolveAdmin: vi.fn(),
}));

import { getDbRead, getDbWrite } from "@/lib/db";
import { resolveAdmin } from "@/lib/admin";

const ROW = {
  id: 1,
  model: "claude-x",
  input: 3,
  output: 15,
  cached: 0.3,
  source: null,
  note: null,
  updated_at: "2026-04-30T00:00:00.000Z",
};

describe("admin pricing CRUD side-effects", () => {
  let dbRead: ReturnType<typeof createMockDbRead>;
  let dbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    dbRead = createMockDbRead();
    dbWrite = createMockDbWrite();
    vi.mocked(getDbRead).mockResolvedValue(dbRead as never);
    vi.mocked(getDbWrite).mockResolvedValue(dbWrite as never);
    vi.mocked(resolveAdmin).mockResolvedValue({ userId: "u1", email: "admin@example.com" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  // --- POST -----------------------------------------------------------------

  it("POST → after successful insert runs invalidate + rebuild side-effects", async () => {
    dbWrite.execute.mockResolvedValueOnce({ changes: 1, lastInsertRowId: 1 });
    dbWrite.batch.mockResolvedValueOnce([{ results: [ROW], meta: { changes: 0, duration: 0 } }]);

    const res = await POST(
      makeJsonRequest("POST", "/api/admin/pricing", {
        model: "claude-x",
        input: 3,
        output: 15,
      }),
    );
    expect(res.status).toBe(201);
    expect(dbRead.invalidateCacheKey).toHaveBeenCalledWith("pricing:all");
    expect(dbRead.rebuildDynamicPricing).toHaveBeenCalledTimes(1);
    expect(dbRead.rebuildDynamicPricing).toHaveBeenCalledWith({ forceRefetch: false });
  });

  it("POST → does not run side-effects on validation failure (400)", async () => {
    const res = await POST(
      makeJsonRequest("POST", "/api/admin/pricing", { input: 1, output: 1 }),
    );
    expect(res.status).toBe(400);
    expect(dbRead.invalidateCacheKey).not.toHaveBeenCalled();
    expect(dbRead.rebuildDynamicPricing).not.toHaveBeenCalled();
  });

  it("POST → tolerates rebuild rejection (allSettled): still returns 201", async () => {
    dbWrite.execute.mockResolvedValueOnce({ changes: 1, lastInsertRowId: 1 });
    dbWrite.batch.mockResolvedValueOnce([{ results: [ROW], meta: { changes: 0, duration: 0 } }]);
    dbRead.rebuildDynamicPricing.mockRejectedValueOnce(new Error("worker-read down"));

    const res = await POST(
      makeJsonRequest("POST", "/api/admin/pricing", {
        model: "claude-x",
        input: 3,
        output: 15,
      }),
    );
    expect(res.status).toBe(201);
    expect(dbRead.invalidateCacheKey).toHaveBeenCalled();
  });

  // --- PUT ------------------------------------------------------------------

  it("PUT → after successful update runs invalidate + rebuild", async () => {
    dbWrite.execute.mockResolvedValueOnce({ changes: 1 });
    dbWrite.batch.mockResolvedValueOnce([{ results: [ROW], meta: { changes: 0, duration: 0 } }]);

    const res = await PUT(
      makeJsonRequest("PUT", "/api/admin/pricing", { id: 1, input: 4 }),
    );
    expect(res.status).toBe(200);
    expect(dbRead.invalidateCacheKey).toHaveBeenCalledWith("pricing:all");
    expect(dbRead.rebuildDynamicPricing).toHaveBeenCalledTimes(1);
  });

  it("PUT → does not run side-effects when 404 (changes=0)", async () => {
    dbWrite.execute.mockResolvedValueOnce({ changes: 0 });
    const res = await PUT(
      makeJsonRequest("PUT", "/api/admin/pricing", { id: 999, input: 4 }),
    );
    expect(res.status).toBe(404);
    expect(dbRead.invalidateCacheKey).not.toHaveBeenCalled();
    expect(dbRead.rebuildDynamicPricing).not.toHaveBeenCalled();
  });

  // --- DELETE ---------------------------------------------------------------

  it("DELETE → after successful delete runs invalidate + rebuild", async () => {
    dbWrite.execute.mockResolvedValueOnce({ changes: 1 });

    const res = await DELETE(makeGetRequest("/api/admin/pricing", { id: "1" }));
    expect(res.status).toBe(200);
    expect(dbRead.invalidateCacheKey).toHaveBeenCalledWith("pricing:all");
    expect(dbRead.rebuildDynamicPricing).toHaveBeenCalledTimes(1);
  });

  it("DELETE → does not run side-effects when 404", async () => {
    dbWrite.execute.mockResolvedValueOnce({ changes: 0 });
    const res = await DELETE(makeGetRequest("/api/admin/pricing", { id: "999" }));
    expect(res.status).toBe(404);
    expect(dbRead.invalidateCacheKey).not.toHaveBeenCalled();
    expect(dbRead.rebuildDynamicPricing).not.toHaveBeenCalled();
  });

  it("DELETE → tolerates invalidate rejection (allSettled)", async () => {
    dbWrite.execute.mockResolvedValueOnce({ changes: 1 });
    (dbRead.invalidateCacheKey as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("kv 503"),
    );

    const res = await DELETE(makeGetRequest("/api/admin/pricing", { id: "1" }));
    expect(res.status).toBe(200);
    expect(dbRead.rebuildDynamicPricing).toHaveBeenCalled();
  });

  // --- Auth -----------------------------------------------------------------

  it("POST → returns 403 when not admin (no DB calls)", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce(null);
    const res = await POST(
      makeJsonRequest("POST", "/api/admin/pricing", { model: "x", input: 1, output: 1 }),
    );
    expect(res.status).toBe(403);
    expect(dbWrite.execute).not.toHaveBeenCalled();
  });
});
