/**
 * POST /api/showcases/preview — fetch GitHub metadata for preview before submit.
 *
 * - Auth required
 * - Validates URL format
 * - Fetches repo metadata from GitHub API
 * - Checks if repo already showcased
 */

import { NextResponse } from "next/server";
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

// ---------------------------------------------------------------------------
// POST — preview showcase
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const user = await resolveUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { github_url } = body as { github_url?: string };
  if (!github_url || typeof github_url !== "string") {
    return NextResponse.json(
      { error: "github_url is required" },
      { status: 400 }
    );
  }

  // Validate and normalize URL
  const normalized = normalizeGitHubUrl(github_url);
  if (!normalized) {
    return NextResponse.json(
      { error: "Invalid GitHub repository URL. Must be https://github.com/owner/repo format." },
      { status: 400 }
    );
  }

  const { repoKey, displayUrl, owner, repo } = normalized;

  // Fetch metadata from GitHub
  let title: string;
  let description: string | null;
  let stars: number;
  let forks: number;
  let language: string | null;
  let license: string | null;
  let topics: string[];
  let homepage: string | null;
  try {
    const metadata = await fetchGitHubMetadata(owner, repo);
    title = metadata.title;
    description = metadata.description;
    stars = metadata.stars;
    forks = metadata.forks;
    language = metadata.language;
    license = metadata.license;
    topics = metadata.topics;
    homepage = metadata.homepage;
  } catch (err) {
    if (err instanceof GitHubError) {
      return NextResponse.json(
        { error: gitHubErrorMessage(err) },
        { status: gitHubErrorToStatus(err) }
      );
    }
    console.error("Failed to fetch GitHub metadata:", err);
    return NextResponse.json(
      { error: "Failed to fetch repository information" },
      { status: 500 }
    );
  }

  // Check if already showcased
  const dbRead = await getDbRead();
  let alreadyExists = false;
  try {
    const result = await dbRead.checkShowcaseExistsByRepoKey(repoKey);
    alreadyExists = result.exists;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!msg.includes("no such table")) {
      console.error("Failed to check showcase existence:", err);
      return NextResponse.json(
        { error: "Failed to check showcase existence" },
        { status: 500 }
      );
    }
    // Table doesn't exist yet — that's fine, alreadyExists = false
  }

  return NextResponse.json({
    repo_key: repoKey,
    github_url: displayUrl,
    title,
    description,
    og_image_url: buildOgImageUrl(owner, repo),
    already_exists: alreadyExists,
    stars,
    forks,
    language,
    license,
    topics,
    homepage,
  });
}
