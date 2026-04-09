# 37. Worker-Read Security Hardening

## Problem Statement

`worker-read` is a generic SQL proxy that accepts arbitrary SELECT queries from the Next.js dashboard. The current write-statement guard uses a simple regex that only checks the SQL first word:

```typescript
const WRITE_RE = /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA)\b/i;
```

This can be bypassed via:
- **Comment prefix**: `-- DELETE FROM users;` or `/* */ DELETE FROM users`
- **CTE**: `WITH x AS (SELECT 1) DELETE FROM users`
- **Multi-statement**: `SELECT 1; DELETE FROM users`
- **Whitespace**: Leading spaces/newlines before the statement

While the endpoint requires a shared secret (`WORKER_READ_SECRET`) between Next.js and the Worker, a compromised Next.js instance or leaked secret could allow arbitrary write operations.

## Scope

### In Scope
- `packages/worker-read/src/index.ts` — SQL validation logic
- `packages/web/src/lib/db-worker.ts` — DbRead adapter
- `packages/web/src/lib/db.ts` — DbRead interface
- All consumers of `getDbRead()` (~42 files, ~139 query calls):
  - API routes (`packages/web/src/app/api/**/*.ts`)
  - Auth layer (`packages/web/src/auth.ts`)
  - Lib modules (`packages/web/src/lib/invite.ts`, `auto-register.ts`, etc.)

### Out of Scope
- `packages/worker/` (write Worker) — already uses explicit INSERT statements
- `packages/web/src/lib/db-rest.ts` — DbWrite adapter (stays on REST API)
- CLI package — no D1 interaction

## Solution

Two-phase approach:

### Phase 1: SQL Tokenizer/Validator ✅ COMPLETED

Harden the SQL validation in `worker-read` using a minimal SQL tokenizer (not regex) to:
1. Strip comments (`--`, `/* */`) while preserving string literals
2. Reject semicolons outside string literals (multi-statement)
3. Detect CTE write patterns (`WITH...DELETE/UPDATE/INSERT`)
4. Require query to start with `SELECT` or `WITH` (for CTE SELECT)

**Status**: Deployed to production. Worker version 2.12.0.

### Phase 2: Business-Level RPC ✅ WORKER HANDLERS COMPLETED

Replace generic SQL proxy with typed query functions.

**Worker-read handlers**: All 16 domains implemented (302 tests passing).

**Web-side migration**: In progress (139 raw SQL calls to migrate).

## Domain Summary

| # | Domain | RPC Methods | Web Files | SQL Calls | Tables |
|---|--------|-------------|-----------|-----------|--------|
| 1 | users | 10 | 7 | ~10 | users, api_keys |
| 2 | projects | 15 | 2 | 22 | projects, project_aliases, project_tags |
| 3 | teams | 14 | 7 | 25 | teams, team_members |
| 4 | seasons | 12 | 7 | 18 | seasons, season_teams, season_team_members, season_snapshots |
| 5 | organizations | 5 | 8 | 22 | organizations, organization_members |
| 6 | showcases | 8 | 6 | 17 | showcases, showcase_upvotes |
| 7 | devices | 5 | 1 | 4 | device_aliases |
| 8 | auth | 5 | 2 | 4 | invite_codes, auth_codes |
| 9 | settings | 4 | 4 | 5 | app_settings, user_settings |
| 10 | pricing | 6 | 1 | 3 | model_pricing, pricing_plans, usage_tiers |
| 11 | usage | 5 | 1 | 2 | usage_records |
| 12 | sessions | 3 | 0 | 0 | session_records |
| 13 | achievements | 9 | 0 | 0 | (aggregates) |
| 14 | admin | 6 | 1 | 1 | audit_logs |
| 15 | leaderboard | 4 | 0 | 0 | (cross-table) |
| 16 | live | 4 | 1 | 1 | (health check) |
| **Total** | **115** | **42** | **139** | |

## Phase 3: Web-Side Migration

### Migration Strategy (Revised)

Instead of 139 atomic commits, we use a **batch migration approach** by domain:

