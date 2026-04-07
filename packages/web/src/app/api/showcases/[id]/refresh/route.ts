/**
 * POST /api/showcases/[id]/refresh — re-fetch metadata from GitHub (owner only)
 *
 * Updates title, description, og_image_url, refreshed_at.
 * Handles repo renames/transfers with conflict detection.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";
import {
  fetchGitHubMetadata,
  buildOgImageUrl,
  GitHubError,
  gitHubErrorToStatus,
  gitHubErrorMessage,
  type GitHubMetadata,
} from "@/lib/github";

type RouteContext = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// POST — refresh showcase from GitHub
// ---------------------------------------------------------------------------

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const user = await resolveUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  // Find showcase
  let showcase: {
    id: string;
    user_id: string;
    repo_key: string;
    github_url: string;
  } | null;

  try {
    showcase = await dbRead.firstOrNull<{
      id: string;
      user_id: string;
      repo_key: string;
      github_url: string;
    }>(
      "SELECT id, user_id, repo_key, github_url FROM showcases WHERE id = ?",
      [id]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
    }
    console.error("Failed to find showcase:", err);
    return NextResponse.json(
      { error: "Failed to find showcase" },
      { status: 500 }
    );
  }

  if (!showcase) {
    return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
  }

  // Access control: owner only
  if (showcase.user_id !== user.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Parse owner/repo from current github_url
  const urlMatch = showcase.github_url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!urlMatch || !urlMatch[1] || !urlMatch[2]) {
    return NextResponse.json(
      { error: "Invalid stored GitHub URL" },
      { status: 500 }
    );
  }
  const [, currentOwner, currentRepo] = urlMatch;

  // Fetch fresh metadata from GitHub
  let metadata: GitHubMetadata;

  try {
    metadata = await fetchGitHubMetadata(currentOwner, currentRepo);
  } catch (err) {
    if (err instanceof GitHubError) {
      if (err.code === "NOT_FOUND") {
        // Repo was deleted or made private
        return NextResponse.json(
          { error: "Repository was deleted or made private" },
          { status: 410 }
        );
      }
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

  // Check if repo was renamed/transferred
  const newRepoKey = `${metadata.owner}/${metadata.name}`.toLowerCase();
  const newGithubUrl = `https://github.com/${metadata.owner}/${metadata.name}`;
  const ogImageUrl = buildOgImageUrl(metadata.owner, metadata.name);
  const now = new Date().toISOString();

  if (newRepoKey !== showcase.repo_key) {
    // Repo was renamed — check for conflict
    try {
      const existing = await dbRead.firstOrNull<{ id: string }>(
        "SELECT id FROM showcases WHERE repo_key = ? AND id != ?",
        [newRepoKey, id]
      );
      if (existing) {
        return NextResponse.json(
          {
            error: `Repository was renamed to ${metadata.owner}/${metadata.name} but that repo is already showcased`,
          },
          { status: 409 }
        );
      }
    } catch (err) {
      console.error("Failed to check for conflict:", err);
      return NextResponse.json(
        { error: "Failed to check for conflict" },
        { status: 500 }
      );
    }
  }

  // Update showcase
  try {
    await dbWrite.execute(
      `UPDATE showcases
       SET title = ?, description = ?, og_image_url = ?, repo_key = ?, github_url = ?,
           stars = ?, forks = ?, language = ?, license = ?, topics = ?, homepage = ?,
           refreshed_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        metadata.title,
        metadata.description,
        ogImageUrl,
        newRepoKey,
        newGithubUrl,
        metadata.stars,
        metadata.forks,
        metadata.language,
        metadata.license,
        JSON.stringify(metadata.topics),
        metadata.homepage,
        now,
        now,
        id,
      ]
    );
  } catch (err) {
    console.error("Failed to update showcase:", err);
    return NextResponse.json(
      { error: "Failed to update showcase" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    title: metadata.title,
    description: metadata.description,
    og_image_url: ogImageUrl,
    repo_key: newRepoKey,
    github_url: newGithubUrl,
    stars: metadata.stars,
    forks: metadata.forks,
    language: metadata.language,
    license: metadata.license,
    topics: metadata.topics,
    homepage: metadata.homepage,
    refreshed_at: now,
  });
}
