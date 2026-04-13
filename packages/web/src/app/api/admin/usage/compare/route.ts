/**
 * GET /api/admin/usage/compare — compare token usage across multiple users.
 *
 * Query params:
 *   userIds  — comma-separated user IDs (required, max 10)
 *   from     — ISO date (default: 30 days ago)
 *   to       — ISO date (default: now)
 *   source   — optional agent filter (e.g. "claude-code")
 *   model    — optional model filter
 *   tzOffset — timezone offset in minutes (default: 0)
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead } from "@/lib/db";

const MAX_USERS = 10;
const DEFAULT_DAYS = 30;

export interface CompareUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  slug: string | null;
}

export interface DailyUsage {
  date: string;
  users: Record<string, number>;
}

export interface CompareResponse {
  users: CompareUser[];
  daily: DailyUsage[];
  sources: string[];
  models: string[];
}

export async function GET(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);

  // Parse userIds (required)
  const userIdsParam = url.searchParams.get("userIds");
  if (!userIdsParam?.trim()) {
    return NextResponse.json(
      { error: "userIds parameter is required" },
      { status: 400 }
    );
  }

  // Parse, dedupe, and preserve order
  const rawIds = userIdsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const userIds: string[] = [];
  for (const id of rawIds) {
    if (!seen.has(id)) {
      seen.add(id);
      userIds.push(id);
    }
  }

  if (userIds.length < 2) {
    return NextResponse.json(
      { error: "At least 2 unique user IDs are required" },
      { status: 400 }
    );
  }

  if (userIds.length > MAX_USERS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_USERS} users allowed` },
      { status: 400 }
    );
  }

  // Parse date range
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - DEFAULT_DAYS);

  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const fromDate = fromParam ? new Date(fromParam) : defaultFrom;
  const toDate = toParam ? new Date(toParam) : now;

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json(
      { error: "Invalid date format" },
      { status: 400 }
    );
  }

  // Optional filters
  const source = url.searchParams.get("source");
  const model = url.searchParams.get("model");
  const tzOffsetParam = url.searchParams.get("tzOffset");
  const tzOffset = tzOffsetParam !== null ? parseInt(tzOffsetParam, 10) : 0;

  // Validate tzOffset
  if (!Number.isFinite(tzOffset) || Math.abs(tzOffset) > 840) {
    return NextResponse.json(
      { error: "Invalid tzOffset value" },
      { status: 400 }
    );
  }

  const db = await getDbRead();

  try {
    // Fetch user info
    const userPlaceholders = userIds.map(() => "?").join(", ");
    const { results: usersUnordered } = await db.query<CompareUser>(
      `SELECT id, name, email, image, slug FROM users WHERE id IN (${userPlaceholders})`,
      userIds
    );

    // Re-order users to match request order and filter out non-existent IDs
    const userMap = new Map(usersUnordered.map((u) => [u.id, u]));
    const users: CompareUser[] = [];
    for (const id of userIds) {
      const user = userMap.get(id);
      if (user) users.push(user);
    }

    // Validate we have at least 2 valid users
    if (users.length < 2) {
      return NextResponse.json(
        { error: "At least 2 valid users are required" },
        { status: 400 }
      );
    }

    // Build date expression for grouping (apply tzOffset for local date)
    let dateExpr: string;
    let groupByExpr: string;
    const tzParams: unknown[] = [];

    if (tzOffset !== 0) {
      const offsetStr = String(-tzOffset);
      dateExpr = "date(datetime(hour_start, ? || ' minutes'))";
      groupByExpr = "date(datetime(hour_start, ? || ' minutes')), user_id, source, model";
      tzParams.push(offsetStr, offsetStr);
    } else {
      dateExpr = "date(hour_start)";
      groupByExpr = "date(hour_start), user_id, source, model";
    }

    // Build usage query with optional filters
    let usageQuery = `
      SELECT
        ${dateExpr} as date,
        user_id,
        SUM(total_tokens) as total_tokens,
        source,
        model
      FROM usage_records
      WHERE user_id IN (${userPlaceholders})
        AND hour_start >= ?
        AND hour_start < ?
    `;
    const usageParams: unknown[] = [
      ...tzParams,
      ...userIds,
      fromDate.toISOString(),
      toDate.toISOString(),
    ];

    if (source) {
      usageQuery += " AND source = ?";
      usageParams.push(source);
    }

    if (model) {
      usageQuery += " AND model = ?";
      usageParams.push(model);
    }

    usageQuery += ` GROUP BY ${groupByExpr}`;

    const { results: usageRows } = await db.query<{
      date: string;
      user_id: string;
      total_tokens: number;
      source: string;
      model: string;
    }>(usageQuery, usageParams);

    // Aggregate daily totals per user
    const dailyMap = new Map<string, Record<string, number>>();
    const sourcesSet = new Set<string>();
    const modelsSet = new Set<string>();

    for (const row of usageRows) {
      sourcesSet.add(row.source);
      modelsSet.add(row.model);

      let dayUsers = dailyMap.get(row.date);
      if (!dayUsers) {
        dayUsers = {};
        dailyMap.set(row.date, dayUsers);
      }
      dayUsers[row.user_id] = (dayUsers[row.user_id] ?? 0) + row.total_tokens;
    }

    // Convert to sorted array
    const daily: DailyUsage[] = Array.from(dailyMap.entries())
      .map(([date, usersData]) => ({ date, users: usersData }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const response: CompareResponse = {
      users,
      daily,
      sources: Array.from(sourcesSet).sort(),
      models: Array.from(modelsSet).sort(),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("Failed to compare user usage:", err);
    return NextResponse.json(
      { error: "Failed to compare user usage" },
      { status: 500 }
    );
  }
}
