# 33 — Achievement System Overhaul

> "Welcome to the Hall of Shame, where every token spent is a badge of dishonor."

## Background

The current achievement system is a minimal MVP: 6 achievements displayed in a 2×3 grid on the dashboard Hero sidebar. It lacks:

1. **Dedicated page** — achievements are buried in the dashboard, no way to browse all of them
2. **Social proof** — no visibility into who else earned achievements
3. **Variety** — only 6 achievements, missing many data dimensions we already collect
4. **Personality** — generic names and descriptions, no WoW-style sass

This document plans a comprehensive overhaul inspired by WoW's Achievement system, with satirical, self-deprecating flavor.

## Goals

1. **Achievements Page** — standalone route at `/leaderboard/achievements` (or `/achievements`), entry in LeaderboardNav
2. **Dashboard Integration** — show user's highest-tier achievement on dashboard Hero, clickable to achievements page
3. **Achievement Roster Expansion** — add 20+ new achievements leveraging all available data
4. **WoW-style Copy** — ironic, self-aware names and descriptions that mock our AI-tool-addiction
5. **Social Features** — show avatars of users who earned each achievement, click to open profile dialog

## Data Inventory

### Token Data (usage_records)

| Field | Achievement Potential |
|-------|----------------------|
| `total_tokens` | Power user tiers, lifetime totals |
| `input_tokens` | Verbose prompts |
| `output_tokens` | Chatty AI responses |
| `cached_input_tokens` | Cache efficiency |
| `reasoning_output_tokens` | Thinking model usage |
| `source` | Tool-specific achievements |
| `model` | Model loyalty / diversity |
| `device_id` | Multi-device usage |
| `hour_start` | Time-of-day, streaks, weekends |

### Session Data (session_records)

| Field | Achievement Potential |
|-------|----------------------|
| `duration_seconds` | Marathon sessions, quick wins |
| `user_messages` | Conversation depth |
| `total_messages` | Message count records |
| `kind` | Human vs automated sessions |
| `started_at` | Night owl, early bird |
| `project_ref` | Project focus / diversity |

### Derived Metrics

- **Streak** — consecutive active days
- **Active Days** — unique days with usage
- **Cache Rate** — cached / input tokens
- **Cost** — computed from pricing map
- **Peak Hour** — hour with highest activity
- **Tool Diversity** — number of different sources used
- **Model Diversity** — number of different models used

## Achievement Taxonomy

### Category: Volume (Token Gluttony)

| ID | Name | Flavor Text | Tiers |
|----|------|-------------|-------|
| `power-user` | **Insatiable** | "Your wallet weeps. Your AI rejoices." | 100K / 1M / 10M / 50M tokens |
| `big-day` | **One More Turn** | "You said 'just one more prompt' 47 times." | 10K / 50K / 100K / 500K tokens/day |
| `input-hog` | **The Novelist** | "Did you just paste your entire codebase again?" | 50K / 200K / 1M / 5M input |
| `output-addict` | **Attention Seeker** | "You could've read the docs. But no." | 50K / 200K / 1M / 5M output |
| `reasoning-junkie` | **Overthinker** | "Watching an AI think about thinking." | 10K / 100K / 500K / 2M reasoning |

### Category: Consistency (The Grind)

| ID | Name | Flavor Text | Tiers |
|----|------|-------------|-------|
| `streak` | **On Fire** | "Your streak is alive. Your social life is not." | 3 / 7 / 14 / 30 days |
| `veteran` | **No Life** | "You've been here longer than some marriages." | 7 / 30 / 90 / 365 active days |
| `weekend-warrior` | **No Rest for the Wicked** | "Saturday? More like Codeturday." | 4 / 12 / 26 / 52 weekend days ⚠️ |
| `night-owl` | **Sleep is Overrated** | "2AM prompt submitted. 2:01AM regret." | 10 / 30 / 100 / 300 midnight-6am hours ⚠️ |
| `early-bird` | **Dawn Debugger** | "The AI was your first conversation today." | 10 / 30 / 100 / 300 6am-9am hours ⚠️ |

> ⚠️ **Timezone-dependent achievements** (`weekend-warrior`, `night-owl`, `early-bird`): These require user timezone to compute accurately. See Decision 5 for social feature limitations and DST approximation notes.

### Category: Efficiency (Copium)

