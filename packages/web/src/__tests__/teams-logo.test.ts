import { describe, it, expect, vi, beforeEach } from "vitest";
import * as d1Module from "@/lib/d1";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/d1", async (importOriginal) => {
  const original = await importOriginal<typeof d1Module>();
  return { ...original, getD1Client: vi.fn() };
});

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/r2", () => ({
  putTeamLogo: vi.fn(),
  deleteTeamLogoByUrl: vi.fn(),
}));

vi.mock("sharp", () => {
  const mockSharp = vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 200, height: 200 }),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-jpeg")),
  }));
  return { default: mockSharp };
});

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

const { putTeamLogo, deleteTeamLogoByUrl } = (await import("@/lib/r2")) as unknown as {
  putTeamLogo: ReturnType<typeof vi.fn>;
  deleteTeamLogoByUrl: ReturnType<typeof vi.fn>;
};

const sharp = (await import("sharp")).default as unknown as ReturnType<typeof vi.fn>;

function createMockClient() {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    batch: vi.fn(),
    firstOrNull: vi.fn(),
  };
}

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
  return new Request(`http://localhost:7030/api/teams/${teamId}/logo`, {
    method: "POST",
    body: formData,
  });
}

function makeDeleteRequest(teamId: string): Request {
  return new Request(`http://localhost:7030/api/teams/${teamId}/logo`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// POST /api/teams/[teamId]/logo
// ---------------------------------------------------------------------------

describe("POST /api/teams/[teamId]/logo", () => {
  let POST: (req: Request, ctx: { params: Promise<{ teamId: string }> }) => Promise<Response>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client,
    );
    // Reset sharp mock to default (square image)
    vi.mocked(sharp).mockReturnValue({
      metadata: vi.fn().mockResolvedValue({ width: 200, height: 200 }),
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-jpeg")),
    } as never);
    putTeamLogo.mockResolvedValue("https://s.zhe.to/apps/pew/teams-logo/t1/abc123.jpg");
    deleteTeamLogoByUrl.mockResolvedValue(undefined);
    // firstOrNull: first call returns role, second returns old logo_url
    mockClient.firstOrNull.mockResolvedValue(null);
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
    mockClient.firstOrNull.mockResolvedValueOnce(null);

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Not a member");
  });

  it("should reject non-owner with 403", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "member" });

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("owner");
  });

  it("should reject invalid MIME type", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });

    const res = await POST(
      makeUploadRequest("t1", { type: "image/gif" }),
      makeParams(),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("PNG and JPEG");
  });

  it("should reject file exceeding 2 MB", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });

    const res = await POST(
      makeUploadRequest("t1", { size: 3 * 1024 * 1024 }),
      makeParams(),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("too large");
  });

  it("should reject non-square images", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });
    vi.mocked(sharp).mockReturnValue({
      metadata: vi.fn().mockResolvedValue({ width: 200, height: 100 }),
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-jpeg")),
    } as never);

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("square");
  });

  it("should reject invalid image data", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });
    vi.mocked(sharp).mockReturnValue({
      metadata: vi.fn().mockRejectedValue(new Error("Input buffer contains unsupported image format")),
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-jpeg")),
    } as never);

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid image");
  });

  it("should reject images with missing dimensions", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });
    vi.mocked(sharp).mockReturnValue({
      metadata: vi.fn().mockResolvedValue({ width: undefined, height: undefined }),
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-jpeg")),
    } as never);

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("dimensions");
  });

  it("should reject request without file field", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });

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
    // firstOrNull call 1: role check
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });
    // firstOrNull call 2: old logo_url
    mockClient.firstOrNull.mockResolvedValueOnce({ logo_url: oldUrl });

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logo_url).toBe(newUrl);
    expect(putTeamLogo).toHaveBeenCalledOnce();
    expect(putTeamLogo).toHaveBeenCalledWith("t1", expect.any(Buffer));
    // Should persist to DB
    expect(mockClient.execute).toHaveBeenCalledWith(
      "UPDATE teams SET logo_url = ? WHERE id = ?",
      [newUrl, "t1"],
    );
    // Should delete old logo
    expect(deleteTeamLogoByUrl).toHaveBeenCalledWith(oldUrl);
  });

  it("should skip old logo deletion when team had no logo", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    putTeamLogo.mockResolvedValueOnce("https://s.zhe.to/apps/pew/teams-logo/t1/new123.jpg");
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });
    mockClient.firstOrNull.mockResolvedValueOnce({ logo_url: null });

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(200);
    expect(deleteTeamLogoByUrl).not.toHaveBeenCalled();
  });

  it("should return 500 when R2 upload fails", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });
    putTeamLogo.mockRejectedValueOnce(new Error("R2 unavailable"));

    const res = await POST(makeUploadRequest("t1"), makeParams());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Failed to store");
  });

  it("should accept JPEG content type", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });
    mockClient.firstOrNull.mockResolvedValueOnce({ logo_url: null });

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
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client,
    );
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
    mockClient.firstOrNull.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Not a member");
  });

  it("should reject non-owner with 403", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "member" });

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("owner");
  });

  it("should delete successfully, clear DB, and remove R2 object", async () => {
    const logoUrl = "https://s.zhe.to/apps/pew/teams-logo/t1/abc123.jpg";
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    // firstOrNull call 1: role check
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });
    // firstOrNull call 2: current logo_url
    mockClient.firstOrNull.mockResolvedValueOnce({ logo_url: logoUrl });

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // Should clear in DB
    expect(mockClient.execute).toHaveBeenCalledWith(
      "UPDATE teams SET logo_url = NULL WHERE id = ?",
      ["t1"],
    );
    // Should delete from R2
    expect(deleteTeamLogoByUrl).toHaveBeenCalledWith(logoUrl);
  });

  it("should succeed even when team has no logo", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });
    mockClient.firstOrNull.mockResolvedValueOnce({ logo_url: null });

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    expect(res.status).toBe(200);
    expect(deleteTeamLogoByUrl).not.toHaveBeenCalled();
  });

  it("should return 500 when R2 delete fails", async () => {
    resolveUser.mockResolvedValueOnce({ userId: "u1" });
    mockClient.firstOrNull.mockResolvedValueOnce({ role: "owner" });
    mockClient.firstOrNull.mockResolvedValueOnce({ logo_url: "https://s.zhe.to/apps/pew/teams-logo/t1/abc.jpg" });
    deleteTeamLogoByUrl.mockRejectedValueOnce(new Error("R2 unavailable"));

    const res = await DELETE(makeDeleteRequest("t1"), makeParams());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Failed to remove");
  });
});
