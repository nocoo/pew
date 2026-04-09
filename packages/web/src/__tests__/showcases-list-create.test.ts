import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "@/app/api/showcases/route";

// Mock dependencies
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
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

vi.mock("@/lib/rate-limit", () => ({
  checkShowcaseRateLimit: vi.fn(),
  SHOWCASE_CREATE_RATE_LIMIT: { maxRequests: 5, windowSeconds: 3600 },
}));

vi.mock("nanoid", () => ({
  nanoid: () => "test-nanoid-123",
}));

import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";
import {
  normalizeGitHubUrl,
  fetchGitHubMetadata,
  buildOgImageUrl,
  GitHubError,
  gitHubErrorToStatus,
  gitHubErrorMessage,
} from "@/lib/github";
import { checkShowcaseRateLimit } from "@/lib/rate-limit";

const mockResolveUser = vi.mocked(resolveUser);
const mockGetDbRead = vi.mocked(getDbRead);
const mockGetDbWrite = vi.mocked(getDbWrite);
const mockNormalizeGitHubUrl = vi.mocked(normalizeGitHubUrl);
const mockFetchGitHubMetadata = vi.mocked(fetchGitHubMetadata);
const mockBuildOgImageUrl = vi.mocked(buildOgImageUrl);
const mockGitHubErrorToStatus = vi.mocked(gitHubErrorToStatus);
const mockGitHubErrorMessage = vi.mocked(gitHubErrorMessage);
const mockCheckShowcaseRateLimit = vi.mocked(checkShowcaseRateLimit);

function createGetRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/showcases");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString(), { method: "GET" });
}