| ID | Name | Flavor Text | Tiers |
|----|------|-------------|-------|
| `cache-master` | **Recycler** | "At least SOMETHING is being reused." | 10% / 25% / 50% / 75% cache rate |
| `quick-draw` | **One and Done** | "In, out, shipped. Respect." | 10 / 50 / 200 / 500 sessions <5min |
| `marathon` | **Send Help** | "This session is older than some startups." | 1 / 5 / 20 / 50 sessions >2hr |

### Category: Spending (Financial Ruin)

| ID | Name | Flavor Text | Tiers |
|----|------|-------------|-------|
| `big-spender` | **API Baron** | "Anthropic sends you a Christmas card." | $1 / $10 / $50 / $100 |
| `daily-burn` | **Money Printer** | "Your daily API bill could feed a small village." | $0.50 / $2 / $10 / $50/day |

### Category: Diversity (Tool Hoarding)

| ID | Name | Flavor Text | Tiers |
|----|------|-------------|-------|
| `tool-hoarder` | **Commitment Issues** | "You've tried every CLI tool. Twice." | 2 / 4 / 5 / 7 sources |
| `model-tourist` | **Model Agnostic** | "Opus? Sonnet? Haiku? Yes." | 3 / 5 / 8 / 12 models |
| `device-nomad` | **Work From Anywhere** | "Your code runs on 4 different machines. None of them work." | 2 / 3 / 5 / 8 devices |

### Category: Sessions (Conversation Crimes)

| ID | Name | Flavor Text | Tiers |
|----|------|-------------|-------|
| `chatterbox` | **Verbose Mode** | "Your sessions have more messages than group chats." | 50 / 100 / 500 / 1000 msg/session |
| `session-hoarder` | **Context Collector** | "You've started more sessions than you've finished." | 100 / 500 / 2000 / 10000 sessions |
| `automation-addict` | **The Machine** | "Let the robots talk to the robots." | 10 / 50 / 200 / 1000 automated sessions |

### Category: Special (Hidden / Rare)

| ID | Name | Flavor Text | Condition |
|----|------|-------------|-----------|
| `first-blood` | **Hello World** | "Your first token. The gateway drug." | First usage ever |
| `centurion` | **Triple Digits** | "Day 100. Still no exit strategy." | 100 active days |
| `millionaire` | **Club 1M** | "Welcome to the club nobody wanted to join." | 1M lifetime tokens |
| `billionaire` | **Tokens Go Brrrr** | "Seriously, are you okay?" | 1B lifetime tokens (aspirational) |

## UI Design

### Achievements Page (`/leaderboard/achievements`)

