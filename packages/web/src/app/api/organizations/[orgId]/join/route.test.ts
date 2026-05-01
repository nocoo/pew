import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { createMockDbRead, createMockDbWrite } from "@/__tests__/test-utils";
import * as dbModule from "@/lib/db";

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

function makeParams(orgId = "org1") {
  return { params: Promise.resolve({ orgId }) };
}

describe("POST /api/organizations/[orgId]/join error handling", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    vi.mocked(resolveUser).mockResolvedValue({ userId: "u1" });
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const req = new Request("http://localhost/api/organizations/org1/join", {
      method: "POST",
    });
    const res = await POST(req, makeParams());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 503 when table is missing", async () => {
    mockDbRead.getOrganizationById.mockRejectedValueOnce(
      new Error("no such table: organizations"),
    );

    const req = new Request("http://localhost/api/organizations/org1/join", {
      method: "POST",
    });
    const res = await POST(req, makeParams());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Organization tables not yet migrated",
    });
  });

  it("returns 500 for unexpected database failures", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDbRead.getOrganizationById.mockRejectedValueOnce(
      new Error("connection refused"),
    );

    const req = new Request("http://localhost/api/organizations/org1/join", {
      method: "POST",
    });
    const res = await POST(req, makeParams());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Failed to join organization",
    });
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