1. **Step A**: Add all needed RPC methods to worker-read (per domain)
2. **Step B**: Add corresponding methods to DbRead interface + db-worker.ts
3. **Step C**: Batch migrate all web routes in that domain
4. **Step D**: Update test mocks (createMockDbRead)

This reduces commits from 139 to ~20-25 domain-based batches.

### Domain Progress Summary

| Domain | Worker Methods | DbRead Methods | Web Routes | Status |
|--------|---------------|----------------|------------|--------|
| users | 10 | 10 | ✅ migrated | ✅ DONE |
| organizations | 9 | 7 | 8 files | ⏳ Partial |
| showcases | 9 | 8 | 6 files | ⏳ Needs migration |
| teams | 14 | 3 | 7 files | ⏳ Needs methods |
| projects | 15 | 0 | 2 files | 🔴 Needs methods |
| seasons | 12 | 0 | 5 files | 🔴 Needs methods |
| devices | 5 | 0 | 1 file | 🔴 Needs methods |
| auth | 5 | 0 | 2 files | 🔴 Needs methods |
| settings | 4 | 0 | 3 files | 🔴 Needs methods |
| pricing | 6 | 3 | 1 file | ⏳ Partial |
| admin | 6 | 0 | 1 file | 🔴 Needs methods |

### Batch Migration Plan

#### Batch 1: Teams Domain (11 methods to add, 7 files)
**Worker methods to add to DbRead:**
- `getTeamById(teamId)` → teams.getById
- `getTeamMembers(teamId)` → teams.getMembers
- `getTeamSeasonRegistrations(teamId)` → teams.getSeasonRegistrations
- `findTeamByInviteCode(inviteCode)` → teams.findByInviteCode
- `checkTeamMembershipExists(teamId, userId)` → teams.membershipExists
- `listTeamsForUser(userId)` → teams.listForUser
- `checkTeamSlugExists(slug)` → teams.checkSlugExists
- `getTeamMemberUserIds(teamId)` → teams.getMemberUserIds

**Files to migrate:**
- teams/route.ts (2 calls)
- teams/join/route.ts (3 calls)
- teams/[teamId]/route.ts (10 calls) - 5 already migrated
- teams/[teamId]/logo/route.ts (4 calls)
- teams/[teamId]/members/[userId]/route.ts (2 calls)

#### Batch 2: Projects Domain (15 methods to add, 2 files)
**Worker methods to add to DbRead:**
- `listProjects(userId)` → projects.list
- `listProjectAliasesWithStats(userId/projectId)` → projects.listAliasesWithStats
- `listUnassignedRefs(userId)` → projects.listUnassignedRefs
- `listProjectTags(projectId)` → projects.listTags
- `getProjectById(projectId)` → projects.getById
- `getProjectByName(userId, name)` → projects.getByName
- `getProjectByNameExcluding(userId, name, excludeId)` → projects.getByNameExcluding
- `checkProjectExistsForUser(userId, name)` → projects.existsForUser
- `checkSessionRecordExists(projectId)` → projects.sessionRecordExists
- `getAliasOwner(alias)` → projects.getAliasOwner
- `getAliasStats(alias)` → projects.getAliasStats
- `checkAliasAttachedToProject(alias, projectId)` → projects.aliasAttachedToProject
- `checkTagExists(projectId, tag)` → projects.tagExists
- `getProjectTagList(projectId)` → projects.getTagList

**Files to migrate:**
- projects/route.ts (11 calls)
- projects/[id]/route.ts (11 calls)

#### Batch 3: Seasons Domain (12 methods to add, 5+ files)
**Worker methods to add to DbRead:**
- `listSeasons(filter?)` → seasons.list
- `getSeasonById(seasonId)` → seasons.getById
- `getSeasonBySlug(slug)` → seasons.getBySlug
- `getSeasonRegistration(seasonId, teamId)` → seasons.getRegistration
- `checkSeasonMemberConflict(seasonId, userIds)` → seasons.checkMemberConflict
- `getSeasonTeamTokens(seasonId)` → seasons.getTeamTokens
- `getSeasonMemberTokens(seasonId)` → seasons.getMemberTokens
- `getSeasonTeamSessionStats(seasonId)` → seasons.getTeamSessionStats
- `getSeasonMemberSessionStats(seasonId)` → seasons.getMemberSessionStats
- `getSeasonSnapshots(seasonId)` → seasons.getSnapshots
- `getSeasonMemberSnapshots(seasonId)` → seasons.getMemberSnapshots
- `getSeasonTeamMembers(seasonId, teamId)` → seasons.getTeamMembers

