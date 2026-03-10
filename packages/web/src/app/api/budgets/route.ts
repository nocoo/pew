/**
 * GET/PUT /api/budgets — per-month budget limits for cost and token tracking.
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getD1Client } from "@/lib/d1";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isValidMonth(v: unknown): v is string {
  return typeof v === "string" && MONTH_RE.test(v);
}

// ---------------------------------------------------------------------------
// GET — read budget for a given month
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");

  if (!isValidMonth(month)) {
    return NextResponse.json(
      { error: "month query param required in YYYY-MM format" },
      { status: 400 },
    );
  }

  const client = getD1Client();

  try {
    const row = await client.firstOrNull<{
      budget_usd: number | null;
      budget_tokens: number | null;
      month: string;
    }>(
      "SELECT budget_usd, budget_tokens, month FROM user_budgets WHERE user_id = ? AND month = ?",
      [authResult.userId, month],
    );

    return NextResponse.json(row);
  } catch (err) {
    console.error("Failed to load budget:", err);
    return NextResponse.json(
      { error: "Failed to load budget" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — create or update budget for a given month
// ---------------------------------------------------------------------------

export async function PUT(request: Request) {
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

  // Validate month
  if (!isValidMonth(body.month)) {
    return NextResponse.json(
      { error: "month required in YYYY-MM format" },
      { status: 400 },
    );
  }

  const month = body.month;
  const hasBudgetUsd = "budget_usd" in body && body.budget_usd != null;
  const hasBudgetTokens = "budget_tokens" in body && body.budget_tokens != null;

  // At least one budget field required
  if (!hasBudgetUsd && !hasBudgetTokens) {
    return NextResponse.json(
      { error: "At least one of budget_usd or budget_tokens is required" },
      { status: 400 },
    );
  }

  // Validate budget_usd if present
  if (hasBudgetUsd) {
    const v = body.budget_usd;
    if (typeof v !== "number" || v < 0) {
      return NextResponse.json(
        { error: "budget_usd must be a non-negative number" },
        { status: 400 },
      );
    }
  }

  // Validate budget_tokens if present
  if (hasBudgetTokens) {
    const v = body.budget_tokens;
    if (typeof v !== "number" || v < 0) {
      return NextResponse.json(
        { error: "budget_tokens must be a non-negative number" },
        { status: 400 },
      );
    }
  }

  const budgetUsd = hasBudgetUsd ? (body.budget_usd as number) : null;
  const budgetTokens = hasBudgetTokens ? (body.budget_tokens as number) : null;

  const client = getD1Client();

  try {
    await client.execute(
      `INSERT INTO user_budgets (user_id, month, budget_usd, budget_tokens)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, month) DO UPDATE SET
         budget_usd = excluded.budget_usd,
         budget_tokens = excluded.budget_tokens,
         updated_at = datetime('now')`,
      [authResult.userId, month, budgetUsd, budgetTokens],
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to save budget:", err);
    return NextResponse.json(
      { error: "Failed to save budget" },
      { status: 500 },
    );
  }
}
