import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/showcases/[id]/refresh/route";

// Mock dependencies
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
}));

vi.mock("@/lib/github", () => ({
  fetchGitHubMetadata: vi.fn(),
  buildOgImageUrl: vi.fn(),
  GitHubError: class GitHubError extends Error {
    constructor(public code: string, message: string) {
      super(message);
      this.name = "GitHubError";
    }
  },
  gitHubErrorToStatus: vi.fn(),
  gitHubErrorMessage: vi.fn(),
}));

import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";
import {
  fetchGitHubMetadata,
  buildOgImageUrl,
  GitHubError,
  gitHubErrorToStatus,
  gitHubErrorMessage,
} from "@/lib/github";

const mockResolveUser = vi.mocked(resolveUser);
const mockGetDbRead = vi.mocked(getDbRead);
const mockGetDbWrite = vi.mocked(getDbWrite);
const mockFetchGitHubMetadata = vi.mocked(fetchGitHubMetadata);
const mockBuildOgImageUrl = vi.mocked(buildOgImageUrl);
const mockGitHubErrorToStatus = vi.mocked(gitHubErrorToStatus);
const mockGitHubErrorMessage = vi.mocked(gitHubErrorMessage);

function createRequest(): Request {
  return new Request("http://localhost/api/showcases/s1/refresh", {
    method: "POST",
  });
}

function createContext(id: string = "s1") {
  return { params: Promise.resolve({ id }) };
}

const mockShowcase = {
  id: "s1",
  user_id: "u1",
  repo_key: "owner/repo",
  github_url: "https://github.com/owner/repo",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/showcases/[id]/refresh
// ---------------------------------------------------------------------------

describe("POST /api/showcases/[id]/refresh", () => {
  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      mockResolveUser.mockResolvedValue(null);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(401);
    });
  });

  describe("authorization", () => {
    it("returns 403 for non-owner", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u2", email: "other@example.com" });
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue(mockShowcase),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(403);
    });

    it("returns 404 when showcase not found", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue(null),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(404);
    });
  });

  describe("successful refresh", () => {
    beforeEach(() => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
    });

    it("updates metadata from GitHub", async () => {
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue(mockShowcase),
      };
      const mockDbWrite = {
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);
      mockFetchGitHubMetadata.mockResolvedValue({
        owner: "owner",
        name: "repo",
        title: "Updated Title",
        description: "New description",
        fullName: "owner/repo",
      });
      mockBuildOgImageUrl.mockReturnValue("https://og.test/1/owner/repo");

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.title).toBe("Updated Title");
      expect(json.description).toBe("New description");
      expect(json.repo_key).toBe("owner/repo");
      expect(json.refreshed_at).toBeDefined();
    });

    it("handles repo rename without conflict", async () => {
      const mockDbRead = {
        firstOrNull: vi
          .fn()
          .mockResolvedValueOnce(mockShowcase) // First call: find showcase
          .mockResolvedValueOnce(null), // Second call: check conflict
      };
      const mockDbWrite = {
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);
      mockFetchGitHubMetadata.mockResolvedValue({
        owner: "newowner",
        name: "newrepo",
        title: "New Repo Name",
        description: "Desc",
        fullName: "newowner/newrepo",
      });
      mockBuildOgImageUrl.mockReturnValue("https://og.test/1/newowner/newrepo");

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.repo_key).toBe("newowner/newrepo");
      expect(json.github_url).toBe("https://github.com/newowner/newrepo");
    });

    it("returns 409 when renamed repo conflicts with existing showcase", async () => {
      const mockDbRead = {
        firstOrNull: vi
          .fn()
          .mockResolvedValueOnce(mockShowcase) // First call: find showcase
          .mockResolvedValueOnce({ id: "s2" }), // Second call: conflict exists
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockFetchGitHubMetadata.mockResolvedValue({
        owner: "existing",
        name: "repo",
        title: "Existing",
        description: null,
        fullName: "existing/repo",
      });

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toContain("already showcased");
    });
  });

  describe("GitHub API errors", () => {
    beforeEach(() => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue(mockShowcase),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
    });

    it("returns 410 when repo was deleted", async () => {
      const error = new GitHubError("NOT_FOUND", "Not found");
      mockFetchGitHubMetadata.mockRejectedValue(error);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(410);
      const json = await res.json();
      expect(json.error).toContain("deleted or made private");
    });

    it("returns 422 on rate limit", async () => {
      const error = new GitHubError("RATE_LIMITED", "Rate limited");
      mockFetchGitHubMetadata.mockRejectedValue(error);
      mockGitHubErrorToStatus.mockReturnValue(422);
      mockGitHubErrorMessage.mockReturnValue("GitHub API rate limit exceeded");

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(422);
    });

    it("returns 500 on unexpected GitHub error", async () => {
      mockFetchGitHubMetadata.mockRejectedValue(new Error("Network error"));

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to fetch repository information");
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "owner@example.com" });
    });

    it("handles missing table gracefully", async () => {
      const mockDbRead = {
        firstOrNull: vi.fn().mockRejectedValue(new Error("no such table: showcases")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(404);
    });

    it("returns 500 on DB read error", async () => {
      const mockDbRead = {
        firstOrNull: vi.fn().mockRejectedValue(new Error("Connection refused")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to find showcase");
    });

    it("returns 500 on DB write error", async () => {
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue(mockShowcase),
      };
      const mockDbWrite = {
        execute: vi.fn().mockRejectedValue(new Error("Disk full")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);
      mockFetchGitHubMetadata.mockResolvedValue({
        owner: "owner",
        name: "repo",
        title: "Title",
        description: null,
        fullName: "owner/repo",
      });
      mockBuildOgImageUrl.mockReturnValue("https://og.test/1/owner/repo");

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to update showcase");
    });

    it("returns 500 on conflict check error", async () => {
      const mockDbRead = {
        firstOrNull: vi
          .fn()
          .mockResolvedValueOnce(mockShowcase)
          .mockRejectedValueOnce(new Error("DB error")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockFetchGitHubMetadata.mockResolvedValue({
        owner: "newowner",
        name: "newrepo",
        title: "New",
        description: null,
        fullName: "newowner/newrepo",
      });

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to check for conflict");
    });

    it("returns 500 for invalid stored GitHub URL", async () => {
      const mockDbRead = {
        firstOrNull: vi.fn().mockResolvedValue({
          ...mockShowcase,
          github_url: "invalid-url",
        }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createRequest(), createContext());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Invalid stored GitHub URL");
    });
  });
});
