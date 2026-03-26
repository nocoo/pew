"use client";

import { useState, useMemo } from "react";
import { Dialog } from "radix-ui";
import {
  X,
  Zap,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  Calendar,
} from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { formatMemberSince } from "@/lib/date-helpers";
import { useAdmin } from "@/hooks/use-admin";
import { useSeasons } from "@/hooks/use-seasons";
import { useUserProfile } from "@/hooks/use-user-profile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { SourceDonutChart } from "@/components/dashboard/source-donut-chart";
import { ModelBreakdownChart } from "@/components/dashboard/model-breakdown-chart";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProfileDialogTab = "season" | "7d" | "30d" | "total";

interface TabDef {
  id: ProfileDialogTab;
  label: string;
}

/** Resolved season info used internally */
interface ResolvedSeason {
  name: string;
  start: string;
  end: string;
}

export interface UserProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** User slug (or user ID as fallback) for fetching profile data */
  slug: string | null;
  /** Display name (shown while loading) */
  name?: string | null;
  /** Avatar image URL (shown while loading) */
  image?: string | null;
  /** Which tab to select initially (default: "7d") */
  defaultTab?: ProfileDialogTab;
  /** Pre-fetched season name (from season leaderboard entry point) */
  seasonName?: string;
  /** Pre-fetched season start date ISO 8601 (from season leaderboard entry point) */
  seasonStart?: string;
  /** Pre-fetched season end date ISO 8601 — exclusive (from season leaderboard entry point) */
  seasonEnd?: string;
}

// ---------------------------------------------------------------------------
// Content skeleton — matches the real content layout exactly
// ---------------------------------------------------------------------------

