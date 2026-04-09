import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/showcases/[id]/upvote/route";

// Mock dependencies
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";

const mockResolveUser = vi.mocked(resolveUser);
const mockGetDbRead = vi.mocked(getDbRead);
const mockGetDbWrite = vi.mocked(getDbWrite);

/** Create a mock DbRead with typed RPC methods for upvote route */
function createMockDbRead(overrides: {
  getShowcaseById?: { id: string; is_public: number } | null;
  checkShowcaseUpvote?: boolean;
  getShowcaseUpvoteCount?: number;
} = {}) {
  return {
    getShowcaseById: vi.fn().mockResolvedValue(overrides.getShowcaseById ?? null),
    checkShowcaseUpvote: vi.fn().mockResolvedValue(overrides.checkShowcaseUpvote ?? false),
    getShowcaseUpvoteCount: vi.fn().mockResolvedValue(overrides.getShowcaseUpvoteCount ?? 0),
  };
}

function createRequest(): Request {
  return new Request("http://localhost/api/showcases/s1/upvote", {
    method: "POST",
  });
}

function createContext(id: string = "s1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/showcases/[id]/upvote
// ---------------------------------------------------------------------------

describe("POST /api/showcases/[id]/upvote", () => {
  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      mockResolveUser.mockResolvedValue(null);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(401);
    });
  });

  describe("showcase validation", () => {
    it("returns 404 when showcase not found", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
      const mockDbRead = createMockDbRead({
        getShowcaseById: null,
      });
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(404);
    });

    it("returns 403 when showcase is hidden", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
      const mockDbRead = createMockDbRead({
        getShowcaseById: { id: "s1", is_public: 0 },
      });
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("hidden showcase");
    });
  });

  describe("upvote toggle", () => {
    it("adds upvote when not upvoted", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
      const mockDbRead = createMockDbRead({
        getShowcaseById: { id: "s1", is_public: 1 },
        checkShowcaseUpvote: false,
        getShowcaseUpvoteCount: 5,
      });
      const mockDbWrite = {
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.upvoted).toBe(true);
      expect(json.upvote_count).toBe(5);
      expect(mockDbWrite.execute).toHaveBeenCalledWith(
        "INSERT INTO showcase_upvotes (showcase_id, user_id) VALUES (?, ?)",
        ["s1", "u1"]
      );
    });

    it("removes upvote when already upvoted", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
      const mockDbRead = createMockDbRead({
        getShowcaseById: { id: "s1", is_public: 1 },
        checkShowcaseUpvote: true,
        getShowcaseUpvoteCount: 4,
      });
      const mockDbWrite = {
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.upvoted).toBe(false);
      expect(json.upvote_count).toBe(4);
      expect(mockDbWrite.execute).toHaveBeenCalledWith(
        "DELETE FROM showcase_upvotes WHERE showcase_id = ? AND user_id = ?",
        ["s1", "u1"]
      );
    });

    it("handles count query failure gracefully", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
      const mockDbRead = createMockDbRead({
        getShowcaseById: { id: "s1", is_public: 1 },
        checkShowcaseUpvote: false,
      });
      mockDbRead.getShowcaseUpvoteCount.mockRejectedValue(new Error("DB error"));
      const mockDbWrite = {
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await POST(createRequest(), createContext());

      // Should still return 200 with count 0
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.upvoted).toBe(true);
      expect(json.upvote_count).toBe(0);
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
    });

    it("handles missing table gracefully", async () => {
      const mockDbRead = createMockDbRead();
      mockDbRead.getShowcaseById.mockRejectedValue(new Error("no such table: showcases"));
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(404);
    });

    it("returns 500 on showcase lookup error", async () => {
      const mockDbRead = createMockDbRead();
      mockDbRead.getShowcaseById.mockRejectedValue(new Error("Connection refused"));
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to find showcase");
    });

    it("returns 500 on upvote check error", async () => {
      const mockDbRead = createMockDbRead({
        getShowcaseById: { id: "s1", is_public: 1 },
      });
      mockDbRead.checkShowcaseUpvote.mockRejectedValue(new Error("DB error"));
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to check upvote status");
    });

    it("returns 500 on upvote toggle error", async () => {
      const mockDbRead = createMockDbRead({
        getShowcaseById: { id: "s1", is_public: 1 },
        checkShowcaseUpvote: false,
      });
      const mockDbWrite = {
        execute: vi.fn().mockRejectedValue(new Error("Disk full")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to toggle upvote");
    });
  });
});
