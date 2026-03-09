/**
 * GET/POST/PUT/DELETE /api/admin/pricing — admin-only model pricing CRUD.
 *
 * - GET    → list all DB pricing rows
 * - POST   → create a new pricing entry
 * - PUT    → update an existing pricing entry (requires `id`)
 * - DELETE → delete a pricing entry (requires `id`)
 */

import { NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin";
import { getD1Client } from "@/lib/d1";
import type { DbPricingRow } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// GET — list all DB pricing rows
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getD1Client();

  try {
    const { results } = await client.query<DbPricingRow>(
      "SELECT * FROM model_pricing ORDER BY model ASC, source ASC"
    );
    return NextResponse.json({ rows: results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("no such table")) {
      return NextResponse.json({ rows: [] });
    }
    console.error("Failed to load pricing:", err);
    return NextResponse.json(
      { error: "Failed to load pricing" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create new pricing entry
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

  const { model, input, output, cached, source, note } = body as {
    model?: string;
    input?: number;
    output?: number;
    cached?: number | null;
    source?: string | null;
    note?: string | null;
  };

  if (!model || typeof model !== "string" || model.trim() === "") {
    return NextResponse.json({ error: "model is required" }, { status: 400 });
  }
  if (typeof input !== "number" || input < 0) {
    return NextResponse.json(
      { error: "input must be a non-negative number" },
      { status: 400 }
    );
  }
  if (typeof output !== "number" || output < 0) {
    return NextResponse.json(
      { error: "output must be a non-negative number" },
      { status: 400 }
    );
  }
  if (cached !== undefined && cached !== null && (typeof cached !== "number" || cached < 0)) {
    return NextResponse.json(
      { error: "cached must be a non-negative number or null" },
      { status: 400 }
    );
  }

  const client = getD1Client();

  try {
    await client.execute(
      `INSERT INTO model_pricing (model, input, output, cached, source, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [model.trim(), input, output, cached ?? null, source ?? null, note ?? null]
    );

    const row = await client.firstOrNull<DbPricingRow>(
      "SELECT * FROM model_pricing WHERE model = ? AND (source = ? OR (source IS NULL AND ? IS NULL))",
      [model.trim(), source ?? null, source ?? null]
    );

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE constraint")) {
      return NextResponse.json(
        { error: "A pricing entry for this model/source already exists" },
        { status: 409 }
      );
    }
    console.error("Failed to create pricing:", err);
    return NextResponse.json(
      { error: "Failed to create pricing" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — update existing pricing entry
// ---------------------------------------------------------------------------

export async function PUT(request: Request) {
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

  const { id, model, input, output, cached, source, note } = body as {
    id?: number;
    model?: string;
    input?: number;
    output?: number;
    cached?: number | null;
    source?: string | null;
    note?: string | null;
  };

  if (typeof id !== "number") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (model !== undefined) {
    if (typeof model !== "string" || model.trim() === "") {
      return NextResponse.json({ error: "model must be a non-empty string" }, { status: 400 });
    }
    sets.push("model = ?");
    params.push(model.trim());
  }
  if (input !== undefined) {
    if (typeof input !== "number" || input < 0) {
      return NextResponse.json({ error: "input must be a non-negative number" }, { status: 400 });
    }
    sets.push("input = ?");
    params.push(input);
  }
  if (output !== undefined) {
    if (typeof output !== "number" || output < 0) {
      return NextResponse.json({ error: "output must be a non-negative number" }, { status: 400 });
    }
    sets.push("output = ?");
    params.push(output);
  }
  if (cached !== undefined) {
    if (cached !== null && (typeof cached !== "number" || cached < 0)) {
      return NextResponse.json({ error: "cached must be a non-negative number or null" }, { status: 400 });
    }
    sets.push("cached = ?");
    params.push(cached);
  }
  if (source !== undefined) {
    sets.push("source = ?");
    params.push(source);
  }
  if (note !== undefined) {
    sets.push("note = ?");
    params.push(note);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  sets.push("updated_at = datetime('now')");
  params.push(id);

  const client = getD1Client();

  try {
    const meta = await client.execute(
      `UPDATE model_pricing SET ${sets.join(", ")} WHERE id = ?`,
      params
    );

    if (meta.changes === 0) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const row = await client.firstOrNull<DbPricingRow>(
      "SELECT * FROM model_pricing WHERE id = ?",
      [id]
    );

    return NextResponse.json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE constraint")) {
      return NextResponse.json(
        { error: "A pricing entry for this model/source already exists" },
        { status: 409 }
      );
    }
    console.error("Failed to update pricing:", err);
    return NextResponse.json(
      { error: "Failed to update pricing" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — delete a pricing entry
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

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const client = getD1Client();

  try {
    const meta = await client.execute(
      "DELETE FROM model_pricing WHERE id = ?",
      [id]
    );

    if (meta.changes === 0) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("Failed to delete pricing:", err);
    return NextResponse.json(
      { error: "Failed to delete pricing" },
      { status: 500 }
    );
  }
}
