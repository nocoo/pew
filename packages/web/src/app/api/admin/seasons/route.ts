/**
 * GET/POST /api/admin/seasons — admin-only season management.
 *
 * - GET  → list all seasons with computed status and team_count
 * - POST → create a new season
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getD1Client } from "@/lib/d1";
import { deriveSeasonStatus } from "@/lib/seasons";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]{1,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// GET — list all seasons
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getD1Client();

  try {
    const { results } = await client.query<{
      id: string;
      name: string;
      slug: string;
      start_date: string;
      end_date: string;
      created_at: string;
      team_count: number;
      allow_late_registration: number;
      allow_roster_changes: number;
      allow_late_withdrawal: number;
    }>(
      `SELECT
         s.id, s.name, s.slug, s.start_date, s.end_date, s.created_at,
         s.allow_late_registration, s.allow_roster_changes, s.allow_late_withdrawal,
         COUNT(st.id) AS team_count
       FROM seasons s
       LEFT JOIN season_teams st ON st.season_id = s.id
       GROUP BY s.id
       ORDER BY s.start_date DESC`
    );

    const seasons = results.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      start_date: r.start_date,
      end_date: r.end_date,
      status: deriveSeasonStatus(r.start_date, r.end_date),
      team_count: r.team_count,
      created_at: r.created_at,
      allow_late_registration: !!r.allow_late_registration,
      allow_roster_changes: !!r.allow_roster_changes,
      allow_late_withdrawal: !!r.allow_late_withdrawal,
    }));

    return NextResponse.json({ seasons });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Season tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to list seasons:", err);
    return NextResponse.json(
      { error: "Failed to list seasons" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create a new season
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, slug, start_date, end_date } = body as {
    name?: string;
    slug?: string;
    start_date?: string;
    end_date?: string;
  };

  // Extract toggle flags (default false)
  const allow_late_registration = !!body.allow_late_registration;
  const allow_roster_changes = !!body.allow_roster_changes;
  const allow_late_withdrawal = !!body.allow_late_withdrawal;

  // Validate name
  if (!name || typeof name !== "string" || name.length < 1 || name.length > 64) {
    return NextResponse.json(
      { error: "name must be 1-64 characters" },
      { status: 400 }
    );
  }

  // Validate slug
  if (!slug || typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: "slug must be 1-32 lowercase alphanumeric or hyphens" },
      { status: 400 }
    );
  }

  // Validate dates
  if (!start_date || typeof start_date !== "string" || !isValidDate(start_date)) {
    return NextResponse.json(
      { error: "start_date must be YYYY-MM-DD format" },
      { status: 400 }
    );
  }
  if (!end_date || typeof end_date !== "string" || !isValidDate(end_date)) {
    return NextResponse.json(
      { error: "end_date must be YYYY-MM-DD format" },
      { status: 400 }
    );
  }
  if (end_date < start_date) {
    return NextResponse.json(
      { error: "end_date must be >= start_date" },
      { status: 400 }
    );
  }

  const client = getD1Client();

  try {
    // Check slug uniqueness
    const existing = await client.firstOrNull<{ id: string }>(
      "SELECT id FROM seasons WHERE slug = ?",
      [slug]
    );
    if (existing) {
      return NextResponse.json(
        { error: "A season with this slug already exists" },
        { status: 409 }
      );
    }

    const id = crypto.randomUUID();
    await client.execute(
      `INSERT INTO seasons (id, name, slug, start_date, end_date, created_by, allow_late_registration, allow_roster_changes, allow_late_withdrawal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, slug, start_date, end_date, admin.userId, allow_late_registration ? 1 : 0, allow_roster_changes ? 1 : 0, allow_late_withdrawal ? 1 : 0]
    );

    return NextResponse.json(
      {
        id,
        name,
        slug,
        start_date,
        end_date,
        status: deriveSeasonStatus(start_date, end_date),
        created_at: new Date().toISOString(),
        allow_late_registration,
        allow_roster_changes,
        allow_late_withdrawal,
      },
      { status: 201 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { error: "Season tables not yet migrated" },
        { status: 503 }
      );
    }
    console.error("Failed to create season:", err);
    return NextResponse.json(
      { error: "Failed to create season" },
      { status: 500 }
    );
  }
}
