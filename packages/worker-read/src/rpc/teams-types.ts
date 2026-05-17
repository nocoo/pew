/**
 * Type-only definitions for the teams RPC. Extracted from teams.ts so the
 * handler file stays under the 400-LOC complexity guideline.
 */

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

export interface TeamRow {
  id: string;
  name: string;
  slug: string;
  invite_code: string;
  created_by: string;
  created_at: string;
  logo_url: string | null;
  member_count: number;
}

export interface TeamDetailRow {
  id: string;
  name: string;
  slug: string;
  invite_code: string;
  created_at: string;
  logo_url: string | null;
  auto_register_season: number | null;
}

export interface TeamMemberRow {
  user_id: string;
  name: string | null;
  nickname: string | null;
  slug: string | null;
  image: string | null;
  role: string;
  joined_at: string;
}

// ---------------------------------------------------------------------------
// RPC Request Types
// ---------------------------------------------------------------------------

export interface GetTeamMembershipRequest {
  method: "teams.getMembership";
  teamId: string;
  userId: string;
}

export interface ListUserTeamsRequest {
  method: "teams.listForUser";
  userId: string;
}

export interface ListAllTeamsRequest {
  method: "teams.listAll";
}

export interface CheckTeamSlugExistsRequest {
  method: "teams.checkSlugExists";
  slug: string;
}

export interface GetTeamByIdRequest {
  method: "teams.getById";
  teamId: string;
}

export interface GetTeamMembersRequest {
  method: "teams.getMembers";
  teamId: string;
}

export interface GetTeamSeasonRegistrationsRequest {
  method: "teams.getSeasonRegistrations";
  teamId: string;
}

export interface CountTeamMembersRequest {
  method: "teams.countMembers";
  teamId: string;
}

export interface GetTeamLogoUrlRequest {
  method: "teams.getLogoUrl";
  teamId: string;
}

export interface FindTeamByInviteCodeRequest {
  method: "teams.findByInviteCode";
  inviteCode: string;
}

export interface CheckTeamMembershipExistsRequest {
  method: "teams.membershipExists";
  teamId: string;
  userId: string;
}

export interface GetAppSettingRequest {
  method: "teams.getAppSetting";
  key: string;
}

export interface GetTeamMemberUserIdsRequest {
  method: "teams.getMemberUserIds";
  teamId: string;
}

export interface GetTeamOwnerRequest {
  method: "teams.getOwner";
  teamId: string;
}

export interface CheckUsersShareTeamRequest {
  method: "teams.usersShareTeam";
  userId1: string;
  userId2: string;
}

export type TeamsRpcRequest =
  | GetTeamMembershipRequest
  | ListUserTeamsRequest
  | ListAllTeamsRequest
  | CheckTeamSlugExistsRequest
  | GetTeamByIdRequest
  | GetTeamMembersRequest
  | GetTeamSeasonRegistrationsRequest
  | CountTeamMembersRequest
  | GetTeamLogoUrlRequest
  | FindTeamByInviteCodeRequest
  | CheckTeamMembershipExistsRequest
  | GetAppSettingRequest
  | GetTeamMemberUserIdsRequest
  | GetTeamOwnerRequest
  | CheckUsersShareTeamRequest;
