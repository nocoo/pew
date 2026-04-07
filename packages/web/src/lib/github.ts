/**
 * GitHub integration helpers for Showcase feature.
 *
 * - URL validation and normalization
 * - Repository metadata fetching
 * - OG image URL construction
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NormalizedGitHubUrl {
  repoKey: string;    // "owner/repo" lowercase
  displayUrl: string; // "https://github.com/Owner/Repo" original casing
  owner: string;      // original casing
  repo: string;       // original casing
}

export interface GitHubMetadata {
  owner: string;           // current owner (may differ if renamed)
  name: string;            // current repo name (may differ if renamed)
  title: string;           // repo name for display
  description: string | null;
  fullName: string;        // "owner/repo" from API (current)
}

export type GitHubErrorCode =
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "FORBIDDEN"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT";

export class GitHubError extends Error {
  constructor(
    public readonly code: GitHubErrorCode,
    message: string
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

// ---------------------------------------------------------------------------
// URL Validation & Normalization
// ---------------------------------------------------------------------------

/**
 * Regex for valid GitHub repository URLs.
 * Accepts: https://github.com/owner/repo or http://... with optional trailing slash.
 * Rejects: file paths, issue URLs, user/org pages, etc.
 */
const GITHUB_REPO_PATTERN =
  /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/;

/**
 * Validate and normalize a GitHub repository URL.
 *
 * @param url - Raw URL string from user input
 * @returns Normalized URL info, or null if invalid
 *
 * @example
 * normalizeGitHubUrl("https://github.com/Owner/Repo/")
 * // => { repoKey: "owner/repo", displayUrl: "https://github.com/Owner/Repo", owner: "Owner", repo: "Repo" }
 */
export function normalizeGitHubUrl(url: string): NormalizedGitHubUrl | null {
  const trimmed = url.trim();
  const match = trimmed.match(GITHUB_REPO_PATTERN);
  if (!match || !match[1] || !match[2]) return null;

  const owner = match[1];
  const repo = match[2];
  return {
    repoKey: `${owner}/${repo}`.toLowerCase(),
    displayUrl: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
  };
}

/**
 * Check if a string is a valid GitHub repository URL.
 */
export function isValidGitHubRepoUrl(url: string): boolean {
  return normalizeGitHubUrl(url) !== null;
}

// ---------------------------------------------------------------------------
// Metadata Fetching
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch repository metadata from GitHub API.
 *
 * @param owner - Repository owner (case-insensitive)
 * @param repo - Repository name (case-insensitive)
 * @returns Metadata including current owner/name (handles renames)
 * @throws GitHubError on failure
 */
export async function fetchGitHubMetadata(
  owner: string,
  repo: string
): Promise<GitHubMetadata> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": "pew-showcase/1.0",
        Accept: "application/vnd.github.v3+json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new GitHubError("TIMEOUT", "GitHub API request timed out");
    }
    throw new GitHubError("NETWORK_ERROR", "Failed to connect to GitHub");
  }

  if (res.status === 404) {
    throw new GitHubError("NOT_FOUND", "Repository not found or is private");
  }

  if (res.status === 403) {
    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (remaining === "0") {
      throw new GitHubError(
        "RATE_LIMITED",
        "GitHub API rate limit exceeded. Try again later."
      );
    }
    throw new GitHubError("FORBIDDEN", "Cannot access repository");
  }

  if (!res.ok) {
    throw new GitHubError(
      "UPSTREAM_ERROR",
      `GitHub API error: ${res.status}`
    );
  }

  const data = await res.json();

  return {
    owner: data.owner?.login || owner,
    name: data.name || repo,
    title: data.name || `${owner}/${repo}`,
    description: data.description || null,
    fullName: data.full_name || `${owner}/${repo}`,
  };
}

// ---------------------------------------------------------------------------
// OG Image
// ---------------------------------------------------------------------------

/**
 * Construct GitHub OG image URL for a repository.
 *
 * Uses opengraph.githubassets.com which generates dynamic preview images.
 * The "1" is a placeholder hash that GitHub accepts.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 */
export function buildOgImageUrl(owner: string, repo: string): string {
  return `https://opengraph.githubassets.com/1/${owner}/${repo}`;
}

// ---------------------------------------------------------------------------
// Error Mapping
// ---------------------------------------------------------------------------

/**
 * Map GitHubError to HTTP status code for API responses.
 */
export function gitHubErrorToStatus(error: GitHubError): number {
  switch (error.code) {
    case "NOT_FOUND":
      return 404;
    case "RATE_LIMITED":
    case "FORBIDDEN":
    case "UPSTREAM_ERROR":
    case "NETWORK_ERROR":
    case "TIMEOUT":
      return 422;
    default:
      return 500;
  }
}

/**
 * Get user-friendly error message for GitHubError.
 */
export function gitHubErrorMessage(error: GitHubError): string {
  switch (error.code) {
    case "NOT_FOUND":
      return "Repository not found or is private";
    case "RATE_LIMITED":
      return "GitHub API rate limit exceeded. Try again later.";
    case "FORBIDDEN":
      return "Cannot access repository";
    case "UPSTREAM_ERROR":
      return "GitHub is temporarily unavailable. Try again later.";
    case "NETWORK_ERROR":
      return "Failed to connect to GitHub";
    case "TIMEOUT":
      return "GitHub API request timed out. Try again later.";
    default:
      return "Unknown error occurred";
  }
}