function ContentSkeleton() {
  return (
    <div className="space-y-4">
      {/* Stats skeleton — matches StatGrid columns={4} */}
      <StatGrid columns={4}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </StatGrid>

      {/* Charts skeleton — matches grid grid-cols-1 lg:grid-cols-[1fr_280px] */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
        <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
          <Skeleton className="h-4 w-24 mb-3" />
          <Skeleton className="h-[220px] w-full" />
        </div>
        <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 flex flex-col">
          <Skeleton className="h-4 w-20 mb-3" />
          <div className="flex flex-1 items-center justify-center">
            <Skeleton className="h-[180px] w-[180px] rounded-full" />
          </div>
        </div>
      </div>

      {/* Model breakdown skeleton */}
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
        <Skeleton className="h-4 w-20 mb-4" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config loading skeleton — shown while admin + season resolve
// ---------------------------------------------------------------------------

function ConfigLoadingSkeleton({
  name,
  image,
}: {
  name?: string | null | undefined;
  image?: string | null | undefined;
}) {
  const displayName = name ?? "User";
  const displayImage = image;
  const initial = displayName[0]?.toUpperCase() ?? "?";

  return (
    <>
      {/* Header — shows known info while config resolves */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            {displayImage && (
              <AvatarImage src={displayImage} alt={displayName} />
            )}
            <AvatarFallback className="bg-primary text-primary-foreground text-lg">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div>
            <Dialog.Title className="text-xl font-semibold text-foreground">
              {displayName}
            </Dialog.Title>
            <Skeleton className="h-4 w-32 mt-1" />
          </div>
        </div>
        <Dialog.Close asChild>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </Dialog.Close>
      </div>

      {/* Tab bar skeleton */}
      <div className="flex gap-1 rounded-lg bg-secondary p-1 mb-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex-1 rounded-md px-3 py-2">
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>

      <ContentSkeleton />
    </>
  );
}

// ---------------------------------------------------------------------------
// Inner body — remounted via key to reset tab state cleanly
// ---------------------------------------------------------------------------

interface DialogBodyProps {
  slug: string | null;
  name?: string | null | undefined;
  image?: string | null | undefined;
  isAdmin: boolean;
  season: ResolvedSeason | null;
  defaultTab?: ProfileDialogTab | undefined;
}

function DialogBody({
  slug,
  name,
  image,
  isAdmin,
  season,
  defaultTab,
}: DialogBodyProps) {
  // Compute available tabs based on admin status and season existence
  const tabs = useMemo<TabDef[]>(() => {
    const result: TabDef[] = [];

    if (season) {
      result.push({ id: "season", label: season.name });
    }

    result.push({ id: "7d", label: "7 Days" });

    if (isAdmin) {
      result.push({ id: "30d", label: "30 Days" });
      result.push({ id: "total", label: "Total" });
    }

    return result;
  }, [season, isAdmin]);

  // Resolve default tab — validate it exists in computed tab list
  const resolvedDefault = useMemo(() => {
    const wanted = defaultTab ?? "7d";
    return tabs.some((t) => t.id === wanted) ? wanted : tabs[0]?.id ?? "7d";
  }, [defaultTab, tabs]);

  const [tab, setTab] = useState<ProfileDialogTab>(resolvedDefault);

  // Determine time range based on active tab
  const timeRange = useMemo(() => {
    switch (tab) {
      case "season":
        // season is guaranteed non-null when tab === "season"
        return { from: (season as ResolvedSeason).start, to: (season as ResolvedSeason).end };
      case "7d":
        return { days: 7 };
      case "30d":
        return { days: 30 };
      case "total":
        return { days: 365 };
    }
  }, [tab, season]);

  // Fetch profile data
  const { user, data, daily, sources, models, loading, error, notFound } = useUserProfile({
    slug: slug ?? "",
    ...timeRange,
  });

  // Display name and image (prefer fetched data, fallback to props)
  const displayName = user?.name ?? name ?? "User";
  const displayImage = user?.image ?? image;
  const initial = displayName[0]?.toUpperCase() ?? "?";

  // First load = no data at all; tab switch = loading but data still present
  const isFirstLoad = loading && !data;
  const isRefreshing = loading && !!data;

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            {displayImage && (
              <AvatarImage src={displayImage} alt={displayName} />
            )}
            <AvatarFallback className="bg-primary text-primary-foreground text-lg">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div>
            <Dialog.Title className="text-xl font-semibold text-foreground">
              {isFirstLoad && !user ? (
                <Skeleton className="h-6 w-40" />
              ) : (
                displayName
              )}
            </Dialog.Title>
            {user && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                <Calendar className="h-3.5 w-3.5" />
                Member since {formatMemberSince(user.created_at)}
                {isAdmin && user.first_seen && (
                  <span className="text-muted-foreground/60">
                    · Data since {formatMemberSince(user.first_seen)}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        <Dialog.Close asChild>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </Dialog.Close>
      </div>

      {/* Tab bar — hidden when only 1 tab */}
      {tabs.length > 1 && (
        <div className="flex gap-1 rounded-lg bg-secondary p-1 mb-5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Season date range indicator — shown when season tab is active */}
      {tab === "season" && season && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-5">
          <Calendar className="h-3.5 w-3.5" />
          <span>
            {new Date(season.start).toLocaleDateString()} – {new Date(season.end).toLocaleDateString()}
          </span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      {/* Not found state */}
      {notFound && (
        <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground mb-4">
          User profile not found or not public.
        </div>
      )}

      {/* Content area — skeleton on first load, fade during tab refresh */}
      {!error && !notFound && (
        isFirstLoad ? (
          <ContentSkeleton />
        ) : data ? (
          <div className={cn(
            "space-y-4 transition-opacity duration-200",
            isRefreshing && "opacity-50",
          )}>
            {/* Stats row */}
            <StatGrid columns={4}>
              <StatCard
                title="Total"
                value={formatTokens(data.summary.total_tokens)}
                icon={Zap}
                iconColor="text-primary"
              />
              <StatCard
                title="Input"
                value={formatTokens(data.summary.input_tokens)}
                icon={ArrowDownToLine}
              />
              <StatCard
                title="Output"
                value={formatTokens(data.summary.output_tokens)}
                icon={ArrowUpFromLine}
              />
              <StatCard
                title="Cached"
                value={formatTokens(data.summary.cached_input_tokens)}
                icon={Database}
                iconColor="text-success"
              />
            </StatGrid>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
              <UsageTrendChart data={daily} />
              <SourceDonutChart data={sources} />
            </div>

            {/* Model breakdown */}
            <ModelBreakdownChart data={models} />
          </div>
        ) : null
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UserProfileDialog({
  open,
  onOpenChange,
  slug,
  name,
  image,
  defaultTab = "7d",
  seasonName,
  seasonStart,
  seasonEnd,
}: UserProfileDialogProps) {
  // Resolve admin status
  const { isAdmin, loading: adminLoading } = useAdmin();

  // Fetch active season (always fires; result ignored when season props exist)
  const { data: seasonsData, loading: seasonsLoading } = useSeasons({ status: "active" });

  // Season from props (season leaderboard entry point)
  const seasonFromProps = useMemo<ResolvedSeason | null>(() => {
    if (seasonName && seasonStart && seasonEnd) {
      return { name: seasonName, start: seasonStart, end: seasonEnd };
    }
    return null;
  }, [seasonName, seasonStart, seasonEnd]);

  // Season from API (other entry points)
  const seasonFromAPI = useMemo<ResolvedSeason | null>(() => {
    const active = seasonsData?.seasons?.[0];
    if (!active) return null;
    // Compute exclusive end date (end_date is inclusive at minute precision)
    const exclusiveEnd = new Date(
      new Date(active.end_date).getTime() + 60_000,
    ).toISOString();
    return { name: active.name, start: active.start_date, end: exclusiveEnd };
  }, [seasonsData]);

  // Resolved season: props take precedence
  const season = seasonFromProps ?? seasonFromAPI;

  // Config is ready when admin check is done AND season is resolved
  // (season from props = instant, season from API = wait for fetch)
  const configReady = !adminLoading && (seasonFromProps !== null || !seasonsLoading);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-5xl max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 md:p-8 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          {configReady ? (
            <DialogBody
              key={`${slug}-${defaultTab}`}
              slug={slug}
              name={name}
              image={image}
              isAdmin={isAdmin}
              season={season}
              defaultTab={defaultTab}
            />
          ) : (
            <ConfigLoadingSkeleton name={name} image={image} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
