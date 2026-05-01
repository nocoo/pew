import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

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
  fetchGitHubMetadata,
  normalizeGitHubUrl,
} from "@/lib/github";

function makeRequest() {
  return new Request("http://localhost:7020/api/showcases/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      github_url: "https://github.com/owner/repo",
    }),
  });
}

describe("POST /api/showcases/preview unexpected GitHub failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveUser).mockResolvedValue({
      userId: "u1",
      email: "test@example.com",
    });
    vi.mocked(normalizeGitHubUrl).mockReturnValue({
      repoKey: "owner/repo",
      displayUrl: "https://github.com/owner/repo",
      owner: "owner",
      repo: "repo",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 500 when metadata lookup throws a non-GitHubError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetchGitHubMetadata).mockRejectedValueOnce(
      new Error("socket hang up"),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Failed to fetch repository information",
    });
    expect(vi.mocked(getDbRead)).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
