/**
 * Auto season registration — registers teams with `auto_register_season = 1`
 * for a newly created season.
 *
 * Called from POST /api/admin/seasons after a season is created.
 * Skips teams that would cause a member conflict (user already
 * registered on another team for the same season).
 *
 * IMPORTANT: This function enforces the same rules as manual registration:
 * - Cannot register for ended seasons
 * - Cannot register for active seasons without allow_late_registration
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
 * The season must also be eligible:
 *   - Not ended
 *   - If active, must have allow_late_registration enabled
 *
 * Returns details about the registration result.
 */
export async function autoRegisterTeamsForSeason(
  dbRead: DbRead,
  dbWrite: DbWrite,
  seasonId: string,
): Promise<AutoRegisterResult> {
  // First, check if the season is eligible for registration
  // (same rules as manual registration in register/route.ts)
  const season = await dbRead.firstOrNull<{
    start_date: string;
    end_date: string;
    allow_late_registration: number;
  }>(
    "SELECT start_date, end_date, allow_late_registration FROM seasons WHERE id = ?",
    [seasonId],
  );

  if (!season) {
    return { registered: 0, skipped: 0, seasonEligible: false };
  }

  const status = deriveSeasonStatus(season.start_date, season.end_date);
  if (status === "ended") {
    // Cannot auto-register for ended seasons
    return { registered: 0, skipped: 0, seasonEligible: false };
  }
  if (status === "active" && !season.allow_late_registration) {
    // Cannot auto-register for active seasons without late registration
    return { registered: 0, skipped: 0, seasonEligible: false };
  }

  // Find teams with auto-registration enabled
  const { results: teams } = await dbRead.query<{
    id: string;
    created_by: string;
  }>(
    `SELECT t.id, t.created_by
     FROM teams t
     WHERE t.auto_register_season = 1
       AND t.id NOT IN (
         SELECT team_id FROM season_teams WHERE season_id = ?
       )`,
    [seasonId],
  );

  if (teams.length === 0) {
    return { registered: 0, skipped: 0, seasonEligible: true };
  }

  let registered = 0;
  let skipped = 0;

  for (const team of teams) {
    try {
      // Get current team members
      const { results: members } = await dbRead.query<{ user_id: string }>(
        "SELECT user_id FROM team_members WHERE team_id = ?",
        [team.id],
      );

      // Check for member conflicts — any member already registered for this season
      if (members.length > 0) {
        const placeholders = members.map(() => "?").join(",");
        const userIds = members.map((m) => m.user_id);
        const conflict = await dbRead.firstOrNull<{ user_id: string }>(
          `SELECT user_id FROM season_team_members
           WHERE season_id = ? AND user_id IN (${placeholders})
           LIMIT 1`,
          [seasonId, ...userIds],
        );
        if (conflict) {
          // Skip this team — a member is already on another team
          skipped++;
          continue;
        }
      }

      // Find the owner to record as registered_by
      const owner = await dbRead.firstOrNull<{ user_id: string }>(
        "SELECT user_id FROM team_members WHERE team_id = ? AND role = 'owner' LIMIT 1",
        [team.id],
      );
      const registeredBy = owner?.user_id ?? team.created_by;

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
          params: [memberIds[i] as string, seasonId, team.id, m.user_id],
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