**Files to migrate:**
- seasons/[seasonId]/register/route.ts (8 calls)
- admin/seasons/route.ts (2 calls)
- admin/seasons/[seasonId]/route.ts (2 calls)
- admin/seasons/[seasonId]/snapshot/route.ts (3 calls)
- admin/seasons/[seasonId]/sync-rosters/route.ts (1 call)
- lib/auto-register.ts (5 calls)
- lib/season-roster.ts (6 calls)

#### Batch 4: Showcases Domain (already have methods, 6 files)
**DbRead methods already exist.** Just need to migrate web routes.

**Files to migrate:**
- showcases/route.ts (6 calls)
- showcases/[id]/route.ts (4 calls)
- showcases/[id]/upvote/route.ts (3 calls)
- showcases/[id]/refresh/route.ts (2 calls)
- showcases/preview/route.ts (1 call)
- admin/showcases/route.ts (3 calls)

#### Batch 5: Devices Domain (5 methods to add, 1 file)
**Worker methods to add to DbRead:**
- `listDeviceAliases(userId)` → devices.list
- `getDeviceAlias(userId, deviceId)` → devices.getAlias
- `checkDuplicateDeviceAlias(userId, alias, excludeDeviceId?)` → devices.checkDuplicateAlias
- `checkDeviceHasRecords(userId, deviceId)` → devices.hasRecords
- `checkDeviceExists(userId, deviceId)` → devices.exists

**Files to migrate:**
- devices/route.ts (4 calls)

#### Batch 6: Auth Domain (5 methods to add, 2 files)
**Worker methods to add to DbRead:**
- `getAuthCode(code)` → auth.getAuthCode
- `listInviteCodes()` → auth.listInviteCodes
- `checkInviteCodeExists(code)` → auth.checkInviteCodeExists
- `getInviteCode(code)` → auth.getInviteCode
- `checkUserHasUnusedInvite(userId)` → auth.checkUserHasUnusedInvite

**Files to migrate:**
- auth/code/verify/route.ts (3 calls)
- admin/invites/route.ts (3 calls)

#### Batch 7: Settings Domain (4 methods to add, 3 files)
**Worker methods to add to DbRead:**
- `getAppSetting(key)` → settings.getApp
- `getAllAppSettings()` → settings.getAllApp
- `getUserSetting(userId, key)` → settings.getUser
- `getAllUserSettings(userId)` → settings.getAllUser

**Files to migrate:**
- auth/invite-required/route.ts (1 call)
- settings/route.ts (2 calls)
- admin/settings/route.ts (1 call)
- lib/invite.ts (1 call)

#### Batch 8: Organizations Domain (partial, 8 files)
**DbRead methods mostly exist.** Need to add:
- `countOrgMembers(orgId)` → organizations.countMembers
- `listOrgMembersAdmin(orgId)` → organizations.listMembersAdmin

**Files to migrate:**
- organizations/[orgId]/members/route.ts (2 calls)
- organizations/route.ts (1 call) - ✅ already done
- organizations/mine/route.ts (1 call) - ✅ already done
- organizations/[orgId]/join/route.ts (2 calls) - ✅ already done
- organizations/[orgId]/leave/route.ts (2 calls) - ✅ already done
- admin/organizations/route.ts (2 calls)
- admin/organizations/[orgId]/route.ts (7 calls)
- admin/organizations/[orgId]/members/route.ts (5 calls)
- admin/organizations/[orgId]/logo/route.ts (3 calls)

#### Batch 9: Pricing Domain (partial, 1 file)
**DbRead methods exist.** Just need to use them in POST/PUT handlers.

