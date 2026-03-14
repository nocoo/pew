/**
 * GET /api/projects/timeline — daily session counts per project for a date range.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getD1Client } from "@/lib/d1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimelineRow {
  date: string;
  project_name: string;
  session_count: number;
}

// ---------------------------------------------------------------------------
// GET — timeline data
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authResult.userId;

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to query params are required" },
      { status: 400 },
    );
  }

  const client = getD1Client();

  try {
    const result = await client.query<TimelineRow>(
      `SELECT
         DATE(sr.started_at) AS date,
         COALESCE(p.name, 'Unassigned') AS project_name,
         COUNT(*) AS session_count
       FROM session_records sr
       LEFT JOIN project_aliases pa
         ON pa.user_id = sr.user_id
         AND pa.source = sr.source
         AND pa.project_ref = sr.project_ref
       LEFT JOIN projects p ON p.id = pa.project_id
       WHERE sr.user_id = ?
         AND sr.started_at >= ?
         AND sr.started_at < ?
       GROUP BY date, project_name
       ORDER BY date`,
      [userId, from, to],
    );

    // Transform flat rows into { date, projects: { name: count } } entries
    const byDate = new Map<string, Record<string, number>>();
    for (const row of result.results) {
      let entry = byDate.get(row.date);
      if (!entry) {
        entry = {};
        byDate.set(row.date, entry);
      }
      entry[row.project_name] = row.session_count;
    }

    const timeline = [...byDate.entries()].map(([date, projects]) => ({
      date,
      projects,
    }));

    return NextResponse.json({ timeline });
  } catch (err) {
    console.error("Failed to query project timeline:", err);
    return NextResponse.json(
      { error: "Failed to query project timeline" },
      { status: 500 },
    );
  }
}
