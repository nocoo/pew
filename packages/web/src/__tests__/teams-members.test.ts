import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetTeamMembership = vi.fn();
const mockCheckTeamMembershipExists = vi.fn();
const mockExecute = vi.fn();
const mockSyncSeasonRosters = vi.fn();
const mockResolveUser = vi.fn();

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: (...args: unknown[]) => mockResolveUser(...args),
}));

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(() =>
    Promise.resolve({
      getTeamMembership: mockGetTeamMembership,
      checkTeamMembershipExists: mockCheckTeamMembershipExists,
    }),
  ),
  getDbWrite: vi.fn(() => Promise.resolve({ execute: mockExecute })),
}));

vi.mock("@/lib/season-roster", () => ({
  syncSeasonRosters: (...args: unknown[]) => mockSyncSeasonRosters(...args),
}));

import { DELETE } from "@/app/api/teams/[teamId]/members/[userId]/route";

describe("DELETE /api/teams/[teamId]/members/[userId]", () => {
  function createRequest() {
    return new Request("http://localhost/api/teams/team-1/members/user-2", {
      method: "DELETE",
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockResolveUser.mockResolvedValue(null);

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ teamId: "team-1", userId: "user-2" }),
    });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should return 400 when trying to kick yourself", async () => {
    mockResolveUser.mockResolvedValue({ userId: "user-1" });

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ teamId: "team-1", userId: "user-1" }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("leave endpoint");
  });

  it("should return 403 when not a member of the team", async () => {
    mockResolveUser.mockResolvedValue({ userId: "user-1" });
    mockGetTeamMembership.mockResolvedValue(null);

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ teamId: "team-1", userId: "user-2" }),
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Not a member");
  });

  it("should return 403 when not the owner", async () => {
    mockResolveUser.mockResolvedValue({ userId: "user-1" });
    mockGetTeamMembership.mockResolvedValue("member");

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ teamId: "team-1", userId: "user-2" }),
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("owner");
  });

  it("should return 404 when target user is not a member", async () => {
    mockResolveUser.mockResolvedValue({ userId: "user-1" });
    mockGetTeamMembership.mockResolvedValue("owner"); // caller is owner
    mockCheckTeamMembershipExists.mockResolvedValue(false); // target not found

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ teamId: "team-1", userId: "user-2" }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("User is not a member");
  });

  it("should successfully kick a member", async () => {
    mockResolveUser.mockResolvedValue({ userId: "user-1" });
    mockGetTeamMembership.mockResolvedValue("owner"); // caller is owner
    mockCheckTeamMembershipExists.mockResolvedValue(true); // target is member
    mockExecute.mockResolvedValue({ success: true });
    mockSyncSeasonRosters.mockResolvedValue(undefined);

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ teamId: "team-1", userId: "user-2" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(mockExecute).toHaveBeenCalled();
    expect(mockSyncSeasonRosters).toHaveBeenCalled();
  });

  it("should continue even if season roster sync fails", async () => {
    mockResolveUser.mockResolvedValue({ userId: "user-1" });
    mockGetTeamMembership.mockResolvedValue("owner");
    mockCheckTeamMembershipExists.mockResolvedValue(true);
    mockExecute.mockResolvedValue({ success: true });
    mockSyncSeasonRosters.mockRejectedValue(new Error("Sync failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ teamId: "team-1", userId: "user-2" }),
    });

    expect(response.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should return 500 on unexpected error", async () => {
    mockResolveUser.mockResolvedValue({ userId: "user-1" });
    mockGetTeamMembership.mockRejectedValue(new Error("DB down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ teamId: "team-1", userId: "user-2" }),
    });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain("Failed to remove member");
    consoleSpy.mockRestore();
  });
});