**Files to migrate:**
- admin/pricing/route.ts (2 calls remaining in POST/PUT)

#### Batch 10: Misc (lib files, rate-limit)
**Files to migrate:**
- lib/rate-limit.ts (1 call) - uses showcases.count

### Legacy Atomic Checklist (Reference Only)

#### projects domain (22 calls, 2 files)

**packages/web/src/app/api/projects/route.ts** (11 calls)
- [ ] M001: `dbRead.query<ProjectRow>` → `projects.list`
- [ ] M002: `dbRead.query<AliasStatsRow>` (1st) → `projects.listAliasesWithStats`
- [ ] M003: `dbRead.query<AliasStatsRow>` (2nd) → `projects.listAliasesWithStats`
- [ ] M004: `dbRead.query<UnassignedRow>` (1st) → `projects.listUnassignedRefs`
- [ ] M005: `dbRead.query<UnassignedRow>` (2nd) → `projects.listUnassignedRefs`
- [ ] M006: `dbRead.query<TagRow>` → `projects.listTags`
- [ ] M007: `dbRead.firstOrNull<{ id: string }>` → `projects.existsForUser`
- [ ] M008: `dbRead.firstOrNull<{ "1": number }>` → `projects.sessionRecordExists`
- [ ] M009: `dbRead.firstOrNull<{ project_id: string }>` → `projects.getAliasOwner`
- [ ] M010: `dbRead.query<{ ... }>` (stats) → `projects.getAliasStats`
- [ ] M011: `dbRead.firstOrNull<{ created_at: string }>` → `projects.getById`

**packages/web/src/app/api/projects/[id]/route.ts** (11 calls)
- [ ] M012: `dbRead.firstOrNull<{ id: string; name: string }>` → `projects.getById`
- [ ] M013: `dbRead.firstOrNull<{ id: string }>` (existing check) → `projects.getByNameExcluding`
- [ ] M014: `dbRead.firstOrNull<{ "1": number }>` → `projects.sessionRecordExists`
- [ ] M015: `dbRead.firstOrNull<{ project_id: string }>` (taken) → `projects.getAliasOwner`
- [ ] M016: `dbRead.firstOrNull<{ project_id: string }>` (attached) → `projects.aliasAttachedToProject`
- [ ] M017: `dbRead.firstOrNull<{ tag: string }>` (1st) → `projects.tagExists`
- [ ] M018: `dbRead.firstOrNull<{ tag: string }>` (2nd) → `projects.tagExists`
- [ ] M019: `dbRead.firstOrNull<{ ... }>` (updated) → `projects.getById`
- [ ] M020: `dbRead.query<AliasStatsRow>` → `projects.listAliasesWithStats`
- [ ] M021: `dbRead.query<{ tag: string }>` → `projects.getTagList`
- [ ] M022: `dbRead.firstOrNull<{ id: string }>` (delete check) → `projects.getById`

#### teams domain (25 calls, 7 files)

**packages/web/src/app/api/teams/[teamId]/route.ts** (10 calls)
- [x] M023: `dbRead.firstOrNull<{ role: string }>` (1st) → `teams.getMembership`
- [ ] M024: `dbRead.firstOrNull<{ ... }>` (team info) → `teams.getById`
- [ ] M025: `dbRead.query<{ ... }>` (members) → `teams.getMembers`
- [ ] M026: `dbRead.query<{ season_id: string }>` → `teams.getSeasonRegistrations`
- [x] M027: `dbRead.firstOrNull<{ role: string }>` (2nd) → `teams.getMembership`
- [ ] M028: `dbRead.firstOrNull<{ ... }>` (edit check) → `teams.getById`
- [x] M029: `dbRead.firstOrNull<{ logo_url: string | null }>` → `teams.getLogoUrl`
- [x] M030: `dbRead.firstOrNull<{ cnt: number }>` → `teams.countMembers`
- [x] M031: `dbRead.firstOrNull<{ role: string }>` (3rd) → `teams.getMembership`
- [ ] M032: `dbRead.query<{ ... }>` (members 2nd) → `teams.getMembers`

