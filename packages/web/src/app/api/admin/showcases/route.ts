/**
 * GET /api/admin/showcases — list all showcases (admin only)
 *
 * Provides extended user info (email) for moderation purposes.
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead } from "@/lib/db";
import {
  type AdminShowcaseRow,
  DEFAULT_ADMIN_SHOWCASE_LIMIT,
  MAX_ADMIN_SHOWCASE_LIMIT,
} from "@/lib/showcase-types";

// ---------------------------------------------------------------------------
// GET — admin list all showcases
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const isPublicParam = url.searchParams.get("is_public");
  const userIdParam = url.searchParams.get("user_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || String(DEFAULT_ADMIN_SHOWCASE_LIMIT), 10), MAX_ADMIN_SHOWCASE_LIMIT);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  const dbRead = await getDbRead();

  try {
    // Build WHERE clause
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (isPublicParam !== null) {
      conditions.push("s.is_public = ?");
      params.push(isPublicParam === "1" ? 1 : 0);
    }

    if (userIdParam) {
      conditions.push("s.user_id = ?");
      params.push(userIdParam);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get total count (affected by filters)
    const countResult = await dbRead.firstOrNull<{ count: number }>(
      `SELECT COUNT(*) as count FROM showcases s ${whereClause}`,
      params
    );
    const total = countResult?.count ?? 0;

    // Get statistics (always unfiltered for dashboard)
    const statsResult = await dbRead.firstOrNull<{
      total_showcases: number;
      unique_users: number;
      unique_github_owners: number;
    }>(
      `SELECT
        COUNT(*) as total_showcases,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT SUBSTR(repo_key, 1, INSTR(repo_key, '/') - 1)) as unique_github_owners
      FROM showcases`
    );

    const stats = {
      totalShowcases: statsResult?.total_showcases ?? 0,
      uniqueUsers: statsResult?.unique_users ?? 0,
      uniqueGithubOwners: statsResult?.unique_github_owners ?? 0,
    };

    // Get showcases
    const query = `
      SELECT
        s.id, s.user_id, s.repo_key, s.github_url, s.title, s.description,
        s.tagline, s.og_image_url, s.is_public, s.created_at, s.refreshed_at,
        s.stars, s.forks, s.language, s.license, s.topics, s.homepage,
        u.name as user_name, u.nickname as user_nickname, u.image as user_image,
        u.slug as user_slug, u.email as user_email,
        (SELECT COUNT(*) FROM showcase_upvotes WHERE showcase_id = s.id) as upvote_count
      FROM showcases s
      JOIN users u ON u.id = s.user_id
      ${whereClause}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ? OFFSET ?
    `;
    const { results } = await dbRead.query<AdminShowcaseRow>(query, [
      ...params,
      limit,
      offset,
    ]);

    return NextResponse.json({
      showcases: results.map((s) => ({
        id: s.id,
        repo_key: s.repo_key,
        github_url: s.github_url,
        title: s.title,
        description: s.description,
        tagline: s.tagline,
        og_image_url: s.og_image_url,
        upvote_count: s.upvote_count,
        is_public: s.is_public === 1,
        created_at: s.created_at,
        refreshed_at: s.refreshed_at,
        stars: s.stars ?? 0,
        forks: s.forks ?? 0,
        language: s.language ?? null,
        license: s.license ?? null,
        topics: s.topics ? JSON.parse(s.topics as string) : [],
        homepage: s.homepage ?? null,
        user: {
          id: s.user_id,
          email: s.user_email,
          name: s.user_name,
          nickname: s.user_nickname,
          image: s.user_image,
          slug: s.user_slug,
        },
      })),
      total,
      limit,
      offset,
      stats,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({
        showcases: [],
        total: 0,
        limit,
        offset,
        stats: { totalShowcases: 0, uniqueUsers: 0, uniqueGithubOwners: 0 },
      });
    }
    console.error("Failed to list showcases:", err);
    return NextResponse.json(
      { error: "Failed to list showcases" },
      { status: 500 }
    );
  }
}
