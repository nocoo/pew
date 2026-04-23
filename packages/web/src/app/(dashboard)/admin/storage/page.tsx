"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  X,
  Trash2,
  RefreshCw,
  Database,
  HardDrive,
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
import {
  UserProfileDialog,
  type ProfileDialogTab,
} from "@/components/user-profile-dialog";
import type {
  StorageUserRow,
  StorageSummary,
} from "@/app/api/admin/storage/route";
import type {
  CacheListResponse,
  CacheClearResponse,
} from "@/app/api/admin/cache/route";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortKey = "usage_row_count" | "session_count" | "total_tokens";

type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format duration in seconds to human-readable string */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Parse cache key and return human-readable description */
function describeCacheKey(key: string): { type: string; description: string } {
  if (key === "pricing:all") {
    return {
      type: "Pricing",
      description: "Model pricing data (24h TTL)",
    };
  }
  if (key === "seasons:list") {
    return {
      type: "Seasons",
      description: "Season list for navigation (5min TTL)",
    };
  }
  if (key.startsWith("season:") && key.endsWith(":snapshots")) {
    const seasonId = key.slice(7, -10); // Extract season ID
    return {
      type: "Snapshot",
      description: `Frozen season leaderboard: ${seasonId.slice(0, 8)}... (24h TTL)`,
    };
  }
  if (key.startsWith("lb:global:")) {
    const parts = key.slice(10).split(":");
    const filters: string[] = [];
    if (parts[0] && parts[0] !== "_") filters.push(`from=${parts[0]}`);
    if (parts[1] && parts[1] !== "_") filters.push(`source=${parts[1]}`);
    if (parts[2] && parts[2] !== "_") filters.push(`model=${parts[2]}`);
    const limit = parts[3] ?? "50";
    const offset = parts[4] ?? "0";
    const filterStr = filters.length > 0 ? filters.join(", ") : "no filters";
    return {
      type: "Leaderboard",
      description: `Public leaderboard (${filterStr}, limit=${limit}, offset=${offset}) (5min TTL)`,
    };
  }
  // Achievement earners: ach:{id}:earners:{limit}:{offset}
  if (key.startsWith("ach:") && key.includes(":earners:")) {
    const parts = key.split(":");
    const achievementId = parts[1] ?? "?";
    const limit = parts[3] ?? "5";
    const offset = parts[4] ?? "0";
    return {
      type: "Achievement",
      description: `Earners for "${achievementId}" (limit=${limit}, offset=${offset}) (15min TTL)`,
    };
  }
  // Achievement earners count: ach:{id}:count
  if (key.startsWith("ach:") && key.endsWith(":count")) {
    const achievementId = key.slice(4, -6); // Extract achievement ID
    return {
      type: "Achievement",
      description: `Earners count for "${achievementId}" (15min TTL)`,
    };
  }
  return {
    type: "Unknown",
    description: key,
  };
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function StorageSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left column skeleton */}
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-secondary p-4">
              <Skeleton className="h-3 w-12 mb-2" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-secondary p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <div className="flex-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
      {/* Right column skeleton */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-secondary p-4">
              <Skeleton className="h-3 w-12 mb-2" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-secondary p-4">
          <Skeleton className="h-4 w-24 mb-3" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full mb-2" />
          ))}
        </div>
      </div>
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

  const ariaSort = isActive
    ? currentDir === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th
      aria-sort={ariaSort as "ascending" | "descending" | "none"}
      className={cn(
        "px-4 py-3 text-xs font-medium text-muted-foreground",
        className
      )}
    >
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

  // DB data
  const [users, setUsers] = useState<StorageUserRow[]>([]);
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & sort
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("usage_row_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Profile dialog
  const [dialogUser, setDialogUser] = useState<StorageUserRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<ProfileDialogTab>("total");

  // Cache management
  const [cacheKeys, setCacheKeys] = useState<string[]>([]);
  const [cacheCount, setCacheCount] = useState(0);
  const [cacheTruncated, setCacheTruncated] = useState(false);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [cacheDeletingKey, setCacheDeletingKey] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);

  const openProfileDialog = useCallback(
    (user: StorageUserRow, tab: ProfileDialogTab = "total") => {
      setDialogUser(user);
      setDialogTab(tab);
      setDialogOpen(true);
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Cache management handlers
  // ---------------------------------------------------------------------------

  const fetchCacheKeys = useCallback(async () => {
    setCacheLoading(true);
    setCacheError(null);
    try {
      const res = await fetch("/api/admin/cache");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CacheListResponse;
      setCacheKeys(data.keys);
      setCacheCount(data.count);
      setCacheTruncated(data.truncated);
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setCacheLoading(false);
    }
  }, []);

  const handleClearCache = useCallback(async () => {
    if (!confirm("Clear all cache entries? This cannot be undone.")) return;
    setCacheClearing(true);
    setCacheError(null);
    try {
      const res = await fetch("/api/admin/cache", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CacheClearResponse;
      // Refresh list after clearing
      await fetchCacheKeys();
      alert(
        `Cleared ${data.deleted} cache entries${data.truncated ? " (more remain)" : ""}`
      );
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : "Failed to clear");
    } finally {
      setCacheClearing(false);
    }
  }, [fetchCacheKeys]);

  const handleInvalidateKey = useCallback(
    async (key: string) => {
      setCacheDeletingKey(key);
      try {
        const res = await fetch(
          `/api/admin/cache?key=${encodeURIComponent(key)}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Refresh list
        await fetchCacheKeys();
      } catch (err) {
        setCacheError(
          err instanceof Error ? err.message : "Failed to invalidate"
        );
      } finally {
        setCacheDeletingKey(null);
      }
    },
    [fetchCacheKeys]
  );

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
    if (isAdmin) {
      fetchData();
      fetchCacheKeys();
    }
  }, [isAdmin, fetchData, fetchCacheKeys]);

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

  // Cache key type counts
  const cacheTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const key of cacheKeys) {
      const { type } = describeCacheKey(key);
      counts[type] = (counts[type] ?? 0) + 1;
    }
    return counts;
  }, [cacheKeys]);

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
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
            Storage
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Database and cache storage overview.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-card bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load storage stats: {error}
          </div>
        )}

        {/* Loading */}
        {loading && <StorageSkeleton />}

        {/* Main content - Two columns */}
        {!loading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column: DB Usage */}
            <div className="flex flex-col gap-4 lg:max-h-[calc(100vh-12rem)] lg:overflow-hidden">
              {/* Section header */}
              <div className="flex items-center gap-2 shrink-0">
                <Database
                  className="h-4 w-4 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <h2 className="font-medium">Database (D1)</h2>
              </div>

              {/* Summary cards */}
              {summary && (
                <div className="grid grid-cols-3 gap-3 shrink-0">
                  <div className="rounded-xl bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">Users</p>
                    <p className="text-xl font-semibold tabular-nums mt-1">
                      {summary.total_users.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-xl bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">Usage Rows</p>
                    <p className="text-xl font-semibold tabular-nums mt-1">
                      {summary.total_usage_rows.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-xl bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">Tokens</p>
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
                    <p className="text-xs text-muted-foreground">Messages</p>
                    <p className="text-xl font-semibold tabular-nums mt-1">
                      {summary.total_messages.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-xl bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">Duration</p>
                    <p className="text-xl font-semibold tabular-nums mt-1">
                      {formatDuration(summary.total_duration_seconds)}
                    </p>
                  </div>
                </div>
              )}

              {/* Search bar */}
              {users.length > 0 && (
                <div className="flex items-center gap-3 shrink-0">
                  <div className="relative flex-1">
                    <Search
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                      strokeWidth={1.5}
                    />
                    <input
                      type="text"
                      placeholder="Filter users..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full rounded-lg border border-border bg-secondary pl-9 pr-8 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
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
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {filteredUsers.length}/{users.length}
                  </span>
                </div>
              )}

              {/* User table */}
              {filteredUsers.length === 0 ? (
                <div className="rounded-xl bg-secondary p-8 text-center text-sm text-muted-foreground">
                  {search ? "No users match your filter." : "No users found."}
                </div>
              ) : (
                <div className="rounded-xl bg-secondary overflow-x-auto flex-1 lg:overflow-y-auto min-h-0">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10 bg-secondary shadow-[0_1px_0_0_hsl(var(--border)/0.3)]">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                          User
                        </th>
                        <SortHeader
                          label="Rows"
                          sortKey="usage_row_count"
                          currentSort={sortKey}
                          currentDir={sortDir}
                          onSort={handleSort}
                          className="text-right"
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
                          label="Tokens"
                          sortKey="total_tokens"
                          currentSort={sortKey}
                          currentDir={sortDir}
                          onSort={handleSort}
                          className="text-right hidden md:table-cell"
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((user) => (
                        <tr
                          key={user.user_id}
                          className="border-b border-border/30 last:border-0 hover:bg-accent/30 transition-colors"
                        >
                          {/* User */}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => openProfileDialog(user)}
                              className="flex items-center gap-3 min-w-0 text-left hover:opacity-80 transition-opacity cursor-pointer"
                            >
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
                                  {user.email ?? user.user_id}
                                </p>
                              </div>
                            </button>
                          </td>
                          {/* Usage rows */}
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-medium tabular-nums">
                              {user.usage_row_count.toLocaleString()}
                            </span>
                          </td>
                          {/* Sessions */}
                          <td className="px-4 py-3 text-right hidden sm:table-cell">
                            <span className="text-sm text-muted-foreground tabular-nums">
                              {user.session_count.toLocaleString()}
                            </span>
                          </td>
                          {/* Tokens */}
                          <td className="px-4 py-3 text-right hidden md:table-cell">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm text-muted-foreground tabular-nums cursor-default">
                                  {formatTokens(user.total_tokens)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {formatTokensFull(user.total_tokens)}
                              </TooltipContent>
                            </Tooltip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Right Column: KV Cache */}
            <div className="flex flex-col gap-4 lg:max-h-[calc(100vh-12rem)] lg:overflow-hidden">
              {/* Section header with actions */}
              <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <HardDrive
                    className="h-4 w-4 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                  <h2 className="font-medium">Edge Cache (KV)</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchCacheKeys}
                    disabled={cacheLoading}
                    className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <RefreshCw
                      className={cn(
                        "h-3 w-3",
                        cacheLoading && "animate-spin"
                      )}
                      strokeWidth={1.5}
                    />
                    Refresh
                  </button>
                  <button
                    onClick={handleClearCache}
                    disabled={cacheLoading || cacheClearing || cacheKeys.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 text-destructive px-3 py-1.5 text-xs font-medium hover:bg-destructive/20 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                    Clear All
                  </button>
                </div>
              </div>

              {/* Cache error */}
              {cacheError && (
                <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive shrink-0">
                  {cacheError}
                </div>
              )}

              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3 shrink-0">
                <div className="rounded-xl bg-secondary p-4">
                  <p className="text-xs text-muted-foreground">Cached Keys</p>
                  <p className="text-xl font-semibold tabular-nums mt-1">
                    {cacheCount.toLocaleString()}
                    {cacheTruncated && (
                      <span className="text-xs text-muted-foreground font-normal ml-1">
                        +
                      </span>
                    )}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary p-4">
                  <p className="text-xs text-muted-foreground">Cache Types</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {Object.entries(cacheTypeCounts).map(([type, count]) => (
                      <span
                        key={type}
                        className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
                      >
                        <span className="text-muted-foreground">{type}:</span>
                        <span className="font-medium tabular-nums">{count}</span>
                      </span>
                    ))}
                    {Object.keys(cacheTypeCounts).length === 0 && (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Cache key list */}
              {cacheLoading ? (
                <div className="rounded-xl bg-secondary p-4 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : cacheKeys.length === 0 ? (
                <div className="rounded-xl bg-secondary p-8 text-center text-sm text-muted-foreground">
                  No cached entries. Cache will be populated as users access
                  pricing, seasons, and leaderboards.
                </div>
              ) : (
                <div className="rounded-xl bg-secondary p-1 space-y-1 flex-1 lg:overflow-y-auto min-h-0">
                  {cacheKeys.map((key) => {
                    const { type, description } = describeCacheKey(key);
                    const isDeleting = cacheDeletingKey === key;

                    return (
                      <div
                        key={key}
                        className={cn(
                          "flex items-start gap-3 rounded-lg bg-secondary p-3 group",
                          isDeleting && "opacity-50"
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                                type === "Pricing" &&
                                  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                                type === "Seasons" &&
                                  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                                type === "Snapshot" &&
                                  "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
                                type === "Leaderboard" &&
                                  "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
                                type === "Achievement" &&
                                  "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
                                type === "Unknown" &&
                                  "bg-secondary text-muted-foreground"
                              )}
                            >
                              {type}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {description}
                          </p>
                          <code className="text-[10px] text-muted-foreground/60 font-mono block mt-1 truncate">
                            {key}
                          </code>
                        </div>
                        <button
                          onClick={() => handleInvalidateKey(key)}
                          disabled={isDeleting}
                          className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus:text-destructive focus:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                          title="Delete this cache entry"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      </div>
                    );
                  })}
                  {cacheTruncated && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      More keys exist beyond the 10,000 limit
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Profile dialog */}
      {dialogUser && (
        <UserProfileDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          slug={dialogUser.slug ?? dialogUser.user_id}
          name={dialogUser.name}
          image={dialogUser.image}
          defaultTab={dialogTab}
        />
      )}
    </TooltipProvider>
  );
}