**packages/web/src/app/api/teams/[teamId]/logo/route.ts** (4 calls)
- [ ] M033: `dbRead.firstOrNull<{ role: string }>` (GET) → `teams.getMembership`
- [ ] M034: `dbRead.firstOrNull<{ logo_url: string | null }>` (GET) → `teams.getLogoUrl`
- [ ] M035: `dbRead.firstOrNull<{ role: string }>` (POST) → `teams.getMembership`
- [ ] M036: `dbRead.firstOrNull<{ logo_url: string | null }>` (POST) → `teams.getLogoUrl`

**packages/web/src/app/api/teams/[teamId]/members/[userId]/route.ts** (2 calls)
- [ ] M037: `dbRead.firstOrNull<{ role: string }>` (1st) → `teams.getMembership`
- [ ] M038: `dbRead.firstOrNull<{ role: string }>` (2nd) → `teams.getMembership`

**packages/web/src/app/api/teams/join/route.ts** (3 calls)
- [ ] M039: `dbRead.firstOrNull<{ value: string }>` → `teams.getAppSetting`
- [ ] M040: `dbRead.firstOrNull<{ id: string; name: string; slug: string }>` → `teams.findByInviteCode`
- [ ] M041: `dbRead.firstOrNull<{ id: string }>` → `teams.membershipExists`

**packages/web/src/app/api/teams/route.ts** (2 calls)
- [ ] M042: `dbRead.query<TeamRow>` → `teams.listForUser`
- [ ] M043: `dbRead.firstOrNull<{ id: string }>` → `teams.checkSlugExists`

**packages/web/src/lib/auto-register.ts** (5 calls)
- [ ] M044: `dbRead.query<{ ... }>` (active seasons) → `seasons.list` (with filter)
- [ ] M045: `dbRead.query<{ user_id: string }>` → `teams.getMemberUserIds`
- [ ] M046: `dbRead.firstOrNull<{ ... }>` (season team) → `seasons.getRegistration`
- [ ] M047: `dbRead.firstOrNull<{ user_id: string }>` (1st) → `seasons.checkMemberConflict`
- [ ] M048: `dbRead.firstOrNull<{ user_id: string }>` (2nd) → `seasons.checkMemberConflict`

**packages/web/src/lib/season-roster.ts** (6 calls)
- [ ] M049: `dbRead.query<{ ... }>` (team registrations) → `seasons.getTeamTokens`
- [ ] M050: `dbRead.query<{ ... }>` (member tokens) → `seasons.getMemberTokens`
- [ ] M051: `dbRead.query<{ ... }>` (team sessions) → `seasons.getTeamSessionStats`
- [ ] M052: `dbRead.query<{ ... }>` (member sessions) → `seasons.getMemberSessionStats`
- [ ] M053: `dbRead.query<{ ... }>` (snapshots) → `seasons.getSnapshots`
- [ ] M054: `dbRead.query<{ ... }>` (member snapshots) → `seasons.getMemberSnapshots`

#### seasons domain (10 calls, 5 files)

**packages/web/src/app/api/seasons/[seasonId]/register/route.ts** (8 calls)
- [ ] M055: `dbRead.firstOrNull<{ ... }>` (season info) → `seasons.getById`
- [ ] M056: `dbRead.firstOrNull<{ id: string }>` (team check 1) → `teams.getById`
- [ ] M057: `dbRead.firstOrNull<{ role: string }>` (membership) → `teams.getMembership`
- [ ] M058: `dbRead.firstOrNull<{ id: string }>` (existing reg) → `seasons.getRegistration`
- [ ] M059: `dbRead.firstOrNull<{ ... }>` (season info 2) → `seasons.getById`
- [ ] M060: `dbRead.firstOrNull<{ id: string }>` (team check 2) → `teams.getById`
- [ ] M061: `dbRead.firstOrNull<{ role: string }>` (membership 2) → `teams.getMembership`
- [ ] M062: `dbRead.firstOrNull<{ user_id: string }>` → `seasons.checkMemberConflict`
- [ ] M063: `dbRead.query<{ user_id: string }>` → `teams.getMemberUserIds`

