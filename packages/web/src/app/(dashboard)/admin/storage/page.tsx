"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  X,
} from "lucide-react";
import { cn, formatTokens, formatTokensFull } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  StorageUserRow,
  StorageSummary,
} from "@/app/api/admin/storage/route";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortKey =
  | "total_tokens"
  | "input_tokens"
  | "output_tokens"
  | "session_count"
  | "total_messages"
  | "total_duration_seconds"
  | "usage_row_count";

type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDurationFull(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function StorageSkeleton() {
  return (
    <div className="space-y-3">
      {/* Summary cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-secondary p-4">
            <Skeleton className="h-3 w-16 mb-2" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-secondary p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16 hidden md:block" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sort header button
// ---------------------------------------------------------------------------

function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = currentSort === sortKey;
  const Icon = isActive
    ? currentDir === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <th className={cn("px-4 py-3 text-xs font-medium text-muted-foreground", className)}>
      <button
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors ml-auto",
          isActive && "text-foreground"
        )}
      >
        {label}
        <Icon className="h-3 w-3" strokeWidth={1.5} />
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminStoragePage() {
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdmin();

  const [users, setUsers] = useState<StorageUserRow[]>([]);
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & sort
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_tokens");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ---------------------------------------------------------------------------
  // Redirect non-admins
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      router.replace("/");
    }
  }, [adminLoading, isAdmin, router]);

  // ---------------------------------------------------------------------------
  // Fetch data
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/storage");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        users: StorageUserRow[];
        summary: StorageSummary;
      };
      setUsers(json.users);
      setSummary(json.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchData();
  }, [isAdmin, fetchData]);

  // ---------------------------------------------------------------------------
  // Sort handler
  // ---------------------------------------------------------------------------

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("desc");
      }
    },
    [sortKey]
  );

  // ---------------------------------------------------------------------------
  // Filtered & sorted data
  // ---------------------------------------------------------------------------

  const filteredUsers = useMemo(() => {
    let list = users;

    // Text search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (u) =>
          (u.email ?? "").toLowerCase().includes(q) ||
          (u.name ?? "").toLowerCase().includes(q)
      );
    }

    // Sort
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return (Number(av) - Number(bv)) * dir;
    });

    return list;
  }, [users, search, sortKey, sortDir]);

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
        <StorageSkeleton />
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
          <h1 className="text-2xl font-bold font-display">Storage</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Database usage overview across all users.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load storage stats: {error}
          </div>
        )}

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-secondary p-4">
              <p className="text-xs text-muted-foreground">Users</p>
              <p className="text-xl font-semibold tabular-nums mt-1">
                {summary.total_users.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-secondary p-4">
              <p className="text-xs text-muted-foreground">Total Tokens</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xl font-semibold tabular-nums mt-1 cursor-default">
                    {formatTokens(summary.total_tokens)}
                  </p>
                </TooltipTrigger>
                <TooltipContent>
                  {formatTokensFull(summary.total_tokens)}
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="rounded-xl bg-secondary p-4">
              <p className="text-xs text-muted-foreground">Sessions</p>
              <p className="text-xl font-semibold tabular-nums mt-1">
                {summary.total_sessions.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-secondary p-4">
              <p className="text-xs text-muted-foreground">Usage Rows</p>
              <p className="text-xl font-semibold tabular-nums mt-1">
                {summary.total_usage_rows.toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Search bar */}
        {!loading && users.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
              <input
                type="text"
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-background pl-9 pr-8 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" strokeWidth={1.5} />
                </button>
              )}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {filteredUsers.length} of {users.length} users
            </span>
          </div>
        )}

        {/* Loading */}
        {loading && <StorageSkeleton />}

        {/* Table */}
        {!loading && (
          <>
            {filteredUsers.length === 0 ? (
              <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
                {search ? "No users match your search." : "No usage data yet."}
              </div>
            ) : (
              <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        User
                      </th>
                      <SortHeader
                        label="Total"
                        sortKey="total_tokens"
                        currentSort={sortKey}
                        currentDir={sortDir}
                        onSort={handleSort}
                        className="text-right"
                      />
                      <SortHeader
                        label="Input"
                        sortKey="input_tokens"
                        currentSort={sortKey}
                        currentDir={sortDir}
                        onSort={handleSort}
                        className="text-right hidden md:table-cell"
                      />
                      <SortHeader
                        label="Output"
                        sortKey="output_tokens"
                        currentSort={sortKey}
                        currentDir={sortDir}
                        onSort={handleSort}
                        className="text-right hidden md:table-cell"
                      />
                      <SortHeader
                        label="Sessions"
                        sortKey="session_count"
                        currentSort={sortKey}
                        currentDir={sortDir}
                        onSort={handleSort}
                        className="text-right hidden sm:table-cell"
                      />
                      <SortHeader
                        label="Messages"
                        sortKey="total_messages"
                        currentSort={sortKey}
                        currentDir={sortDir}
                        onSort={handleSort}
                        className="text-right hidden sm:table-cell"
                      />
                      <SortHeader
                        label="Duration"
                        sortKey="total_duration_seconds"
                        currentSort={sortKey}
                        currentDir={sortDir}
                        onSort={handleSort}
                        className="text-right hidden lg:table-cell"
                      />
                      <SortHeader
                        label="Rows"
                        sortKey="usage_row_count"
                        currentSort={sortKey}
                        currentDir={sortDir}
                        onSort={handleSort}
                        className="text-right hidden lg:table-cell"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr
                        key={user.user_id}
                        className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
                      >
                        {/* User */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar className="h-7 w-7 shrink-0">
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
                                <p className="text-sm font-medium text-foreground truncate">
                                  {user.name}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground truncate">
                                {user.email ?? user.user_id}
                              </p>
                            </div>
                          </div>
                        </td>
                        {/* Total tokens */}
                        <td className="px-4 py-3 text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm font-medium tabular-nums cursor-default">
                                {formatTokens(user.total_tokens)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {formatTokensFull(user.total_tokens)}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        {/* Input tokens */}
                        <td className="px-4 py-3 text-right hidden md:table-cell">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm text-muted-foreground tabular-nums cursor-default">
                                {formatTokens(user.input_tokens)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {formatTokensFull(user.input_tokens)}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        {/* Output tokens */}
                        <td className="px-4 py-3 text-right hidden md:table-cell">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm text-muted-foreground tabular-nums cursor-default">
                                {formatTokens(user.output_tokens)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {formatTokensFull(user.output_tokens)}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        {/* Sessions */}
                        <td className="px-4 py-3 text-right hidden sm:table-cell">
                          <span className="text-sm text-muted-foreground tabular-nums">
                            {user.session_count.toLocaleString()}
                          </span>
                        </td>
                        {/* Messages */}
                        <td className="px-4 py-3 text-right hidden sm:table-cell">
                          <span className="text-sm text-muted-foreground tabular-nums">
                            {user.total_messages.toLocaleString()}
                          </span>
                        </td>
                        {/* Duration */}
                        <td className="px-4 py-3 text-right hidden lg:table-cell">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm text-muted-foreground tabular-nums cursor-default">
                                {formatDuration(user.total_duration_seconds)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {formatDurationFull(user.total_duration_seconds)}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        {/* Usage rows */}
                        <td className="px-4 py-3 text-right hidden lg:table-cell">
                          <span className="text-sm text-muted-foreground tabular-nums">
                            {user.usage_row_count.toLocaleString()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
