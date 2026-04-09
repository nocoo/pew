"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X, ExternalLink } from "lucide-react";
import { formatTokens, formatTokensFull } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
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

interface SearchUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

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
      <Skeleton className="h-10 w-full max-w-sm" />
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

export default function AdminComparePage() {
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdmin();

  // Selected users
  const [selectedUsers, setSelectedUsers] = useState<SearchUser[]>([]);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filters
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [sourceFilter, setSourceFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");

  // Data
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Redirect non-admins
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      router.replace("/");
    }
  }, [adminLoading, isAdmin, router]);

  // ---------------------------------------------------------------------------
  // Close search dropdown on outside click
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ---------------------------------------------------------------------------
  // Search users (debounced)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/users?q=${encodeURIComponent(q)}&limit=10`
        );
        if (res.ok) {
          const json = (await res.json()) as { users: SearchUser[] };
          // Filter out already selected
          const selectedIds = new Set(selectedUsers.map((u) => u.id));
          setSearchResults(
            json.users.filter((u) => !selectedIds.has(u.id))
          );
          setSearchOpen(true);
        }
      } catch {
        // Ignore search errors
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, selectedUsers]);

  // ---------------------------------------------------------------------------
  // Fetch comparison data
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    if (selectedUsers.length === 0) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        userIds: selectedUsers.map((u) => u.id).join(","),
        from: dateFrom,
        to: dateTo,
      });
      if (sourceFilter) params.set("source", sourceFilter);
      if (modelFilter) params.set("model", modelFilter);

      const res = await fetch(`/api/admin/usage/compare?${params}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          (json as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }

      const json = (await res.json()) as CompareResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedUsers, dateFrom, dateTo, sourceFilter, modelFilter]);

  useEffect(() => {
    if (isAdmin) fetchData();
  }, [isAdmin, fetchData]);

  // ---------------------------------------------------------------------------
  // User selection
  // ---------------------------------------------------------------------------

  const addUser = useCallback(
    (user: SearchUser) => {
      if (selectedUsers.length >= 10) return;
      if (selectedUsers.some((u) => u.id === user.id)) return;
      setSelectedUsers((prev) => [...prev, user]);
      setSearchQuery("");
      setSearchOpen(false);
    },
    [selectedUsers]
  );

  const removeUser = useCallback((userId: string) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
    // Reset filters that may no longer apply
    setSourceFilter("");
    setModelFilter("");
  }, []);

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
    selectedUsers.forEach((u, i) => {
      map.set(u.id, CHART_COLORS[i % CHART_COLORS.length] as string);
    });
    return map;
  }, [selectedUsers]);

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

  if (!isAdmin) return null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4 md:space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
            Compare Users
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare token usage trends across multiple users.
          </p>
        </div>

        {/* User Picker */}
        <div className="space-y-3">
          <div ref={searchRef} className="relative max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
              strokeWidth={1.5}
            />
            <input
              type="text"
              placeholder="Search users by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setSearchOpen(true);
              }}
              className="w-full rounded-lg border border-border bg-background pl-9 pr-8 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSearchOpen(false);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" strokeWidth={1.5} />
              </button>
            )}

            {/* Search dropdown */}
            {searchOpen && searchResults.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg max-h-64 overflow-y-auto">
                {searchResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => addUser(user)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent transition-colors first:rounded-t-lg last:rounded-b-lg"
                  >
                    <Avatar className="h-6 w-6 shrink-0">
                      {user.image && (
                        <AvatarImage
                          src={user.image}
                          alt={user.name ?? ""}
                        />
                      )}
                      <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
                        {(user.name ?? user.email ?? "?")[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      {user.name && (
                        <p className="text-sm font-medium truncate">
                          {user.name}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground truncate">
                        {user.email}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searchOpen && searching && searchResults.length === 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg p-3 text-xs text-muted-foreground">
                Searching...
              </div>
            )}

            {searchOpen &&
              !searching &&
              searchQuery.trim() &&
              searchResults.length === 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg p-3 text-xs text-muted-foreground">
                  No users found
                </div>
              )}
          </div>

          {/* Selected user chips */}
          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedUsers.map((user, i) => (
                <div
                  key={user.id}
                  className="flex items-center gap-2 rounded-full border border-border bg-secondary pl-1 pr-2 py-0.5"
                >
                  <Avatar className="h-5 w-5 shrink-0">
                    {user.image && (
                      <AvatarImage
                        src={user.image}
                        alt={user.name ?? ""}
                      />
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
                  <button
                    onClick={() => removeUser(user.id)}
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-accent transition-colors"
                  >
                    <X className="h-2.5 w-2.5" strokeWidth={2} />
                  </button>
                </div>
              ))}
              <span className="self-center text-xs text-muted-foreground tabular-nums">
                {selectedUsers.length}/10
              </span>
            </div>
          )}
        </div>

        {/* Filter Bar */}
        {selectedUsers.length > 0 && (
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
        )}

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load comparison data: {error}
          </div>
        )}

        {/* Loading */}
        {loading && <CompareSkeleton />}

        {/* Empty state */}
        {!loading && selectedUsers.length === 0 && (
          <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
            Search and select users above to compare their token usage.
          </div>
        )}

        {/* Chart */}
        {!loading && data && chartData.length > 0 && (
          <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
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
                    content={
                      <CompareTooltipContent users={data.users} />
                    }
                    isAnimationActive={false}
                  />
                  {data.users.map((user, i) => (
                    <Line
                      key={user.id}
                      type="monotone"
                      dataKey={user.id}
                      name={getUserLabel(user)}
                      stroke={
                        CHART_COLORS[i % CHART_COLORS.length] as string
                      }
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
        {!loading &&
          data &&
          chartData.length === 0 &&
          selectedUsers.length > 0 && (
            <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
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
