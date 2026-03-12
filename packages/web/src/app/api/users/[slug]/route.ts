/**
 * GET /api/users/[slug] — public profile data for a user.
 *
 * No auth required. Returns user info + usage summary + records.
 *
 * Query params:
 *   days   — number of days to look back (default: 30, max: 365)
 *   source — filter by source (optional)
 *
 * Returns { user, records, summary }.
 */

import { NextResponse } from "next/server";
import { getD1Client } from "@/lib/d1";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SOURCES = new Set([
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "openclaw",
  "vscode-copilot",
]);

const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  name: string | null;
  image: string | null;
  slug: string;
  is_public: number | null;
  created_at: string;
}

interface UsageRow {
  source: string;
  model: string;
  hour_start: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // 1. Validate slug format (alphanumeric + hyphens, 1-64 chars)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug)) {
    return NextResponse.json(
      { error: "Invalid profile slug" },
      { status: 400 },
    );
  }

  const client = getD1Client();

  // 2. Look up user by slug (with is_public gate)
  let user: UserRow | null = null;
  let hasIsPublicColumn = true;

  try {
    user = await client.firstOrNull<UserRow>(
      "SELECT id, name, image, slug, created_at, is_public FROM users WHERE slug = ?",
      [slug],
    );
  } catch (err: unknown) {
    // Fallback: is_public column doesn't exist yet (pre-migration)
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("no such column")) {
      hasIsPublicColumn = false;
      user = await client.firstOrNull<UserRow>(
        "SELECT id, name, image, slug, created_at FROM users WHERE slug = ?",
        [slug],
      );
    } else {
      throw err;
    }
  }

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Return 404 if user is not public (don't leak existence)
  if (hasIsPublicColumn && !user.is_public) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // 3. Parse query params
  const url = new URL(request.url);
  const daysParam = url.searchParams.get("days");
  const sourceFilter = url.searchParams.get("source");

  let days = DEFAULT_DAYS;
  if (daysParam) {
    const parsed = parseInt(daysParam, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > MAX_DAYS) {
      return NextResponse.json(
        { error: `days must be 1-${MAX_DAYS}` },
        { status: 400 },
      );
    }
    days = parsed;
  }

  if (sourceFilter && !VALID_SOURCES.has(sourceFilter)) {
    return NextResponse.json(
      { error: `Invalid source: "${sourceFilter}"` },
      { status: 400 },
    );
  }

  // 4. Build query
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  const conditions = ["user_id = ?", "hour_start >= ?"];
  const queryParams: unknown[] = [user.id, fromDate.toISOString()];

  if (sourceFilter) {
    conditions.push("source = ?");
    queryParams.push(sourceFilter);
  }

  const sql = `
    SELECT
      source,
      model,
      date(hour_start) AS hour_start,
      SUM(input_tokens) AS input_tokens,
      SUM(cached_input_tokens) AS cached_input_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(reasoning_output_tokens) AS reasoning_output_tokens,
      SUM(total_tokens) AS total_tokens
    FROM usage_records
    WHERE ${conditions.join(" AND ")}
    GROUP BY date(hour_start), source, model
    ORDER BY hour_start ASC, source, model
  `;

  try {
    const result = await client.query<UsageRow>(sql, queryParams);
    const records = result.results;

    // Compute summary
    const summary = records.reduce(
      (acc, r) => ({
        input_tokens: acc.input_tokens + r.input_tokens,
        cached_input_tokens: acc.cached_input_tokens + r.cached_input_tokens,
        output_tokens: acc.output_tokens + r.output_tokens,
        reasoning_output_tokens:
          acc.reasoning_output_tokens + r.reasoning_output_tokens,
        total_tokens: acc.total_tokens + r.total_tokens,
      }),
      {
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
      },
    );

    return NextResponse.json({
      user: {
        name: user.name,
        image: user.image,
        slug: user.slug,
        created_at: user.created_at,
      },
      records,
      summary,
    });
  } catch (err) {
    console.error("Failed to query public profile:", err);
    return NextResponse.json(
      { error: "Failed to load profile data" },
      { status: 500 },
    );
  }
}
