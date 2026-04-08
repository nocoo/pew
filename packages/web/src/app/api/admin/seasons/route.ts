/**
 * GET/POST /api/admin/seasons — admin-only season management.
 *
 * - GET  → list all seasons with computed status and team_count
 * - POST → create a new season
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead, getDbWrite } from "@/lib/db";
import { deriveSeasonStatus } from "@/lib/seasons";
import { autoRegisterTeamsForSeason } from "@/lib/auto-register";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]{1,32}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/;

function isValidDatetime(s: string): boolean {
  if (!DATETIME_RE.test(s)) return false;
  const d = new Date(s);
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

  const dbRead = await getDbRead();

  try {
    const { results } = await dbRead.query<{
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
  if (!start_date || typeof start_date !== "string" || !isValidDatetime(start_date)) {
    return NextResponse.json(
      { error: "start_date must be ISO 8601 UTC format (YYYY-MM-DDTHH:mmZ)" },
      { status: 400 }
    );
  }
  if (!end_date || typeof end_date !== "string" || !isValidDatetime(end_date)) {
    return NextResponse.json(
      { error: "end_date must be ISO 8601 UTC format (YYYY-MM-DDTHH:mmZ)" },
      { status: 400 }
    );
  }
  if (new Date(end_date).getTime() < new Date(start_date).getTime()) {
    return NextResponse.json(
      { error: "end_date must be >= start_date" },
      { status: 400 }
    );
  }

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    // Check slug uniqueness
    const existing = await dbRead.firstOrNull<{ id: string }>(
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
    await dbWrite.execute(
      `INSERT INTO seasons (id, name, slug, start_date, end_date, created_by, allow_late_registration, allow_roster_changes, allow_late_withdrawal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, slug, start_date, end_date, admin.userId, allow_late_registration ? 1 : 0, allow_roster_changes ? 1 : 0, allow_late_withdrawal ? 1 : 0]
    );

    // Auto-register teams that have opted in (best-effort, don't fail the request)
    // Note: autoRegisterTeamsForSeason enforces the same rules as manual registration
    // (no ended seasons, no active seasons without late_registration)
    let autoRegistered = 0;
    try {
      const result = await autoRegisterTeamsForSeason(dbRead, dbWrite, id);
      autoRegistered = result.registered;
    } catch (err) {
      console.error("Auto-registration failed (non-fatal):", err);
    }

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
        auto_registered_teams: autoRegistered,
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
