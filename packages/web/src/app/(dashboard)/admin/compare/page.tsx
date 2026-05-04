"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  X,
  Users,
  Check,
} from "lucide-react";
import { cn, formatTokens, formatTokensFull } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { ErrorBanner } from "@/components/ui/error-banner";
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
import { CHART_COLORS } from "@/lib/palette";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortKey =
  | "total_tokens"
  | "tokens_7d"
  | "tokens_30d"
  | "session_count"
  | "total_messages";

type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

const EMPTY_USERS: StorageUserRow[] = [];

function SelectionSkeleton() {
  return (
    <div className="space-y-3">
      {/* Table skeleton */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-secondary p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-5 w-5 rounded" />
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
// Page Content
// ---------------------------------------------------------------------------

function ComparePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAdmin, loading: adminLoading } = useAdmin();

  const { data, error: swrError, isLoading } = useSWR<{
    users: StorageUserRow[];
    summary: StorageSummary;
  }>(isAdmin ? "/api/admin/storage" : null, fetcher);
  const users = data?.users ?? EMPTY_USERS;
  const loading = isAdmin ? isLoading : false;
  const error = swrError
    ? swrError instanceof Error
      ? swrError.message
      : "Failed to load."
    : null;

  // Selected users (restore from URL if present)
  const initialUserIds = useMemo(() => {
    const param = searchParams.get("userIds");
    return param ? param.split(",").filter(Boolean) : [];
  }, [searchParams]);
  const [selectedUserIds, setSelectedUserIds] =
    useState<string[]>(initialUserIds);

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
  // Selection handlers
  // ---------------------------------------------------------------------------

  const toggleUser = useCallback((userId: string) => {
    setSelectedUserIds((prev) => {
      if (prev.includes(userId)) {
        return prev.filter((id) => id !== userId);
      }
      if (prev.length >= 10) return prev; // Max 10
      return [...prev, userId];
    });
  }, []);

  const removeUser = useCallback((userId: string) => {
    setSelectedUserIds((prev) => prev.filter((id) => id !== userId));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedUserIds([]);
  }, []);

  // ---------------------------------------------------------------------------
  // Navigate to compare
  // ---------------------------------------------------------------------------

  const handleCompare = useCallback(() => {
    if (selectedUserIds.length < 2) return;
    router.push(`/admin/compare/result?userIds=${selectedUserIds.join(",")}`);
  }, [selectedUserIds, router]);

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

  // Selected user objects (for chips)
  const selectedUsers = useMemo(() => {
    const userMap = new Map(users.map((u) => [u.user_id, u]));
    return selectedUserIds
      .map((id) => userMap.get(id))
      .filter((u): u is StorageUserRow => u !== undefined);
  }, [users, selectedUserIds]);

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
        <SelectionSkeleton />
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
            Select 2-10 users to compare their token usage trends.
          </p>
        </div>

        {/* Selected user chips */}
        {selectedUsers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-secondary/50 border border-border">
            <span className="text-xs text-muted-foreground mr-1">Selected:</span>
            {selectedUsers.map((user, i) => (
              <div
                key={user.user_id}
                className="flex items-center gap-2 rounded-full border border-border bg-background pl-1 pr-2 py-0.5"
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
                <button
                  onClick={() => removeUser(user.user_id)}
                  className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-accent transition-colors"
                >
                  <X className="h-2.5 w-2.5" strokeWidth={2} />
                </button>
              </div>
            ))}
            <span className="text-xs text-muted-foreground tabular-nums ml-auto">
              {selectedUsers.length}/10
            </span>
            {selectedUsers.length > 0 && (
              <button
                onClick={clearSelection}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
            <button
              onClick={handleCompare}
              disabled={selectedUsers.length < 2}
              className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
              Compare
            </button>
          </div>
        )}

        {/* Error */}
        <ErrorBanner messagePrefix="Failed to load users" error={error} />

        {/* Search bar */}
        {!loading && users.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <input
                type="text"
                placeholder="Filter by name or email..."
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
        {loading && <SelectionSkeleton />}

        {/* Table */}
        {!loading && (
          <>
            {filteredUsers.length === 0 ? (
              <div className="rounded-card bg-secondary p-8 text-center text-sm text-muted-foreground">
                {search ? "No users match your filter." : "No users found."}
              </div>
            ) : (
              <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground w-10">
                        <span className="sr-only">Select</span>
                      </th>
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
                        label="7d"
                        sortKey="tokens_7d"
                        currentSort={sortKey}
                        currentDir={sortDir}
                        onSort={handleSort}
                        className="text-right hidden md:table-cell"
                      />
                      <SortHeader
                        label="30d"
                        sortKey="tokens_30d"
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
                        className="text-right hidden lg:table-cell"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => {
                      const isSelected = selectedUserIds.includes(user.user_id);
                      const isDisabled =
                        !isSelected && selectedUserIds.length >= 10;

                      return (
                        <tr
                          key={user.user_id}
                          className={cn(
                            "border-b border-border/50 last:border-0 transition-colors",
                            isSelected
                              ? "bg-accent/30"
                              : "hover:bg-accent/50",
                            isDisabled && "opacity-50"
                          )}
                        >
                          {/* Checkbox */}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => toggleUser(user.user_id)}
                              disabled={isDisabled}
                              className={cn(
                                "flex h-5 w-5 items-center justify-center rounded border-2 transition-colors",
                                isSelected
                                  ? "border-primary bg-primary"
                                  : "border-muted-foreground/30 bg-background hover:border-primary/50",
                                isDisabled && "cursor-not-allowed opacity-50"
                              )}
                            >
                              {isSelected && (
                                <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />
                              )}
                            </button>
                          </td>
                          {/* User */}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => toggleUser(user.user_id)}
                              disabled={isDisabled}
                              className="flex items-center gap-3 min-w-0 text-left hover:opacity-80 transition-opacity cursor-pointer disabled:cursor-not-allowed"
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
                          {/* 7d tokens */}
                          <td className="px-4 py-3 text-right hidden md:table-cell">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm text-muted-foreground tabular-nums cursor-default">
                                  {formatTokens(user.tokens_7d)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {formatTokensFull(user.tokens_7d)}
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          {/* 30d tokens */}
                          <td className="px-4 py-3 text-right hidden md:table-cell">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm text-muted-foreground tabular-nums cursor-default">
                                  {formatTokens(user.tokens_30d)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {formatTokensFull(user.tokens_30d)}
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
                          <td className="px-4 py-3 text-right hidden lg:table-cell">
                            <span className="text-sm text-muted-foreground tabular-nums">
                              {user.total_messages.toLocaleString()}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Empty state - show compare button if users selected */}
        {!loading && selectedUsers.length >= 2 && (
          <div className="flex justify-center pt-2">
            <button
              onClick={handleCompare}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Users className="h-4 w-4" strokeWidth={1.5} />
              Compare {selectedUsers.length} Users
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Export with Suspense
// ---------------------------------------------------------------------------

export default function AdminComparePage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 md:space-y-6">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80 mt-2" />
          </div>
          <SelectionSkeleton />
        </div>
      }
    >
      <ComparePageContent />
    </Suspense>
  );
}
