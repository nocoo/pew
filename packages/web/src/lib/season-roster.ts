/**
 * Season roster sync — synchronizes team_members → season_team_members
 * for active seasons with `allow_roster_changes = 1`.
 *
 * Called after team membership changes (join, kick, leave) to keep
 * frozen season rosters in sync when the admin has opted in.
 */

import type { D1Client } from "@/lib/d1";

/**
 * Sync season rosters for a given team.
 *
 * For each active season where the team is registered AND
 * `allow_roster_changes = 1`:
 *   - INSERT OR IGNORE new members (handles UNIQUE(season_id, user_id))
 *   - DELETE members who left the team
 */
export async function syncSeasonRosters(
  client: D1Client,
  teamId: string,
): Promise<void> {
  // Find active seasons this team is registered for with roster changes enabled
  const { results: seasons } = await client.query<{
    season_id: string;
  }>(
    `SELECT st.season_id
     FROM season_teams st
     JOIN seasons s ON s.id = st.season_id
     WHERE st.team_id = ?
       AND s.allow_roster_changes = 1
       AND date(s.start_date) <= date('now')
       AND date(s.end_date, '+1 day') > date('now')`,
    [teamId],
  );

  if (seasons.length === 0) return;

  // Get current team members
  const { results: currentMembers } = await client.query<{
    user_id: string;
  }>("SELECT user_id FROM team_members WHERE team_id = ?", [teamId]);

  const currentUserIds = new Set(currentMembers.map((m) => m.user_id));

  for (const { season_id } of seasons) {
    // Get existing season roster for this team
    const { results: seasonMembers } = await client.query<{
      user_id: string;
    }>(
      "SELECT user_id FROM season_team_members WHERE season_id = ? AND team_id = ?",
      [season_id, teamId],
    );

    const seasonUserIds = new Set(seasonMembers.map((m) => m.user_id));

    // Add new members (INSERT OR IGNORE handles UNIQUE(season_id, user_id) conflicts
    // where a user is already registered on another team)
    for (const userId of currentUserIds) {
      if (!seasonUserIds.has(userId)) {
        await client.execute(
          `INSERT OR IGNORE INTO season_team_members (id, season_id, team_id, user_id)
           VALUES (?, ?, ?, ?)`,
          [crypto.randomUUID(), season_id, teamId, userId],
        );
      }
    }

    // Remove departed members
    for (const userId of seasonUserIds) {
      if (!currentUserIds.has(userId)) {
        await client.execute(
          "DELETE FROM season_team_members WHERE season_id = ? AND team_id = ? AND user_id = ?",
          [season_id, teamId, userId],
        );
      }
    }
  }
}
