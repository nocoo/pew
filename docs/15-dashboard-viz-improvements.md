# Dashboard Visualization Improvements

> Roadmap for enriching the pew dashboard with advanced visualizations and insights.

## Product Positioning

pew tracks token usage from local AI coding tools (Claude Code, Codex, Gemini CLI, OpenCode, OpenClaw, VS Code Copilot). The dashboard should:

1. **Quantify value** — Show users how much they're using and what it costs
2. **Reveal patterns** — Surface productivity insights and usage trends
3. **Drive engagement** — Leaderboards, achievements, and personal milestones

---

## Improvement Categories

### 1. Cost Insights

| Feature | Description | Priority |
|---------|-------------|----------|
| Cost trend chart | Daily/weekly cost change curve | High |
| Cache savings ($\$$) | Actual money saved, not just percentage | High |
| Cost forecast | Linear extrapolation based on historical data (end-of-month projection) | Medium |
| Cost-per-token comparison | Bar chart comparing different models/tools | Medium |

### 2. Efficiency Metrics

| Feature | Description |
|---------|-------------|
| Tokens/hour | Coding efficiency metric |
| Cache hit rate trend | Line chart showing cache performance over time |
| Input/Output ratio | Pie chart reflecting conversation patterns |
| Reasoning ratio | "Thinking depth" metric for reasoning models |

### 3. Time Analysis Enhancements

| Feature | Description |
|---------|-------------|
| Peak hour detection | Highlight top 3 most active time slots |
| Weekend vs weekday comparison | Dual bar chart |
| Month-over-month comparison | MoM growth rate |
| Streak badges | Consecutive usage days (like GitHub contributions) |

### 4. Model/Tool Comparison

| Feature | Description |
|---------|-------------|
| Overlay trend chart | Compare multiple tools on same timeline |
| Tool switch timeline | When user switched from Claude to Gemini etc. |
| Model evolution chart | New vs legacy model share over time |

### 5. Personal Insight Cards

Spotify Wrapped-style "fun facts":

- "Your most-used model is **claude-sonnet-4**, accounting for **67%** of total usage"
- "Your cache hit rate is higher than **82%** of users"
- "Your most active time this week was **Wednesday 9-11 PM**"

### 6. Goal Tracking

| Feature | Description |
|---------|-------------|
| Monthly budget setting | User-defined token/cost limits |
| Progress bar | Used this month / budget |
| Overage warning | Alert when projected to exceed budget |

### 7. Leaderboard Enhancements

| Feature | Description |
|---------|-------------|
| Tier system | Bronze/Silver/Gold/Platinum ranking |
| Rank change indicators | Up/down arrows with position change |
| "Nearby users" | List of users with similar rankings |

### 8. Advanced Chart Types

| Chart | Use Case |
|-------|----------|
| Sankey diagram | Token flow: Tool → Model → Input/Output |
| Radar chart | Multi-dimensional assessment (cost, efficiency, frequency, cache rate) |
| Small multiples | Faceted trend charts by tool |

---

## MVP Extension Priority

Recommended implementation order for maximum impact:

1. **Cost trend chart** — Users care most about money
2. **Cache savings ($\$$)** — Emphasizes product value
3. **Personal insight cards** — Increases engagement and fun factor
4. **Weekend vs weekday comparison** — Easy to implement, valuable insight

---

## Technical Considerations

### Data Requirements

- Cost data requires accurate pricing tables per model
- Time-based aggregations need efficient queries (pre-compute daily/weekly buckets)
- Leaderboard tiers need periodic recalculation

### Frontend Libraries

- Current: Recharts (area, bar, pie, donut)
- Potential additions:
  - `d3-sankey` for Sankey diagrams
  - `react-radar-chart` for radar charts

### Performance

- Heavy aggregations should be computed server-side
- Consider caching computed insights (refresh daily)
- Large datasets need pagination or windowing

---

## Future Considerations

- **Team dashboards** — Aggregate usage across organization
- **API for power users** — Export data for custom analysis
- **Mobile-friendly charts** — Responsive design for smaller screens
- **Dark mode chart colors** — Already implemented via Basalt theme

---

## Detailed Design (Categories 1–6)

> Architecture baseline: All cost estimation is **client-side** (no cost columns in DB).
> Data flows: `usage_records` → `GET /api/usage` → `useUsageData` hook → pure helper functions → Recharts components.
> Existing UI conventions: `"use client"` pages, `PeriodSelector` for time range, `StatCard`/`StatGrid` for metrics, `bg-secondary rounded-[var(--radius-card)]` card wrapper, colors via `palette.ts`.

#### Timezone Strategy

All timestamps in the database and API are **UTC ISO 8601** (e.g., `2026-03-10T21:00:00.000Z`). The existing codebase consistently uses UTC for storage, queries (`route.ts` uses `.toISOString()`), and the working-hours heatmap (`session-helpers.ts` uses `getUTCDay()`/`getUTCHours()`).

**Rule: store/query UTC, render local.** All new time-based features must:

1. **Helpers** accept raw UTC strings and a `timezoneOffset` parameter (minutes, from `new Date().getTimezoneOffset()`), or use the browser's `Intl.DateTimeFormat` for display formatting.
2. **Day bucketing** for user-facing labels (peak hours, weekday/weekend, streaks) must convert UTC → local before extracting day-of-week or hour-of-day. Use `new Date(utcString)` which auto-converts to local in the browser, then call `getDay()`/`getHours()` (NOT `getUTCDay()`/`getUTCHours()`).
3. **Pure helper functions** under test must accept an optional `tzOffset` parameter (default `0` for UTC in tests, real offset injected from the UI layer) so tests remain deterministic.