**packages/web/src/app/api/admin/seasons/route.ts** (2 calls)
- [ ] M064: `dbRead.query<{ ... }>` → `seasons.list`
- [ ] M065: `dbRead.firstOrNull<{ id: string }>` → `seasons.getBySlug`

**packages/web/src/app/api/admin/seasons/[seasonId]/route.ts** (2 calls)
- [ ] M066: `dbRead.firstOrNull<{ ... }>` (1st) → `seasons.getById`
- [ ] M067: `dbRead.firstOrNull<{ ... }>` (2nd) → `seasons.getById`

**packages/web/src/app/api/admin/seasons/[seasonId]/snapshot/route.ts** (3 calls)
- [ ] M068: `dbRead.firstOrNull<SeasonRow>` → `seasons.getById`
- [ ] M069: `dbRead.query<TeamAggRow>` → `seasons.getTeamTokens`
- [ ] M070: `dbRead.query<MemberAggRow>` → `seasons.getMemberTokens`

**packages/web/src/app/api/admin/seasons/[seasonId]/sync-rosters/route.ts** (1 call)
- [ ] M071: `dbRead.firstOrNull<{ ... }>` → `seasons.getById`

#### organizations domain (22 calls, 8 files)

**packages/web/src/app/api/admin/organizations/[orgId]/route.ts** (7 calls)
- [ ] M072: `dbRead.firstOrNull<{ id: string }>` (1st) → `organizations.getById`
- [ ] M073: `dbRead.firstOrNull<{ ... }>` (full) → `organizations.getById`
- [ ] M074: `dbRead.firstOrNull<{ count: number }>` (1st) → `organizations.countMembers`
- [ ] M075: `dbRead.firstOrNull<{ id: string }>` (2nd) → `organizations.getById`
- [ ] M076: `dbRead.firstOrNull<{ ... }>` (full 2) → `organizations.getById`
- [ ] M077: `dbRead.firstOrNull<{ count: number }>` (2nd) → `organizations.countMembers`
- [ ] M078: `dbRead.firstOrNull<{ id: string; slug: string }>` → `organizations.getById`

**packages/web/src/app/api/admin/organizations/[orgId]/members/route.ts** (5 calls)
- [ ] M079: `dbRead.firstOrNull<{ id: string }>` (1st) → `organizations.getById`
- [ ] M080: `dbRead.query<{ ... }>` → `organizations.listMembers`
- [ ] M081: `dbRead.firstOrNull<{ id: string }>` (2nd) → `organizations.getById`
- [ ] M082: `dbRead.firstOrNull<{ id: string }>` (user) → `users.getById`
- [ ] M083: `dbRead.firstOrNull<{ ... }>` (user full) → `users.getById`

**packages/web/src/app/api/admin/organizations/[orgId]/members/[userId]/route.ts** (2 calls)
- [x] M084: `dbRead.firstOrNull<{ id: string }>` (org) → `organizations.getById`
- [x] M085: `dbRead.firstOrNull<{ id: string }>` (member) → `organizations.checkMembership`

**packages/web/src/app/api/admin/organizations/[orgId]/logo/route.ts** (3 calls)
- [ ] M086: `dbRead.firstOrNull<{ id: string }>` → `organizations.getById`
- [ ] M087: `dbRead.firstOrNull<{ logo_url: string | null }>` → `organizations.getById`
- [ ] M088: `dbRead.firstOrNull<{ id: string; logo_url: string | null }>` → `organizations.getById`

**packages/web/src/app/api/admin/organizations/route.ts** (2 calls)
- [ ] M089: `dbRead.query<{ ... }>` → `organizations.list`
- [ ] M090: `dbRead.firstOrNull<{ id: string }>` → `organizations.getBySlug`

**packages/web/src/app/api/organizations/[orgId]/join/route.ts** (2 calls)
- [ ] M091: `dbRead.firstOrNull<{ id: string; name: string; slug: string }>` → `organizations.getById`
- [ ] M092: `dbRead.firstOrNull<{ id: string }>` → `organizations.checkMembership`

