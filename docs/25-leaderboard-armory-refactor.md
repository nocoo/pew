# Leaderboard Armory-Style Refactor

> Extract duplicated shell/components across the 3 leaderboard pages into a
> shared layout + component library. Adopt a WoW-Armory-inspired information
> architecture (shared shell -> page header -> sub-nav tabs -> content) while
> keeping pew's existing Basalt visual design language intact.

## Status

| #   | Commit                                                        | Description                                                     | Status |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------- | ------ |
| 1   | `docs: add leaderboard armory refactor plan`                  | This document                                                   | done   |
| 2   | `refactor: extract shared leaderboard components`             | CheckRuling, RankBadge, StatusBadge, LeaderboardSkeleton        | done   |
| 3   | `feat: add leaderboard layout and nav components`             | `layout.tsx`, `LeaderboardNav`, `PageHeader`                    | done   |
| 4   | `refactor: rewrite leaderboard pages to use shared shell`     | Remove duplicated shell from all 3 pages                        | done   |
| 5   | `feat: support slug in season leaderboard API`                | `[seasonId]` accepts UUID or slug, delete `useSeasonIdFromSlug` | done   |
| 6   | `feat: switch leaderboard nav to underline tabs`              | Armory-style underline navigation                               | done   |
| 7   | `feat: add table header, compact density, color-coded tokens` | TableHeader, py-3 density, cyan/amber In/Out                    | done   |
| 8   | `feat: add hero header gradient`                              | Teal radial-gradient glow on PageHeader                         | done   |
| 9   | `feat: polish season pages`                                   | SeasonTableHeader, compact density, color-coded tokens          | done   |
| 10  | `feat: add token tier badges (K/M/B)`                         | Pill badges by token magnitude                                  | done   |

---

## Problem

The three leaderboard pages (`/leaderboard`, `/leaderboard/seasons`,
`/leaderboard/seasons/[slug]`) each independently render:

1. **Top-right icon bar** (Privacy, GitHub, ThemeToggle) — ~12 lines x3
2. **Page header** (logo + title + subtitle) — ~15 lines x3
3. **Footer** — ~8 lines x3
4. **CheckRuling** component — identical in all 3 files
5. **StatusBadge** + `STATUS_STYLES`/`STATUS_LABELS` constants — identical in
   seasons list + season detail
6. **RankBadge** — identical in individual + season detail
7. **LeaderboardSkeleton** — near-identical in individual + season detail

Total duplicated code: ~150 lines across 3 files. No `layout.tsx` exists at
the `/leaderboard` level, and no shared `components/leaderboard/` directory
exists.

Additionally, the season detail page (`/leaderboard/seasons/[slug]`) performs a
**two-step slug resolution**: fetch ALL seasons from `/api/seasons`, find the
matching slug, extract the UUID, then call `/api/seasons/{uuid}/leaderboard`.
This wastes a network round-trip.

---

## Design Decisions

| Decision          | Choice                                                                           | Rationale                                                                   |
| ----------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Navigation style  | Route-based tabs (`/leaderboard` = Individual, `/leaderboard/seasons` = Seasons) | Real routes, not client-side state; supports deep linking and back button   |
| Tab component     | `LeaderboardNav` using `usePathname()` to highlight active tab                   | Standard Next.js App Router pattern                                         |
| Season detail nav | Breadcrumb (`Leaderboard > Seasons > {name}`) instead of tabs                    | Detail page is a child of Seasons, not a peer of Individual                 |
| Layout scope      | Top-right icons + centered `max-w-3xl` container + footer only                   | Header/nav rendered by pages for context-aware content (season name, etc.)  |
| Header ownership  | Each page renders its own header + nav section                                   | Season detail needs season name + status badge in header, not generic title |
| API slug support  | `[seasonId]` route accepts UUID or slug via `isUUID()` check                     | Eliminates two-step resolution; single network call                         |
| Old routes        | Keep all existing routes, no redirects                                           | No breaking changes                                                         |
| Visual style      | Basalt design system + Armory-inspired visual polish                             | Started as IA refactor, expanded to include visual refinements (see below)  |

---

## Technical Design

### Phase 1: Shared Components

Create `packages/web/src/components/leaderboard/` with these files:

#### `check-ruling.tsx`

Extracted verbatim from the 3 pages. No props needed.

```tsx
export function CheckRuling() {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-[0.04]"
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex flex-col justify-evenly">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-px bg-foreground" />
        ))}
      </div>
    </div>
  );
}
```

