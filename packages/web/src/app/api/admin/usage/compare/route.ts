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
import { sumCounts } from "@pew/core";
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

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
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
    const usersUnordered = await db.getAdminUsersByIds(userIds);

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

    const usageRows = await db.getAdminUsageComparison(
      userIds, fromDate.toISOString(), toDate.toISOString(),
      { tzOffset, ...(source ? { source } : {}), ...(model ? { model } : {}) },
    );

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
      dayUsers[row.user_id] = sumCounts(dayUsers[row.user_id] ?? 0, row.total_tokens);
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
