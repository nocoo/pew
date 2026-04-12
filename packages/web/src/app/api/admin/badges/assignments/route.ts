/**
 * GET/POST /api/admin/badges/assignments — admin-only badge assignment management.
 *
 * - GET  → list all assignments (filterable by status, badge, user)
 * - POST → assign badge to user
 */

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead, getDbWrite } from "@/lib/db";

// ---------------------------------------------------------------------------
// GET — list all badge assignments
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const badgeIdParam = url.searchParams.get("badgeId");
  const userIdParam = url.searchParams.get("userId");
  const status =
    (url.searchParams.get("status") as
      | "active"
      | "expired"
      | "revoked"
      | "cleared"
      | "all") ?? "all";
  const limit = Math.min(
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)),
    250,
  );
  const offset = Math.max(
    0,
    parseInt(url.searchParams.get("offset") ?? "0", 10),
  );

  const dbRead = await getDbRead();

  try {
    const assignments = await dbRead.listBadgeAssignments({
      ...(badgeIdParam && { badgeId: badgeIdParam }),
      ...(userIdParam && { userId: userIdParam }),
      status,
      limit,
      offset,
    });

    return NextResponse.json({ assignments });
  } catch (err) {
    console.error("Failed to list badge assignments:", err);
    return NextResponse.json(
      { error: "Failed to list badge assignments" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — assign badge to user
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

  const { badgeId, userId, note } = body;

  if (typeof badgeId !== "string" || badgeId.length === 0) {
    return NextResponse.json(
      { error: "badgeId is required" },
      { status: 400 },
    );
  }

  if (typeof userId !== "string" || userId.length === 0) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  try {
    // Validate badge exists and is not archived
    const badge = await dbRead.getBadge(badgeId);
    if (!badge) {
      return NextResponse.json({ error: "Badge not found" }, { status: 404 });
    }
    if (badge.is_archived === 1) {
      return NextResponse.json(
        { error: "Cannot assign archived badge" },
        { status: 400 },
      );
    }

    // Validate user exists
    const user = await dbRead.getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check for existing non-revoked assignment
    const existing = await dbRead.checkNonRevokedAssignment(badgeId, userId);
    if (existing.exists) {
      if (existing.isActive) {
        return NextResponse.json(
          {
            error:
              "User already has an active assignment for this badge. Revoke it first to re-assign.",
          },
          { status: 409 },
        );
      } else {
        return NextResponse.json(
          {
            error:
              "User has an expired (but not revoked) assignment for this badge. Clear it first to re-assign.",
          },
          { status: 409 },
        );
      }
    }

    // Calculate expiry (7 days from now)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const id = nanoid();
    const noteValue =
      typeof note === "string" && note.trim() ? note.trim() : null;

    await dbWrite.execute(
      `INSERT INTO badge_assignments (
        id, badge_id, user_id,
        snapshot_text, snapshot_icon, snapshot_bg, snapshot_fg,
        assigned_at, expires_at, assigned_by, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        badgeId,
        userId,
        badge.text,
        badge.icon,
        badge.color_bg,
        badge.color_text,
        now.toISOString(),
        expiresAt.toISOString(),
        admin.userId,
        noteValue,
      ],
    );

    return NextResponse.json({
      assignment: {
        id,
        badge_id: badgeId,
        user_id: userId,
        snapshot_text: badge.text,
        snapshot_icon: badge.icon,
        snapshot_bg: badge.color_bg,
        snapshot_fg: badge.color_text,
        assigned_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        assigned_by: admin.userId,
        note: noteValue,
        status: "active",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Handle unique constraint violation
    if (msg.includes("UNIQUE constraint failed")) {
      return NextResponse.json(
        {
          error:
            "Cannot assign badge: user already has a non-revoked assignment for this badge",
        },
        { status: 409 },
      );
    }
    console.error("Failed to assign badge:", err);
    return NextResponse.json(
      { error: "Failed to assign badge" },
      { status: 500 },
    );
  }
}