#### `rank-badge.tsx`

Extracted from `page.tsx` and `[slug]/page.tsx`. Identical implementation.

```tsx
interface RankBadgeProps { rank: number }
export function RankBadge({ rank }: RankBadgeProps) { ... }
```

#### `status-badge.tsx`

Extracted from `seasons/page.tsx` and `[slug]/page.tsx`. Includes the
`STATUS_STYLES` and `STATUS_LABELS` constants + the `StatusBadge` component.

```tsx
export const STATUS_STYLES: Record<SeasonStatus, string> = { ... };
export const STATUS_LABELS: Record<SeasonStatus, string> = { ... };
export function StatusBadge({ status }: { status: SeasonStatus }) { ... }
```

#### `leaderboard-skeleton.tsx`

Parameterized version accepting optional `count` (default 10). Extracted from
`page.tsx` and `[slug]/page.tsx`.

```tsx
export function LeaderboardSkeleton({ count = 10 }: { count?: number }) { ... }
```

#### `leaderboard-nav.tsx`

Route-based tab navigation. Two tabs: Individual (`/leaderboard`) and Seasons
(`/leaderboard/seasons`). Uses `usePathname()` to determine active state.

```tsx
"use client";
const TABS = [
  { href: "/leaderboard", label: "Individual" },
  { href: "/leaderboard/seasons", label: "Seasons" },
];
export function LeaderboardNav() { ... }
```

Visual style: Armory-inspired underline tabs — uppercase tracking-wider labels
with a teal active underline indicator (border-b), gap-6 spacing. This
differentiates top-level route navigation from the period selector (which
keeps the pill-tab pattern).

#### `page-header.tsx`

Reusable header pattern: logo (links to `/`) + title area (children slot) +
subtle teal radial-gradient glow at top.

```tsx
export function PageHeader({ children }: { children: React.ReactNode }) { ... }
```

The children slot allows each page to render its own title content:

- Individual: `pew` (handwriting) + `Leaderboard` (muted)
- Seasons list: `pew` (handwriting) + `Seasons` (muted)
- Season detail: `{season.name}` (handwriting) + status badges

### Phase 2: Layout + Page Rewrites

#### `packages/web/src/app/leaderboard/layout.tsx`

Server component. Renders:

1. Top-right icon bar (Privacy, GitHub, ThemeToggle)
2. `<div className="mx-auto w-full max-w-3xl">` container wrapping `{children}`
3. Footer

Does NOT render: header, nav, or any page-specific content.

```tsx
export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Top-right icons */}
      <div className="absolute right-6 top-4 z-50 flex items-center gap-1">
        ...Privacy, GitHub, ThemeToggle...
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 flex flex-col px-6">{children}</div>
      <footer className="px-6 py-3">...</footer>
    </div>
  );
}
```

#### Page rewrites

Each page drops:

- `<div className="relative flex min-h-screen flex-col bg-background">` wrapper
- Top-right icons block
- Footer block

And instead renders just:

1. `<PageHeader>` with page-specific title
2. `<LeaderboardNav />` (Individual + Seasons pages) OR breadcrumb (season detail)
3. Content area (`<main>`)

**`/leaderboard/page.tsx`** (~610 -> ~230 lines estimated):

- Remove shell code (~45 lines)
- Replace inline CheckRuling, RankBadge, LeaderboardSkeleton with imports
- Add `<LeaderboardNav />`
- Remove the "Seasons" link button from controls row (replaced by tab nav)

**`/leaderboard/seasons/page.tsx`** (~284 -> ~150 lines estimated):

- Remove shell code (~45 lines)
- Replace inline CheckRuling, StatusBadge with imports
- Add `<LeaderboardNav />`
- Remove "Back to Leaderboard" button (replaced by tab nav)

**`/leaderboard/seasons/[slug]/page.tsx`** (~457 -> ~250 lines estimated):

- Remove shell code (~45 lines)
- Replace inline CheckRuling, RankBadge, StatusBadge, LeaderboardSkeleton
- Remove `useSeasonIdFromSlug` hook entirely (Phase 3 enables this)
- Add breadcrumb: `Leaderboard > Seasons > {season.name}`
- Pass slug directly to `useSeasonLeaderboard(slug)` instead of resolved UUID

### Phase 3: API Slug Support

#### `packages/web/src/app/api/seasons/[seasonId]/leaderboard/route.ts`

