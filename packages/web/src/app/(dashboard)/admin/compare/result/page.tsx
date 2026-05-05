"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { formatTokens, formatTokensFull } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { useTzOffset } from "@/hooks/use-tz-offset";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
} from "recharts";
import { CHART_COLORS, chartAxis } from "@/lib/palette";
import { DashboardResponsiveContainer } from "@/components/dashboard/dashboard-responsive-container";
import {
  ChartTooltip,
  ChartTooltipRow,
  ChartTooltipSummary,
} from "@/components/dashboard/chart-tooltip";
import type {
  CompareUser,
  CompareResponse,
} from "@/app/api/admin/usage/compare/route";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChartDataPoint {
  date: string;
  [userId: string]: string | number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format date string "2026-03-07" to "Mar 7" */
function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function getUserLabel(user: CompareUser): string {
  return user.name ?? user.email ?? user.id;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function CompareSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-secondary p-4">
        <Skeleton className="h-[280px] w-full" />
      </div>
      <div className="rounded-xl bg-secondary p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare Tooltip
// ---------------------------------------------------------------------------

function CompareTooltipContent({
  active,
  payload,
  label,
  users,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  users: CompareUser[];
}) {
  if (!active || !payload?.length) return null;

  const total = payload.reduce((sum, e) => sum + (e.value ?? 0), 0);
  const userMap = new Map(users.map((u) => [u.id, u]));

  return (
    <ChartTooltip title={label ? fmtDate(label) : undefined}>
      {payload
        .filter((e) => e.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((entry) => {
          const user = userMap.get(entry.dataKey);
          return (
            <ChartTooltipRow
              key={entry.dataKey}
              color={entry.color}
              label={user ? getUserLabel(user) : entry.dataKey}
              value={formatTokens(entry.value)}
              tabularNums
            />
          );
        })}
      {payload.length > 1 && (
        <ChartTooltipSummary label="Total" value={formatTokens(total)} />
      )}
    </ChartTooltip>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function CompareResultContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAdmin, loading: adminLoading } = useAdmin();

  // Get userIds from URL
  const userIdsParam = searchParams.get("userIds") ?? "";
  const userIds = useMemo(
    () => userIdsParam.split(",").filter(Boolean),
    [userIdsParam]
  );

  // Filters
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [sourceFilter, setSourceFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const tzOffset = useTzOffset();

  // Data via SWR
  const swrKey = useMemo(() => {
    if (!isAdmin || userIds.length === 0) return null;
    const params = new URLSearchParams({
      userIds: userIds.join(","),
      from: dateFrom,
      to: dateTo,
      tzOffset: String(tzOffset),
    });
    if (sourceFilter) params.set("source", sourceFilter);
    if (modelFilter) params.set("model", modelFilter);
    return `/api/admin/usage/compare?${params}`;
  }, [isAdmin, userIds, dateFrom, dateTo, sourceFilter, modelFilter, tzOffset]);

  const { data, error: swrError, isLoading } = useSWR<CompareResponse>(swrKey, fetcher);
  const loading = swrKey ? isLoading : false;
  const error = swrError
    ? swrError instanceof Error
      ? swrError.message
      : "Failed to load."
    : null;

  // ---------------------------------------------------------------------------
  // Redirect non-admins or invalid params
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      router.replace("/");
    }
  }, [adminLoading, isAdmin, router]);

  useEffect(() => {
    if (!adminLoading && userIds.length === 0) {
      router.replace("/admin/compare");
    }
  }, [adminLoading, userIds.length, router]);

  // ---------------------------------------------------------------------------
  // Chart data
  // ---------------------------------------------------------------------------

  const chartData = useMemo((): ChartDataPoint[] => {
    if (!data?.daily) return [];
    return data.daily.map((d) => ({
      date: d.date,
      ...d.users,
    }));
  }, [data]);

  // ---------------------------------------------------------------------------
  // User table data
  // ---------------------------------------------------------------------------

  const userTableData = useMemo(() => {
    if (!data) return [];

    const totals = new Map<string, number>();
    const lastActive = new Map<string, string>();

    for (const day of data.daily) {
      for (const [userId, tokens] of Object.entries(day.users)) {
        totals.set(userId, (totals.get(userId) ?? 0) + tokens);
        const current = lastActive.get(userId);
        if (!current || day.date > current) {
          lastActive.set(userId, day.date);
        }
      }
    }

    const dayCount = data.daily.length || 1;

    return data.users
      .map((user) => ({
        ...user,
        totalTokens: totals.get(user.id) ?? 0,
        dailyAvg: Math.round((totals.get(user.id) ?? 0) / dayCount),
        lastActive: lastActive.get(user.id) ?? "—",
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }, [data]);

  // ---------------------------------------------------------------------------
  // Color map for users
  // ---------------------------------------------------------------------------

  const userColorMap = useMemo(() => {
    const map = new Map<string, string>();
    (data?.users ?? []).forEach((u, i) => {
      map.set(u.id, CHART_COLORS[i % CHART_COLORS.length] as string);
    });
    return map;
  }, [data?.users]);

  // ---------------------------------------------------------------------------
  // Guard
  // ---------------------------------------------------------------------------

  if (adminLoading) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80 mt-2" />
        </div>
        <CompareSkeleton />
      </div>
    );
  }

  if (!isAdmin || userIds.length === 0) return null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4 md:space-y-6">
        {/* Header with back button */}
        <div className="flex items-start gap-4">
          <button
            onClick={() => router.push(`/admin/compare?userIds=${userIdsParam}`)}
            className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
              Compare Users
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data
                ? `Comparing ${data.users.length} user${data.users.length !== 1 ? "s" : ""}.`
                : "Loading comparison..."}
            </p>
          </div>
        </div>

        {/* Selected user chips */}
        {data && data.users.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {data.users.map((user, i) => (
              <div
                key={user.id}
                className="flex items-center gap-2 rounded-full border border-border bg-secondary pl-1 pr-3 py-0.5"
              >
                <Avatar className="h-5 w-5 shrink-0">
                  {user.image && (
                    <AvatarImage src={user.image} alt={user.name ?? ""} />
                  )}
                  <AvatarFallback className="text-[8px] bg-primary text-primary-foreground">
                    {(user.name ?? user.email ?? "?")[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: CHART_COLORS[
                      i % CHART_COLORS.length
                    ] as string,
                  }}
                />
                <span className="text-xs font-medium truncate max-w-[120px]">
                  {user.name ?? user.email}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {/* Agent filter */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            <option value="">All Agents</option>
            {(data?.sources ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Model filter */}
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            <option value="">All Models</option>
            {(data?.models ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Error */}
        <ErrorBanner messagePrefix="Failed to load comparison data" error={error} />

        {/* Loading */}
        {loading && <CompareSkeleton />}

        {/* Chart */}
        {!loading && data && chartData.length > 0 && (
          <div className="rounded-card bg-secondary p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs md:text-sm text-muted-foreground">
                Daily Token Usage
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {data.users.map((user, i) => (
                  <div key={user.id} className="flex items-center gap-1.5">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: CHART_COLORS[
                          i % CHART_COLORS.length
                        ] as string,
                      }}
                    />
                    <span className="text-xs text-muted-foreground">
                      {getUserLabel(user)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="h-[240px] md:h-[320px]">
              <DashboardResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={chartAxis}
                    strokeOpacity={0.15}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    tick={{ fill: chartAxis, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={formatTokens}
                    tick={{ fill: chartAxis, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <RechartsTooltip
                    content={<CompareTooltipContent users={data.users} />}
                    isAnimationActive={false}
                  />
                  {data.users.map((user, i) => (
                    <Line
                      key={user.id}
                      type="monotone"
                      dataKey={user.id}
                      name={getUserLabel(user)}
                      stroke={CHART_COLORS[i % CHART_COLORS.length] as string}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  ))}
                </LineChart>
              </DashboardResponsiveContainer>
            </div>
          </div>
        )}

        {/* No data for range */}
        {!loading && data && chartData.length === 0 && (
          <div className="rounded-card bg-secondary p-8 text-center text-sm text-muted-foreground">
            No usage data in the selected date range.
          </div>
        )}

        {/* User Table */}
        {!loading && userTableData.length > 0 && (
          <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    User
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                    Total Tokens
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">
                    Daily Avg
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground hidden md:table-cell">
                    Last Active
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground w-10">
                    <span className="sr-only">Link</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {userTableData.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
                  >
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              userColorMap.get(user.id) ?? chartAxis,
                          }}
                        />
                        <Avatar className="h-7 w-7 shrink-0">
                          {user.image && (
                            <AvatarImage
                              src={user.image}
                              alt={user.name ?? ""}
                            />
                          )}
                          <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
                            {(
                              user.name ??
                              user.email ??
                              "?"
                            )[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          {user.name && (
                            <p className="text-sm font-medium text-foreground truncate">
                              {user.name}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground truncate">
                            {user.email ?? user.id}
                          </p>
                        </div>
                      </div>
                    </td>
                    {/* Total Tokens */}
                    <td className="px-4 py-3 text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm tabular-nums cursor-default">
                            {formatTokens(user.totalTokens)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {formatTokensFull(user.totalTokens)}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    {/* Daily Avg */}
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {formatTokens(user.dailyAvg)}
                      </span>
                    </td>
                    {/* Last Active */}
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {user.lastActive !== "—"
                          ? fmtDate(user.lastActive)
                          : "—"}
                      </span>
                    </td>
                    {/* Profile link */}
                    <td className="px-4 py-3 text-right">
                      {user.slug && (
                        <a
                          href={`/u/${user.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink
                            className="h-3.5 w-3.5"
                            strokeWidth={1.5}
                          />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Export with Suspense
// ---------------------------------------------------------------------------

export default function AdminCompareResultPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 md:space-y-6">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80 mt-2" />
          </div>
          <CompareSkeleton />
        </div>
      }
    >
      <CompareResultContent />
    </Suspense>
  );
}
