import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/showcases/preview/route";

// Mock dependencies
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
}));

vi.mock("@/lib/github", () => ({
  normalizeGitHubUrl: vi.fn(),
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
import { getDbRead } from "@/lib/db";
import {
  normalizeGitHubUrl,
  fetchGitHubMetadata,
  buildOgImageUrl,
  GitHubError,
  gitHubErrorToStatus,
  gitHubErrorMessage,
} from "@/lib/github";

const mockResolveUser = vi.mocked(resolveUser);
const mockGetDbRead = vi.mocked(getDbRead);
const mockNormalizeGitHubUrl = vi.mocked(normalizeGitHubUrl);
const mockFetchGitHubMetadata = vi.mocked(fetchGitHubMetadata);
const mockBuildOgImageUrl = vi.mocked(buildOgImageUrl);
const mockGitHubErrorToStatus = vi.mocked(gitHubErrorToStatus);
const mockGitHubErrorMessage = vi.mocked(gitHubErrorMessage);

function createRequest(body: unknown): Request {
  return new Request("http://localhost/api/showcases/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/showcases/preview", () => {
  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      mockResolveUser.mockResolvedValue(null);

      const res = await POST(createRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });
  });

  describe("validation", () => {
    beforeEach(() => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
    });

    it("returns 400 for invalid JSON", async () => {
      const req = new Request("http://localhost/api/showcases/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid JSON");
    });

    it("returns 400 when github_url is missing", async () => {
      const res = await POST(createRequest({}));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("github_url is required");
    });

    it("returns 400 when github_url is not a string", async () => {
      const res = await POST(createRequest({ github_url: 123 }));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("github_url is required");
    });

    it("returns 400 for invalid GitHub URL format", async () => {
      mockNormalizeGitHubUrl.mockReturnValue(null);

      const res = await POST(createRequest({ github_url: "https://github.com/owner" }));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid GitHub repository URL");
    });
  });

  describe("GitHub API errors", () => {
    beforeEach(() => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
      mockNormalizeGitHubUrl.mockReturnValue({
        repoKey: "owner/repo",
        displayUrl: "https://github.com/owner/repo",
        owner: "owner",
        repo: "repo",
      });
    });

    it("returns 404 when repo not found", async () => {
      const error = new GitHubError("NOT_FOUND", "Not found");
      mockFetchGitHubMetadata.mockRejectedValue(error);
      mockGitHubErrorToStatus.mockReturnValue(404);
      mockGitHubErrorMessage.mockReturnValue("Repository not found or is private");

      const res = await POST(createRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Repository not found or is private");
    });

    it("returns 422 when rate limited", async () => {
      const error = new GitHubError("RATE_LIMITED", "Rate limited");
      mockFetchGitHubMetadata.mockRejectedValue(error);
      mockGitHubErrorToStatus.mockReturnValue(422);
      mockGitHubErrorMessage.mockReturnValue("GitHub API rate limit exceeded");

      const res = await POST(createRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toBe("GitHub API rate limit exceeded");
    });
  });

  describe("successful preview", () => {
    beforeEach(() => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
      mockNormalizeGitHubUrl.mockReturnValue({
        repoKey: "owner/repo",
        displayUrl: "https://github.com/owner/repo",
        owner: "owner",
        repo: "repo",
      });
      mockFetchGitHubMetadata.mockResolvedValue({
        owner: "owner",
        name: "repo",
        title: "My Repo",
        description: "A cool project",
        fullName: "owner/repo",
        stars: 100,
        forks: 10,
        language: "TypeScript",
        license: "MIT",
        topics: ["test"],
        homepage: null,
      });
      mockBuildOgImageUrl.mockReturnValue("https://opengraph.githubassets.com/1/owner/repo");
    });

    it("returns preview data for new repo", async () => {
      const mockDb = {
        firstOrNull: vi.fn().mockResolvedValue(null),
      };
      mockGetDbRead.mockResolvedValue(mockDb as never);

      const res = await POST(createRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        repo_key: "owner/repo",
        github_url: "https://github.com/owner/repo",
        title: "My Repo",
        description: "A cool project",
        og_image_url: "https://opengraph.githubassets.com/1/owner/repo",
        already_exists: false,
        stars: 100,
        forks: 10,
        language: "TypeScript",
        license: "MIT",
        topics: ["test"],
        homepage: null,
      });
    });

    it("returns already_exists=true for existing repo", async () => {
      const mockDb = {
        firstOrNull: vi.fn().mockResolvedValue({ id: "existing-id" }),
      };
      mockGetDbRead.mockResolvedValue(mockDb as never);

      const res = await POST(createRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.already_exists).toBe(true);
    });

    it("handles missing table gracefully", async () => {
      const mockDb = {
        firstOrNull: vi.fn().mockRejectedValue(new Error("no such table: showcases")),
      };
      mockGetDbRead.mockResolvedValue(mockDb as never);

      const res = await POST(createRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.already_exists).toBe(false);
    });

    it("returns 500 on unexpected DB error", async () => {
      const mockDb = {
        firstOrNull: vi.fn().mockRejectedValue(new Error("Connection refused")),
      };
      mockGetDbRead.mockResolvedValue(mockDb as never);

      const res = await POST(createRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to check showcase existence");
    });
  });
});
