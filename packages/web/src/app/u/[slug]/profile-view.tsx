"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Zap,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  DollarSign,
  Calendar,
  ArrowLeft,
} from "lucide-react";
import { usePublicProfile } from "@/hooks/use-public-profile";
import { formatTokens } from "@/lib/utils";
import { usePricingMap, formatCost } from "@/hooks/use-pricing";
import { computeTotalCost } from "@/lib/cost-helpers";
import { formatMemberSince } from "@/lib/date-helpers";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { UsageTrendChart } from "@/components/dashboard/usage-trend-chart";
import { SourceDonutChart } from "@/components/dashboard/source-donut-chart";
import { ModelBreakdownChart } from "@/components/dashboard/model-breakdown-chart";
import { HeatmapCalendar } from "@/components/dashboard/heatmap-calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PageHeader } from "@/components/leaderboard/page-header";
import { LeaderboardNav } from "@/components/leaderboard/leaderboard-nav";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ProfileSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6">
      {/* 3-col stat grid × 2 rows */}
      {Array.from({ length: 2 }).map((_, row) => (
        <StatGrid key={row} columns={3}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-3"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </StatGrid>
      ))}

      {/* Charts row: trend + donut */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3 md:gap-4">
        <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
          <Skeleton className="h-3 w-24 mb-4" />
          <Skeleton className="h-[240px] md:h-[280px] w-full" />
        </div>
        <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
          <Skeleton className="h-3 w-20 mb-4" />
          <div className="flex justify-center">
            <Skeleton className="h-[180px] w-[180px] rounded-full" />
          </div>
        </div>
      </div>

      {/* Model breakdown */}
      <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
        <Skeleton className="h-3 w-28 mb-4" />
        <Skeleton className="h-[200px] md:h-[240px] w-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PublicProfileViewProps {
  slug: string;
}

export function PublicProfileView({ slug }: PublicProfileViewProps) {
  const { user, data, daily, sources, models, loading, error, notFound } =
    usePublicProfile({ slug, days: 30 });

  const yearData = usePublicProfile({ slug, days: 365 });

  const { pricingMap } = usePricingMap();

  const currentYear = new Date().getFullYear();
  const estimatedCost = useMemo(() => computeTotalCost(models, pricingMap), [models, pricingMap]);

  // 404
  if (notFound) {
    return (
      <div className="min-h-screen bg-background px-4 md:px-6">
        <PageHeader>
          <h1 className="tracking-tight text-foreground">
            <span className="text-[36px] font-bold font-handwriting leading-none mr-2">pew</span>
            <span className="text-[19px] font-normal text-muted-foreground">
              Profile
            </span>
          </h1>
        </PageHeader>
        <main className="flex-1 py-8">
          <LeaderboardNav />
          <div className="mt-8 text-center space-y-4">
            <h2 className="text-4xl font-bold font-display text-foreground">
              404
            </h2>
            <p className="text-muted-foreground">
              No public profile found for &ldquo;{slug}&rdquo;
            </p>
            <Link
              href="/leaderboard"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to leaderboard
            </Link>
          </div>
        </main>
        <footer className="py-8 text-center border-t border-border">
          <p className="text-xs text-muted-foreground">
            Powered by{" "}
            <Link href="/" className="text-primary hover:underline font-handwriting">
              pew
            </Link>{" "}
            — show your tokens
          </p>
        </footer>
      </div>
    );
  }

  // Error
  if (error && !loading) {
    return (
      <div className="min-h-screen bg-background px-4 md:px-6">
        <PageHeader>
          <h1 className="tracking-tight text-foreground">
            <span className="text-[36px] font-bold font-handwriting leading-none mr-2">pew</span>
            <span className="text-[19px] font-normal text-muted-foreground">
              Profile
            </span>
          </h1>
        </PageHeader>
        <main className="flex-1 py-8">
          <LeaderboardNav />
          <div className="mt-8 text-center space-y-4">
            <p className="text-destructive">Failed to load profile: {error}</p>
            <Link
              href="/leaderboard"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to leaderboard
            </Link>
          </div>
        </main>
        <footer className="py-8 text-center border-t border-border">
          <p className="text-xs text-muted-foreground">
            Powered by{" "}
            <Link href="/" className="text-primary hover:underline font-handwriting">
              pew
            </Link>{" "}
            — show your tokens
          </p>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 md:px-6">
      {/* Header */}
      <PageHeader>
        <h1 className="tracking-tight text-foreground">
          <span className="text-[36px] font-bold font-handwriting leading-none mr-2">pew</span>
          <span className="text-[19px] font-normal text-muted-foreground">
            Profile
          </span>
        </h1>
      </PageHeader>

      <main className="flex-1 py-4 space-y-4 md:space-y-6">
        {/* Tab nav */}
        <LeaderboardNav />

        {/* Profile header */}
        {loading && !user ? (
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ) : (
          user && (
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                {user.image && (
                  <AvatarImage src={user.image} alt={user.name ?? slug} />
                )}
                <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                  {(user.name ?? slug)[0]?.toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
              <div>
                <h2 className="text-2xl font-bold font-display text-foreground">
                  {user.name ?? slug}
                </h2>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  Member since {formatMemberSince(user.created_at)}
                </p>
              </div>
            </div>
          )
        )}

        {/* Loading */}
        {loading && <ProfileSkeleton />}

        {/* Content */}
        {!loading && data && (
          <>
            {/* Stat cards — top row */}
            <StatGrid columns={3}>
              <StatCard
                title="Total Tokens"
                value={formatTokens(data.summary.total_tokens)}
                subtitle="Last 30 days"
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
                value={
                  data.summary.input_tokens > 0
                    ? `${Math.round((data.summary.cached_input_tokens / data.summary.input_tokens) * 100)}%`
                    : "0%"
                }
                subtitle={`${formatTokens(data.summary.cached_input_tokens)} cached tokens`}
                icon={Database}
                iconColor="text-success"
              />
            </StatGrid>

            {/* Token breakdown — secondary row */}
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
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3 md:gap-4">
              <UsageTrendChart data={daily} />
              <SourceDonutChart data={sources} />
            </div>

            {/* Model breakdown */}
            <ModelBreakdownChart data={models} />

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
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="py-8 text-center border-t border-border">
        <p className="text-xs text-muted-foreground">
          Powered by{" "}
          <Link href="/" className="text-primary hover:underline font-handwriting">
            pew
          </Link>{" "}
          — show your tokens
        </p>
      </footer>
    </div>
  );
}
