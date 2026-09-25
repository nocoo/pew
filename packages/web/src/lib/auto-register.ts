/**
 * Auto season registration — registers teams with `auto_register_season = 1`
 * for a newly created season.
 *
 * Called from POST /api/admin/seasons after a season is created.
 * Skips teams that would cause a member conflict (user already
 * registered on another team for the same season).
 *
 * Automatic registration is limited to upcoming seasons, so owners can withdraw before they start.
 */

import type { DbRead, DbWrite } from "@/lib/db";
import { deriveSeasonStatus } from "@/lib/seasons";

export interface AutoRegisterResult {
  /** Number of teams successfully registered */
  registered: number;
  /** Number of teams skipped (conflicts, empty, etc.) */
  skipped: number;
  /** Whether the season was eligible for auto-registration */
  seasonEligible: boolean;
}

/**
 * Auto-register all eligible teams for a season.
 *
 * A team is eligible if:
 *   - `auto_register_season = 1`
 *   - Not already registered for this season
 *   - No member conflicts (each user can only be on one team per season)
 *
 * The season must not have started.
 *
 * Returns details about the registration result.
 */
export async function autoRegisterTeamsForSeason(
  dbRead: DbRead,
  dbWrite: DbWrite,
  seasonId: string,
): Promise<AutoRegisterResult> {
  const season = await dbRead.getSeasonById(seasonId);

  if (!season) {
    return { registered: 0, skipped: 0, seasonEligible: false };
  }

  const status = deriveSeasonStatus(season.start_date, season.end_date);
  if (status !== "upcoming") {
    return { registered: 0, skipped: 0, seasonEligible: false };
  }

  // Find teams with auto-registration enabled
  const teams = await dbRead.listAutoRegisterTeams(seasonId);

  if (teams.length === 0) {
    return { registered: 0, skipped: 0, seasonEligible: true };
  }

  let registered = 0;
  let skipped = 0;

  for (const team of teams) {
    try {
      // Get current team members
      const members = await dbRead.getTeamMemberUserIds(team.id);

      // Check for member conflicts — any member already registered for this season
      if (members.length > 0) {
        const conflict = await dbRead.checkSeasonMemberConflict(seasonId, members);
        if (conflict) {
          // Skip this team — a member is already on another team
          skipped++;
          continue;
        }
      }

      // Find the owner to record as registered_by
      const owner = await dbRead.getTeamOwner(team.id);
      const registeredBy = owner ?? team.created_by;

      // Register the team + freeze roster
      const regId = crypto.randomUUID();
      const memberIds = members.map(() => crypto.randomUUID());
      const statements: Array<{ sql: string; params: unknown[] }> = [
        {
          sql: `INSERT INTO season_teams (id, season_id, team_id, registered_by)
                VALUES (?, ?, ?, ?)`,
          params: [regId, seasonId, team.id, registeredBy],
        },
        ...members.map((m, i) => ({
          sql: `INSERT INTO season_team_members (id, season_id, team_id, user_id)
                VALUES (?, ?, ?, ?)`,
          params: [memberIds[i] as string, seasonId, team.id, m],
        })),
      ];

      try {
        await dbWrite.batch(statements);
        registered++;
      } catch (err) {
        // Compensate on failure — only delete rows created by THIS request (by UUID)
        // Using (season_id, team_id) would be wrong: a concurrent request may have
        // successfully registered the same team, and we'd delete their data.
        console.error(`Auto-registration failed for team ${team.id}:`, err);
        skipped++;
        try {
          if (memberIds.length > 0) {
            const ph = memberIds.map(() => "?").join(",");
            await dbWrite.execute(
              `DELETE FROM season_team_members WHERE id IN (${ph})`,
              memberIds,
            );
          }
          await dbWrite.execute(
            "DELETE FROM season_teams WHERE id = ?",
            [regId],
          );
        } catch {
          // Swallow cleanup errors
        }
      }
    } catch (err) {
      // Read errors (member query, conflict check, owner lookup) — skip this team
      // but continue processing others to preserve partial success count
      console.error(`Auto-registration read error for team ${team.id}:`, err);
      skipped++;
    }
  }

  return { registered, skipped, seasonEligible: true };
}
