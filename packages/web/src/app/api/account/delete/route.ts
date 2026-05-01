/**
 * DELETE /api/account/delete — permanently delete user account
 *
 * Requires email confirmation in request body to prevent accidental deletion.
 * Deletes all user data including:
 * - User record and auth tokens
 * - Usage records and session records
 * - Team memberships (but not teams the user created)
 * - Projects and aliases
 * - Budget settings
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
    // Delete in dependency order (children first, then parent)
    // Many tables have ON DELETE CASCADE from users, but we explicitly delete
    // to ensure all data is removed even if foreign keys are missing.

    const userId = authResult.userId;

    // 1. Project-related (has cascade from projects)
    await dbWrite.execute(
      "DELETE FROM project_tags WHERE user_id = ?",
      [userId],
    );
    await dbWrite.execute(
      "DELETE FROM project_aliases WHERE user_id = ?",
      [userId],
    );
    await dbWrite.execute(
      "DELETE FROM projects WHERE user_id = ?",
      [userId],
    );

    // 2. Usage and session data
    await dbWrite.execute(
      "DELETE FROM usage_records WHERE user_id = ?",
      [userId],
    );
    await dbWrite.execute(
      "DELETE FROM session_records WHERE user_id = ?",
      [userId],
    );

    // 3. Team memberships (not the teams themselves)
    await dbWrite.execute(
      "DELETE FROM team_members WHERE user_id = ?",
      [userId],
    );

    // 4. Season member snapshots
    try {
      await dbWrite.execute(
        "DELETE FROM season_member_snapshots WHERE user_id = ?",
        [userId],
      );
    } catch {
      // Table may not exist
    }

    // 5. Season team members (season-specific roster)
    try {
      await dbWrite.execute(
        "DELETE FROM season_team_members WHERE user_id = ?",
        [userId],
      );
    } catch {
      // Table may not exist
    }

    // 6. Budget settings
    await dbWrite.execute(
      "DELETE FROM user_budgets WHERE user_id = ?",
      [userId],
    );

    // 7. Invite codes created by user (mark as orphaned, don't delete)
    await dbWrite.execute(
      "UPDATE invite_codes SET created_by = 'deleted-user' WHERE created_by = ?",
      [userId],
    );

    // 8. Device aliases
    try {
      await dbWrite.execute(
        "DELETE FROM device_aliases WHERE user_id = ?",
        [userId],
      );
    } catch {
      // Table may not exist
    }

    // 9. Auth sessions and accounts (should cascade from users, but be explicit)
    await dbWrite.execute(
      "DELETE FROM sessions WHERE user_id = ?",
      [userId],
    );
    await dbWrite.execute(
      "DELETE FROM accounts WHERE user_id = ?",
      [userId],
    );

    // 10. Finally, delete the user record
    await dbWrite.execute(
      "DELETE FROM users WHERE id = ?",
      [userId],
    );

    console.log(`Account deleted: ${user.email} (${userId})`);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete account:", err);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 },
    );
  }
}
