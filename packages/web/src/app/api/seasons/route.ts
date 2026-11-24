/**
 * GET /api/seasons — public season list.
 *
 * - No auth required
 * - Optional `status` query filter ("upcoming" | "active" | "ended")
 * - Returns seasons with computed status, team_count, and has_snapshot
 * - Sorted: active first, then upcoming, then ended (by start_date DESC)
 */

import { NextResponse } from "next/server";
import type { SeasonStatus } from "@pew/core";
import { getDbRead } from "@/lib/db";
import { deriveSeasonStatus } from "@/lib/seasons";

const VALID_STATUSES = new Set<SeasonStatus>(["upcoming", "active", "ended"]);

// Sort priority: active=0, upcoming=1, ended=2
const STATUS_ORDER: Record<SeasonStatus, number> = {
  active: 0,
  upcoming: 1,
  ended: 2,
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") as SeasonStatus | null;

  // Validate optional status filter
  if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
    return NextResponse.json(
      { error: "Invalid status filter. Must be: upcoming, active, or ended" },
      { status: 400 },
    );
  }

  const db = await getDbRead();

  try {
    const results = await db.listSeasons();

    let seasons = results.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      start_date: r.start_date,
      end_date: r.end_date,
      status: deriveSeasonStatus(r.start_date, r.end_date),
      team_count: r.team_count,
      has_snapshot: r.has_snapshot === 1,
      allow_late_registration: r.allow_late_registration === 1,
      allow_late_withdrawal: r.allow_late_withdrawal === 1,
      created_at: r.created_at,
    }));

    // Apply optional status filter (computed, not in SQL)
    if (statusFilter) {
      seasons = seasons.filter((s) => s.status === statusFilter);
    }

    // Sort: active > upcoming > ended, then by start_date DESC within group
    seasons.sort((a, b) => {
      const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (orderDiff !== 0) return orderDiff;
      // Within same status group, more recent start_date first
      return b.start_date.localeCompare(a.start_date);
    });

    return NextResponse.json({ seasons });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ seasons: [] });
    }
    console.error("Failed to list seasons:", err);
    return NextResponse.json({ error: "Failed to list seasons" }, { status: 500 });
  }
}
