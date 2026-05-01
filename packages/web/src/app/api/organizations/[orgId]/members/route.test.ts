import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { createMockDbRead, loadMockedAuthHelpers, makeGetRequest } from "@/__tests__/test-utils";
import * as dbModule from "@/lib/db";

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

const { resolveUser } = await loadMockedAuthHelpers();

function makeParams(orgId = "org1") {
  return { params: Promise.resolve({ orgId }) };
}

describe("GET /api/organizations/[orgId]/members error handling", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(resolveUser).mockResolvedValue({ userId: "u1" });
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const req = makeGetRequest("/api/organizations/org1/members");
    const res = await GET(req, makeParams());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 503 when table is missing", async () => {
    mockDbRead.firstOrNull.mockRejectedValueOnce(
      new Error("no such table: organizations"),
    );

    const req = makeGetRequest("/api/organizations/org1/members");
    const res = await GET(req, makeParams());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Organization tables not yet migrated",
    });
  });

  it("returns 500 for unexpected database failures", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDbRead.firstOrNull.mockRejectedValueOnce(
      new Error("connection refused"),
    );

    const req = makeGetRequest("/api/organizations/org1/members");
    const res = await GET(req, makeParams());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Failed to list members",
    });
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