**packages/web/src/app/api/organizations/[orgId]/leave/route.ts** (2 calls)
- [ ] M093: `dbRead.firstOrNull<{ id: string }>` (org) → `organizations.getById`
- [ ] M094: `dbRead.firstOrNull<{ id: string }>` (member) → `organizations.checkMembership`

**packages/web/src/app/api/organizations/[orgId]/members/route.ts** (2 calls)
- [ ] M095: `dbRead.firstOrNull<{ id: string }>` → `organizations.getById`
- [ ] M096: `dbRead.query<{ ... }>` → `organizations.listMembers`

**packages/web/src/app/api/organizations/mine/route.ts** (1 call)
- [ ] M097: `dbRead.query<OrgRow>` → `organizations.listForUser`

**packages/web/src/app/api/organizations/route.ts** (1 call)
- [ ] M098: `dbRead.query<OrgRow>` → `organizations.list`

#### showcases domain (17 calls, 6 files)

**packages/web/src/app/api/showcases/route.ts** (6 calls)
- [ ] M099: `dbRead.query<ShowcaseRow>` (1st) → `showcases.list`
- [ ] M100: `dbRead.query<ShowcaseRow>` (2nd) → `showcases.list`
- [ ] M101: `dbRead.query<ShowcaseRow>` (3rd) → `showcases.list`
- [ ] M102: `dbRead.firstOrNull<{ count: number }>` (1st) → `showcases.count`
- [ ] M103: `dbRead.firstOrNull<{ count: number }>` (2nd) → `showcases.count`
- [ ] M104: `dbRead.firstOrNull<{ id: string }>` → `showcases.checkExists`

**packages/web/src/app/api/showcases/[id]/route.ts** (4 calls)
- [ ] M105: `dbRead.firstOrNull<ShowcaseRow>` (GET) → `showcases.getById`
- [ ] M106: `dbRead.firstOrNull<{ id: string; user_id: string }>` (PATCH owner) → `showcases.getOwner`
- [ ] M107: `dbRead.firstOrNull<ShowcaseRow>` (PATCH) → `showcases.getById`
- [ ] M108: `dbRead.firstOrNull<{ id: string; user_id: string }>` (DELETE) → `showcases.getOwner`

**packages/web/src/app/api/showcases/[id]/upvote/route.ts** (3 calls)
- [ ] M109: `dbRead.firstOrNull<{ id: string; is_public: number }>` → `showcases.getById`
- [ ] M110: `dbRead.firstOrNull<{ id: number }>` → `showcases.checkUpvote`
- [ ] M111: `dbRead.firstOrNull<{ count: number }>` → `showcases.getUpvoteCount`

**packages/web/src/app/api/showcases/[id]/refresh/route.ts** (2 calls)
- [ ] M112: `dbRead.firstOrNull<{ id: string }>` → `showcases.getById`
- [ ] M113: `dbRead.firstOrNull<{ ... }>` → `showcases.getById`

**packages/web/src/app/api/showcases/preview/route.ts** (1 call)
- [ ] M114: `dbRead.firstOrNull<{ id: string }>` → `showcases.checkExists`

**packages/web/src/app/api/admin/showcases/route.ts** (3 calls)
- [ ] M115: `dbRead.query<AdminShowcaseRow>` → `showcases.list`
- [ ] M116: `dbRead.firstOrNull<{ count: number }>` → `showcases.count`
- [ ] M117: `dbRead.firstOrNull<{ ... }>` → `showcases.getById`

#### devices domain (4 calls, 1 file)

**packages/web/src/app/api/devices/route.ts** (4 calls)
- [ ] M118: `dbRead.query<DeviceRow>` → `devices.list`
- [ ] M119: `dbRead.firstOrNull<{ device_id: string }>` (1st) → `devices.getAlias`
- [ ] M120: `dbRead.firstOrNull<{ device_id: string }>` (2nd) → `devices.checkDuplicateAlias`
- [ ] M121: `dbRead.firstOrNull<{ cnt: number }>` → `devices.hasRecords`

#### auth domain (4 calls, 2 files)

