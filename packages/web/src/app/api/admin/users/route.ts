/**
 * GET /api/admin/users — search users (admin only).
 *
 * Query params:
 *   q     — search query (name or email)
 *   limit — max results (default: 20, max: 50)
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead } from "@/lib/db";

export async function GET(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const limitParam = url.searchParams.get("limit");

  let limit = 20;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 50) {
      limit = parsed;
    }
  }

  if (!query.trim()) {
    return NextResponse.json({ users: [] });
  }

  const dbRead = await getDbRead();

  try {
    const searchPattern = `%${query.trim()}%`;
    const { results } = await dbRead.query<{
      id: string;
      name: string | null;
      email: string;
      image: string | null;
    }>(
      `SELECT id, name, email, image FROM users
       WHERE name LIKE ? OR email LIKE ?
       ORDER BY name ASC
       LIMIT ?`,
      [searchPattern, searchPattern, limit]
    );

    return NextResponse.json({ users: results });
  } catch (err) {
    console.error("Failed to search users:", err);
    return NextResponse.json(
      { error: "Failed to search users" },
      { status: 500 }
    );
  }
}