**Critical: `DailyPoint` is a UTC-day bucket and cannot be used for local-time features.** The API's `granularity=day` groups rows via `date(hour_start)` (SQLite, UTC), and `toDailyPoints()` slices `hour_start` to `YYYY-MM-DD` in UTC. Once records are collapsed into UTC dates, the user's true local weekday near midnight boundaries is lost.

**Equally critical: day-granularity `UsageRow[]` also loses time information.** When `granularity=day`, the SQL query uses `date(hour_start) AS hour_start` (`route.ts:114`), so the `hour_start` field in each `UsageRow` is a bare date string (`"2026-03-10"`), NOT a full ISO timestamp. `toLocalDailyBuckets()` cannot shift records across midnight boundaries without a time component. **Any feature requiring local-day accuracy must fetch with half-hour (default) granularity** to get full timestamps like `"2026-03-10T14:30:00.000Z"`.

Therefore:

- **Peak hours (3a)**: Must use raw `UsageRow[]` from half-hour granularity — already correct.
- **Weekday/weekend (3b)**: Must fetch with **half-hour granularity** and accept raw `UsageRow[]` — NOT day-granularity rows or `DailyPoint[]`.
- **Streaks (3d)**: Must fetch with **half-hour granularity** (separate from the heatmap's day-granularity fetch) and accept raw `UsageRow[]` — NOT day-granularity rows or `DailyPoint[]`.
- **Cost trend (1a)**, **MoM (3c)**: These aggregate by calendar date where ±1 day error is acceptable for a trend chart, so `DailyPoint[]` / UTC day bucketing is fine.

A new shared helper `toLocalDailyBuckets(rows: UsageRow[], tzOffset?: number): Map<string, number>` should be introduced to handle UTC → local day bucketing for features that need it. This helper **requires rows with full ISO timestamps** (half-hour granularity) — it will not produce correct results with bare date strings from day-granularity queries. This avoids duplicating the conversion logic across weekday/weekend, streaks, and future features.

**Pre-existing bug**: `toWorkingHoursGrid()` in `session-helpers.ts` uses `getUTCDay()`/`getUTCHours()` instead of local time. This is fixed as Category 3 commit #2 (`fix: use local time in toWorkingHoursGrid`).

This ensures "Wednesday 9–10 PM" means the user's local Wednesday 9–10 PM, not UTC.

### Category 1: Cost Insights — Detailed Design

#### 1a. Cost Trend Chart

**What**: A line/area chart showing estimated daily cost ($) over the selected period, replacing or complementing the existing token-based `UsageTrendChart`.

**Data pipeline**:
- Reuse existing `GET /api/usage?granularity=day` — no API changes needed
- The response already returns daily rows with per-model token breakdowns
- Client-side: extend `toDailyPoints()` in `use-usage-data.ts` to produce `DailyCostPoint[]`

**New types** (`packages/web/src/lib/cost-helpers.ts`):
```ts
interface DailyCostPoint {
  date: string;           // "2026-03-10"
  inputCost: number;      // USD
  outputCost: number;     // USD
  cachedCost: number;     // USD
  totalCost: number;      // USD
}

function toDailyCostPoints(
  rows: UsageRow[],
  pricingMap: PricingMap,
): DailyCostPoint[];
```

**Algorithm**: Group rows by `hour_start.slice(0, 10)`, for each day sum per-model costs using `estimateCost()` + `lookupPricing()`. Already have all building blocks — this is pure aggregation composition.

**UI component** (`packages/web/src/components/dashboard/cost-trend-chart.tsx`):
- Stacked `AreaChart` with 3 areas: inputCost (teal), outputCost (sky), cachedCost (muted)
- Same visual treatment as `UsageTrendChart` (gradient fills, custom tooltip)
- Y-axis: `$` prefix, formatted with `$X.XX` for small values, `$X.XK` for thousands
- Toggle between token view and cost view on dashboard page

**Placement**: Dashboard page, same slot as `UsageTrendChart` with a tab toggle ("Tokens" | "Cost").

#### 1b. Cache Savings ($)

**What**: A `StatCard` showing actual dollars saved by cache hits, not just percentage.

**Data pipeline**: No API changes. Compute client-side from existing data.

**New function** (`packages/web/src/lib/cost-helpers.ts`):
```ts
interface CacheSavings {
  savedDollars: number;        // what user would have paid at full input price
  actualCachedCost: number;    // what user paid at cached price
  netSavings: number;          // savedDollars - actualCachedCost
  savingsPercent: number;      // netSavings / savedDollars * 100
}

function computeCacheSavings(
  models: ModelAggregate[],
  pricingMap: PricingMap,
): CacheSavings;
```

**Algorithm**: For each model, compute `(cachedTokens / 1M) * inputPrice` (hypothetical full cost) minus `(cachedTokens / 1M) * cachedPrice` (actual cost). The difference is net savings.

**UI**: New `StatCard` in the existing primary StatGrid row (expand from 3 to 4 columns). Icon: `PiggyBank`. Subtitle: "vs full input price". Trend: compare to previous period if available.

#### 1c. Cost Forecast

**What**: A projected end-of-month cost based on linear extrapolation of the current month's daily spending.

**New function** (`packages/web/src/lib/cost-helpers.ts`):
```ts
interface CostForecast {
  currentMonthCost: number;     // spent so far
  projectedMonthCost: number;   // linear extrapolation
  daysElapsed: number;
  daysInMonth: number;
  dailyAverage: number;
}

function forecastMonthlyCost(
  dailyCosts: DailyCostPoint[],
  now?: Date,
): CostForecast;
```

**Algorithm**: Filter `dailyCosts` to current month, compute `dailyAverage = currentMonthCost / daysElapsed`, project `projectedMonthCost = dailyAverage * daysInMonth`. Edge case: if `daysElapsed < 3`, show "Not enough data" instead of a wildly extrapolated number.

**UI**: `StatCard` with icon `TrendingUp`. Value shows `$X.XX projected`. Subtitle: `$Y.YY spent so far (N days)`. Only visible when period is "month" or "all".

#### 1d. Cost-per-Token Comparison

**What**: Horizontal bar chart comparing effective cost-per-1K-tokens across models/tools.

**New function** (`packages/web/src/lib/cost-helpers.ts`):
```ts
interface ModelCostEfficiency {
  model: string;
  source: string;
  totalCost: number;
  totalTokens: number;
  costPer1K: number;   // totalCost / totalTokens * 1000
}

function computeCostPerToken(
  models: ModelAggregate[],
  pricingMap: PricingMap,
): ModelCostEfficiency[];
```

**UI component** (`packages/web/src/components/dashboard/cost-per-token-chart.tsx`):
- Horizontal `BarChart` (layout="vertical"), same pattern as `ModelBreakdownChart`
- Bar color intensity proportional to `costPer1K` (gradient from green=cheap to red=expensive)
- Top 10 models by total tokens, sorted by `costPer1K` descending
- Placement: New dedicated section on the Models page, below existing model breakdown

---

### Category 2: Efficiency Metrics — Detailed Design

#### 2a. Tokens/Hour

**What**: A metric showing average tokens consumed per coding hour, derived by cross-referencing `usage_records` (tokens) with `session_records` (duration).

**Data pipeline**: Requires data from **both** `/api/usage` and `/api/sessions`. Currently the sessions page (`sessions/page.tsx`) only calls `useSessionData()` (which fetches `/api/sessions`). To compute tokens/hour, the sessions page must **additionally** call `useUsageData()` for token totals. This is new wiring work.

**New function** (`packages/web/src/lib/session-helpers.ts`):
```ts
interface EfficiencyMetrics {
  tokensPerHour: number;         // totalTokens / totalHours
  totalCodingHours: number;      // from SessionOverview.totalHours
  totalTokens: number;
}

function computeTokensPerHour(
  totalTokens: number,           // from UsageSummary.total_tokens (snake_case)
  sessionOverview: SessionOverview,  // actual type, has totalHours (not totalDurationSeconds)
): EfficiencyMetrics;
```

**Algorithm**: `tokensPerHour = totalTokens / sessionOverview.totalHours`. Guard against division by zero (totalHours === 0 → return 0).

**UI**: `StatCard` on Sessions page. Icon: `Zap`. Value: `12.3K tok/hr`. This naturally pairs with the existing session overview stats.

**API concern**: Currently the dashboard page and sessions page fetch data independently. To show this on the dashboard, either (a) co-fetch session summary on dashboard, or (b) keep it sessions-page-only. Recommend (b) to avoid extra API calls on the main dashboard.

#### 2b. Cache Hit Rate Trend

**What**: A line chart showing daily cache hit rate (%) over time.

**Data pipeline**: No API changes. Derived from existing daily usage data.

**New function** (`packages/web/src/lib/cost-helpers.ts`):
```ts
interface DailyCacheRate {
  date: string;
  cacheRate: number;         // cached_input_tokens / input_tokens * 100
  cachedTokens: number;
  inputTokens: number;
}

function toDailyCacheRates(rows: UsageRow[]): DailyCacheRate[];
```

**Algorithm**: Group by date, sum `cached_input_tokens` and `input_tokens` per day, compute ratio. Days with zero input tokens get `cacheRate = 0`.

**UI component** (`packages/web/src/components/dashboard/cache-rate-chart.tsx`):
- Single `LineChart` (not area) with a horizontal reference line at the period average
- Y-axis: 0–100%, `%` suffix
- Color: `chart.emerald` or a dedicated cache color
- Tooltip: "Mar 10: 73.2% (1.2M cached / 1.6M input)"
- Placement: Dashboard page, below the main chart row, in a half-width card alongside the cost forecast

#### 2c. Input/Output Ratio

**What**: A simple pie/donut chart showing the split between input and output tokens.

**Data pipeline**: Already available from `usageSummary` in the `/api/usage` response (server-side aggregation returns `input_tokens`, `output_tokens` — snake_case, matching the `UsageSummary` interface).

**New function**: None needed — data is already in `UsageSummary`. Just format for the chart.

**UI component** (`packages/web/src/components/dashboard/io-ratio-chart.tsx`):
- `PieChart` with 2 slices: Input (teal), Output (sky). Same style as `SourceDonutChart`.
- Inner label showing ratio like "3.2:1" (input-heavy is normal for AI tools)
- Placement: Dashboard page, small card alongside source donut or in an "Efficiency" section

#### 2d. Reasoning Ratio

**What**: Percentage of output tokens that are "thinking" tokens (reasoning_output_tokens), indicating model depth.

**Data pipeline**: `reasoning_output_tokens` is already in `usage_records` and returned by `/api/usage`. Currently not surfaced in the UI.

**New function** (`packages/web/src/lib/cost-helpers.ts`):
```ts
function computeReasoningRatio(summary: UsageSummary): {
  reasoningTokens: number;
  outputTokens: number;
  reasoningPercent: number;    // reasoning / output * 100
};
```

**UI**: `StatCard` on dashboard. Icon: `Brain`. Value: "42.3%". Subtitle: "of output tokens are reasoning". Only meaningful when reasoning models (o3, claude-opus, etc.) are used — show "N/A" if `reasoningTokens === 0`.

---

### Category 3: Time Analysis Enhancements — Detailed Design

#### 3a. Peak Hour Detection

**What**: Identify and highlight the top 3 most active half-hour slots across the selected period.

**Data pipeline**: Requires half-hour granularity data. Use `GET /api/usage?granularity=half-hour`.

> **Prerequisite**: The current `useUsageData` hook hardcodes `granularity: "day"` (line ~208 in `use-usage-data.ts`). To support peak hour detection, either (a) add a `granularity` parameter to `useUsageData` so callers can request `"half-hour"` data, or (b) create a dedicated `usePeakHourData` hook that fetches with half-hour granularity. Option (a) is preferred — it's a single-line change to make the existing hook more flexible. This hook change must be a separate commit **before** the `detectPeakHours` helper commit (see Atomic Commit Plan, Category 3 commit 0).

**New function** (`packages/web/src/lib/date-helpers.ts`):
```ts
interface PeakSlot {
  hourStart: string;        // ISO 8601 half-hour boundary
  dayOfWeek: string;        // "Monday", "Tuesday", ... (local time)
  timeSlot: string;         // "9:00 PM – 9:30 PM" (local time)
  totalTokens: number;
}

function detectPeakHours(
  rows: UsageRow[],
  topN?: number,            // default 3
  tzOffset?: number,        // minutes, from new Date().getTimezoneOffset()
): PeakSlot[];
```

**Algorithm**: For each row, convert `hour_start` to local time via `new Date(hour_start)` then extract day-of-week with `getDay()` and hour with `getHours()` (local, NOT `getUTCDay()`/`getUTCHours()`). Group by `(localDayOfWeek, localHalfHourSlot)`. Sum `total_tokens` per group. Return top N sorted by total descending. For deterministic tests, accept `tzOffset` and apply manual offset: `new Date(new Date(utc).getTime() - tzOffset * 60000)`.

**UI**: A small "Peak Hours" card with a ranked list. Icon: `Flame`. Each slot shows day + time + a mini bar representing relative activity. Placement: Sessions page, near the working hours heatmap (contextually related).

#### 3b. Weekend vs Weekday Comparison

**What**: Side-by-side bar chart comparing average daily token usage on weekdays vs weekends.

**Data pipeline**: Requires raw `UsageRow[]` with **full UTC timestamps** (NOT pre-bucketed `DailyPoint[]`) to correctly determine the user's local weekday near midnight boundaries. Must fetch with **default (half-hour) granularity** — NOT `granularity=day`, which collapses `hour_start` to a bare UTC date string (`"2026-03-10"`) via `date(hour_start)` in the API query (`route.ts:114`). Without a time component, `toLocalDailyBuckets()` cannot shift records across midnight boundaries. Use the `granularity` param added in commit #0 to request half-hour data: `useUsageData({ days: 30, granularity: "half-hour" })`.

**New function** (`packages/web/src/lib/usage-helpers.ts`):
```ts
interface WeekdayWeekendStats {
  weekday: { avgTokens: number; avgCost: number; totalDays: number };
  weekend: { avgTokens: number; avgCost: number; totalDays: number };
  ratio: number;    // weekday.avgTokens / weekend.avgTokens
}

function compareWeekdayWeekend(
  rows: UsageRow[],
  dateRange: { from: string; to: string },  // period boundaries for calendar fill
  pricingMap: PricingMap,
  tzOffset?: number,                         // minutes, default 0
): WeekdayWeekendStats;
```

**Algorithm**: First, re-bucket rows into local-day totals using `toLocalDailyBuckets(rows, tzOffset)`. Then generate a complete calendar of local dates between `dateRange.from` and `dateRange.to` (inclusive). Left-join with the local-day buckets — dates with no usage records get `totalTokens = 0`. This prevents sparse-user bias where "average daily usage" would otherwise mean "average active-day usage." Then partition the filled calendar by local day-of-week — 0/6 = weekend, 1-5 = weekday. Compute averages dividing by **calendar days** (not active days).

**Why calendar fill matters**: Without it, a user who codes only on weekdays would show "0 weekend days" instead of the correct weekend count. The `/api/usage` endpoint only returns rows for days with actual usage (`GROUP BY` omits zero-usage days), so the client must fill the gaps.

**UI component** (`packages/web/src/components/dashboard/weekday-weekend-chart.tsx`):
- Grouped `BarChart` with 2 groups (Weekday, Weekend), 2 bars each (Tokens, Cost)
- Or simpler: two large stat cards side by side with comparative arrows
- Placement: Dashboard page, in an "Insights" row below the main charts

#### 3c. Month-over-Month Comparison

**What**: Show MoM growth rate for key metrics (tokens, cost, sessions).

**Data pipeline**: Requires fetching 2 months of data. The existing `/api/usage` endpoint supports arbitrary `from`/`to` ranges, so fetch current month + previous month in a single wider request.

**New function** (`packages/web/src/lib/usage-helpers.ts`):
```ts
interface MoMComparison {
  currentMonth: { tokens: number; cost: number; days: number };
  previousMonth: { tokens: number; cost: number; days: number };
  tokenGrowth: number;     // percentage change
  costGrowth: number;      // percentage change
}

function computeMoMGrowth(
  rows: UsageRow[],
  pricingMap: PricingMap,
  now?: Date,
): MoMComparison;
```

**Algorithm**: Split rows into current vs previous month by `hour_start`. Compute totals per month. Growth = `(current - previous) / previous * 100`. Handle first-month edge case (no previous data → show "N/A").

**UI**: Leverage existing `StatCard` `trend` prop. The primary "Est. Cost" and "Total Tokens" stat cards already support `trend: { value: number, label: string }`. Populate with MoM growth data. Green for decrease (cost savings), red for increase. This requires the dashboard to fetch a wider date range when `period === "month"`.

#### 3d. Streak Badges

**What**: Count consecutive days with at least one usage record, similar to GitHub contribution streaks.

**Data pipeline**: Must use raw `UsageRow[]` with **full UTC timestamps** (NOT the yearly heatmap's `DailyPoint[]` or day-granularity rows). The yearly heatmap fetches with `granularity=day`, which collapses `hour_start` to a bare UTC date string (`"2026-03-10"`) — `toLocalDailyBuckets()` cannot recover local calendar days from these. Instead, fetch 365 days with **half-hour granularity**: `useUsageData({ days: 365, granularity: "half-hour" })`. This is a separate fetch from the heatmap's existing one.

> **Performance note**: 365 days of half-hour data is significantly more rows than 365 days of day-granularity data. If the payload is too large, consider (a) a dedicated `/api/usage/active-days` endpoint that returns distinct local dates server-side, or (b) streaming/pagination. Start with the naive approach (half-hour fetch) and optimize if needed — the streak helper itself is O(n) and cheap.

**New function** (`packages/web/src/lib/usage-helpers.ts`):
```ts
interface StreakInfo {
  currentStreak: number;       // consecutive days ending today (or yesterday)
  longestStreak: number;       // longest within available data (up to 365 days)
  longestStreakStart: string;  // start date of longest streak
  longestStreakEnd: string;    // end date of longest streak
  isActiveToday: boolean;      // has usage today
}

function computeStreak(
  rows: UsageRow[],
  today?: string,              // "2026-03-10" (local date)
  tzOffset?: number,           // minutes, default 0
): StreakInfo;
```

**Algorithm**: Re-bucket rows into local-day presence using `toLocalDailyBuckets(rows, tzOffset)` to get a set of active local dates. Sort dates ascending. Walk backwards from `today` counting consecutive non-zero days for current streak. Walk forward from start tracking max consecutive run for longest streak.

**UI**: A badge/pill displayed near the heatmap calendar. Shows `currentStreak` with a flame icon when active. "5-day streak" or "Longest: 23 days (Feb 3 – Feb 25)". Placement: Below or beside the `HeatmapCalendar` on the dashboard page.

---

### Category 4: Model/Tool Comparison — Detailed Design

#### 4a. Overlay Trend Chart

**What**: Multi-line chart showing daily token usage per source (tool) on the same timeline, enabling visual comparison.

**Data pipeline**: No API changes. The existing daily rows already include `source` per row.

**New function** (`packages/web/src/lib/usage-helpers.ts`):
```ts
interface SourceTrendPoint {
  date: string;
  sources: Record<string, number>;  // { "claude-code": 50000, "gemini-cli": 30000 }
}

function toSourceTrendPoints(rows: UsageRow[]): SourceTrendPoint[];
```

**Algorithm**: Group by `(date, source)`, pivot into a record per date with source keys.

**UI component** (`packages/web/src/components/dashboard/source-trend-chart.tsx`):
- `LineChart` with one `Line` per source, each colored by `CHART_COLORS[i]`
- Interactive legend: click to toggle source visibility
- Tooltip shows all sources for the hovered date
- Placement: New "Tools" tab or section on the dashboard page, replacing/augmenting the source donut

#### 4b. Tool Switch Timeline

**What**: A timeline visualization showing which tool was dominant on each day, revealing migration patterns (e.g., user moved from Claude Code to OpenCode).

**Data pipeline**: No API changes. Derived from the same daily rows.

**New function** (`packages/web/src/lib/usage-helpers.ts`):
```ts
interface DailyDominantSource {
  date: string;
  dominantSource: string;      // source with highest total_tokens that day
  dominantShare: number;       // percentage of daily total
  sources: Record<string, number>;
}

function toDominantSourceTimeline(rows: UsageRow[]): DailyDominantSource[];
```

**Algorithm**: Group by date, per date find the source with max tokens, compute its share.

**UI component** (`packages/web/src/components/dashboard/tool-timeline.tsx`):
- Horizontal bar chart where each bar spans one day, colored by dominant source
- Or a stacked 100% area chart (each source's share of daily total, always summing to 100%)
- The 100% stacked area is more informative — it shows gradual transitions
- Placement: Models page or a dedicated "Tools" page

#### 4c. Model Evolution Chart

**What**: Stacked area chart showing new vs legacy model share over time (e.g., sonnet-4 replacing sonnet-3.5).

**Data pipeline**: No API changes. Need model grouping logic.

**New function** (`packages/web/src/lib/model-helpers.ts`):
```ts
interface ModelEra {
  date: string;
  models: Record<string, number>;  // { "claude-sonnet-4": 40000, "claude-sonnet-3.5": 10000 }
}

function toModelEvolutionPoints(
  rows: UsageRow[],
  topN?: number,    // default 5, group rest as "other"
): ModelEra[];
```

**Algorithm**: Identify top N models by total tokens across the period. Group remaining as "Other". Produce daily data points for each model.

**UI component** (`packages/web/src/components/dashboard/model-evolution-chart.tsx`):
- 100% stacked `AreaChart` — each model is a band, total always 100%
- Colors assigned by model via `CHART_COLORS`
- Model names shortened via existing `shortModel()` helper
- Placement: Models page, as a new "Evolution" chart above the existing bar chart

---

### Category 5: Personal Insight Cards — Detailed Design

#### Architecture

**What**: A set of "fun fact" cards computed from the user's data, Spotify Wrapped-style. Each insight is a standalone computation that produces a sentence.

**Data pipeline**: All computed client-side from existing API responses. No new endpoints needed.

**New module** (`packages/web/src/lib/insights.ts`):
```ts
interface Insight {
  id: string;            // "top-model", "cache-champion", "peak-hour", etc.
  icon: string;          // Lucide icon name
  title: string;         // short label
  description: string;   // the fun-fact sentence with bold highlights
  metric?: number;       // raw value for sorting/prioritization
}

interface InsightInputs {
  rows: UsageRow[];              // raw usage records — MUST be half-hour granularity (full timestamps) for peak-hour, streak, and local-day features
  summary: UsageSummary;         // pre-computed totals
  models: ModelAggregate[];      // per-model breakdown
  pricingMap: PricingMap;        // for cost calculations
  sessions?: SessionOverview;    // optional, for tokens/hour insight
  tzOffset?: number;             // for local-time features (peak hour, streak)
  today?: string;                // for streak calculation, defaults to current local date
}

function generateInsights(inputs: InsightInputs): Insight[];
```

**Why `rows` is required**: The insight catalog includes `peak-hour` (needs raw rows for `detectPeakHours()`), `streak` (needs raw rows for `computeStreak()` with local-day re-bucketing), and `cost-trend` (needs raw rows for `computeMoMGrowth()`). Pre-aggregated `summary`/`models`/`dailyPoints` are insufficient for these. The `rows` field **must contain half-hour granularity data** (full UTC timestamps) — day-granularity rows have bare date strings and cannot be used for local-time features. If half-hour rows are unavailable, `peak-hour` and `streak` insights are skipped (return null).

#### Insight Catalog

| ID | Logic | Example Output |
|----|-------|----------------|
| `top-model` | Model with highest `total_tokens` share (from `models`) | "Your #1 model is **claude-sonnet-4**, at **67%** of all tokens" |
| `top-source` | Source with highest token share (from `models`) | "You use **Claude Code** for **82%** of your AI coding" |
| `cache-rate` | Overall `cached_input_tokens / input_tokens` (from `summary`) | "Your cache hit rate is **73%** — saving you **$12.40** this month" |
| `peak-hour` | `detectPeakHours(rows, 1, tzOffset)[0]` — skipped if rows lack half-hour granularity | "Your most productive slot: **Wednesday 9–10 PM**" |
| `streak` | `computeStreak(rows, today, tzOffset).currentStreak` — skipped if rows lack half-hour granularity | "You're on a **12-day streak** — keep it going!" |
| `big-day` | Day with highest total tokens (from `toLocalDailyBuckets(rows, tzOffset)`) | "Your biggest day was **Mar 5** with **2.1M tokens**" |
| `reasoning-depth` | Reasoning ratio when > 20% (from `summary`) | "**38%** of your output is deep reasoning" |
| `cost-trend` | `computeMoMGrowth(rows, pricingMap)` direction | "Your costs are **down 15%** vs last month" |

**Algorithm**: Run all insight generators, filter out any that return null (insufficient data), sort by relevance/surprise factor, return top 4–6.

**UI component** (`packages/web/src/components/dashboard/insight-cards.tsx`):
- A horizontal scrollable row of 3–4 cards
- Each card: `bg-secondary rounded-[var(--radius-card)] p-4`, icon top-left, bold metric, descriptive sentence
- Subtle gradient or accent border to make them feel special (distinct from regular StatCards)
- Placement: Dashboard page, between the stat grid and the charts — prime real estate for engagement

---

### Category 6: Goal Tracking — Detailed Design

#### Architecture

This is the only feature requiring a **new database table** and new API endpoints, since user budget preferences must be persisted server-side.

#### Database Migration (`scripts/migrations/005-user-budgets.sql`)

```sql
CREATE TABLE IF NOT EXISTS user_budgets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT    NOT NULL REFERENCES users(id),
  month       TEXT    NOT NULL,    -- "2026-03" format
  budget_usd  REAL,               -- monthly USD limit (NULL = no budget)
  budget_tokens INTEGER,          -- monthly token limit (NULL = no budget)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, month)
);
CREATE INDEX idx_budget_user ON user_budgets(user_id);
```

Design notes:
- Per-month granularity allows changing budgets over time
- Both USD and token limits are optional (user can set either or both)
- `UNIQUE(user_id, month)` enables upsert for easy updates

#### Worker Changes

No worker changes needed — budgets are read/written by the Next.js app directly via D1 REST API (reads from Next.js are already via REST). Budget data is low-volume (1 row/user/month) so REST is fine.

#### New API Endpoint (`packages/web/src/app/api/budgets/route.ts`)

**GET** `/api/budgets?month=2026-03`:
- Auth: Session or Bearer
- Returns: `{ budget_usd, budget_tokens, month }` or `null` if no budget set
- Query: `SELECT * FROM user_budgets WHERE user_id = ? AND month = ?`

**PUT** `/api/budgets`:
- Auth: Session or Bearer
- Body: `{ month: "2026-03", budget_usd?: number, budget_tokens?: number }`
- Upsert: `INSERT INTO user_budgets ... ON CONFLICT(user_id, month) DO UPDATE SET ...`
- Validation: `budget_usd >= 0`, `budget_tokens >= 0`, month format `YYYY-MM`

#### New Helper Functions (`packages/web/src/lib/budget-helpers.ts`)

```ts
interface BudgetStatus {
  budgetUsd: number | null;
  budgetTokens: number | null;
  spentUsd: number;
  spentTokens: number;
  usedPercentUsd: number;       // 0–100+
  usedPercentTokens: number;    // 0–100+
  projectedUsd: number;         // end-of-month forecast
  projectedTokens: number;
  isOverBudgetUsd: boolean;
  isOverBudgetTokens: boolean;
  willExceedUsd: boolean;       // projected > budget
  willExceedTokens: boolean;
}

function computeBudgetStatus(
  budget: { budget_usd: number | null; budget_tokens: number | null },
  currentMonthCost: number,
  currentMonthTokens: number,
  forecast: CostForecast,
): BudgetStatus;
```

#### New Hook (`packages/web/src/hooks/use-budget.ts`)

```ts
function useBudget(month: string): {
  budget: Budget | null;
  loading: boolean;
  error: string | null;
  saveBudget: (budget: Partial<Budget>) => Promise<void>;
};
```

#### UI Components

**Budget settings dialog** (`packages/web/src/components/dashboard/budget-dialog.tsx`):
- Modal/drawer with two inputs: "Monthly cost limit ($)" and "Monthly token limit"
- "Save" button triggers `PUT /api/budgets`
- Accessible from a settings icon in the stat grid area

**Budget progress bar** (`packages/web/src/components/dashboard/budget-progress.tsx`):
- Horizontal progress bar inside a `StatCard`-like container
- Color: green (0–70%), yellow (70–90%), red (90%+)
- Label: "$42.30 / $100.00 (42%)"
- Projected line marker on the bar showing where the month will end
- Placement: Dashboard page, top of page (above stat grid) when a budget is active

**Overage warning** (`packages/web/src/components/dashboard/budget-alert.tsx`):
- Conditional banner: appears when `willExceedUsd || willExceedTokens`
- Style: `bg-warning/10 text-warning` (amber tone), same pattern as existing error banner
- Message: "At current pace, you'll reach $132 by month end (budget: $100)"
- Dismissible per session via local state

---

## Atomic Commit Plan & Test Strategy

> Convention: Each commit is self-contained, passes L1 (vitest) + L2 (tsc), and follows `<type>: <description>` format.
> Test philosophy: Business logic lives in `lib/*.ts` pure functions (L1 testable). React components are presentational (L4 testable). No `@testing-library/react` — component tests are out of scope until L4 Playwright is implemented.

### Category 1: Cost Insights (8 commits)

| # | Commit | Files Changed | Tests |
|---|--------|---------------|-------|
| 1 | `feat: add toDailyCostPoints helper` | `cost-helpers.ts` | `cost-helpers.test.ts` — 5+ cases: empty data, single day, multi-day, multi-model same day, zero tokens |
| 2 | `feat: add computeCacheSavings helper` | `cost-helpers.ts` | `cost-helpers.test.ts` — 4+ cases: no cache, partial cache, full cache, mixed models |
| 3 | `feat: add forecastMonthlyCost helper` | `cost-helpers.ts` | `cost-helpers.test.ts` — 5+ cases: mid-month, start of month (<3 days → null), end of month, empty data, leap year |
| 4 | `feat: add computeCostPerToken helper` | `cost-helpers.ts` | `cost-helpers.test.ts` — 3+ cases: single model, multi-model sorting, zero-token model filtered out |
| 5 | `feat: add CostTrendChart component` | `cost-trend-chart.tsx` | No unit test (presentational). Manual verification. |
| 6 | `feat: add CostPerTokenChart component` | `cost-per-token-chart.tsx` | No unit test (presentational). |
| 7 | `feat: integrate cost trend + cache savings on dashboard` | `dashboard/page.tsx`, `use-usage-data.ts` | No unit test (wiring). L3 E2E covers API. |
| 8 | `feat: add cost forecast stat card to dashboard` | `dashboard/page.tsx` | No unit test (wiring). |

### Category 2: Efficiency Metrics (7 commits)

| # | Commit | Files Changed | Tests |
|---|--------|---------------|-------|
| 1 | `feat: add computeTokensPerHour helper` | `session-helpers.ts` | `session-helpers.test.ts` — 3+ cases: normal, zero hours (guard), high throughput |
| 2 | `feat: add toDailyCacheRates helper` | `cost-helpers.ts` | `cost-helpers.test.ts` — 4+ cases: 100% cache, 0% cache, mixed days, zero input day |
| 3 | `feat: add computeReasoningRatio helper` | `cost-helpers.ts` | `cost-helpers.test.ts` — 3+ cases: no reasoning, partial reasoning, 100% reasoning |
| 4 | `feat: add CacheRateChart component` | `cache-rate-chart.tsx` | No unit test (presentational). |
| 5 | `feat: add IoRatioChart component` | `io-ratio-chart.tsx` | No unit test (presentational). |
| 6 | `feat: integrate tokens/hour + reasoning ratio on sessions page` | `sessions/page.tsx` | No unit test (wiring). |
| 7 | `feat: integrate cache rate chart + io ratio on dashboard` | `dashboard/page.tsx` | No unit test (wiring). |

### Category 3: Time Analysis (11 commits)

| # | Commit | Files Changed | Tests |
|---|--------|---------------|-------|
| 0 | `feat: add granularity param to useUsageData hook` | `use-usage-data.ts` | No unit test (hook). Existing tests unaffected (default remains "day"). |
| 1 | `feat: add toLocalDailyBuckets helper` | `usage-helpers.ts` | `usage-helpers.test.ts` — 4+ cases: UTC midnight boundary, positive/negative tzOffset, empty rows, multiple rows same local day |
| 2 | `fix: use local time in toWorkingHoursGrid` | `session-helpers.ts` | `session-helpers.test.ts` — update existing tests to verify local-time extraction (`getDay`/`getHours` instead of `getUTCDay`/`getUTCHours`), add tzOffset param |
| 3 | `feat: add detectPeakHours helper` | `date-helpers.ts` | `date-helpers.test.ts` — 4+ cases: clear winner, tie-breaking, single record, topN param |
| 4 | `feat: add compareWeekdayWeekend helper` | `usage-helpers.ts` | `usage-helpers.test.ts` — 4+ cases: all weekdays, all weekends, mixed, empty data, midnight boundary with tzOffset |
| 5 | `feat: add computeMoMGrowth helper` | `usage-helpers.ts` | `usage-helpers.test.ts` — 4+ cases: growth, decline, first month (no previous), same cost |
| 6 | `feat: add computeStreak helper` | `usage-helpers.ts` | `usage-helpers.test.ts` — 6+ cases: active today, ended yesterday, no data, gap in middle, longest within 365 days, midnight boundary with tzOffset |
| 7 | `feat: add PeakHoursCard component` | `peak-hours-card.tsx` | No unit test (presentational). |
| 8 | `feat: add WeekdayWeekendChart component` | `weekday-weekend-chart.tsx` | No unit test (presentational). |
| 9 | `feat: add StreakBadge component` | `streak-badge.tsx` | No unit test (presentational). |
| 10 | `feat: integrate time analysis on dashboard + sessions pages` | `dashboard/page.tsx`, `sessions/page.tsx` | No unit test (wiring). **Note**: 3b (weekday/weekend) and 3d (streaks) each need a `useUsageData({ granularity: "half-hour" })` call — they cannot reuse the heatmap's day-granularity fetch. Consider sharing a single half-hour fetch between 3a/3b/3d on the same page, or using a dedicated hook. |

### Category 4: Model/Tool Comparison (6 commits)

| # | Commit | Files Changed | Tests |
|---|--------|---------------|-------|
| 1 | `feat: add toSourceTrendPoints helper` | `usage-helpers.ts` | `usage-helpers.test.ts` — 3+ cases: single source, multi-source, missing days |
| 2 | `feat: add toDominantSourceTimeline helper` | `usage-helpers.ts` | `usage-helpers.test.ts` — 3+ cases: clear dominant, tied sources, single source |
| 3 | `feat: add toModelEvolutionPoints helper` | `model-helpers.ts` | `model-helpers.test.ts` — 3+ cases: <N models (no "other"), >N models (grouped), single day |
| 4 | `feat: add SourceTrendChart component` | `source-trend-chart.tsx` | No unit test (presentational). |
| 5 | `feat: add ModelEvolutionChart component` | `model-evolution-chart.tsx` | No unit test (presentational). |
| 6 | `feat: integrate tool comparison charts on models page` | `models/page.tsx` | No unit test (wiring). |

### Category 5: Personal Insight Cards (4 commits)

| # | Commit | Files Changed | Tests |
|---|--------|---------------|-------|
| 1 | `feat: add insights generator module` | `insights.ts` (new) | `insights.test.ts` (new) — 10+ cases: one per insight type + edge cases (empty data, single record, all zeros) |
| 2 | `feat: add InsightCard component` | `insight-cards.tsx` | No unit test (presentational). |
| 3 | `feat: integrate insight cards on dashboard` | `dashboard/page.tsx` | No unit test (wiring). |
| 4 | `test: add integration test for insights with real-shaped data` | `insights.test.ts` | Full scenario test: feed realistic data, assert all expected insights generated |

### Category 6: Goal Tracking (9 commits)

| # | Commit | Files Changed | Tests |
|---|--------|---------------|-------|
| 1 | `feat: add user_budgets migration` | `scripts/migrations/005-user-budgets.sql` | No test (DDL). Manual D1 verification. |
| 2 | `feat: add budget API route (GET + PUT)` | `api/budgets/route.ts` | `budgets.test.ts` (new) — 6+ cases: GET empty, GET existing, PUT create, PUT update, invalid month format, negative values |
| 3 | `feat: add budget validation in @pew/core` | `core/src/validation.ts` | `core/validation.test.ts` — 4+ cases: valid budget, zero budget, negative, invalid month |
| 4 | `feat: add computeBudgetStatus helper` | `budget-helpers.ts` (new) | `budget-helpers.test.ts` (new) — 6+ cases: under budget, at budget, over budget, projected overage, null budget (no limit), tokens-only budget |
| 5 | `feat: add useBudget hook` | `use-budget.ts` (new) | No unit test (hook with fetch). Covered by L3 E2E. |
| 6 | `feat: add BudgetDialog component` | `budget-dialog.tsx` | No unit test (presentational). |
| 7 | `feat: add BudgetProgress component` | `budget-progress.tsx` | No unit test (presentational). |
| 8 | `feat: add BudgetAlert component` | `budget-alert.tsx` | No unit test (presentational). |
| 9 | `feat: integrate budget tracking on dashboard` | `dashboard/page.tsx` | No unit test (wiring). |

### Total: 45 atomic commits

| Category | Helper commits (tested) | Component commits | Integration commits | Total |
|----------|------------------------|-------------------|---------------------|-------|
| 1. Cost Insights | 4 | 2 | 2 | 8 |
| 2. Efficiency Metrics | 3 | 2 | 2 | 7 |
| 3. Time Analysis | 7 | 3 | 1 | 11 |
| 4. Model/Tool Comparison | 3 | 2 | 1 | 6 |
| 5. Personal Insights | 2 | 1 | 1 | 4 |
| 6. Goal Tracking | 3 | 3 | 3 | 9 |
| **Total** | **22** | **13** | **10** | **45** |

### Test Coverage Summary

- **22 helper commits** each include L1 unit tests (pure functions, vitest)
- **13 component commits** are presentational React (deferred to L4 Playwright)
- **10 integration commits** are page wiring (deferred to L3/L4 E2E)
- Estimated **75+ new test cases** across existing and new test files
- All commits must pass pre-commit hook: `vitest run` (L1) + `tsc --noEmit` (L2)