```
┌─────────────────────────────────────────────────────────────┐
│  [Page Header - same as leaderboard]                        │
│  [LeaderboardNav - Individual | Seasons | Achievements]     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ Summary Bar ──────────────────────────────────────────┐ │
│  │  🏆 18 / 25 Unlocked   ⭐ 5 Diamond   🔥 7-day streak  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ Category: Volume ─────────────────────────────────────┐ │
│  │                                                         │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │ [Icon Ring]  │  │ [Icon Ring]  │  │ [Icon Ring]  │  │ │
│  │  │ Insatiable   │  │ One More Turn│  │ The Novelist │  │ │
│  │  │ GOLD         │  │ SILVER       │  │ LOCKED       │  │ │
│  │  │ 8.2M / 10M   │  │ 45K / 50K    │  │ 12K / 50K    │  │ │
│  │  │ [avatars...] │  │ [avatars...] │  │              │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │ │
│  │                                                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ Category: Consistency ────────────────────────────────┐ │
│  │  ...                                                    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Achievement Card (Expanded)

```
┌────────────────────────────────────────┐
│  [56px Progress Ring with Icon]        │
│                                        │
│  Insatiable                      GOLD  │
│  "Your wallet weeps..."                │
│                                        │
│  ████████████████░░░░  82% → Diamond   │
│  8.2M / 10M tokens                     │
│                                        │
│  Earned by:                            │
│  [👤] [👤] [👤] [👤] +12 more          │
└────────────────────────────────────────┘
```

### Dashboard Hero Integration

Replace current `AchievementPanel` with a single "Top Achievement" card (shows highest-tier achievement, not "most recent" — see Decision 1):

```
┌─ Top Achievement ──────────────────────┐
│                                        │
│  🏆 On Fire — DIAMOND                  │
│  30-day streak unlocked!               │
│                                        │
│  [View All Achievements →]             │
└────────────────────────────────────────┘
```

Clicking opens the achievements page.

## API Design

### GET `/api/achievements`

Returns all achievement definitions + current user's progress.

```typescript
interface AchievementResponse {
  achievements: Array<{
    id: string;
    name: string;
    flavorText: string;
    icon: string;
    category: string;
    tier: "locked" | "bronze" | "silver" | "gold" | "diamond";
    currentValue: number;
    tiers: [number, number, number, number];
    progress: number;
    displayValue: string;
    displayThreshold: string;
    unit: string;
    // Social data
    earnedBy: Array<{
      id: string;
      name: string;
      image: string | null;
      slug: string | null;
      tier: "bronze" | "silver" | "gold" | "diamond";
    }>;
    totalEarned: number;
  }>;
  summary: {
    totalUnlocked: number;
    totalAchievements: number;
    diamondCount: number;
    currentStreak: number;
  };
}
```

### GET `/api/achievements/[id]/members`

Paginated list of users who earned a specific achievement.

```typescript
interface AchievementMembersResponse {
  members: Array<{
    id: string;
    name: string;
    image: string | null;
    slug: string | null;
    tier: "bronze" | "silver" | "gold" | "diamond";
    earnedAt: string; // ISO datetime
    currentValue: number;
  }>;
  cursor: string | null;
}
```

## Implementation Plan

### Phase 1: Server-Side Achievement API

1. Create `GET /api/achievements` route:
   - Compute all achievements server-side using SQL aggregations
   - Return `achievements[]` + `summary` as specified in API Design
   - Include "earned by" preview (top 5 users per achievement)
2. Expand `achievement-helpers.ts`:
   - Add `category` and `flavorText` fields to `AchievementDef`
   - Add all new achievement definitions from Taxonomy
   - Extract `computeTierProgress()` as shared utility
3. Unit tests for all achievement value extractors

### Phase 2: Social Data & Members Endpoint

1. Create `GET /api/achievements/[id]/members` route:
   - Paginated list of users who earned the achievement
   - Compute approximate `earnedAt` from historical data
2. Add achievement-specific SQL queries:
   - Time-of-day achievements (night-owl, early-bird): filter by UTC hour
   - Session-based achievements: aggregate from `session_records`
   - Diversity achievements: `COUNT(DISTINCT ...)` queries
3. Integration tests with real D1 data

### Phase 3: Achievements Page

1. Add "Achievements" tab to `LeaderboardNav`
2. Create `/leaderboard/achievements/page.tsx`
3. Build `AchievementGrid` component with category sections
4. Build expanded `AchievementCard` with social avatars
5. Wire up `UserProfileDialog` for avatar clicks

### Phase 4: Dashboard Integration

1. Create `TopAchievement` component (shows highest-tier achievement, not most recent)
2. Replace `AchievementPanel` in Hero sidebar
3. Add "View All" link to achievements page
4. Remove client-side achievement computation from dashboard

### Phase 5: Polish

1. Add animations for tier upgrades
2. Add toast notifications for new achievements (compare before/after on load)
3. Consider push notifications for milestone achievements

## Technical Notes

### Achievement Computation Strategy

All achievement computation runs server-side in `GET /api/achievements`. The `achievement-helpers.ts` module provides:
- `AchievementDef` type definitions (shared between API and any future client utilities)
- `computeTierProgress()` helper (used by API route)
- Formatting functions (`formatShortTokens`, `formatDollars`, etc.)

The existing client-side dashboard achievement panel will be replaced with a simple fetch to the new API.

### Caching Considerations

- Achievement definitions are static — can be bundled client-side
- User progress changes on each sync — no caching
- "Earned by" lists change slowly — cache for 5-10 minutes

### Timezone-Dependent Achievements

The `hour_start` field is stored in UTC. For `weekend-warrior`, `night-owl`, and `early-bird`, we convert to the **current user's** local time:

```typescript
// Convert UTC to user's local time (APPROXIMATE - ignores DST history)
const utcHour = new Date(row.hour_start).getUTCHours();
const localHour = (utcHour - tzOffset / 60 + 24) % 24;

// For weekend-warrior: also need local day-of-week
const utcDate = new Date(row.hour_start);
const localDate = new Date(utcDate.getTime() - tzOffset * 60 * 1000);
const localDayOfWeek = localDate.getUTCDay(); // 0=Sun, 6=Sat
const isWeekend = localDayOfWeek === 0 || localDayOfWeek === 6;

