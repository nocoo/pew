/**
 * GET/POST/DELETE /api/admin/invites — admin-only invite code management.
 *
 * - GET    → list all invite codes with usage info
 * - POST   → generate new invite codes
 * - DELETE → delete an unused or burned invite code
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getD1Client } from "@/lib/d1";
import { generateInviteCode } from "@/lib/invite";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InviteCodeRow {
  id: number;
  code: string;
  created_by: string;
  created_by_email: string | null;
  used_by: string | null;
  used_by_email: string | null;
  used_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET — list all invite codes
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getD1Client();

  try {
    const { results } = await client.query<InviteCodeRow>(
      `SELECT
         ic.id,
         ic.code,
         ic.created_by,
         creator.email AS created_by_email,
         ic.used_by,
         consumer.email AS used_by_email,
         ic.used_at,
         ic.created_at
       FROM invite_codes ic
       LEFT JOIN users creator ON ic.created_by = creator.id
       LEFT JOIN users consumer ON ic.used_by = consumer.id
       ORDER BY ic.created_at DESC`
    );
    return NextResponse.json({ rows: results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ rows: [] });
    }
    console.error("Failed to load invite codes:", err);
    return NextResponse.json(
      { error: "Failed to load invite codes" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — generate new invite codes
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

  const count = typeof body.count === "number" ? body.count : 1;

  if (!Number.isInteger(count) || count < 1) {
    return NextResponse.json(
      { error: "count must be a positive integer" },
      { status: 400 }
    );
  }
  if (count > 20) {
    return NextResponse.json(
      { error: "count must be at most 20" },
      { status: 400 }
    );
  }

  const client = getD1Client();
  const codes: string[] = [];

  try {
    for (let i = 0; i < count; i++) {
      // Generate unique code with retry for collision
      let code: string;
      let attempts = 0;
      do {
        code = generateInviteCode();
        attempts++;
        if (attempts > 10) {
          return NextResponse.json(
            { error: "Failed to generate unique code after retries" },
            { status: 500 }
          );
        }
        // Check for collision
        const existing = await client.firstOrNull<{ id: number }>(
          "SELECT id FROM invite_codes WHERE code = ?",
          [code]
        );
        if (!existing) break;
        // eslint-disable-next-line no-constant-condition -- retry loop for unique code generation
      } while (true);

      await client.execute(
        `INSERT INTO invite_codes (code, created_by) VALUES (?, ?)`,
        [code, admin.userId]
      );
      codes.push(code);
    }

    return NextResponse.json({ codes }, { status: 201 });
  } catch (err) {
    console.error("Failed to generate invite codes:", err);
    return NextResponse.json(
      { error: "Failed to generate invite codes" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — delete an unused or burned invite code
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const idStr = url.searchParams.get("id");
  if (!idStr) {
    return NextResponse.json(
      { error: "id query parameter is required" },
      { status: 400 }
    );
  }

  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const client = getD1Client();

  try {
    // Single atomic DELETE — only removes unused or burned (pending:*) codes.
    // Avoids TOCTOU race between a prior SELECT check and DELETE.
    const meta = await client.execute(
      "DELETE FROM invite_codes WHERE id = ? AND (used_by IS NULL OR used_by LIKE 'pending:%')",
      [id]
    );

    if (meta.changes > 0) {
      return NextResponse.json({ deleted: true });
    }

    // changes=0: either the row doesn't exist, or it's fully consumed.
    const row = await client.firstOrNull<{ used_by: string | null }>(
      "SELECT used_by FROM invite_codes WHERE id = ?",
      [id]
    );

    if (!row) {
      return NextResponse.json({ error: "Code not found" }, { status: 404 });
    }

    // Row exists but DELETE didn't match — it's a fully consumed code
    return NextResponse.json(
      { error: "Cannot delete a used invite code" },
      { status: 409 }
    );
  } catch (err) {
    console.error("Failed to delete invite code:", err);
    return NextResponse.json(
      { error: "Failed to delete invite code" },
      { status: 500 }
    );
  }
}
