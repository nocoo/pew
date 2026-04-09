/**
 * GET    /api/showcases/[id] — get single showcase
 * PATCH  /api/showcases/[id] — update showcase (owner or admin)
 * DELETE /api/showcases/[id] — delete showcase (owner or admin)
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbRead, getDbWrite } from "@/lib/db";
import { isAdminUser } from "@/lib/admin";
import { MAX_TAGLINE_LENGTH } from "@/lib/showcase-types";

type RouteContext = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// GET — get single showcase
// ---------------------------------------------------------------------------

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const user = await resolveUser(request);
  const admin = user ? await isAdminUser(user) : false;

  const dbRead = await getDbRead();

  try {
    const showcase = await dbRead.getShowcaseById(id, user?.userId);

    if (!showcase) {
      return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
    }

    // Access control: hidden showcases only visible to owner or admin
    if (showcase.is_public !== 1) {
      const isOwner = user && showcase.user_id === user.userId;
      if (!isOwner && !admin) {
        return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
      }
    }

    return NextResponse.json({
      id: showcase.id,
      repo_key: showcase.repo_key,
      github_url: showcase.github_url,
      title: showcase.title,
      description: showcase.description,
      tagline: showcase.tagline,
      og_image_url: showcase.og_image_url,
      upvote_count: showcase.upvote_count,
      is_public: showcase.is_public === 1,
      created_at: showcase.created_at,
      refreshed_at: showcase.refreshed_at,
      user: {
        id: showcase.user_id,
        name: showcase.user_name,
        nickname: showcase.user_nickname,
        image: showcase.user_image,
        slug: showcase.user_slug,
      },
      has_upvoted: showcase.has_upvoted !== undefined ? showcase.has_upvoted === 1 : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
    }
    console.error("Failed to get showcase:", err);
    return NextResponse.json(
      { error: "Failed to get showcase" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH — update showcase
// ---------------------------------------------------------------------------

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const user = await resolveUser(request);
  if (!user) {
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
  const admin = await isAdminUser(user);

  // Find showcase
  let showcase: { id: string; user_id: string } | null;
  try {
    showcase = await dbRead.getShowcaseOwner(id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
    }
    console.error("Failed to find showcase:", err);
    return NextResponse.json(
      { error: "Failed to find showcase" },
      { status: 500 }
    );
  }

  if (!showcase) {
    return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
  }

  // Access control: owner or admin
  const isOwner = showcase.user_id === user.userId;
  if (!isOwner && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Validate input
  const { tagline, is_public } = body as { tagline?: string | null; is_public?: boolean };

  if (tagline !== undefined && tagline !== null) {
    if (typeof tagline !== "string") {
      return NextResponse.json(
        { error: "tagline must be a string" },
        { status: 400 }
      );
    }
    if (tagline.length > MAX_TAGLINE_LENGTH) {
      return NextResponse.json(
        { error: `tagline must be ${MAX_TAGLINE_LENGTH} characters or less` },
        { status: 400 }
      );
    }
  }

  if (is_public !== undefined && typeof is_public !== "boolean") {
    return NextResponse.json(
      { error: "is_public must be a boolean" },
      { status: 400 }
    );
  }

  // Build UPDATE statement
  const updates: string[] = [];
  const params: unknown[] = [];

  if (tagline !== undefined) {
    updates.push("tagline = ?");
    params.push(tagline);
  }

  if (is_public !== undefined) {
    updates.push("is_public = ?");
    params.push(is_public ? 1 : 0);
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  updates.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  try {
    await dbWrite.execute(
      `UPDATE showcases SET ${updates.join(", ")} WHERE id = ?`,
      params
    );
  } catch (err) {
    console.error("Failed to update showcase:", err);
    return NextResponse.json(
      { error: "Failed to update showcase" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

// ---------------------------------------------------------------------------
// DELETE — delete showcase
// ---------------------------------------------------------------------------

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const user = await resolveUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();
  const admin = await isAdminUser(user);

  // Find showcase
  let showcase: { id: string; user_id: string } | null;
  try {
    showcase = await dbRead.getShowcaseOwner(id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
    }
    console.error("Failed to find showcase:", err);
    return NextResponse.json(
      { error: "Failed to find showcase" },
      { status: 500 }
    );
  }

  if (!showcase) {
    return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
  }

  // Access control: owner or admin
  const isOwner = showcase.user_id === user.userId;
  if (!isOwner && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Delete showcase (upvotes cascade due to ON DELETE CASCADE)
    await dbWrite.execute("DELETE FROM showcases WHERE id = ?", [id]);
  } catch (err) {
    console.error("Failed to delete showcase:", err);
    return NextResponse.json(
      { error: "Failed to delete showcase" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
