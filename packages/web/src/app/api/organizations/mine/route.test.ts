import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { createMockDbRead, makeGetRequest } from "@/__tests__/test-utils";

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: vi.fn(),
}));

import { getDbRead } from "@/lib/db";
import { isAdminUser } from "@/lib/admin";

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
    vi.mocked(isAdminUser).mockResolvedValue(false);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);
    const res = await GET(makeGetRequest("/api/organizations/mine"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("calls listOrganizations (not user-scoped) when caller is admin", async () => {
    vi.mocked(isAdminUser).mockResolvedValueOnce(true);
    mockDbRead.listOrganizations.mockResolvedValueOnce([
      { id: "o1", name: "Acme", slug: "acme", logo_url: "https://x/y.png" },
      { id: "o2", name: "Globex", slug: "globex", logo_url: null },
    ] as never);

    const res = await GET(makeGetRequest("/api/organizations/mine"));

    expect(res.status).toBe(200);
    expect(mockDbRead.listOrganizations).toHaveBeenCalledTimes(1);
    expect(mockDbRead.listUserOrganizations).not.toHaveBeenCalled();
    const body = (await res.json()) as { organizations: Array<{ id: string; name: string; slug: string; logoUrl: string | null }> };
    expect(body.organizations).toEqual([
      { id: "o1", name: "Acme", slug: "acme", logoUrl: "https://x/y.png" },
      { id: "o2", name: "Globex", slug: "globex", logoUrl: null },
    ]);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns mapped memberships for non-admin users", async () => {
    mockDbRead.listUserOrganizations.mockResolvedValueOnce([
      { id: "o3", name: "My Org", slug: "my-org", logo_url: null },
    ] as never);

    const res = await GET(makeGetRequest("/api/organizations/mine"));

    expect(res.status).toBe(200);
    expect(mockDbRead.listUserOrganizations).toHaveBeenCalledWith("u1");
    expect(mockDbRead.listOrganizations).not.toHaveBeenCalled();
    const body = (await res.json()) as { organizations: Array<{ id: string }> };
    expect(body.organizations).toEqual([
      { id: "o3", name: "My Org", slug: "my-org", logoUrl: null },
    ]);
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
