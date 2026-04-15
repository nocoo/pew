import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDbRead, createMockDbWrite } from "./test-utils";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

import * as dbModule from "@/lib/db";

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

const { putTeamLogo, deleteTeamLogoByUrl } = (await import("@/lib/r2")) as unknown as {
  putTeamLogo: ReturnType<typeof vi.fn>;
  deleteTeamLogoByUrl: ReturnType<typeof vi.fn>;
};

const sharp = (await import("sharp")).default as unknown as ReturnType<typeof vi.fn>;

function makeParams(teamId = "t1") {
  return { params: Promise.resolve({ teamId }) };
}

/** Create a fake File wrapped in multipart FormData */
function makeUploadRequest(
  teamId: string,
  options?: { type?: string; size?: number; body?: FormData },
): Request {
  const formData = options?.body ?? new FormData();
  if (!options?.body) {
    const blob = new Blob(
      [new Uint8Array(options?.size ?? 100)],
      { type: options?.type ?? "image/png" },
    );
    const file = new File([blob], "logo.png", { type: options?.type ?? "image/png" });
    formData.append("file", file);
  }
  return new Request(`http://localhost:7020/api/teams/${teamId}/logo`, {
    method: "POST",
    body: formData,
  });
}

function makeDeleteRequest(teamId: string): Request {
  return new Request(`http://localhost:7020/api/teams/${teamId}/logo`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// POST /api/teams/[teamId]/logo
// ---------------------------------------------------------------------------

describe("POST /api/teams/[teamId]/logo", () => {
  let POST: (req: Request, ctx: { params: Promise<{ teamId: string }> }) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    // Reset sharp mock to default
    vi.mocked(sharp).mockReturnValue({
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-jpeg")),
    } as never);
    putTeamLogo.mockResolvedValue("https://s.zhe.to/apps/pew/teams-logo/t1/abc123.jpg");
    deleteTeamLogoByUrl.mockResolvedValue(undefined);
    mockDbRead.getTeamMembership.mockResolvedValue(null);
    mockDbRead.getTeamLogoUrl.mockResolvedValue(null);
    const mod = await import("@/app/api/teams/[teamId]/logo/route");
    POST = mod.POST;
  });

  it("should reject unauthenticated with 401", async () => {
    resolveUser.mockResolvedValueOnce(null);

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(401);
  });

  it("should reject non-member with 403", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce(null);

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Not a member");
  });

  it("should reject non-owner with 403", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member");

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("owner");
  });

  it("should reject invalid MIME type", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");

    const res = await POST(
      makeUploadRequest("t1", { type: "image/gif" }),
      makeParams(),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("PNG and JPEG");
  });

  it("should reject file exceeding 2 MB", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");

    const res = await POST(
      makeUploadRequest("t1", { size: 3 * 1024 * 1024 }),
      makeParams(),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("too large");
  });

  it("should accept non-square images (center-crop to 256x256)", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce(null);
    mockDbWrite.execute.mockResolvedValueOnce(undefined);
    vi.mocked(putTeamLogo).mockResolvedValueOnce("https://cdn.example.com/new.jpg");

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logoUrl).toBe("https://cdn.example.com/new.jpg");
  });

  it("should reject invalid image data", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    vi.mocked(sharp).mockReturnValue({
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockRejectedValue(new Error("Input buffer contains unsupported image format")),
    } as never);

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid image");
  });

  it("should reject request without file field", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");

    const formData = new FormData();
    // No file appended
    const res = await POST(
      makeUploadRequest("t1", { body: formData }),
      makeParams(),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Missing file");
  });

  it("should upload successfully, persist URL to DB, and delete old logo", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    const newUrl = "https://s.zhe.to/apps/pew/teams-logo/t1/new123.jpg";
    const oldUrl = "https://s.zhe.to/apps/pew/teams-logo/t1/old456.jpg";
    putTeamLogo.mockResolvedValueOnce(newUrl);
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce(oldUrl);

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logoUrl).toBe(newUrl);
    expect(putTeamLogo).toHaveBeenCalledOnce();
    expect(putTeamLogo).toHaveBeenCalledWith("t1", expect.any(Buffer));
    // Should persist to DB
    expect(mockDbWrite.execute).toHaveBeenCalledWith(
      "UPDATE teams SET logo_url = ? WHERE id = ?",
      [newUrl, "t1"],
    );
    // Should delete old logo
    expect(deleteTeamLogoByUrl).toHaveBeenCalledWith(oldUrl);
  });

  it("should skip old logo deletion when team had no logo", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    putTeamLogo.mockResolvedValueOnce("https://s.zhe.to/apps/pew/teams-logo/t1/new123.jpg");
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce(null);

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(200);
    expect(deleteTeamLogoByUrl).not.toHaveBeenCalled();
  });

  it("should return 500 and compensate-delete R2 object when getTeamLogoUrl fails after upload", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    const newUrl = "https://s.zhe.to/apps/pew/teams-logo/t1/new123.jpg";
    putTeamLogo.mockResolvedValueOnce(newUrl);
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamLogoUrl.mockRejectedValueOnce(new Error("D1 down"));

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Failed to save");
    // Should compensate by deleting the just-uploaded R2 object
    expect(deleteTeamLogoByUrl).toHaveBeenCalledWith(newUrl);
  });

  it("should return 500 and compensate-delete R2 object when DB UPDATE fails after upload", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    const newUrl = "https://s.zhe.to/apps/pew/teams-logo/t1/new123.jpg";
    putTeamLogo.mockResolvedValueOnce(newUrl);
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce(null);
    // execute: UPDATE fails
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 write failed"));

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Failed to save");
    // Should compensate by deleting the just-uploaded R2 object
    expect(deleteTeamLogoByUrl).toHaveBeenCalledWith(newUrl);
  });

  it("should return 500 when R2 upload fails", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    putTeamLogo.mockRejectedValueOnce(new Error("R2 unavailable"));

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Failed to store");
  });

  it("should accept JPEG content type", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce(null);

    const res = await POST(
      makeUploadRequest("t1", { type: "image/jpeg" }),
      makeParams(),
    );

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/teams/[teamId]/logo
// ---------------------------------------------------------------------------

describe("DELETE /api/teams/[teamId]/logo", () => {
  let DELETE: (req: Request, ctx: { params: Promise<{ teamId: string }> }) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(mockDbWrite as never);
    deleteTeamLogoByUrl.mockResolvedValue(undefined);
    const mod = await import("@/app/api/teams/[teamId]/logo/route");
    DELETE = mod.DELETE;
  });

  it("should reject unauthenticated with 401", async () => {
    resolveUser.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    expect(res.status).toBe(401);
  });

  it("should reject non-member with 403", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Not a member");
  });

  it("should reject non-owner with 403", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("member");

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("owner");
  });

  it("should delete successfully, clear DB, and remove R2 object", async () => {
    const logoUrl = "https://s.zhe.to/apps/pew/teams-logo/t1/abc123.jpg";
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce(logoUrl);

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // Should clear in DB
    expect(mockDbWrite.execute).toHaveBeenCalledWith(
      "UPDATE teams SET logo_url = NULL WHERE id = ?",
      ["t1"],
    );
    // Should delete from R2
    expect(deleteTeamLogoByUrl).toHaveBeenCalledWith(logoUrl);
  });

  it("should succeed even when team has no logo", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    expect(res.status).toBe(200);
    expect(deleteTeamLogoByUrl).not.toHaveBeenCalled();
  });

  it("should return 200 when R2 delete fails (DB still cleared, storage leak tolerable)", async () => {
    const logoUrl = "https://s.zhe.to/apps/pew/teams-logo/t1/abc.jpg";
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce(logoUrl);
    deleteTeamLogoByUrl.mockRejectedValueOnce(new Error("R2 unavailable"));

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    // Should still succeed — DB is the authoritative state
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // Should have attempted R2 delete
    expect(deleteTeamLogoByUrl).toHaveBeenCalledWith(logoUrl);
    // Should have cleared DB before attempting R2 delete
    expect(mockDbWrite.execute).toHaveBeenCalledWith(
      "UPDATE teams SET logo_url = NULL WHERE id = ?",
      ["t1"],
    );
  });

  it("should return 500 when DB UPDATE fails, leaving R2 object untouched", async () => {
    const logoUrl = "https://s.zhe.to/apps/pew/teams-logo/t1/abc.jpg";
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getTeamMembership.mockResolvedValueOnce("owner");
    mockDbRead.getTeamLogoUrl.mockResolvedValueOnce(logoUrl);
    mockDbWrite.execute.mockRejectedValueOnce(new Error("D1 write failed"));

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Failed to remove");
    // R2 object should NOT have been deleted (DB still references it)
    expect(deleteTeamLogoByUrl).not.toHaveBeenCalled();
  });
});
