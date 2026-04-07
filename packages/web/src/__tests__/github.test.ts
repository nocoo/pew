import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeGitHubUrl,
  isValidGitHubRepoUrl,
  buildOgImageUrl,
  gitHubErrorToStatus,
  gitHubErrorMessage,
  GitHubError,
  fetchGitHubMetadata,
} from "@/lib/github";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// normalizeGitHubUrl
// ---------------------------------------------------------------------------

describe("normalizeGitHubUrl", () => {
  describe("valid URLs", () => {
    it("normalizes https URL", () => {
      const result = normalizeGitHubUrl("https://github.com/Owner/Repo");
      expect(result).toEqual({
        repoKey: "owner/repo",
        displayUrl: "https://github.com/Owner/Repo",
        owner: "Owner",
        repo: "Repo",
      });
    });

    it("normalizes http URL to https", () => {
      const result = normalizeGitHubUrl("http://github.com/Owner/Repo");
      expect(result).not.toBeNull();
      expect(result!.displayUrl).toBe("https://github.com/Owner/Repo");
    });

    it("handles trailing slash", () => {
      const result = normalizeGitHubUrl("https://github.com/Owner/Repo/");
      expect(result).not.toBeNull();
      expect(result!.repoKey).toBe("owner/repo");
    });

    it("preserves original casing in displayUrl", () => {
      const result = normalizeGitHubUrl("https://github.com/MyOrg/MyRepo");
      expect(result!.displayUrl).toBe("https://github.com/MyOrg/MyRepo");
      expect(result!.owner).toBe("MyOrg");
      expect(result!.repo).toBe("MyRepo");
    });

    it("lowercases repoKey for dedup", () => {
      const result1 = normalizeGitHubUrl("https://github.com/Owner/REPO");
      const result2 = normalizeGitHubUrl("https://github.com/OWNER/repo");
      expect(result1!.repoKey).toBe("owner/repo");
      expect(result2!.repoKey).toBe("owner/repo");
    });

    it("handles owner/repo with dots", () => {
      const result = normalizeGitHubUrl("https://github.com/some.org/my.repo");
      expect(result).not.toBeNull();
      expect(result!.repoKey).toBe("some.org/my.repo");
    });

    it("handles owner/repo with hyphens", () => {
      const result = normalizeGitHubUrl("https://github.com/my-org/my-repo");
      expect(result).not.toBeNull();
      expect(result!.repoKey).toBe("my-org/my-repo");
    });

    it("handles owner/repo with underscores", () => {
      const result = normalizeGitHubUrl("https://github.com/my_org/my_repo");
      expect(result).not.toBeNull();
      expect(result!.repoKey).toBe("my_org/my_repo");
    });

    it("trims whitespace", () => {
      const result = normalizeGitHubUrl("  https://github.com/Owner/Repo  ");
      expect(result).not.toBeNull();
      expect(result!.repoKey).toBe("owner/repo");
    });
  });

  describe("invalid URLs", () => {
    it("rejects user/org page (no repo)", () => {
      expect(normalizeGitHubUrl("https://github.com/Owner")).toBeNull();
    });

    it("rejects file path URL", () => {
      expect(
        normalizeGitHubUrl("https://github.com/Owner/Repo/blob/main/file.ts")
      ).toBeNull();
    });

    it("rejects tree URL", () => {
      expect(
        normalizeGitHubUrl("https://github.com/Owner/Repo/tree/main")
      ).toBeNull();
    });

    it("rejects issue URL", () => {
      expect(
        normalizeGitHubUrl("https://github.com/Owner/Repo/issues/123")
      ).toBeNull();
    });

    it("rejects pull request URL", () => {
      expect(
        normalizeGitHubUrl("https://github.com/Owner/Repo/pull/456")
      ).toBeNull();
    });

    it("rejects non-GitHub URL", () => {
      expect(normalizeGitHubUrl("https://gitlab.com/Owner/Repo")).toBeNull();
    });

    it("rejects malformed URL", () => {
      expect(normalizeGitHubUrl("not-a-url")).toBeNull();
    });

    it("rejects empty string", () => {
      expect(normalizeGitHubUrl("")).toBeNull();
    });

    it("rejects URL with extra path segments", () => {
      expect(
        normalizeGitHubUrl("https://github.com/Owner/Repo/extra")
      ).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// isValidGitHubRepoUrl
// ---------------------------------------------------------------------------

describe("isValidGitHubRepoUrl", () => {
  it("returns true for valid URL", () => {
    expect(isValidGitHubRepoUrl("https://github.com/Owner/Repo")).toBe(true);
  });

  it("returns false for invalid URL", () => {
    expect(isValidGitHubRepoUrl("https://github.com/Owner")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildOgImageUrl
// ---------------------------------------------------------------------------

describe("buildOgImageUrl", () => {
  it("constructs correct OG image URL", () => {
    const url = buildOgImageUrl("Owner", "Repo");
    expect(url).toBe("https://opengraph.githubassets.com/1/Owner/Repo");
  });

  it("preserves casing", () => {
    const url = buildOgImageUrl("MyOrg", "MyRepo");
    expect(url).toBe("https://opengraph.githubassets.com/1/MyOrg/MyRepo");
  });
});

// ---------------------------------------------------------------------------
// GitHubError helpers
// ---------------------------------------------------------------------------

describe("gitHubErrorToStatus", () => {
  it("maps NOT_FOUND to 404", () => {
    const err = new GitHubError("NOT_FOUND", "test");
    expect(gitHubErrorToStatus(err)).toBe(404);
  });

  it("maps RATE_LIMITED to 422", () => {
    const err = new GitHubError("RATE_LIMITED", "test");
    expect(gitHubErrorToStatus(err)).toBe(422);
  });

  it("maps FORBIDDEN to 422", () => {
    const err = new GitHubError("FORBIDDEN", "test");
    expect(gitHubErrorToStatus(err)).toBe(422);
  });

  it("maps UPSTREAM_ERROR to 422", () => {
    const err = new GitHubError("UPSTREAM_ERROR", "test");
    expect(gitHubErrorToStatus(err)).toBe(422);
  });

  it("maps NETWORK_ERROR to 422", () => {
    const err = new GitHubError("NETWORK_ERROR", "test");
    expect(gitHubErrorToStatus(err)).toBe(422);
  });

  it("maps TIMEOUT to 422", () => {
    const err = new GitHubError("TIMEOUT", "test");
    expect(gitHubErrorToStatus(err)).toBe(422);
  });
});

describe("gitHubErrorMessage", () => {
  it("returns user-friendly message for NOT_FOUND", () => {
    const err = new GitHubError("NOT_FOUND", "test");
    expect(gitHubErrorMessage(err)).toBe("Repository not found or is private");
  });

  it("returns user-friendly message for RATE_LIMITED", () => {
    const err = new GitHubError("RATE_LIMITED", "test");
    expect(gitHubErrorMessage(err)).toContain("rate limit");
  });

  it("returns user-friendly message for TIMEOUT", () => {
    const err = new GitHubError("TIMEOUT", "test");
    expect(gitHubErrorMessage(err)).toContain("timed out");
  });
});

// ---------------------------------------------------------------------------
// GitHubError class
// ---------------------------------------------------------------------------

describe("GitHubError", () => {
  it("is an instance of Error", () => {
    const err = new GitHubError("NOT_FOUND", "test message");
    expect(err).toBeInstanceOf(Error);
  });

  it("has correct name", () => {
    const err = new GitHubError("NOT_FOUND", "test message");
    expect(err.name).toBe("GitHubError");
  });

  it("has correct code", () => {
    const err = new GitHubError("RATE_LIMITED", "test message");
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("has correct message", () => {
    const err = new GitHubError("NOT_FOUND", "custom message");
    expect(err.message).toBe("custom message");
  });
});

// ---------------------------------------------------------------------------
// fetchGitHubMetadata
// ---------------------------------------------------------------------------

describe("fetchGitHubMetadata", () => {
  it("returns metadata for valid public repo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "my-repo",
          description: "A cool project",
          full_name: "owner/my-repo",
          owner: { login: "owner" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchGitHubMetadata("owner", "my-repo");

    expect(result).toEqual({
      owner: "owner",
      name: "my-repo",
      title: "my-repo",
      description: "A cool project",
      fullName: "owner/my-repo",
    });
  });

  it("handles repo with null description", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "my-repo",
          description: null,
          full_name: "owner/my-repo",
          owner: { login: "owner" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchGitHubMetadata("owner", "my-repo");
    expect(result.description).toBeNull();
  });

  it("handles renamed/transferred repo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "new-name",
          description: "Renamed repo",
          full_name: "new-owner/new-name",
          owner: { login: "new-owner" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchGitHubMetadata("old-owner", "old-name");

    expect(result.owner).toBe("new-owner");
    expect(result.name).toBe("new-name");
    expect(result.fullName).toBe("new-owner/new-name");
  });

  it("throws NOT_FOUND for 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 })
    );

    await expect(fetchGitHubMetadata("owner", "nonexistent")).rejects.toThrow(
      GitHubError
    );
    try {
      await fetchGitHubMetadata("owner", "nonexistent");
    } catch (err) {
      expect((err as GitHubError).code).toBe("NOT_FOUND");
    }
  });

  it("throws RATE_LIMITED for 403 with zero remaining", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Rate limit" }), {
        status: 403,
        headers: { "X-RateLimit-Remaining": "0" },
      })
    );

    await expect(fetchGitHubMetadata("owner", "repo")).rejects.toThrow(
      GitHubError
    );
    try {
      await fetchGitHubMetadata("owner", "repo");
    } catch (err) {
      expect((err as GitHubError).code).toBe("RATE_LIMITED");
    }
  });

  it("throws FORBIDDEN for 403 without rate limit header", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 })
    );

    await expect(fetchGitHubMetadata("owner", "repo")).rejects.toThrow(
      GitHubError
    );
    try {
      await fetchGitHubMetadata("owner", "repo");
    } catch (err) {
      expect((err as GitHubError).code).toBe("FORBIDDEN");
    }
  });

  it("throws UPSTREAM_ERROR for 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Server error" }), { status: 500 })
    );

    await expect(fetchGitHubMetadata("owner", "repo")).rejects.toThrow(
      GitHubError
    );
    try {
      await fetchGitHubMetadata("owner", "repo");
    } catch (err) {
      expect((err as GitHubError).code).toBe("UPSTREAM_ERROR");
    }
  });

  it("throws NETWORK_ERROR on fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network failed"));

    await expect(fetchGitHubMetadata("owner", "repo")).rejects.toThrow(
      GitHubError
    );
    try {
      await fetchGitHubMetadata("owner", "repo");
    } catch (err) {
      expect((err as GitHubError).code).toBe("NETWORK_ERROR");
    }
  });

  it("throws TIMEOUT on timeout error", async () => {
    const timeoutError = new Error("Timeout");
    timeoutError.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(timeoutError);

    await expect(fetchGitHubMetadata("owner", "repo")).rejects.toThrow(
      GitHubError
    );
    try {
      await fetchGitHubMetadata("owner", "repo");
    } catch (err) {
      expect((err as GitHubError).code).toBe("TIMEOUT");
    }
  });

  it("uses fallback values when API response missing fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({}), // empty response
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchGitHubMetadata("owner", "repo");

    expect(result.owner).toBe("owner"); // fallback to input
    expect(result.name).toBe("repo"); // fallback to input
    expect(result.title).toBe("owner/repo"); // fallback
    expect(result.description).toBeNull();
    expect(result.fullName).toBe("owner/repo"); // fallback
  });

  it("sends correct headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "repo",
          full_name: "owner/repo",
          owner: { login: "owner" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await fetchGitHubMetadata("owner", "repo");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/owner/repo");
    expect(init!.headers).toEqual(
      expect.objectContaining({
        "User-Agent": "pew-showcase/1.0",
        Accept: "application/vnd.github.v3+json",
      })
    );
  });
});
