/**
 * POST /api/admin/seasons/[seasonId]/sync-rosters — manual roster sync.
 *
 * Admin-only. Syncs team_members → season_team_members for all
 * registered teams in the given season. Requires the season to be
 * active with `allow_roster_changes = 1`.
 *
 * Returns `{ synced_teams: number }`.
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead, getDbWrite } from "@/lib/db";
import { deriveSeasonStatus } from "@/lib/seasons";
import { syncAllRostersForSeason } from "@/lib/season-roster";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ seasonId: string }> },
) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { seasonId } = await params;
  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    const season = await dbRead.getSeasonById(seasonId);

    if (!season) {
      return NextResponse.json({ error: "Season not found" }, { status: 404 });
    }

    const status = deriveSeasonStatus(season.start_date, season.end_date);
    if (status !== "active") {
      return NextResponse.json(
        { error: "Roster sync is only available for active seasons" },
        { status: 400 },
      );
    }

    if (!season.allow_roster_changes) {
      return NextResponse.json(
        { error: "Roster changes are not enabled for this season" },
        { status: 400 },
      );
    }

    const syncedTeams = await syncAllRostersForSeason(dbRead, dbWrite, seasonId);

    return NextResponse.json({ synced_teams: syncedTeams });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ error: "Season tables not yet migrated" }, { status: 503 });
    }
    console.error("Failed to sync rosters:", err);
    return NextResponse.json({ error: "Failed to sync rosters" }, { status: 500 });
  }
}
