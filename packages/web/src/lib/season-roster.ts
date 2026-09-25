/**
 * Season roster sync — synchronizes team_members → season_team_members
 * for active seasons with `allow_roster_changes = 1`.
 *
 * Called after team membership changes (join, kick, leave) to keep
 * frozen season rosters in sync when the admin has opted in.
 *
 * Also provides `syncAllRostersForSeason()` for admin-triggered bulk
 * backfill (e.g. when `allow_roster_changes` is toggled on).
 */

import type { DbRead, DbWrite } from "@/lib/db";

/**
 * Sync season rosters for a given team.
 *
 * For each active season where the team is registered AND
 * `allow_roster_changes = 1`:
 *   - INSERT OR IGNORE new members (handles UNIQUE(season_id, user_id))
 *   - DELETE members who left the team
 */
export async function syncSeasonRosters(
  dbRead: DbRead,
  dbWrite: DbWrite,
  teamId: string,
): Promise<void> {
  // Find active seasons this team is registered for with roster changes enabled
  const seasons = await dbRead.listRosterSyncSeasons(teamId);

  if (seasons.length === 0) return;

  // Get current team members
  const currentMembers = await dbRead.getTeamMemberUserIds(teamId);

  const currentUserIds = new Set(currentMembers);

  for (const season_id of seasons) {
    // Get existing season roster for this team
    const seasonMembers = await dbRead.getRosterUserIds(season_id, teamId);

    const seasonUserIds = new Set(seasonMembers);

    // Add new members (INSERT OR IGNORE handles UNIQUE(season_id, user_id) conflicts
    // where a user is already registered on another team)
    for (const userId of currentUserIds) {
      if (!seasonUserIds.has(userId)) {
        await dbWrite.execute(
          `INSERT OR IGNORE INTO season_team_members (id, season_id, team_id, user_id)
           VALUES (?, ?, ?, ?)`,
          [crypto.randomUUID(), season_id, teamId, userId],
        );
      }
    }

    // Remove departed members
    for (const userId of seasonUserIds) {
      if (!currentUserIds.has(userId)) {
        await dbWrite.execute(
          "DELETE FROM season_team_members WHERE season_id = ? AND team_id = ? AND user_id = ?",
          [season_id, teamId, userId],
        );
      }
    }
  }
}

/**
 * Sync rosters for ALL registered teams in a given season.
 *
 * Unlike `syncSeasonRosters` (which is event-driven per-team), this
 * function is intended for admin-triggered bulk backfill — e.g. when
 * `allow_roster_changes` is toggled on and members who joined while
 * the toggle was off need to be added retroactively.
 *
 * No `allow_roster_changes` guard — the caller decides when it's appropriate.
 *
 * Returns the number of teams that were synced.
 */
export async function syncAllRostersForSeason(
  dbRead: DbRead,
  dbWrite: DbWrite,
  seasonId: string,
): Promise<number> {
  // Get all teams registered for this season
  const teams = await dbRead.getRegisteredTeamIds(seasonId);

  if (teams.length === 0) return 0;

  for (const team_id of teams) {
    // Get current team members
    const currentMembers = await dbRead.getTeamMemberUserIds(team_id);

    const currentUserIds = new Set(currentMembers);

    // Get existing season roster for this team
    const seasonMembers = await dbRead.getRosterUserIds(seasonId, team_id);

    const seasonUserIds = new Set(seasonMembers);

    // Add missing members
    for (const userId of currentUserIds) {
      if (!seasonUserIds.has(userId)) {
        await dbWrite.execute(
          `INSERT OR IGNORE INTO season_team_members (id, season_id, team_id, user_id)
           VALUES (?, ?, ?, ?)`,
          [crypto.randomUUID(), seasonId, team_id, userId],
        );
      }
    }

    // Remove departed members
    for (const userId of seasonUserIds) {
      if (!currentUserIds.has(userId)) {
        await dbWrite.execute(
          "DELETE FROM season_team_members WHERE season_id = ? AND team_id = ? AND user_id = ?",
          [seasonId, team_id, userId],
        );
      }
    }
  }

  return teams.length;
}