**packages/web/src/app/api/auth/code/verify/route.ts** (3 calls)
- [ ] M122: `dbRead.firstOrNull<AuthCodeRow>` → `auth.getAuthCode`
- [ ] M123: `dbRead.firstOrNull<UserRow>` (1st) → `users.getById`
- [ ] M124: `dbRead.firstOrNull<UserRow>` (2nd) → `users.getById`

**packages/web/src/app/api/admin/invites/route.ts** (3 calls)
- [ ] M125: `dbRead.query<InviteCodeRow>` → `auth.listInviteCodes`
- [ ] M126: `dbRead.firstOrNull<{ id: number }>` → `auth.checkInviteCodeExists`
- [ ] M127: `dbRead.firstOrNull<{ used_by: string | null }>` → `auth.getInviteCode`

#### settings domain (5 calls, 4 files)

**packages/web/src/app/api/auth/invite-required/route.ts** (1 call)
- [ ] M128: `dbRead.firstOrNull<{ value: string }>` → `settings.getApp`

**packages/web/src/app/api/settings/route.ts** (2 calls)
- [ ] M129: `dbRead.firstOrNull<{ nickname: string | null; slug: string | null }>` → `users.getSettings`
- [ ] M130: `dbRead.firstOrNull<{ slug: string | null }>` → `users.getSettings`

**packages/web/src/app/api/admin/settings/route.ts** (1 call)
- [ ] M131: `dbRead.query<SettingRow>` → `settings.getAllApp`

**packages/web/src/lib/invite.ts** (2 calls)
- [ ] M132: `dbRead.firstOrNull<{ value: string }>` → `settings.getApp`
- [ ] M133: `dbRead.firstOrNull<{ id: string }>` → `users.getById`

#### pricing domain (3 calls, 1 file)

**packages/web/src/app/api/admin/pricing/route.ts** (3 calls)
- [ ] M134: `dbRead.query<DbPricingRow>` → `pricing.listModelPricing`
- [ ] M135: `dbRead.firstOrNull<DbPricingRow>` (1st) → `pricing.getModelPricing`
- [ ] M136: `dbRead.firstOrNull<DbPricingRow>` (2nd) → `pricing.getModelPricing`

#### other domains (6 calls)

**packages/web/src/app/api/auth/cli/route.ts** (1 call)
- [ ] M137: `dbRead.firstOrNull<{ api_key: string | null }>` → `users.getApiKey`

**packages/web/src/app/api/admin/users/route.ts** (1 call)
- [ ] M138: `dbRead.query<{ ... }>` → `users.search` or `admin.listUsers`

**packages/web/src/lib/rate-limit.ts** (1 call)
- [ ] M139: `dbRead.firstOrNull<{ count: number }>` → `showcases.count` (rate limit check)

**packages/web/src/app/api/account/delete/route.ts** (1 call)
- [ ] M140: `dbRead.firstOrNull<UserRow>` → `users.getById`

## Progress Summary

| Phase | Status | Details |
|-------|--------|---------|
| Phase 1: SQL Tokenizer | ✅ COMPLETED | Deployed v2.12.0 |
| Phase 2: RPC Handlers | ✅ COMPLETED | 16 domains, 115 methods, 302 tests |
| Phase 3: Web Migration | 🔄 IN PROGRESS | 10 batches, ~108 calls remaining |

### Completed Migrations
- M129-M132: users domain (getUserApiKey, getUserEmail, searchUsers)
- M135-M136: organizations list (listOrganizationsWithCount, listUserOrganizations)
- M138-M140: organizations CRUD (join, leave, account/delete)
- M023, M027, M029-M031: teams partial (getMembership, getLogoUrl, countMembers)

## Execution Notes

- Each migration item (M001-M139) is one atomic commit
- Commit message format: `refactor(web): migrate {file} {call} to RPC`
- After all migrations complete, remove `/api/query` endpoint from worker-read

## References

- [29-worker-read-migration.md](./29-worker-read-migration.md) — Original Worker migration
- [30-quality-system-upgrade.md](./30-quality-system-upgrade.md) — 6DQ methodology
- [31-d1-test-isolation.md](./31-d1-test-isolation.md) — Test database isolation
