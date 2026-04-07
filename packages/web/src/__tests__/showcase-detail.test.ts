import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, PATCH, DELETE } from "@/app/api/showcases/[id]/route";

// Mock dependencies
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: vi.fn(),
}));

import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";
import { isAdminUser } from "@/lib/admin";

const mockResolveUser = vi.mocked(resolveUser);
const mockGetDbRead = vi.mocked(getDbRead);
const mockGetDbWrite = vi.mocked(getDbWrite);
const mockIsAdminUser = vi.mocked(isAdminUser);

function createRequest(method: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost/api/showcases/s1", init);
}

function createContext(id: string = "s1") {
  return { params: Promise.resolve({ id }) };
}

const mockShowcase = {
  id: "s1",
  user_id: "u1",
  repo_key: "owner/repo",
  github_url: "https://github.com/owner/repo",
  title: "My Repo",
  description: "A cool project",
  tagline: "Check this out!",
  og_image_url: "https://og.test/1/owner/repo",
  is_public: 1,
  created_at: "2026-01-01T00:00:00Z",
  refreshed_at: "2026-01-01T00:00:00Z",
  stars: 100,
  forks: 10,
  language: "TypeScript",
  license: "MIT",
  topics: '["test"]',
  homepage: "https://example.com",
  user_name: "Test User",
  user_nickname: null,
  user_image: null,
  user_slug: "testuser",
  upvote_count: 5,
  has_upvoted: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/showcases/[id]
// ---------------------------------------------------------------------------

describe("GET /api/showcases/[id]", () => {
  it("returns public showcase without auth", async () => {
    mockResolveUser.mockResolvedValue(null);
    const mockDb = {
      firstOrNull: vi.fn().mockResolvedValue({ ...mockShowcase, has_upvoted: undefined }),
    };
    mockGetDbRead.mockResolvedValue(mockDb as never);

    const res = await GET(createRequest("GET"), createContext());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("s1");
    expect(json.has_upvoted).toBeNull();
  });

  it("includes has_upvoted when authenticated", async () => {
    mockResolveUser.mockResolvedValue({ userId: "u2", email: "test@example.com" });
    mockIsAdminUser.mockResolvedValue(false);
    const mockDb = {
      firstOrNull: vi.fn().mockResolvedValue(mockShowcase),
    };
    mockGetDbRead.mockResolvedValue(mockDb as never);

    const res = await GET(createRequest("GET"), createContext());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.has_upvoted).toBe(true);
  });

  it("returns 404 for non-existent showcase", async () => {
    mockResolveUser.mockResolvedValue(null);
    const mockDb = {
      firstOrNull: vi.fn().mockResolvedValue(null),
    };
    mockGetDbRead.mockResolvedValue(mockDb as never);

    const res = await GET(createRequest("GET"), createContext());

    expect(res.status).toBe(404);
  });

  it("returns 404 for hidden showcase to non-owner", async () => {
    mockResolveUser.mockResolvedValue({ userId: "u2", email: "test@example.com" });
    mockIsAdminUser.mockResolvedValue(false);
    const mockDb = {
      firstOrNull: vi.fn().mockResolvedValue({ ...mockShowcase, is_public: 0 }),
    };
    mockGetDbRead.mockResolvedValue(mockDb as never);

    const res = await GET(createRequest("GET"), createContext());

    expect(res.status).toBe(404);
  });

  it("returns hidden showcase to owner", async () => {
    mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
    mockIsAdminUser.mockResolvedValue(false);
    const mockDb = {
      firstOrNull: vi.fn().mockResolvedValue({ ...mockShowcase, is_public: 0 }),
    };
    mockGetDbRead.mockResolvedValue(mockDb as never);

    const res = await GET(createRequest("GET"), createContext());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.is_public).toBe(false);
  });

  it("returns hidden showcase to admin", async () => {
    mockResolveUser.mockResolvedValue({ userId: "admin", email: "admin@example.com" });
    mockIsAdminUser.mockResolvedValue(true);
    const mockDb = {
      firstOrNull: vi.fn().mockResolvedValue({ ...mockShowcase, is_public: 0 }),
    };
    mockGetDbRead.mockResolvedValue(mockDb as never);

    const res = await GET(createRequest("GET"), createContext());

    expect(res.status).toBe(200);
  });

  it("handles missing table gracefully", async () => {
    mockResolveUser.mockResolvedValue(null);
    const mockDb = {
      firstOrNull: vi.fn().mockRejectedValue(new Error("no such table: showcases")),
    };
    mockGetDbRead.mockResolvedValue(mockDb as never);

    const res = await GET(createRequest("GET"), createContext());

    expect(res.status).toBe(404);
  });

  it("returns 500 on unexpected DB error", async () => {
    mockResolveUser.mockResolvedValue(null);
    const mockDb = {
      firstOrNull: vi.fn().mockRejectedValue(new Error("Connection refused")),
    };
    mockGetDbRead.mockResolvedValue(mockDb as never);

    const res = await GET(createRequest("GET"), createContext());

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to get showcase");
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/showcases/[id]
// ---------------------------------------------------------------------------

describe("PATCH /api/showcases/[id]", () => {
  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      mockResolveUser.mockResolvedValue(null);

      const res = await PATCH(createRequest("PATCH", { tagline: "New" }), createContext());

      expect(res.status).toBe(401);
    });
  });

  describe("authorization", () => {
    it("allows owner to update", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue({ id: "s1", user_id: "u1" }),
      };
      const mockDbWrite = {
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await PATCH(createRequest("PATCH", { tagline: "Updated" }), createContext());

      expect(res.status).toBe(200);
    });

    it("allows admin to update any showcase", async () => {
      mockResolveUser.mockResolvedValue({ userId: "admin", email: "admin@example.com" });
      mockIsAdminUser.mockResolvedValue(true);
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue({ id: "s1", user_id: "u1" }),
      };
      const mockDbWrite = {
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await PATCH(createRequest("PATCH", { is_public: false }), createContext());

      expect(res.status).toBe(200);
    });

    it("returns 403 for non-owner non-admin", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u2", email: "other@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue({ id: "s1", user_id: "u1" }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await PATCH(createRequest("PATCH", { tagline: "Hacked" }), createContext());

      expect(res.status).toBe(403);
    });

    it("returns 404 when showcase not found", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue(null),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await PATCH(createRequest("PATCH", { tagline: "Updated" }), createContext());

      expect(res.status).toBe(404);
    });
  });

  describe("validation", () => {
    beforeEach(() => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue({ id: "s1", user_id: "u1" }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
    });

    it("returns 400 for invalid JSON", async () => {
      const req = new Request("http://localhost/api/showcases/s1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      const res = await PATCH(req, createContext());

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid JSON");
    });

    it("returns 400 when tagline is not a string", async () => {
      const res = await PATCH(createRequest("PATCH", { tagline: 123 }), createContext());

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("tagline must be a string");
    });

    it("returns 400 when tagline exceeds 280 chars", async () => {
      const res = await PATCH(createRequest("PATCH", { tagline: "a".repeat(281) }), createContext());

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("280 characters");
    });

    it("returns 400 when is_public is not boolean", async () => {
      const res = await PATCH(createRequest("PATCH", { is_public: "yes" }), createContext());

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("is_public must be a boolean");
    });

    it("returns 400 when no fields to update", async () => {
      const res = await PATCH(createRequest("PATCH", {}), createContext());

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("No fields to update");
    });

    it("allows clearing tagline with null", async () => {
      const mockDbWrite = {
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      };
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await PATCH(createRequest("PATCH", { tagline: null }), createContext());

      expect(res.status).toBe(200);
    });
  });

  describe("error handling", () => {
    it("handles missing table gracefully", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockRejectedValue(new Error("no such table: showcases")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await PATCH(createRequest("PATCH", { tagline: "New" }), createContext());

      expect(res.status).toBe(404);
    });

    it("returns 500 on DB read error", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockRejectedValue(new Error("Connection refused")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await PATCH(createRequest("PATCH", { tagline: "New" }), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to find showcase");
    });

    it("returns 500 on DB write error", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue({ id: "s1", user_id: "u1" }),
      };
      const mockDbWrite = {
        execute: vi.fn().mockRejectedValue(new Error("Disk full")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await PATCH(createRequest("PATCH", { tagline: "New" }), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to update showcase");
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/showcases/[id]
// ---------------------------------------------------------------------------

describe("DELETE /api/showcases/[id]", () => {
  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      mockResolveUser.mockResolvedValue(null);

      const res = await DELETE(createRequest("DELETE"), createContext());

      expect(res.status).toBe(401);
    });
  });

  describe("authorization", () => {
    it("allows owner to delete", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue({ id: "s1", user_id: "u1" }),
      };
      const mockDbWrite = {
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await DELETE(createRequest("DELETE"), createContext());

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it("allows admin to delete any showcase", async () => {
      mockResolveUser.mockResolvedValue({ userId: "admin", email: "admin@example.com" });
      mockIsAdminUser.mockResolvedValue(true);
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue({ id: "s1", user_id: "u1" }),
      };
      const mockDbWrite = {
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await DELETE(createRequest("DELETE"), createContext());

      expect(res.status).toBe(200);
    });

    it("returns 403 for non-owner non-admin", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u2", email: "other@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue({ id: "s1", user_id: "u1" }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await DELETE(createRequest("DELETE"), createContext());

      expect(res.status).toBe(403);
    });

    it("returns 404 when showcase not found", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue(null),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await DELETE(createRequest("DELETE"), createContext());

      expect(res.status).toBe(404);
    });
  });

  describe("error handling", () => {
    it("handles missing table gracefully", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockRejectedValue(new Error("no such table: showcases")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await DELETE(createRequest("DELETE"), createContext());

      expect(res.status).toBe(404);
    });

    it("returns 500 on DB read error", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockRejectedValue(new Error("Connection refused")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await DELETE(createRequest("DELETE"), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to find showcase");
    });

    it("returns 500 on DB write error", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      mockIsAdminUser.mockResolvedValue(false);
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue({ id: "s1", user_id: "u1" }),
      };
      const mockDbWrite = {
        execute: vi.fn().mockRejectedValue(new Error("Disk full")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await DELETE(createRequest("DELETE"), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to delete showcase");
    });
  });
});
