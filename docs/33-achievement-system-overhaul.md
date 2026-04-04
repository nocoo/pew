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
2. **Dashboard Integration** — show most recently earned achievement on dashboard Hero, clickable to achievements page
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
| `weekend-warrior` | **No Rest for the Wicked** | "Saturday? More like Codeturday." | 4 / 12 / 26 / 52 weekend days |
| `night-owl` | **Sleep is Overrated** | "2AM prompt submitted. 2:01AM regret." | 10 / 30 / 100 / 300 midnight-6am hours |
| `early-bird` | **Dawn Debugger** | "The AI was your first conversation today." | 10 / 30 / 100 / 300 6am-9am hours |

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
│  │  🏆 42 / 78 Unlocked   ⭐ 12 Diamond   🔥 7-day streak │ │
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

Replace current `AchievementPanel` with a single "Latest Achievement" card:

```
┌─ Latest Achievement ───────────────────┐
│                                        │
│  🏆 On Fire — SILVER                   │
│  7-day streak unlocked!                │
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

### Phase 1: Achievement Definitions & Computation

1. Expand `achievement-helpers.ts` with all new achievement definitions
2. Add `category` field to `AchievementDef`
3. Add `flavorText` field for WoW-style descriptions
4. Implement new value extractors for:
   - Time-of-day achievements (night-owl, early-bird)
   - Session-based achievements (marathon, quick-draw, chatterbox)
   - Diversity achievements (tool-hoarder, model-tourist, device-nomad)
5. Add unit tests for all new computations

### Phase 2: API Endpoints

1. Create `GET /api/achievements` route
   - Compute all achievements for authenticated user
   - Query "earned by" preview (top 5 users per achievement)
2. Create `GET /api/achievements/[id]/members` route
   - Paginated user list with tier and earned date
3. Add achievement-related columns to users table (optional: cache computed tiers)

### Phase 3: Achievements Page

1. Add "Achievements" tab to `LeaderboardNav`
2. Create `/leaderboard/achievements/page.tsx`
3. Build `AchievementGrid` component with category sections
4. Build expanded `AchievementCard` with social avatars
5. Wire up `UserProfileDialog` for avatar clicks

### Phase 4: Dashboard Integration

1. Create `LatestAchievement` component
2. Replace `AchievementPanel` in Hero sidebar
3. Add "View All" link to achievements page

### Phase 5: Polish

1. Add animations for tier upgrades
2. Add toast notifications for new achievements
3. Consider push notifications for milestone achievements

## Technical Notes

### Achievement Computation Strategy

- **Client-side for user's own achievements**: Current approach works well, reuses existing usage data hooks
- **Server-side for social data**: "Earned by" requires querying other users' data — must be API

### Caching Considerations

- Achievement definitions are static — can be bundled client-side
- User progress changes on each sync — no caching
- "Earned by" lists change slowly — cache for 5-10 minutes

### Time-of-Day Achievements

The `hour_start` field is stored in UTC. To compute "night owl" (midnight-6am local):

```typescript
// Convert UTC hour to user's local hour
const utcHour = new Date(row.hour_start).getUTCHours();
const localHour = (utcHour - tzOffset / 60 + 24) % 24;
const isNightOwl = localHour >= 0 && localHour < 6;
```

### Device/Model/Source Diversity

Query distinct counts from `usage_records`:

```sql
SELECT COUNT(DISTINCT device_id) as devices,
       COUNT(DISTINCT model) as models,
       COUNT(DISTINCT source) as sources
FROM usage_records
WHERE user_id = ?
```

## Open Questions

1. **Persistence**: Should we store earned achievements in a separate table, or always compute on-the-fly?
   - Pro persistence: faster queries for social features, "earned at" timestamp
   - Pro computation: simpler schema, always up-to-date

2. **Notifications**: How do we detect newly earned achievements?
   - Option A: Compare before/after on each sync
   - Option B: Background job that checks periodically

3. **Rarity Display**: Show what percentage of users earned each achievement?
   - Requires periodic computation across all users

## References

- WoW Armory Achievement UI: https://worldofwarcraft.com/character/us/illidan/charactername/achievements
- Current achievement implementation: `packages/web/src/lib/achievement-helpers.ts`
- Profile dialog (for social click-through): `packages/web/src/components/user-profile-dialog.tsx`
