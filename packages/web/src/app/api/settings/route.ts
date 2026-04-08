/**
 * GET/PATCH /api/settings — user settings (nickname, slug, etc.)
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned to the client. */
interface UserSettings {
  nickname: string | null;
  slug: string | null;
  is_public: boolean;
}

// ---------------------------------------------------------------------------
// GET — read current settings
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbRead = await getDbRead();

  try {
    const row = await dbRead.getUserSettings(authResult.userId);

    if (!row) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      nickname: row.nickname,
      slug: row.slug,
      is_public: row.is_public === 1,
    } satisfies UserSettings);
  } catch (err) {
    // Layered fallback: strip missing columns one at a time so we preserve
    // as much data as possible.
    const msg = err instanceof Error ? err.message : "";
    if (!msg.includes("no such column")) {
      console.error("Failed to load settings:", err);
      return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
    }

    // Level 1: is_public missing but nickname exists
    try {
      const row = await dbRead.firstOrNull<{ nickname: string | null; slug: string | null }>(
        "SELECT nickname, slug FROM users WHERE id = ?",
        [authResult.userId],
      );
      if (!row) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json({ nickname: row.nickname, slug: row.slug, is_public: false });
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : "";
      if (!msg2.includes("no such column")) {
        console.error("Failed to load settings:", err2);
        return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
      }
    }

    // Level 2: both nickname and is_public missing
    const row = await dbRead.firstOrNull<{ slug: string | null }>(
      "SELECT slug FROM users WHERE id = ?",
      [authResult.userId],
    );
    if (!row) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ nickname: null, slug: row.slug, is_public: false });
  }
}

// ---------------------------------------------------------------------------
// PATCH — update settings
// ---------------------------------------------------------------------------

export async function PATCH(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  const sets: string[] = [];
  const params: unknown[] = [];

  if ("nickname" in body) {
    const nickname = body.nickname;
    if (nickname !== null && typeof nickname !== "string") {
      return NextResponse.json(
        { error: "nickname must be a string or null" },
        { status: 400 },
      );
    }
    if (typeof nickname === "string" && (nickname.length < 1 || nickname.length > 32)) {
      return NextResponse.json(
        { error: "nickname must be 1-32 characters" },
        { status: 400 },
      );
    }
    sets.push("nickname = ?");
    params.push(nickname);
  }

  if ("slug" in body) {
    const slug = body.slug;
    if (slug !== null && typeof slug !== "string") {
      return NextResponse.json(
        { error: "slug must be a string or null" },
        { status: 400 },
      );
    }
    if (typeof slug === "string") {
      if (slug.length < 2 || slug.length > 32) {
        return NextResponse.json(
          { error: "slug must be 2-32 characters" },
          { status: 400 },
        );
      }
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
        return NextResponse.json(
          { error: "slug must be lowercase alphanumeric with optional hyphens" },
          { status: 400 },
        );
      }

      // Check uniqueness
      const slugTaken = await dbRead.checkSlugExists(slug, authResult.userId);
      if (slugTaken) {
        return NextResponse.json(
          { error: "slug is already taken" },
          { status: 409 },
        );
      }
    }
    sets.push("slug = ?");
    params.push(slug);
  }

  if ("is_public" in body) {
    const isPublic = body.is_public;
    if (typeof isPublic !== "boolean") {
      return NextResponse.json(
        { error: "is_public must be a boolean" },
        { status: 400 },
      );
    }
    sets.push("is_public = ?");
    params.push(isPublic ? 1 : 0);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  sets.push("updated_at = datetime('now')");
  params.push(authResult.userId);

  try {
    await dbWrite.execute(
      `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
      params,
    );

    // Return updated settings
    const row = await dbRead.getUserSettings(authResult.userId);

    return NextResponse.json(
      row
        ? { nickname: row.nickname, slug: row.slug, is_public: row.is_public === 1 } satisfies UserSettings
        : null,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such column")) {
      return NextResponse.json(
        { error: "Nickname feature not available yet — database migration pending" },
        { status: 503 },
      );
    }
    console.error("Failed to update settings:", err);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
