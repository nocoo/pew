/**
 * GET /api/leaderboard — public leaderboard rankings.
 *
 * Query params:
 *   period — "week" | "month" | "all" (default: "week")
 *   limit  — max entries to return (default: 50, max: 100)
 *   team   — team ID for team-scoped leaderboard (optional)
 *
 * Returns { period, entries[] } where each entry has user info + total tokens.
 */

import { NextResponse } from "next/server";
import { getD1Client } from "@/lib/d1";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_PERIODS = new Set(["week", "month", "all"]);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeaderboardRow {
  user_id: string;
  name: string | null;
  nickname: string | null;
  image: string | null;
  slug: string | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function periodStartDate(period: string): string | null {
  if (period === "all") return null;

  const now = new Date();
  if (period === "week") {
    now.setDate(now.getDate() - 7);
  } else {
    // month
    now.setDate(now.getDate() - 30);
  }
  return now.toISOString();
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "week";
  const limitParam = url.searchParams.get("limit");
  const teamId = url.searchParams.get("team");

  // Validate period
  if (!VALID_PERIODS.has(period)) {
    return NextResponse.json(
      { error: `Invalid period: "${period}". Use week, month, or all.` },
      { status: 400 },
    );
  }

  // Validate limit
  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return NextResponse.json(
        { error: `limit must be 1-${MAX_LIMIT}` },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  const client = getD1Client();
  const fromDate = periodStartDate(period);

  const conditions = ["1=1"];
  const params: unknown[] = [];

  if (fromDate) {
    conditions.push("ur.hour_start >= ?");
    params.push(fromDate);
  }

  // Team filter: only include team members (requires teams tables to exist)
  let teamJoin = "";
  if (teamId) {
    teamJoin = "JOIN team_members tm ON tm.user_id = ur.user_id";
    conditions.push("tm.team_id = ?");
    params.push(teamId);
  } else {
    // Public leaderboard only shows users who opted in and have a slug
    conditions.push("u.is_public = 1");
    conditions.push("u.slug IS NOT NULL");
  }

  params.push(limit);

  // Try with nickname column first, fall back without it
  const buildSql = (withNickname: boolean) => `
    SELECT
      ur.user_id,
      u.name,
      ${withNickname ? "u.nickname," : ""}
      u.image,
      u.slug,
      SUM(ur.total_tokens) AS total_tokens,
      SUM(ur.input_tokens) AS input_tokens,
      SUM(ur.output_tokens) AS output_tokens,
      SUM(ur.cached_input_tokens) AS cached_input_tokens
    FROM usage_records ur
    JOIN users u ON u.id = ur.user_id
    ${teamJoin}
    WHERE ${conditions.join(" AND ")}
    GROUP BY ur.user_id
    ORDER BY total_tokens DESC
    LIMIT ?
  `;

  try {
    let result: { results: LeaderboardRow[] };
    try {
      result = await client.query<LeaderboardRow>(buildSql(true), params);
    } catch (firstErr) {
      // Fallback: nickname column or team_members table may not exist yet
      const msg = firstErr instanceof Error ? firstErr.message : "";
      if (msg.includes("no such column") || msg.includes("no such table")) {
        // Retry without nickname and without team join
        const fallbackConditions = ["1=1"];
        const fallbackParams: unknown[] = [];
        if (fromDate) {
          fallbackConditions.push("ur.hour_start >= ?");
          fallbackParams.push(fromDate);
        }
        fallbackConditions.push("u.slug IS NOT NULL");
        fallbackParams.push(limit);

        const fallbackSql = `
          SELECT
            ur.user_id,
            u.name,
            u.image,
            u.slug,
            SUM(ur.total_tokens) AS total_tokens,
            SUM(ur.input_tokens) AS input_tokens,
            SUM(ur.output_tokens) AS output_tokens,
            SUM(ur.cached_input_tokens) AS cached_input_tokens
          FROM usage_records ur
          JOIN users u ON u.id = ur.user_id
          WHERE ${fallbackConditions.join(" AND ")}
          GROUP BY ur.user_id
          ORDER BY total_tokens DESC
          LIMIT ?
        `;
        result = await client.query<LeaderboardRow>(fallbackSql, fallbackParams);
      } else {
        throw firstErr;
      }
    }

    const entries = result.results.map((row, index) => ({
      rank: index + 1,
      user: {
        name: row.nickname ?? row.name,
        image: row.image,
        slug: row.slug,
      },
      total_tokens: row.total_tokens,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cached_input_tokens: row.cached_input_tokens,
    }));

    return NextResponse.json({ period, entries });
  } catch (err) {
    console.error("Failed to query leaderboard:", err);
    return NextResponse.json(
      { error: "Failed to load leaderboard" },
      { status: 500 },
    );
  }
}
