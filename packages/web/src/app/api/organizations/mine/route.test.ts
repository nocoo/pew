import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { createMockDbRead, makeGetRequest } from "@/__tests__/test-utils";

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

import { getDbRead } from "@/lib/db";

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

describe("GET /api/organizations/mine error handling", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(resolveUser).mockResolvedValue({ userId: "u1" });
  });

  it("returns empty organizations array when table is missing", async () => {
    mockDbRead.listUserOrganizations.mockRejectedValueOnce(
      new Error("no such table: organizations"),
    );

    const res = await GET(makeGetRequest("/api/organizations/mine"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ organizations: [] });
  });

  it("returns 500 for unexpected database failures", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDbRead.listUserOrganizations.mockRejectedValueOnce(
      new Error("connection refused"),
    );

    const res = await GET(makeGetRequest("/api/organizations/mine"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Failed to list organizations",
    });
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
