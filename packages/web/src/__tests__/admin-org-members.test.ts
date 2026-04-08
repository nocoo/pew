/**
 * Tests for admin organization member management APIs:
 * - GET/POST /api/admin/organizations/[orgId]/members
 * - DELETE /api/admin/organizations/[orgId]/members/[userId]
 * - POST/DELETE /api/admin/organizations/[orgId]/logo
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/admin/organizations/[orgId]/members/route";
import { DELETE } from "@/app/api/admin/organizations/[orgId]/members/[userId]/route";
import { POST as UPLOAD_LOGO, DELETE as DELETE_LOGO } from "@/app/api/admin/organizations/[orgId]/logo/route";

// Mock admin resolver
vi.mock("@/lib/admin", () => ({
  resolveAdmin: vi.fn(),
}));

// Mock database
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

// Mock R2
vi.mock("@/lib/r2", () => ({
  putOrgLogo: vi.fn(),
  deleteOrgLogoByUrl: vi.fn(),
}));

// Mock sharp
vi.mock("sharp", () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("jpeg-image")),
  })),
}));

import { resolveAdmin } from "@/lib/admin";
import { getDbRead, getDbWrite } from "@/lib/db";
import { putOrgLogo, deleteOrgLogoByUrl } from "@/lib/r2";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

function makeJsonRequest(method: string, body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost/api/admin/organizations/org-1/members", init);
}

function makeParams(orgId: string): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) };
}

function makeDeleteParams(orgId: string, userId: string): { params: Promise<{ orgId: string; userId: string }> } {
  return { params: Promise.resolve({ orgId, userId }) };
}

const ADMIN = { userId: "admin-1", email: "admin@example.com" };

describe("admin organization member management", () => {
  const mockDbRead = {
    firstOrNull: vi.fn(),
    query: vi.fn(),
  };
  const mockDbWrite = {
    execute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(getDbWrite).mockResolvedValue(mockDbWrite as never);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/organizations/[orgId]/members
  // -------------------------------------------------------------------------

  describe("GET /api/admin/organizations/[orgId]/members", () => {
    it("should return 403 for non-admin users", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(null);

      const res = await GET(makeJsonRequest("GET"), makeParams("org-1"));
      expect(res.status).toBe(403);
    });

    it("should return 404 if org not found", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce(null);

      const res = await GET(makeJsonRequest("GET"), makeParams("org-1"));
      expect(res.status).toBe(404);
    });

    it("should return members list", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce({ id: "org-1" });
      mockDbRead.query.mockResolvedValueOnce({
        results: [
          {
            id: "mem-1",
            org_id: "org-1",
            user_id: "u1",
            joined_at: "2026-01-01T00:00:00Z",
            user_name: "Alice",
            user_email: "alice@example.com",
            user_image: null,
            user_slug: "alice",
          },
        ],
      });

      const res = await GET(makeJsonRequest("GET"), makeParams("org-1"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.members).toHaveLength(1);
      expect(json.members[0].user.name).toBe("Alice");
    });

    it("should return 503 if table not migrated", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("no such table"));

      const res = await GET(makeJsonRequest("GET"), makeParams("org-1"));
      expect(res.status).toBe(503);
    });

    it("should return 500 on unexpected error", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("DB failed"));

      const res = await GET(makeJsonRequest("GET"), makeParams("org-1"));
      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/organizations/[orgId]/members
  // -------------------------------------------------------------------------

  describe("POST /api/admin/organizations/[orgId]/members", () => {
    it("should return 403 for non-admin users", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(null);

      const res = await POST(
        makeJsonRequest("POST", { userId: "u1" }),
        makeParams("org-1"),
      );
      expect(res.status).toBe(403);
    });

    it("should return 400 for invalid JSON", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);

      const req = new Request("http://localhost/api/admin/organizations/org-1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      const res = await POST(req, makeParams("org-1"));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid JSON");
    });

    it("should return 400 if userId missing", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);

      const res = await POST(makeJsonRequest("POST", {}), makeParams("org-1"));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("userId is required");
    });

    it("should return 404 if org not found", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce(null);

      const res = await POST(
        makeJsonRequest("POST", { userId: "u1" }),
        makeParams("org-1"),
      );
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Organization not found");
    });

    it("should return 404 if user not found", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull
        .mockResolvedValueOnce({ id: "org-1" }) // org exists
        .mockResolvedValueOnce(null); // user not found

      const res = await POST(
        makeJsonRequest("POST", { userId: "u1" }),
        makeParams("org-1"),
      );
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("User not found");
    });

    it("should return 409 if user already member", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull
        .mockResolvedValueOnce({ id: "org-1" }) // org exists
        .mockResolvedValueOnce({ id: "u1", name: "Alice", email: "a@e.com", image: null, slug: "a" }) // user exists
        .mockResolvedValueOnce({ id: "mem-1" }); // already member

      const res = await POST(
        makeJsonRequest("POST", { userId: "u1" }),
        makeParams("org-1"),
      );
      expect(res.status).toBe(409);
    });

    it("should add member successfully", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull
        .mockResolvedValueOnce({ id: "org-1" })
        .mockResolvedValueOnce({ id: "u1", name: "Alice", email: "a@e.com", image: null, slug: "a" })
        .mockResolvedValueOnce(null); // not a member
      mockDbWrite.execute.mockResolvedValueOnce({});

      const res = await POST(
        makeJsonRequest("POST", { userId: "u1" }),
        makeParams("org-1"),
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.user.name).toBe("Alice");
    });

    it("should return 503 if table not migrated", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("no such table"));

      const res = await POST(
        makeJsonRequest("POST", { userId: "u1" }),
        makeParams("org-1"),
      );
      expect(res.status).toBe(503);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/admin/organizations/[orgId]/members/[userId]
  // -------------------------------------------------------------------------

  describe("DELETE /api/admin/organizations/[orgId]/members/[userId]", () => {
    it("should return 403 for non-admin users", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(null);

      const req = new Request("http://localhost/api/admin/organizations/org-1/members/u1", {
        method: "DELETE",
      });
      const res = await DELETE(req, makeDeleteParams("org-1", "u1"));
      expect(res.status).toBe(403);
    });

    it("should return 404 if org not found", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce(null);

      const req = new Request("http://localhost/api/admin/organizations/org-1/members/u1", {
        method: "DELETE",
      });
      const res = await DELETE(req, makeDeleteParams("org-1", "u1"));
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Organization not found");
    });

    it("should return 404 if user is not a member", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull
        .mockResolvedValueOnce({ id: "org-1" }) // org exists
        .mockResolvedValueOnce(null); // not a member

      const req = new Request("http://localhost/api/admin/organizations/org-1/members/u1", {
        method: "DELETE",
      });
      const res = await DELETE(req, makeDeleteParams("org-1", "u1"));
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("User is not a member");
    });

    it("should remove member successfully", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull
        .mockResolvedValueOnce({ id: "org-1" })
        .mockResolvedValueOnce({ id: "mem-1" }); // is a member
      mockDbWrite.execute.mockResolvedValueOnce({});

      const req = new Request("http://localhost/api/admin/organizations/org-1/members/u1", {
        method: "DELETE",
      });
      const res = await DELETE(req, makeDeleteParams("org-1", "u1"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it("should return 503 if table not migrated", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("no such table"));

      const req = new Request("http://localhost/api/admin/organizations/org-1/members/u1", {
        method: "DELETE",
      });
      const res = await DELETE(req, makeDeleteParams("org-1", "u1"));
      expect(res.status).toBe(503);
    });

    it("should return 500 on unexpected error", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockRejectedValueOnce(new Error("DB failed"));

      const req = new Request("http://localhost/api/admin/organizations/org-1/members/u1", {
        method: "DELETE",
      });
      const res = await DELETE(req, makeDeleteParams("org-1", "u1"));
      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/organizations/[orgId]/logo — upload logo
  // -------------------------------------------------------------------------

  describe("POST /api/admin/organizations/[orgId]/logo", () => {
    function makeFormRequest(file?: File | null): Request {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      }
      return new Request("http://localhost/api/admin/organizations/org-1/logo", {
        method: "POST",
        body: formData,
      });
    }

    it("should return 403 for non-admin users", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(null);

      const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
      const res = await UPLOAD_LOGO(makeFormRequest(file), makeParams("org-1"));
      expect(res.status).toBe(403);
    });

    it("should return 404 if org not found", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce(null);

      const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
      const res = await UPLOAD_LOGO(makeFormRequest(file), makeParams("org-1"));
      expect(res.status).toBe(404);
    });

    it("should return 400 for non-multipart request", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce({ id: "org-1" });

      const req = new Request("http://localhost/api/admin/organizations/org-1/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const res = await UPLOAD_LOGO(req, makeParams("org-1"));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Expected multipart/form-data");
    });

    it("should return 400 if file field missing", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce({ id: "org-1" });

      const res = await UPLOAD_LOGO(makeFormRequest(null), makeParams("org-1"));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Missing file field");
    });

    it("should return 400 for invalid MIME type", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce({ id: "org-1" });

      const file = new File([new Uint8Array([1, 2, 3])], "logo.gif", { type: "image/gif" });
      const res = await UPLOAD_LOGO(makeFormRequest(file), makeParams("org-1"));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Only PNG and JPEG images are accepted");
    });

    it("should return 400 if file too large", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce({ id: "org-1" });

      // Create a 3MB file
      const bigData = new Uint8Array(3 * 1024 * 1024);
      const file = new File([bigData], "logo.png", { type: "image/png" });
      const res = await UPLOAD_LOGO(makeFormRequest(file), makeParams("org-1"));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("File too large (max 2 MB)");
    });

    it("should upload logo successfully", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull
        .mockResolvedValueOnce({ id: "org-1" }) // org exists
        .mockResolvedValueOnce({ logo_url: null }); // no existing logo
      vi.mocked(putOrgLogo).mockResolvedValueOnce("https://cdn.example.com/logo.jpg");
      mockDbWrite.execute.mockResolvedValueOnce({});

      const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
      const res = await UPLOAD_LOGO(makeFormRequest(file), makeParams("org-1"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.logoUrl).toBe("https://cdn.example.com/logo.jpg");
    });

    it("should delete old logo when uploading new one", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull
        .mockResolvedValueOnce({ id: "org-1" })
        .mockResolvedValueOnce({ logo_url: "https://cdn.example.com/old.jpg" });
      vi.mocked(putOrgLogo).mockResolvedValueOnce("https://cdn.example.com/new.jpg");
      mockDbWrite.execute.mockResolvedValueOnce({});

      const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
      const res = await UPLOAD_LOGO(makeFormRequest(file), makeParams("org-1"));
      expect(res.status).toBe(200);
      expect(deleteOrgLogoByUrl).toHaveBeenCalledWith("https://cdn.example.com/old.jpg");
    });

    it("should return 500 if R2 upload fails", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce({ id: "org-1" });
      vi.mocked(putOrgLogo).mockRejectedValueOnce(new Error("R2 unavailable"));

      const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
      const res = await UPLOAD_LOGO(makeFormRequest(file), makeParams("org-1"));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to store logo");
    });

    it("should compensate R2 on DB failure", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull
        .mockResolvedValueOnce({ id: "org-1" })
        .mockRejectedValueOnce(new Error("DB failed")); // fail on reading old logo
      vi.mocked(putOrgLogo).mockResolvedValueOnce("https://cdn.example.com/new.jpg");

      const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
      const res = await UPLOAD_LOGO(makeFormRequest(file), makeParams("org-1"));
      expect(res.status).toBe(500);
      expect(deleteOrgLogoByUrl).toHaveBeenCalledWith("https://cdn.example.com/new.jpg");
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/admin/organizations/[orgId]/logo — remove logo
  // -------------------------------------------------------------------------

  describe("DELETE /api/admin/organizations/[orgId]/logo", () => {
    it("should return 403 for non-admin users", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(null);

      const req = new Request("http://localhost/api/admin/organizations/org-1/logo", {
        method: "DELETE",
      });
      const res = await DELETE_LOGO(req, makeParams("org-1"));
      expect(res.status).toBe(403);
    });

    it("should return 404 if org not found", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce(null);

      const req = new Request("http://localhost/api/admin/organizations/org-1/logo", {
        method: "DELETE",
      });
      const res = await DELETE_LOGO(req, makeParams("org-1"));
      expect(res.status).toBe(404);
    });

    it("should delete logo successfully", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce({
        id: "org-1",
        logo_url: "https://cdn.example.com/logo.jpg",
      });
      mockDbWrite.execute.mockResolvedValueOnce({});

      const req = new Request("http://localhost/api/admin/organizations/org-1/logo", {
        method: "DELETE",
      });
      const res = await DELETE_LOGO(req, makeParams("org-1"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(deleteOrgLogoByUrl).toHaveBeenCalledWith("https://cdn.example.com/logo.jpg");
    });

    it("should handle org without logo gracefully", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce({
        id: "org-1",
        logo_url: null,
      });
      mockDbWrite.execute.mockResolvedValueOnce({});

      const req = new Request("http://localhost/api/admin/organizations/org-1/logo", {
        method: "DELETE",
      });
      const res = await DELETE_LOGO(req, makeParams("org-1"));
      expect(res.status).toBe(200);
      expect(deleteOrgLogoByUrl).not.toHaveBeenCalled();
    });

    it("should return 500 on DB failure", async () => {
      vi.mocked(resolveAdmin).mockResolvedValue(ADMIN);
      mockDbRead.firstOrNull.mockResolvedValueOnce({ id: "org-1", logo_url: null });
      mockDbWrite.execute.mockRejectedValueOnce(new Error("DB failed"));

      const req = new Request("http://localhost/api/admin/organizations/org-1/logo", {
        method: "DELETE",
      });
      const res = await DELETE_LOGO(req, makeParams("org-1"));
      expect(res.status).toBe(500);
    });
  });
});
