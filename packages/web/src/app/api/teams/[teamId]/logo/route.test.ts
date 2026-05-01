import { beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "@/lib/db";
import { POST, DELETE } from "./route";
import { createMockDbRead, createMockDbWrite, loadMockedAuthHelpers } from "@/__tests__/test-utils";

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/r2", () => ({
  putTeamLogo: vi.fn(),
  deleteTeamLogoByUrl: vi.fn(),
}));

vi.mock("sharp", () => {
  const mockSharp = vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-jpeg")),
  }));
  return { default: mockSharp };
});

const { resolveUser } = await loadMockedAuthHelpers();

const { putTeamLogo, deleteTeamLogoByUrl } = (await import("@/lib/r2")) as unknown as {
  putTeamLogo: ReturnType<typeof vi.fn>;
  deleteTeamLogoByUrl: ReturnType<typeof vi.fn>;
};

function makeParams(teamId = "t1") {
  return { params: Promise.resolve({ teamId }) };
}

function makeUploadRequest(teamId: string): Request {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(100)], { type: "image/png" });
  const file = new File([blob], "logo.png", { type: "image/png" });
  formData.append("file", file);

  return new Request(`http://localhost:7020/api/teams/${teamId}/logo`, {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/teams/[teamId]/logo route edge cases", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    vi.mocked(resolveUser).mockResolvedValue({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValue("owner");
    mockDbWrite.execute.mockResolvedValue(undefined);
    vi.mocked(putTeamLogo).mockResolvedValue(
      "https://cdn.example.com/teams/t1/new-logo.jpg",
    );
    vi.mocked(deleteTeamLogoByUrl).mockResolvedValue(undefined);
  });

  it("returns 401 when POST is unauthenticated", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when DELETE is unauthenticated", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const req = new Request("http://localhost:7020/api/teams/t1/logo", {
      method: "DELETE",
    });
    const res = await DELETE(req, makeParams());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when multipart form parsing fails", async () => {
    const badRequest = {
      formData: vi.fn().mockRejectedValue(new Error("bad multipart")),
    } as unknown as Request;

    const res = await POST(badRequest, makeParams());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Expected multipart/form-data",
    });
  });

  it("returns 500 and logs when cleanup of the uploaded logo also fails", async () => {
    const newLogoUrl = "https://cdn.example.com/teams/t1/new-logo.jpg";
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(putTeamLogo).mockResolvedValueOnce(newLogoUrl);
    mockDbRead.getTeamLogoUrl.mockRejectedValueOnce(new Error("D1 down"));
    vi.mocked(deleteTeamLogoByUrl).mockRejectedValueOnce(
      new Error("R2 unavailable"),
    );

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to save logo" });
    expect(consoleSpy).toHaveBeenCalledWith(
      "Compensating R2 delete also failed for:",
      newLogoUrl,
    );

    consoleSpy.mockRestore();
  });

  it("still succeeds when deleting the previous logo fails", async () => {
    const oldLogoUrl = "https://cdn.example.com/teams/t1/old-logo.jpg";
    const newLogoUrl = "https://cdn.example.com/teams/t1/new-logo.jpg";

    vi.mocked(putTeamLogo).mockResolvedValueOnce(newLogoUrl);
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce(oldLogoUrl);
    vi.mocked(deleteTeamLogoByUrl).mockRejectedValueOnce(
      new Error("old logo delete failed"),
    );

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logoUrl: newLogoUrl });
    expect(mockDbWrite.execute).toHaveBeenCalledWith(
      "UPDATE teams SET logo_url = ? WHERE id = ?",
      [newLogoUrl, "t1"],
    );
  });
});