function createPostRequest(body: unknown): Request {
  return new Request("http://localhost/api/showcases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Create a mock showcase row for RPC responses */
function createMockShowcase(overrides: Partial<{
  id: string;
  user_id: string;
  repo_key: string;
  github_url: string;
  title: string;
  description: string | null;
  tagline: string | null;
  og_image_url: string | null;
  is_public: number;
  created_at: string;
  refreshed_at: string;
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  topics: string | null;
  homepage: string | null;
  upvote_count: number;
  user_name: string | null;
  user_nickname: string | null;
  user_image: string | null;
  user_slug: string | null;
  has_upvoted?: number;
}> = {}) {
  return {
    id: "s1",
    user_id: "u1",
    repo_key: "owner/repo",
    github_url: "https://github.com/owner/repo",
    title: "My Repo",
    description: "A cool project",
    tagline: null,
    og_image_url: "https://og.test/1/owner/repo",
    is_public: 1,
    created_at: "2026-01-01T00:00:00Z",
    refreshed_at: "2026-01-01T00:00:00Z",
    stars: 0,
    forks: 0,
    language: null,
    license: null,
    topics: null,
    homepage: null,
    upvote_count: 5,
    user_name: "Test User",
    user_nickname: null,
    user_image: null,
    user_slug: "testuser",
    ...overrides,
  };
}

/** Create a mock DbRead with RPC methods */
function createMockDbRead(overrides: {
  countShowcases?: number;
  listShowcases?: ReturnType<typeof createMockShowcase>[];
  checkShowcaseExistsByRepoKey?: { exists: boolean; id?: string };
  firstOrNull?: unknown;
} = {}) {
  return {
    countShowcases: vi.fn().mockResolvedValue(overrides.countShowcases ?? 0),
    listShowcases: vi.fn().mockResolvedValue(overrides.listShowcases ?? []),
    checkShowcaseExistsByRepoKey: vi.fn().mockResolvedValue(
      overrides.checkShowcaseExistsByRepoKey ?? { exists: false }
    ),
    // Legacy method for rate-limit.ts (still uses firstOrNull)
    firstOrNull: vi.fn().mockResolvedValue(overrides.firstOrNull ?? null),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/showcases
// ---------------------------------------------------------------------------

describe("GET /api/showcases", () => {
  describe("public list (no mine param)", () => {
    it("returns public showcases without auth", async () => {
      mockResolveUser.mockResolvedValue(null);
      const mockDb = createMockDbRead({
        countShowcases: 1,
        listShowcases: [createMockShowcase()],
      });
      mockGetDbRead.mockResolvedValue(mockDb as never);

      const res = await GET(createGetRequest());

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.showcases).toHaveLength(1);
      expect(json.showcases[0].id).toBe("s1");
      expect(json.showcases[0].has_upvoted).toBeNull(); // unauthenticated
      expect(json.total).toBe(1);
    });

    it("includes has_upvoted when authenticated", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u2", email: "test@example.com" });
      const mockDb = createMockDbRead({
        countShowcases: 1,
        listShowcases: [createMockShowcase({ has_upvoted: 1 })],
      });
      mockGetDbRead.mockResolvedValue(mockDb as never);

      const res = await GET(createGetRequest());

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.showcases[0].has_upvoted).toBe(true);
    });

    it("respects limit and offset params", async () => {
      mockResolveUser.mockResolvedValue(null);
      const mockDb = createMockDbRead({
        countShowcases: 50,
        listShowcases: [],
      });
      mockGetDbRead.mockResolvedValue(mockDb as never);

      const res = await GET(createGetRequest({ limit: "10", offset: "20" }));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.limit).toBe(10);
      expect(json.offset).toBe(20);
      expect(json.total).toBe(50);
    });

    it("caps limit at 100", async () => {
      mockResolveUser.mockResolvedValue(null);
      const mockDb = createMockDbRead({
        countShowcases: 0,
        listShowcases: [],
      });
      mockGetDbRead.mockResolvedValue(mockDb as never);

      const res = await GET(createGetRequest({ limit: "200" }));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.limit).toBe(100);
    });

    it("handles missing table gracefully", async () => {
      mockResolveUser.mockResolvedValue(null);
      const mockDb = {
        countShowcases: vi.fn().mockRejectedValue(new Error("no such table: showcases")),
        listShowcases: vi.fn(),
      };
      mockGetDbRead.mockResolvedValue(mockDb as never);

      const res = await GET(createGetRequest());

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.showcases).toEqual([]);
      expect(json.total).toBe(0);
    });

    it("returns 500 on unexpected DB error", async () => {
      mockResolveUser.mockResolvedValue(null);
      const mockDb = {
        countShowcases: vi.fn().mockRejectedValue(new Error("Connection refused")),
        listShowcases: vi.fn(),
      };
      mockGetDbRead.mockResolvedValue(mockDb as never);

      const res = await GET(createGetRequest());

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to list showcases");
    });
  });

  describe("mine=1 (user's showcases)", () => {
    it("returns 401 when not authenticated", async () => {
      mockResolveUser.mockResolvedValue(null);

      const res = await GET(createGetRequest({ mine: "1" }));

      expect(res.status).toBe(401);
    });

    it("returns user's showcases including hidden", async () => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
      const mockDb = createMockDbRead({
        countShowcases: 2,
        listShowcases: [
          createMockShowcase({
            id: "s1",
            repo_key: "owner/repo1",
            github_url: "https://github.com/owner/repo1",
            title: "Repo 1",
            is_public: 1,
            has_upvoted: 0,
          }),
          createMockShowcase({
            id: "s2",
            repo_key: "owner/repo2",
            github_url: "https://github.com/owner/repo2",
            title: "Repo 2",
            is_public: 0,
            has_upvoted: 0,
          }),
        ],
      });
      mockGetDbRead.mockResolvedValue(mockDb as never);

      const res = await GET(createGetRequest({ mine: "1" }));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.showcases).toHaveLength(2);
      expect(json.showcases[0].is_public).toBe(true);
      expect(json.showcases[1].is_public).toBe(false); // actual value
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/showcases
// ---------------------------------------------------------------------------

describe("POST /api/showcases", () => {
  // Default rate limit mock: allow all requests
  beforeEach(() => {
    mockCheckShowcaseRateLimit.mockResolvedValue({
      allowed: true,
      current: 0,
      limit: 5,
      retryAfter: 0,
    });
  });

  describe("authentication", () => {
    it("returns 401 when not authenticated", async () => {
      mockResolveUser.mockResolvedValue(null);

      const res = await POST(createPostRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(401);
    });
  });

  describe("validation", () => {
    beforeEach(() => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
    });

    it("returns 400 for invalid JSON", async () => {
      const req = new Request("http://localhost/api/showcases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it("returns 400 when github_url is missing", async () => {
      const res = await POST(createPostRequest({}));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("github_url is required");
    });

    it("returns 400 for invalid URL format", async () => {
      mockNormalizeGitHubUrl.mockReturnValue(null);

      const res = await POST(createPostRequest({ github_url: "invalid" }));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid GitHub repository URL");
    });

    it("returns 400 when tagline exceeds 280 chars", async () => {
      const res = await POST(createPostRequest({
        github_url: "https://github.com/owner/repo",
        tagline: "a".repeat(281),
      }));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("280 characters");
    });

    it("returns 400 when tagline is not a string", async () => {
      const res = await POST(createPostRequest({
        github_url: "https://github.com/owner/repo",
        tagline: 123,
      }));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("tagline must be a string");
    });
  });

  describe("successful creation", () => {
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
        fullName: "owner/repo", stars: 0, forks: 0, language: null, license: null, topics: [], homepage: null,
      });
      mockBuildOgImageUrl.mockReturnValue("https://og.test/1/owner/repo");
    });

    it("creates showcase successfully", async () => {
      const mockDbRead = createMockDbRead({
        checkShowcaseExistsByRepoKey: { exists: false },
      });
      const mockDbWrite = {
        execute: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await POST(createPostRequest({
        github_url: "https://github.com/owner/repo",
        tagline: "Check this out!",
      }));

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBe("test-nanoid-123");
      expect(json.repo_key).toBe("owner/repo");
      expect(json.title).toBe("My Repo");
      expect(json.tagline).toBe("Check this out!");
      expect(json.upvote_count).toBe(0);
    });

    it("returns 409 when repo already showcased", async () => {
      const mockDbRead = createMockDbRead({
        checkShowcaseExistsByRepoKey: { exists: true, id: "existing" },
      });
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createPostRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toContain("already been showcased");
    });

    it("returns 409 on unique constraint violation", async () => {
      const mockDbRead = createMockDbRead({
        checkShowcaseExistsByRepoKey: { exists: false },
      });
      const mockDbWrite = {
        execute: vi.fn().mockRejectedValue(new Error("UNIQUE constraint failed: showcases.repo_key")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await POST(createPostRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(409);
    });

    it("returns 500 on unexpected DB error during existence check", async () => {
      const mockDbRead = createMockDbRead();
      mockDbRead.checkShowcaseExistsByRepoKey.mockRejectedValue(new Error("Connection refused"));
      mockGetDbRead.mockResolvedValue(mockDbRead as never);

      const res = await POST(createPostRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to check showcase existence");
    });

    it("returns 500 on unexpected DB error during insert", async () => {
      const mockDbRead = createMockDbRead({
        checkShowcaseExistsByRepoKey: { exists: false },
      });
      const mockDbWrite = {
        execute: vi.fn().mockRejectedValue(new Error("Disk full")),
      };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await POST(createPostRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to create showcase");
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
      mockGitHubErrorMessage.mockReturnValue("Repository not found");

      const res = await POST(createPostRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(404);
    });

    it("returns 500 on unexpected GitHub fetch error", async () => {
      mockFetchGitHubMetadata.mockRejectedValue(new Error("Network error"));

      const res = await POST(createPostRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to fetch repository information");
    });
  });

  describe("rate limiting", () => {
    beforeEach(() => {
      mockResolveUser.mockResolvedValue({ userId: "u1", email: "test@example.com" });
    });

    it("returns 429 when rate limit exceeded", async () => {
      mockCheckShowcaseRateLimit.mockResolvedValue({
        allowed: false,
        current: 5,
        limit: 5,
        retryAfter: 3600,
      });

      const res = await POST(createPostRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toContain("Rate limit exceeded");
      expect(json.retry_after).toBe(3600);
      expect(res.headers.get("Retry-After")).toBe("3600");
    });

    it("allows request when under rate limit", async () => {
      mockCheckShowcaseRateLimit.mockResolvedValue({
        allowed: true,
        current: 2,
        limit: 5,
        retryAfter: 0,
      });
      mockNormalizeGitHubUrl.mockReturnValue({
        repoKey: "owner/repo",
        displayUrl: "https://github.com/owner/repo",
        owner: "owner",
        repo: "repo",
      });
      mockFetchGitHubMetadata.mockResolvedValue({
        owner: "owner",
        name: "repo",
        title: "repo",
        description: null,
        fullName: "owner/repo", stars: 0, forks: 0, language: null, license: null, topics: [], homepage: null,
      });
      mockBuildOgImageUrl.mockReturnValue("https://og.example.com/image");
      const mockDbRead = createMockDbRead({
        checkShowcaseExistsByRepoKey: { exists: false },
      });
      const mockDbWrite = { execute: vi.fn().mockResolvedValue({}) };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await POST(createPostRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(201);
    });

    it("continues when rate limit check throws for no such table", async () => {
      // This allows creation before migration runs
      mockCheckShowcaseRateLimit.mockRejectedValue(new Error("no such table: showcases"));
      mockNormalizeGitHubUrl.mockReturnValue({
        repoKey: "owner/repo",
        displayUrl: "https://github.com/owner/repo",
        owner: "owner",
        repo: "repo",
      });
      mockFetchGitHubMetadata.mockResolvedValue({
        owner: "owner",
        name: "repo",
        title: "repo",
        description: null,
        fullName: "owner/repo", stars: 0, forks: 0, language: null, license: null, topics: [], homepage: null,
      });
      mockBuildOgImageUrl.mockReturnValue("https://og.example.com/image");
      const mockDbRead = createMockDbRead({
        checkShowcaseExistsByRepoKey: { exists: false },
      });
      const mockDbWrite = { execute: vi.fn().mockResolvedValue({}) };
      mockGetDbRead.mockResolvedValue(mockDbRead as never);
      mockGetDbWrite.mockResolvedValue(mockDbWrite as never);

      const res = await POST(createPostRequest({ github_url: "https://github.com/owner/repo" }));

      expect(res.status).toBe(201);
    });
  });
});
