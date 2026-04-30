import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { createMockDbRead, makeJsonRequest } from "@/__tests__/test-utils";
import type { SyncOutcomeDto } from "@/lib/rpc-types";

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  resolveAdmin: vi.fn(),
}));

import { getDbRead } from "@/lib/db";
import { resolveAdmin } from "@/lib/admin";

const META = {
  lastSyncedAt: "2026-04-30T00:00:00.000Z",
  modelCount: 12,
  baselineCount: 14,
  openRouterCount: 8,
  modelsDevCount: 6,
  lastErrors: null,
};

const OK_OUTCOME: SyncOutcomeDto = {
  ok: true,
  entriesWritten: 12,
  warnings: [],
  errors: [],
  meta: META,
};

const PARTIAL_OUTCOME: SyncOutcomeDto = {
  ok: false,
  entriesWritten: 9,
  warnings: [],
  errors: [{ source: "openrouter", message: "HTTP 503" }],
  meta: { ...META, lastErrors: [{ source: "openrouter", at: META.lastSyncedAt, message: "HTTP 503" }] },
};

describe("POST /api/admin/pricing/rebuild", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(resolveAdmin).mockResolvedValue({ userId: "u1", email: "admin@example.com" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns 403 when not admin", async () => {
    vi.mocked(resolveAdmin).mockResolvedValueOnce(null);
    const res = await POST(makeJsonRequest("POST", "/api/admin/pricing/rebuild"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(mockDbRead.rebuildDynamicPricing).not.toHaveBeenCalled();
  });

  it("returns 200 + outcome on full success and forwards forceRefetch=true", async () => {
    mockDbRead.rebuildDynamicPricing.mockResolvedValueOnce(OK_OUTCOME as never);
    const res = await POST(makeJsonRequest("POST", "/api/admin/pricing/rebuild"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OK_OUTCOME);
    expect(mockDbRead.rebuildDynamicPricing).toHaveBeenCalledWith({ forceRefetch: true });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns 207 Multi-Status on partial failure", async () => {
    mockDbRead.rebuildDynamicPricing.mockResolvedValueOnce(PARTIAL_OUTCOME as never);
    const res = await POST(makeJsonRequest("POST", "/api/admin/pricing/rebuild"));
    expect(res.status).toBe(207);
    const body = (await res.json()) as SyncOutcomeDto;
    expect(body.ok).toBe(false);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.source).toBe("openrouter");
  });

  it("returns 502 + { error, fallback: null } when RPC throws", async () => {
    mockDbRead.rebuildDynamicPricing.mockRejectedValueOnce(new Error("worker-read down"));
    const res = await POST(makeJsonRequest("POST", "/api/admin/pricing/rebuild"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "worker-read down", fallback: null });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
