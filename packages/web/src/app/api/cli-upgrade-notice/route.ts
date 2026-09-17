import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth-helpers";
import { getDbWrite } from "@/lib/db";

/** Claim this account's one-time CLI 3.0 notice when its dashboard mounts. */
export async function POST(request: Request) {
  const user = await resolveUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await getDbWrite();
    // Atomic check-and-set prevents two tabs/devices from both showing it.
    // Later visits only check the indexed user row; they do not write it again.
    const { changes } = await db.execute(
      `UPDATE users SET cli_upgrade_notice_seen_at = datetime('now')
       WHERE id = ? AND cli_upgrade_notice_seen_at IS NULL`,
      [user.userId],
    );
    return NextResponse.json(
      { show: changes > 0 },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not load CLI upgrade notice" },
      { status: 503 },
    );
  }
}
