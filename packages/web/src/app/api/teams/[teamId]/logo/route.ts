/**
 * POST /api/teams/[teamId]/logo — upload team logo (owner only).
 * DELETE /api/teams/[teamId]/logo — remove team logo (owner only).
 *
 * Accepts multipart/form-data with a single "file" field.
 * Validates: PNG or JPEG, square aspect ratio, max 2 MB.
 * Converts to JPEG quality 80, stores in R2 at apps/pew/teams-logo/{teamId}.jpg.
 */

import { NextResponse } from "next/server";
import sharp from "sharp";
import { resolveUser } from "@/lib/auth-helpers";
import { getD1Client } from "@/lib/d1";
import { putTeamLogo, deleteTeamLogo, teamLogoUrl } from "@/lib/r2";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);
const OUTPUT_SIZE = 256; // resize to 256x256 square
const JPEG_QUALITY = 80;

// ---------------------------------------------------------------------------
// POST — upload logo
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId } = await params;

  // Verify ownership
  const client = getD1Client();
  const membership = await client.firstOrNull<{ role: string }>(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
    [teamId, authResult.userId],
  );

  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  if (membership.role !== "owner") {
    return NextResponse.json(
      { error: "Only the team owner can change the logo" },
      { status: 403 },
    );
  }

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing file field" },
      { status: 400 },
    );
  }

  // Validate MIME type
  if (!ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Only PNG and JPEG images are accepted" },
      { status: 400 },
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large (max 2 MB)" },
      { status: 400 },
    );
  }

  // Read file buffer
  const arrayBuffer = await file.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  // Validate image dimensions — must be square
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(inputBuffer).metadata();
  } catch {
    return NextResponse.json(
      { error: "Invalid image file" },
      { status: 400 },
    );
  }

  if (!metadata.width || !metadata.height) {
    return NextResponse.json(
      { error: "Cannot determine image dimensions" },
      { status: 400 },
    );
  }

  if (metadata.width !== metadata.height) {
    return NextResponse.json(
      {
        error: `Image must be square. Got ${metadata.width}x${metadata.height}.`,
      },
      { status: 400 },
    );
  }

  // Convert to JPEG, resize to 256x256, quality 80
  const jpegBuffer = await sharp(inputBuffer)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover" })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  // Upload to R2
  try {
    await putTeamLogo(teamId, jpegBuffer);
  } catch (err) {
    console.error("Failed to upload team logo to R2:", err);
    return NextResponse.json(
      { error: "Failed to store logo" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    logo_url: teamLogoUrl(teamId),
  });
}

// ---------------------------------------------------------------------------
// DELETE — remove logo
// ---------------------------------------------------------------------------

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId } = await params;

  // Verify ownership
  const client = getD1Client();
  const membership = await client.firstOrNull<{ role: string }>(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
    [teamId, authResult.userId],
  );

  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  if (membership.role !== "owner") {
    return NextResponse.json(
      { error: "Only the team owner can remove the logo" },
      { status: 403 },
    );
  }

  try {
    await deleteTeamLogo(teamId);
  } catch (err) {
    console.error("Failed to delete team logo from R2:", err);
    return NextResponse.json(
      { error: "Failed to remove logo" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