Add UUID detection. If `seasonId` is not a UUID, treat it as a slug:

```tsx
const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const season = await client.firstOrNull<SeasonRow>(
  isUUID.test(seasonId)
    ? "SELECT ... FROM seasons WHERE id = ?"
    : "SELECT ... FROM seasons WHERE slug = ?",
  [seasonId],
);
```

#### `packages/web/src/hooks/use-season-leaderboard.ts`

Change parameter from `seasonId: string | null` to
`seasonIdOrSlug: string | null`. The fetch URL stays the same
(`/api/seasons/${seasonIdOrSlug}/leaderboard`) since the API now accepts both.

#### Delete from `[slug]/page.tsx`

Remove the `useSeasonIdFromSlug` function entirely. The page passes the URL
slug directly to `useSeasonLeaderboard(slug)`.

---

## File Change Summary

| #   | Op      | Path                                                  | Lines (est.) |
| --- | ------- | ----------------------------------------------------- | ------------ |
| 1   | Create  | `src/components/leaderboard/check-ruling.tsx`         | ~15          |
| 2   | Create  | `src/components/leaderboard/rank-badge.tsx`           | ~25          |
| 3   | Create  | `src/components/leaderboard/status-badge.tsx`         | ~35          |
| 4   | Create  | `src/components/leaderboard/leaderboard-skeleton.tsx` | ~25          |
| 5   | Create  | `src/components/leaderboard/leaderboard-nav.tsx`      | ~40          |
| 6   | Create  | `src/components/leaderboard/page-header.tsx`          | ~30          |
| 7   | Create  | `src/components/leaderboard/table-header.tsx`         | ~25          |
| 8   | Create  | `src/components/leaderboard/token-tier-badge.tsx`     | ~60          |
| 9   | Create  | `src/app/leaderboard/layout.tsx`                      | ~40          |
| 10  | Rewrite | `src/app/leaderboard/page.tsx`                        | 610 -> ~490  |
| 11  | Rewrite | `src/app/leaderboard/seasons/page.tsx`                | 284 -> ~150  |
| 12  | Rewrite | `src/app/leaderboard/seasons/[slug]/page.tsx`         | 457 -> ~305  |
| 13  | Modify  | `src/app/api/seasons/[seasonId]/leaderboard/route.ts` | +10          |
| 14  | Modify  | `src/hooks/use-season-leaderboard.ts`                 | rename param |

All paths relative to `packages/web/`.

---

## Visual Polish (Scope Extension)

The refactor expanded beyond pure IA/structure to include Armory-inspired
visual refinements. All changes stay within the Basalt design system (teal
primary, 3-tier luminance, Caveat handwriting font) but introduce new
visual patterns:

| Change             | File(s)                       | Description                                                                                             |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| Underline nav      | `leaderboard-nav.tsx`         | Route tabs use border-b + teal underline instead of pill-tabs, differentiating from period selector     |
| Table header       | `table-header.tsx`            | Uppercase column labels (Rank, Player, In, Out, Tokens) + thin divider, Armory `SortTable-head` pattern |
| Compact density    | `page.tsx`, `[slug]/page.tsx` | Row padding py-4→py-3, gap-4→gap-3, space-y-3→space-y-2                                                 |
| Color-coded tokens | `page.tsx`, `[slug]/page.tsx` | Input tokens: cyan-400/80, Output tokens: amber-400/80 (hidden on mobile)                               |
| Hero gradient      | `page-header.tsx`             | Subtle teal radial-gradient glow at top (`hsl(186 60% 35% / 0.08)`)                                     |
| Token tier badges  | `token-tier-badge.tsx`        | Pill badge next to total: K (gray, ≥1K), M (teal, ≥1M), B (amber, ≥1B); <1K hidden                      |
| Tabular nums       | `rank-badge.tsx`              | Plain rank numbers use `tabular-nums` for column alignment                                              |

---

## Verification

After each phase:

1. `bun run build` — ensure no TypeScript/build errors
2. `bun run --filter '@pew/web' dev` — visual check all 3 routes
3. Verify: `/leaderboard` shows Individual tab active, period selector, scope dropdown
4. Verify: `/leaderboard/seasons` shows Seasons tab active, season cards
5. Verify: `/leaderboard/seasons/s1` shows breadcrumb, season header, team rows
6. Verify: theme toggle, footer, top-right icons appear on all pages (from layout)
7. Verify: no extra network call on season detail (slug goes directly to API)
