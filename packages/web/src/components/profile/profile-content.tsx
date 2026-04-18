"use client";

import { useState, useMemo } from "react";
import {
  Zap,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  DollarSign,
  Calendar,
} from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { useUserProfile } from "@/hooks/use-user-profile";
import { usePricingMap, formatCost } from "@/hooks/use-pricing";
import { computeTotalCost } from "@/lib/cost-helpers";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { SourceDonutChart } from "@/components/dashboard/source-donut-chart";
import { ModelBreakdownChart } from "@/components/dashboard/model-breakdown-chart";
import { HeatmapCalendar } from "@/components/dashboard/heatmap-calendar";
import { ProfileAchievements } from "@/components/profile/profile-achievements";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProfileTab = "season" | "7d" | "30d" | "total";

interface TabDef {
  id: ProfileTab;
  label: string;
}

export interface ProfileContentProps {
  slug: string;
  defaultTab?: ProfileTab | undefined;
  season?: { name: string; start: string; end: string } | undefined;
  /** Show admin-only tabs (30d, total). Caller resolves via useAdmin(). */
  showAdminTabs?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Content skeleton
// ---------------------------------------------------------------------------

function ContentSkeleton() {
  return (
    <div className="space-y-4">
      {/* Stats skeleton — 2 rows of 3 */}
      {Array.from({ length: 2 }).map((_, row) => (
        <StatGrid key={row} columns={3}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-2"
            >
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </StatGrid>
      ))}

      {/* Charts skeleton */}
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
// ProfileContent
// ---------------------------------------------------------------------------

export function ProfileContent({
  slug,
  defaultTab,
  season,
  showAdminTabs = false,
}: ProfileContentProps) {
  // ---- Tabs ----------------------------------------------------------------

  const tabs = useMemo<TabDef[]>(() => {
    const result: TabDef[] = [];

    if (season) {
      result.push({ id: "season", label: season.name });
    }

    result.push({ id: "7d", label: "7 Days" });

    if (showAdminTabs) {
      result.push({ id: "30d", label: "30 Days" });
      result.push({ id: "total", label: "Total" });
    }

    return result;
  }, [season, showAdminTabs]);

  const resolvedDefault = useMemo(() => {
    const wanted = defaultTab ?? "7d";
    return tabs.some((t) => t.id === wanted) ? wanted : tabs[0]?.id ?? "30d";
  }, [defaultTab, tabs]);

  const [tab, setTab] = useState<ProfileTab>(resolvedDefault);

  // ---- Time range for tab-driven data -------------------------------------

  const timeRange = useMemo(() => {
    switch (tab) {
      case "season":
        return {
          from: (season as NonNullable<typeof season>).start,
          to: (season as NonNullable<typeof season>).end,
        };
      case "7d":
        return { days: 7 };
      case "30d":
        return { days: 30 };
      case "total":
        return { days: 365 };
    }
  }, [tab, season]);

  // ---- Data fetching -------------------------------------------------------

  // Tab-driven data (changes on tab switch)
  const {
    data,
    daily,
    sources,
    models,
    loading,
    error,
    notFound,
  } = useUserProfile({ slug, ...timeRange });

  // 365-day data for heatmap (stable, fires once)
  const yearData = useUserProfile({ slug, days: 365 });

  // Pricing
  const { pricingMap } = usePricingMap();
  const estimatedCost = useMemo(
    () => computeTotalCost(models, pricingMap),
    [models, pricingMap],
  );

  // Cache savings %
  const cacheSavingsPercent = data?.summary.input_tokens
    ? Math.round(
        (data.summary.cached_input_tokens / data.summary.input_tokens) * 100,
      )
    : 0;

  // ---- Loading states ------------------------------------------------------

  const isFirstLoad = loading && !data;
  const isRefreshing = loading && !!data;
  const currentYear = new Date().getFullYear();

  // ---- Tab label for subtitle context --------------------------------------

  const tabSubtitle = useMemo(() => {
    switch (tab) {
      case "season":
        return season?.name ?? "Season";
      case "7d":
        return "Last 7 days";
      case "30d":
        return "Last 30 days";
      case "total":
        return "Last 365 days";
    }
  }, [tab, season]);

  // ---- Render --------------------------------------------------------------

  return (
    <>
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
                  ? "bg-secondary text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Season date range indicator */}
      {tab === "season" && season && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-5">
          <Calendar className="h-3.5 w-3.5" />
          <span>
            {new Date(season.start).toLocaleDateString()} –{" "}
            {new Date(season.end).toLocaleDateString()}
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

      {/* Content area */}
      {!error &&
        !notFound &&
        (isFirstLoad ? (
          <ContentSkeleton />
        ) : data ? (
          <div
            className={cn(
              "space-y-4 transition-opacity duration-200",
              isRefreshing && "opacity-50",
            )}
          >
            {/* Stat cards — row 1: Total, Est. Cost, Cache Savings */}
            <StatGrid columns={3}>
              <StatCard
                title="Total Tokens"
                value={formatTokens(data.summary.total_tokens)}
                subtitle={tabSubtitle}
                icon={Zap}
                iconColor="text-primary"
              />
              <StatCard
                title="Est. Cost"
                value={formatCost(estimatedCost)}
                subtitle="Based on public pricing"
                icon={DollarSign}
                iconColor="text-chart-6"
              />
              <StatCard
                title="Cache Savings"
                value={`${cacheSavingsPercent}%`}
                subtitle={`${formatTokens(data.summary.cached_input_tokens)} cached tokens`}
                icon={Database}
                iconColor="text-success"
              />
            </StatGrid>

            {/* Stat cards — row 2: Input, Output, Cached */}
            <StatGrid columns={3}>
              <StatCard
                title="Input Tokens"
                value={formatTokens(data.summary.input_tokens)}
                subtitle="Prompts & context"
                icon={ArrowDownToLine}
              />
              <StatCard
                title="Output Tokens"
                value={formatTokens(data.summary.output_tokens)}
                subtitle="Responses & reasoning"
                icon={ArrowUpFromLine}
              />
              <StatCard
                title="Cached Tokens"
                value={formatTokens(data.summary.cached_input_tokens)}
                subtitle="Cache hits"
                icon={Database}
              />
            </StatGrid>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
              <UsageTrendChart data={daily} />
              <SourceDonutChart data={sources} />
            </div>

            {/* Model breakdown */}
            <ModelBreakdownChart data={models} />

            {/* Achievements */}
            <ProfileAchievements slug={slug} />

            {/* Activity heatmap */}
            <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
              <p className="mb-3 text-xs md:text-sm text-muted-foreground">
                {currentYear} Activity
              </p>
              {yearData.loading ? (
                <Skeleton className="h-[120px] w-full" />
              ) : (
                <HeatmapCalendar
                  data={yearData.heatmap}
                  year={currentYear}
                  valueFormatter={(v) => formatTokens(v)}
                />
              )}
            </div>
          </div>
        ) : null)}
    </>
  );
}
