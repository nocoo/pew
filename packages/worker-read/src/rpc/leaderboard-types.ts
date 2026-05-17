/**
 * Type-only definitions for the leaderboard RPC. Extracted from
 * leaderboard.ts so the handler file stays under the 400-LOC complexity guideline.
 */

// Response Types
// ---------------------------------------------------------------------------

export interface LeaderboardEntryRow {
  user_id: string;
  name: string | null;
  image: string | null;
  total_tokens: number;
  rank: number;
}

export interface TeamLeaderboardEntryRow {
  team_id: string;
  team_name: string;
  logo_url: string | null;
  total_tokens: number;
  rank: number;
}

/** Global leaderboard entry row */
export interface GlobalLeaderboardRow {
  user_id: string;
  name: string | null;
  nickname: string | null;
  image: string | null;
  slug: string | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

/** User team membership row */
export interface UserTeamMembershipRow {
  user_id: string;
  team_id: string;
  team_name: string;
  logo_url: string | null;
}

/** User session stats row */
export interface UserSessionStatsRow {
  user_id: string;
  session_count: number;
  total_duration_seconds: number;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface GetUserLeaderboardRequest {
  method: "leaderboard.getUsers";
  seasonId: string;
  limit?: number;
  offset?: number;
}

export interface GetTeamLeaderboardRequest {
  method: "leaderboard.getTeams";
  seasonId: string;
  limit?: number;
  offset?: number;
}

export interface GetUserRankRequest {
  method: "leaderboard.getUserRank";
  seasonId: string;
  userId: string;
}

export interface GetTeamRankRequest {
  method: "leaderboard.getTeamRank";
  seasonId: string;
  teamId: string;
}

/** Global leaderboard query request */
export interface GetGlobalLeaderboardRequest {
  method: "leaderboard.getGlobal";
  fromDate?: string;
  teamId?: string;
  orgId?: string;
  source?: string;
  model?: string;
  limit: number;
  offset?: number;
}

/** Get user teams request */
export interface GetUserTeamsRequest {
  method: "leaderboard.getUserTeams";
  userIds: string[];
}

/** Get user session stats request */
export interface GetUserSessionStatsRequest {
  method: "leaderboard.getUserSessionStats";
  userIds: string[];
  fromDate?: string;
  source?: string;
}

export type LeaderboardRpcRequest =
  | GetUserLeaderboardRequest
  | GetTeamLeaderboardRequest
  | GetUserRankRequest
  | GetTeamRankRequest
  | GetGlobalLeaderboardRequest
  | GetUserTeamsRequest
  | GetUserSessionStatsRequest;