// For night-owl
const isNightOwl = localHour >= 0 && localHour < 6;

// For early-bird
const isEarlyBird = localHour >= 6 && localHour < 9;
```

**Limitations** (see Decision 5):
- Requires `tzOffset` from the client — cannot compute for other users
- Uses a fixed offset for all historical data — DST transitions cause ±1 hour error on ~2% of records
- These achievements are excluded from social features ("earned by" list)

### Device/Model/Source Diversity

Query distinct counts from `usage_records`:

```sql
SELECT COUNT(DISTINCT device_id) as devices,
       COUNT(DISTINCT model) as models,
       COUNT(DISTINCT source) as sources
FROM usage_records
WHERE user_id = ?
```

## Data Model Decisions

This section resolves the blocking questions identified during review. These decisions are **final** and should not be revisited without explicit approval.

### Decision 1: earnedAt Source — On-Demand Computation (No Persistence)

**Choice**: Compute all achievement state on-the-fly from existing `usage_records` and `session_records` tables. No `achievement_unlocks` table.

**Rationale**:
- Adding a persistence layer requires: (a) migration, (b) backfill job, (c) sync logic to keep snapshots current, (d) handling edge cases when users re-sync and totals decrease
- The "earned at" timestamp shown on `/api/achievements/[id]/members` will be **approximate** — derived from the earliest `hour_start` (for usage-based) or `started_at` (for session-based) that would have crossed the tier threshold
- This approximation is acceptable because:
  - Historical accuracy is not a product requirement (we're not a blockchain)
  - The social feature ("earned by") is about **who**, not **when**
  - Users won't notice if their "unlocked" date is off by a few hours

**Implementation**:
- For social queries, run a server-side aggregation per achievement that computes each user's current value, then derive the approximate unlock time by binary-searching historical data
- Cache "earned by" lists for 5-10 minutes (low churn)
- The dashboard "Top Achievement" widget shows the **highest-tier achievement** (not most recently unlocked), since we can't reliably track unlock order without persistence

### Decision 2: Computation Boundary — Server-Side for All New Achievements

**Choice**: Migrate achievement computation to a server-side API (`GET /api/achievements`). The existing client-side `achievement-helpers.ts` becomes a shared utility library, but the actual computation runs on the server.

**Rationale**:
- New achievements require data not currently available in `AchievementInputs`:
  - `device_id` — only in `usage_records`, not exposed via `/api/usage`
  - `session_records` fields — `kind`, `duration_seconds`, `started_at`
- Expanding `/api/usage` to return all this data would bloat the response and duplicate `/api/sessions`
- Server-side computation allows:
  - Single SQL query to compute all achievements (efficient)
  - Direct access to both `usage_records` and `session_records`
  - Social data queries ("earned by") in the same request

**Migration Path**:
1. Phase 1: Move computation server-side, keep existing 6 achievements
2. Phase 2: Add new achievements that require session/device data
3. Phase 3: Remove client-side computation from dashboard (it becomes a simple fetch)

### Decision 3: Summary Count — Unlocked Definition IDs, Not Tiers

**Choice**: "18 / 25 Unlocked" counts **achievement definitions with at least one tier unlocked**, not total tier unlocks.

**Rationale**:
- Users intuitively think "I have 18 achievements" not "I have 18 tier unlocks across 25 achievements"
- WoW counts achievement definitions, not individual tiers
- The current taxonomy has 25 achievement definitions (see count below), each with 4 tiers = 100 possible tier unlocks, but showing "18 / 100" is confusing

**Taxonomy Count** (25 total):
- Volume: 5 (power-user, big-day, input-hog, output-addict, reasoning-junkie)
- Consistency: 5 (streak, veteran, weekend-warrior, night-owl, early-bird)
- Efficiency: 3 (cache-master, quick-draw, marathon)
- Spending: 2 (big-spender, daily-burn)
- Diversity: 3 (tool-hoarder, model-tourist, device-nomad)
- Sessions: 3 (chatterbox, session-hoarder, automation-addict)
- Special: 4 (first-blood, centurion, millionaire, billionaire)

**Implementation**:
- `totalAchievements` = count of all `AchievementDef` entries (currently 25)
- `totalUnlocked` = count of definitions where `tier !== "locked"`
- `diamondCount` = count of definitions where `tier === "diamond"`

### Decision 4: Input Data Requirements by Achievement Category

| Category | Data Source | Fields Needed | Available Today |
|----------|-------------|---------------|-----------------|
| Volume | `usage_records` | `total_tokens`, `input_tokens`, `output_tokens`, `reasoning_output_tokens` | ✅ |
| Consistency (streak, veteran) | `usage_records` | `hour_start` (distinct days) | ✅ |
| Consistency (weekend-warrior, night-owl, early-bird) | `usage_records` | `hour_start` + **user timezone** | ⚠️ See Decision 5 |
| Efficiency (cache-master) | `usage_records` | `cached_input_tokens`, `input_tokens` | ✅ |
| Efficiency (quick-draw, marathon) | `session_records` | `duration_seconds` | ✅ |
| Spending | `usage_records` + pricing | `total_tokens` by model | ✅ |
| Diversity (tool-hoarder) | `usage_records` | `COUNT(DISTINCT source)` | ✅ |
| Diversity (model-tourist) | `usage_records` | `COUNT(DISTINCT model)` | ✅ |
| Diversity (device-nomad) | `usage_records` | `COUNT(DISTINCT device_id)` | ✅ |
| Sessions (chatterbox) | `session_records` | `total_messages` | ✅ |
| Sessions (session-hoarder) | `session_records` | `COUNT(*)` | ✅ |
| Sessions (automation-addict) | `session_records` | `kind = 'automated'` | ✅ |
| Special (first-blood) | `usage_records` | `MIN(hour_start)` | ✅ |

**Conclusion**: All planned achievements can be computed from existing tables. No schema changes required. However, `night-owl` and `early-bird` have social feature limitations (see Decision 5).

### Decision 5: Timezone-Dependent Achievements — No Social Features, Approximate Values

**Problem**: `weekend-warrior`, `night-owl`, and `early-bird` require converting UTC `hour_start` to the user's local time. The current `users` table has no `timezone` field.

**Affected achievements**:
- `weekend-warrior` — needs local Saturday/Sunday, not UTC Saturday/Sunday
- `night-owl` — needs local midnight-6am
- `early-bird` — needs local 6am-9am

**Options considered**:
1. Add `timezone` column to `users`, require users to set it, define rules for historical data backfill
2. Exclude these achievements from social features ("earned by" list, `/api/achievements/[id]/members`)

**Choice**: Option 2 — exclude from social features.

**Rationale**:
- Adding timezone persistence requires migration, UI for setting timezone, and complex historical backfill rules (user may have changed timezones)
- These achievements are inherently personal ("when do I work?") — social value is low
- "Earned by" for night-owl would be misleading anyway: a user in UTC+8 and one in UTC-8 could both qualify with the same raw data

**Implementation**:
- `GET /api/achievements` computes these three using the request's `tzOffset` query param (passed from client)
- These achievements return `earnedBy: []` and `totalEarned: 0` in the response
- `GET /api/achievements/[id]/members` returns 404 for these achievement IDs
- UI shows "Personal achievement — no leaderboard" instead of the avatar row

**DST Approximation Warning**:

Even for the current user's own achievements, the computation is **approximate**, not exact:

```typescript
// This applies a FIXED offset to all historical data
const localHour = (utcHour - tzOffset / 60 + 24) % 24;
```

The `tzOffset` from the client reflects the user's **current** timezone offset, but:
- DST transitions shift the offset by 1 hour twice a year
- Historical records from 6 months ago may have had a different offset

**Accepted trade-off**: For a gamification feature, ±1 hour accuracy on ~2% of records (DST transition weeks) is acceptable. The alternative — storing per-record local time or requiring full timezone database lookups — adds significant complexity for minimal user value.

---

## Open Questions (Resolved)

~~1. **Persistence**: Should we store earned achievements in a separate table, or always compute on-the-fly?~~
   - **Resolved**: On-demand computation. See Decision 1.

~~2. **Notifications**: How do we detect newly earned achievements?~~
   - **Deferred to Phase 5**: Compare before/after on dashboard load. No background jobs.

3. **Rarity Display**: Show what percentage of users earned each achievement?
   - **Deferred**: Nice-to-have. Can add `totalUsers` to response and compute client-side.

## References

- WoW Armory Achievement UI: https://worldofwarcraft.com/character/us/illidan/charactername/achievements
- Current achievement implementation: `packages/web/src/lib/achievement-helpers.ts`
- Profile dialog (for social click-through): `packages/web/src/components/user-profile-dialog.tsx`
