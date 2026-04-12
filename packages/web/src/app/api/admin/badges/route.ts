/**
 * GET/POST /api/admin/badges — admin-only badge definition management.
 *
 * - GET  → list all badge definitions (include archived)
 * - POST → create new badge definition
 */

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { resolveAdmin } from "@/lib/admin";
import { getDbRead, getDbWrite } from "@/lib/db";
import type { BadgeIconType, BadgeColorPalette } from "@pew/core";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_ICONS: BadgeIconType[] = [
  "shield",
  "star",
  "hexagon",
  "circle",
  "diamond",
  "crown",
  "flame",
  "zap",
  "heart",
  "sparkles",
];

const COLOR_PALETTES: Record<BadgeColorPalette, { bg: string; text: string }> =
  {
    ocean: { bg: "#3B82F6", text: "#FFFFFF" },
    forest: { bg: "#10B981", text: "#FFFFFF" },
    sunset: { bg: "#F97316", text: "#FFFFFF" },
    royal: { bg: "#8B5CF6", text: "#FFFFFF" },
    crimson: { bg: "#EF4444", text: "#FFFFFF" },
    gold: { bg: "#EAB308", text: "#1F2937" },
  };

function validateBadgeText(text: unknown): string | null {
  if (typeof text !== "string") return "text must be a string";
  const trimmed = text.trim();
  if (trimmed.length === 0) return "text is required";
  if (trimmed.length > 4) return "text must be 1-4 characters";
  // Allow alphanumeric + common unicode (Chinese, Japanese, Korean, emoji)
  // Block HTML/script injection
  if (/<|>|&|script/i.test(trimmed)) {
    return "text contains invalid characters";
  }
  return null;
}

function validateIcon(icon: unknown): BadgeIconType | null {
  if (typeof icon !== "string") return null;
  if (!VALID_ICONS.includes(icon as BadgeIconType)) return null;
  return icon as BadgeIconType;
}

function validateColors(
  colorBg: unknown,
  colorText: unknown,
): { bg: string; text: string } | null {
  // Accept hex colors
  if (typeof colorBg === "string" && typeof colorText === "string") {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    if (hexPattern.test(colorBg) && hexPattern.test(colorText)) {
      return { bg: colorBg.toUpperCase(), text: colorText.toUpperCase() };
    }
  }
  return null;
}

function validatePalette(palette: unknown): BadgeColorPalette | null {
  if (typeof palette !== "string") return null;
  if (!(palette in COLOR_PALETTES)) return null;
  return palette as BadgeColorPalette;
}

// ---------------------------------------------------------------------------
// GET — list all badge definitions
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dbRead = await getDbRead();

  try {
    // Admin always sees all badges (including archived)
    const badges = await dbRead.listBadges(true);
    return NextResponse.json({ badges });
  } catch (err) {
    console.error("Failed to list badges:", err);
    return NextResponse.json(
      { error: "Failed to list badges" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create new badge definition
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

  // Validate text
  const textError = validateBadgeText(body.text);
  if (textError) {
    return NextResponse.json({ error: textError }, { status: 400 });
  }
  const text = (body.text as string).trim();

  // Validate icon
  const icon = validateIcon(body.icon);
  if (!icon) {
    return NextResponse.json(
      { error: `Invalid icon. Must be one of: ${VALID_ICONS.join(", ")}` },
      { status: 400 },
    );
  }

  // Validate colors (either palette name or explicit hex colors)
  let colors: { bg: string; text: string };

  if (body.palette) {
    const palette = validatePalette(body.palette);
    if (!palette) {
      return NextResponse.json(
        {
          error: `Invalid palette. Must be one of: ${Object.keys(COLOR_PALETTES).join(", ")}`,
        },
        { status: 400 },
      );
    }
    colors = COLOR_PALETTES[palette];
  } else if (body.colorBg && body.colorText) {
    const validColors = validateColors(body.colorBg, body.colorText);
    if (!validColors) {
      return NextResponse.json(
        { error: "colorBg and colorText must be valid hex colors (#RRGGBB)" },
        { status: 400 },
      );
    }
    colors = validColors;
  } else {
    return NextResponse.json(
      { error: "Either palette or colorBg/colorText are required" },
      { status: 400 },
    );
  }

  // Optional description
  const description =
    typeof body.description === "string" ? body.description.trim() : null;

  const dbWrite = await getDbWrite();
  const id = nanoid();

  try {
    await dbWrite.execute(
      `INSERT INTO badges (id, text, icon, color_bg, color_text, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, text, icon, colors.bg, colors.text, description],
    );

    return NextResponse.json({
      badge: {
        id,
        text,
        icon,
        color_bg: colors.bg,
        color_text: colors.text,
        description,
        is_archived: 0,
      },
    });
  } catch (err) {
    console.error("Failed to create badge:", err);
    return NextResponse.json(
      { error: "Failed to create badge" },
      { status: 500 },
    );
  }
}
