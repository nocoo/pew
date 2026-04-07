/**
 * GET /api/showcases — list public showcases (no auth required)
 * POST /api/showcases — create new showcase (auth required)
 */

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShowcaseRow {
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
  // Joined user fields
  user_name: string | null;
  user_nickname: string | null;
  user_image: string | null;
  user_slug: string | null;
  // Computed
  upvote_count: number;
  has_upvoted?: number;
}

// ---------------------------------------------------------------------------
// GET — list showcases
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mine = url.searchParams.get("mine") === "1";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  // Auth check for mine=1
  const user = await resolveUser(request);
  if (mine && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbRead = await getDbRead();

  try {
    let showcases: ShowcaseRow[];
    let total: number;

    if (mine && user) {
      // Get current user's showcases (all, including hidden)
      const countResult = await dbRead.firstOrNull<{ count: number }>(
        "SELECT COUNT(*) as count FROM showcases WHERE user_id = ?",
        [user.userId]
      );
      total = countResult?.count ?? 0;

      const query = `
        SELECT
          s.id, s.user_id, s.repo_key, s.github_url, s.title, s.description,
          s.tagline, s.og_image_url, s.is_public, s.created_at, s.refreshed_at,
          u.name as user_name, u.nickname as user_nickname, u.image as user_image, u.slug as user_slug,
          (SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = s.id) as upvote_count,
          EXISTS(SELECT 1 FROM showcase_upvotes WHERE showcase_id = s.id AND user_id = ?) as has_upvoted
        FROM showcases s
        JOIN users u ON u.id = s.user_id
        WHERE s.user_id = ?
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT ? OFFSET ?
      `;
      const { results } = await dbRead.query<ShowcaseRow>(query, [
        user.userId,
        user.userId,
        limit,
        offset,
      ]);
      showcases = results;
    } else {
      // Get public showcases
      const countResult = await dbRead.firstOrNull<{ count: number }>(
        "SELECT COUNT(*) as count FROM showcases WHERE is_public = 1",
        []
      );
      total = countResult?.count ?? 0;

      if (user) {
        // Authenticated: include has_upvoted
        const query = `
          SELECT
            s.id, s.user_id, s.repo_key, s.github_url, s.title, s.description,
            s.tagline, s.og_image_url, s.is_public, s.created_at, s.refreshed_at,
            u.name as user_name, u.nickname as user_nickname, u.image as user_image, u.slug as user_slug,
            (SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = s.id) as upvote_count,
            EXISTS(SELECT 1 FROM showcase_upvotes WHERE showcase_id = s.id AND user_id = ?) as has_upvoted
          FROM showcases s
          JOIN users u ON u.id = s.user_id
          WHERE s.is_public = 1
          ORDER BY s.created_at DESC, s.id DESC
          LIMIT ? OFFSET ?
        `;
        const { results } = await dbRead.query<ShowcaseRow>(query, [user.userId, limit, offset]);
        showcases = results;
      } else {
        // Unauthenticated: no has_upvoted
        const query = `
          SELECT
            s.id, s.user_id, s.repo_key, s.github_url, s.title, s.description,
            s.tagline, s.og_image_url, s.is_public, s.created_at, s.refreshed_at,
            u.name as user_name, u.nickname as user_nickname, u.image as user_image, u.slug as user_slug,
            (SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = s.id) as upvote_count
          FROM showcases s
          JOIN users u ON u.id = s.user_id
          WHERE s.is_public = 1
          ORDER BY s.created_at DESC, s.id DESC
          LIMIT ? OFFSET ?
        `;
        const { results } = await dbRead.query<ShowcaseRow>(query, [limit, offset]);
        showcases = results;
      }
    }

    return NextResponse.json({
      showcases: showcases.map((s) => ({
        id: s.id,
        repo_key: s.repo_key,
        github_url: s.github_url,
        title: s.title,
        description: s.description,
        tagline: s.tagline,
        og_image_url: s.og_image_url,
        upvote_count: s.upvote_count,
        is_public: mine ? s.is_public === 1 : true,
        created_at: s.created_at,
        user: {
          id: s.user_id,
          name: s.user_name,
          nickname: s.user_nickname,
          image: s.user_image,
          slug: s.user_slug,
        },
        has_upvoted: s.has_upvoted !== undefined ? s.has_upvoted === 1 : null,
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ showcases: [], total: 0, limit, offset });
    }
    console.error("Failed to list showcases:", err);
    return NextResponse.json(
      { error: "Failed to list showcases" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create showcase
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

  const { github_url, tagline } = body as { github_url?: string; tagline?: string };

  if (!github_url || typeof github_url !== "string") {
    return NextResponse.json(
      { error: "github_url is required" },
      { status: 400 }
    );
  }

  // Validate tagline length
  if (tagline !== undefined && tagline !== null) {
    if (typeof tagline !== "string") {
      return NextResponse.json(
        { error: "tagline must be a string" },
        { status: 400 }
      );
    }
    if (tagline.length > 280) {
      return NextResponse.json(
        { error: "tagline must be 280 characters or less" },
        { status: 400 }
      );
    }
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
  try {
    const metadata = await fetchGitHubMetadata(owner, repo);
    title = metadata.title;
    description = metadata.description;
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

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  // Check if already exists
  try {
    const existing = await dbRead.firstOrNull<{ id: string }>(
      "SELECT id FROM showcases WHERE repo_key = ?",
      [repoKey]
    );
    if (existing) {
      return NextResponse.json(
        { error: "This repository has already been showcased" },
        { status: 409 }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!msg.includes("no such table")) {
      console.error("Failed to check showcase existence:", err);
      return NextResponse.json(
        { error: "Failed to check showcase existence" },
        { status: 500 }
      );
    }
    // Table doesn't exist yet — will be created with first insert or migration
  }

  // Insert showcase
  const id = nanoid();
  const ogImageUrl = buildOgImageUrl(owner, repo);
  const now = new Date().toISOString();

  try {
    await dbWrite.execute(
      `INSERT INTO showcases (id, user_id, repo_key, github_url, title, description, tagline, og_image_url, is_public, refreshed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [id, user.userId, repoKey, displayUrl, title, description, tagline || null, ogImageUrl, now, now, now]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE constraint failed")) {
      return NextResponse.json(
        { error: "This repository has already been showcased" },
        { status: 409 }
      );
    }
    console.error("Failed to create showcase:", err);
    return NextResponse.json(
      { error: "Failed to create showcase" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      id,
      repo_key: repoKey,
      github_url: displayUrl,
      title,
      description,
      tagline: tagline || null,
      og_image_url: ogImageUrl,
      is_public: true,
      upvote_count: 0,
      created_at: now,
    },
    { status: 201 }
  );
}
