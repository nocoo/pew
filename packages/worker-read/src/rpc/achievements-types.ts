/**
 * Type-only definitions for the achievements RPC. Extracted from
 * achievements.ts so the handler file stays under the 400-LOC complexity guideline.
 */

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface UsageAggregatesRow {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
}

export interface DailyUsageRow {
  day: string;
  total_tokens: number;
}

export interface DailyCostRow {
  day: string;
  model: string;
  source: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
}

export interface DiversityRow {
  source_count: number;
  model_count: number;
  device_count: number;
}

export interface SessionAggregatesRow {
  total_sessions: number;
  quick_sessions: number;
  marathon_sessions: number;
  max_messages: number;
  automated_sessions: number;
}

export interface HourlyUsageRow {
  hour_start: string;
  total_tokens: number;
}

export interface CostByModelSourceRow {
  model: string;
  source: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  reasoning_output_tokens: number;
}

export interface AchievementEarnerRow {
  id: string;
  name: string | null;
  image: string | null;
  slug: string | null;
  value: number;
  earned_at: string | null;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface GetUsageAggregatesRequest {
  method: "achievements.getUsageAggregates";
  userId: string;
}

export interface GetDailyUsageRequest {
  method: "achievements.getDailyUsage";
  userId: string;
}

export interface GetDailyCostBreakdownRequest {
  method: "achievements.getDailyCostBreakdown";
  userId: string;
}

export interface GetDiversityCountsRequest {
  method: "achievements.getDiversityCounts";
  userId: string;
}

export interface GetSessionAggregatesRequest {
  method: "achievements.getSessionAggregates";
  userId: string;
}

export interface GetHourlyUsageRequest {
  method: "achievements.getHourlyUsage";
  userId: string;
}

export interface GetCostByModelSourceRequest {
  method: "achievements.getCostByModelSource";
  userId: string;
}

export interface GetAchievementEarnersRequest {
  method: "achievements.getEarners";
  achievementId: string;
  sql: string;
  params: unknown[];
}

export interface GetAchievementEarnersCountRequest {
  method: "achievements.getEarnersCount";
  achievementId: string;
  sql: string;
  params: unknown[];
}

export type AchievementsRpcRequest =
  | GetUsageAggregatesRequest
  | GetDailyUsageRequest
  | GetDailyCostBreakdownRequest
  | GetDiversityCountsRequest
  | GetSessionAggregatesRequest
  | GetHourlyUsageRequest
  | GetCostByModelSourceRequest
  | GetAchievementEarnersRequest
  | GetAchievementEarnersCountRequest;
