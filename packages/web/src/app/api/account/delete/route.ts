/**
 * DELETE /api/account/delete — permanently delete user account
 *
 * Requires email confirmation in request body to prevent accidental deletion.
 * Deletes all user data including:
 * - User record and auth tokens
 * - Usage records and session records
 * - Team memberships (but not teams the user created)
 * - Invite codes created by user
 */

import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { unauthorizedResponse } from "@/lib/api-responses";
import { getDbRead, getDbWrite } from "@/lib/db";

// ---------------------------------------------------------------------------
// DELETE — permanently delete account
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  // Account deletion is a destructive action — only allow browser session auth.
  // Reject API key (Bearer token) authentication with 403.
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      {
        error:
          "Account deletion requires browser session authentication. API key authentication is not allowed for this action.",
      },
      { status: 403 },
    );
  }

  const authResult = await resolveUser(request);
  if (!authResult) {
    return unauthorizedResponse();
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const confirmEmail = body.confirm_email;
  if (typeof confirmEmail !== "string" || !confirmEmail.trim()) {
    return NextResponse.json(
      { error: "confirm_email is required" },
      { status: 400 },
    );
  }

  const dbRead = await getDbRead();
  const dbWrite = await getDbWrite();

  // Fetch user record to verify email matches
  const user = await dbRead.getUserById(authResult.userId);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Verify email confirmation matches
  if (confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json(
      { error: "Email does not match. Account deletion cancelled." },
      { status: 400 },
    );
  }

  try {
    const userId = authResult.userId;
    await dbWrite.batch([
      {
        sql: `UPDATE season_snapshots AS ss SET
          total_tokens = MAX(0, ss.total_tokens - ms.total_tokens),
          input_tokens = MAX(0, ss.input_tokens - ms.input_tokens),
          output_tokens = MAX(0, ss.output_tokens - ms.output_tokens),
          cached_input_tokens = MAX(0, ss.cached_input_tokens - ms.cached_input_tokens)
          FROM season_member_snapshots ms
          WHERE ms.season_id = ss.season_id AND ms.team_id = ss.team_id AND ms.user_id = ?`,
        params: [userId],
      },
      {
        sql: `WITH ranked AS (
          SELECT season_id, team_id, ROW_NUMBER() OVER (
            PARTITION BY season_id ORDER BY total_tokens DESC, team_id) AS new_rank
          FROM season_snapshots WHERE season_id IN (
            SELECT season_id FROM season_member_snapshots WHERE user_id = ?))
          UPDATE season_snapshots AS ss SET rank = ranked.new_rank FROM ranked
          WHERE ss.season_id = ranked.season_id AND ss.team_id = ranked.team_id`,
        params: [userId],
      },
      { sql: "DELETE FROM usage_details WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM usage_evidence WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM usage_records WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM session_records WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM team_members WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM season_member_snapshots WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM season_team_members WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM device_aliases WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM organization_members WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM auth_codes WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM sessions WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM accounts WHERE user_id = ?", params: [userId] },
      { sql: "DELETE FROM invite_codes WHERE created_by = ?", params: [userId] },
      { sql: "UPDATE invite_codes SET used_by = 'deleted-user' WHERE used_by = ?", params: [userId] },
      { sql: "DELETE FROM users WHERE id = ?", params: [userId] },
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && /FOREIGN KEY constraint failed/i.test(err.message)) {
      return NextResponse.json(
        { error: "Account still owns shared resources. Transfer or remove them before deleting your account." },
        { status: 409 },
      );
    }
    console.error("Failed to delete account:", err);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 },
    );
  }
}
